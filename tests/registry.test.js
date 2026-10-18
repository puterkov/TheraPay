import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHmac} from 'node:crypto';
const source=fs.readFileSync(new URL('../distribution/Registry.gs',import.meta.url),'utf8');
function registry(){const rows=[['שם','מייל','שימוש']],requests=[];let locked=false;let claims={aud:'client-id',iss:'https://accounts.google.com',sub:'GOOGLE-SUB',email:'owner@example.com',email_verified:'true',exp:Math.floor(Date.now()/1000)+3600};
const props={REGISTRY_GOOGLE_CLIENT_ID:'client-id',REGISTRY_HMAC_SECRET:'registry-private-secret',REGISTRY_SPREADSHEET_ID:'REGISTRY-SHEET'};
const sheet={getDataRange:()=>({getValues:()=>rows.map(r=>[...r])}),appendRow:r=>rows.push([...r]),getRange:(r,c)=>({setValue:v=>rows[r-1][c-1]=v})};
const context={Date,JSON,String,Array,Object,Number,Math,Error,encodeURIComponent,
PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]})},
SpreadsheetApp:{openById:id=>{assert.equal(id,'REGISTRY-SHEET');return {getSheetByName:()=>sheet};}},
ContentService:{MimeType:{JSON:'json'},createTextOutput:body=>({body,setMimeType(){return this;}})},
LockService:{getScriptLock:()=>({tryLock(){locked=true;return true;},hasLock:()=>locked,releaseLock(){locked=false;}})},
Utilities:{computeHmacSha256Signature:(value,key)=>[...createHmac('sha256',key).update(value).digest()],base64EncodeWebSafe:value=>Buffer.from(value).toString('base64url'),base64DecodeWebSafe:value=>[...Buffer.from(value,'base64url')],newBlob:bytes=>({getDataAsString:()=>Buffer.from(bytes).toString('utf8')})},
UrlFetchApp:{fetch:url=>{requests.push(url);return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(claims)};}}
};vm.createContext(context);vm.runInContext(source,context);return {rows,requests,call:req=>JSON.parse(context.doPost({postData:{contents:JSON.stringify(req)}}).body),get claims(){return claims;},set claims(v){claims=v;}};}
test('registry saves only name email usage; signed receipt changes only usage and registration does not reset it',()=>{
 const f=registry();const result=f.call({action:'register',name:'דנה',idToken:'google-id-token'});assert.equal(result.success,true);assert.deepEqual(f.rows[1],['דנה','owner@example.com','לא']);
 assert.equal(f.call({action:'markUsed',receipt:result.receipt+'bad'}).success,false);assert.equal(f.rows[1][2],'לא');
 assert.equal(f.call({action:'markUsed',receipt:result.receipt}).success,true);assert.deepEqual(f.rows[1],['דנה','owner@example.com','כן']);
 f.call({action:'register',name:'דנה',idToken:'google-id-token'});assert.equal(f.rows[1][2],'כן');assert.equal(f.rows.length,2);assert.equal(f.rows[1].length,3);assert.ok(f.requests.every(url=>url.startsWith('https://oauth2.googleapis.com/tokeninfo?')));
});
test('registry rejects expired, unverified or wrong-audience Google identities before writing a row',()=>{
 for(const change of [{aud:'other-client'},{email_verified:false},{exp:1},{iss:'untrusted'}]){const f=registry();f.claims={...f.claims,...change};assert.equal(f.call({action:'register',name:'דנה',idToken:'token'}).success,false);assert.equal(f.rows.length,1);}
});

