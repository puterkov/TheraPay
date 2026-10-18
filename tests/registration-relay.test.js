import test from 'node:test';
import assert from 'node:assert/strict';
import {createRegistrationHandler} from '../api/register.js';
import {googleRequest,registerIdentity} from '../onboarding/google.js';
const registryUrl='https://script.google.com/macros/s/REGISTRY/exec';
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};}
test('registration relay forwards only identity fields to its fixed registry and returns only a receipt',async()=>{
 const calls=[],handler=createRegistrationHandler({registryUrl,fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({success:true,receipt:'signed-receipt',ignored:'not-returned'})};}}),res=response();
 await handler({method:'POST',body:{name:' User ',idToken:'identity-only'}},res);
 assert.equal(res.code,200);assert.deepEqual(res.body,{success:true,receipt:'signed-receipt'});assert.equal(res.headers['Cache-Control'],'no-store');assert.equal(calls[0].url,registryUrl);
 assert.deepEqual(JSON.parse(calls[0].options.body),{action:'register',name:'User',idToken:'identity-only'});
});
test('relay rejects credentials, arbitrary destinations and unsupported actions before sending any request',async()=>{
 let count=0;const handler=createRegistrationHandler({registryUrl,fetchImpl:async()=>{count++;}});
 for(const extra of [{morningKey:'private'},{accessToken:'private'},{url:'https://attacker.example'},{action:'markUsed'}]){const res=response();await handler({method:'POST',body:{name:'User',idToken:'identity',...extra}},res);assert.equal(res.code,400);}
 const res=response();await handler({method:'GET'},res);assert.equal(res.code,405);assert.equal(count,0);
});
test('relay returns safe errors on rejected authentication, transport failure and malformed upstream response',async()=>{
 for(const outcome of ['unauthorized','network','bad']){const res=response(),handler=createRegistrationHandler({registryUrl,fetchImpl:async()=>{if(outcome==='network')throw Error('private-google-response');return {ok:true,json:async()=>outcome==='bad'?{success:true}:{success:false,message:'private-google-response'}};}});await handler({method:'POST',body:{name:'User',idToken:'identity'}},res);assert.equal(res.body.success,false);assert.ok(!JSON.stringify(res.body).includes('private-google-response'));}
});
test('hosted registration uses same-origin transport; Google network failures name the operation without retrying',async()=>{
 let calls=0;
 const result=await registerIdentity(registryUrl,{name:'User'},'identity-only',{relay:true,fetchImpl:async(url,options)=>{calls++;assert.equal(url,'/api/register');assert.deepEqual(JSON.parse(options.body),{name:'User',idToken:'identity-only'});return {ok:true,json:async()=>({success:true,receipt:'receipt'})};}});
 assert.equal(result.receipt,'receipt');assert.equal(calls,1);
 await assert.rejects(googleRequest('private-token','https://script.googleapis.com/v1/projects',{method:'POST',fetchImpl:async()=>{throw TypeError('secret-debug-data');}}),e=>e.message.includes('יצירת פרויקט Apps Script')&&e.message.includes('NETWORK')&&!e.message.includes('secret'));
});
