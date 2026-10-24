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
