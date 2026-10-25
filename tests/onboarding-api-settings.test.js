import test from 'node:test';
import assert from 'node:assert/strict';
import {googleRequest} from '../onboarding/google.js';
test('Apps Script permission errors have a dedicated settings recovery code without exposing remote messages',async()=>{
 const fetchImpl=async()=>({ok:false,status:403,json:async()=>({error:{status:'PERMISSION_DENIED',message:'private source must not appear'}})});
 await assert.rejects(googleRequest('dummy','https://script.googleapis.com/v1/projects',{method:'POST',fetchImpl}),error=>{
  assert.equal(error.code,'SCRIPT_API_PERMISSION_REQUIRED');assert.match(error.message,/Google Apps Script API/);assert.ok(!error.message.includes('private source'));return true;
 });
 await assert.rejects(googleRequest('dummy','https://sheets.googleapis.com/v4/spreadsheets',{fetchImpl}),error=>{assert.equal(error.code,undefined);return true;});
});


test('new Apps Script resources tolerate temporary 404s on reads only and persistent failures remain diagnosable',async()=>{
 let calls=0;const delays=[];
 const missing=()=>({ok:false,status:404,json:async()=>({error:{status:'NOT_FOUND'}})});
 const result=await googleRequest('token','https://script.googleapis.com/v1/projects/P1',{fetchImpl:async()=>++calls<3?missing():{ok:true,status:200,json:async()=>({scriptId:'P1'})},retryDelay:async ms=>delays.push(ms)});
 assert.equal(result.scriptId,'P1');assert.equal(calls,3);assert.deepEqual(delays,[500,1500]);
 calls=0;await assert.rejects(googleRequest('token','https://script.googleapis.com/v1/projects/P1/deployments/D1',{fetchImpl:async()=>{calls++;return missing();},retryDelay:async()=>{}}),error=>{assert.equal(error.code,'HTTP_404');assert.match(error.message,/בדיקת פריסת הבקנד/);return true;});assert.equal(calls,4);
 calls=0;await assert.rejects(googleRequest('token','https://script.googleapis.com/v1/projects',{method:'POST',fetchImpl:async()=>{calls++;return missing();},retryDelay:async()=>{throw Error('Must not retry writes');}}));assert.equal(calls,1);
});
