import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {backendFiles} from '../onboarding/google.js';
import {prepareOwnerAuthorization,privateAuthorizationFiles} from '../onboarding/authorization.js';
const core=fs.readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8'),bootstrap=fs.readFileSync(new URL('../distribution/ClinicBootstrap.gs',import.meta.url),'utf8');
const resources={ownerEmail:'owner@example.com',spreadsheetId:'S1',scriptId:'P1',backendUrl:'https://script.google.com/macros/s/BACKEND/exec'};
function files(){return backendFiles(core,bootstrap,{ownerEmail:resources.ownerEmail,spreadsheetId:'S1',bootstrapSecret:'private-bootstrap',registryUrl:'registry'});}
test('authorization version is owner-only, uses the same scopes, and renders a success screen without code or clinic secrets',()=>{
 const original=files(),snapshot=JSON.stringify(original),auth=privateAuthorizationFiles(original,resources.ownerEmail,'S1');
 assert.equal(JSON.stringify(original),snapshot);
 const manifest=JSON.parse(auth.find(f=>f.name==='appsscript').source),previous=JSON.parse(original.find(f=>f.name==='appsscript').source);
 assert.deepEqual(manifest.webapp,{access:'MYSELF',executeAs:'USER_ACCESSING'});assert.deepEqual(manifest.oauthScopes,previous.oauthScopes);
 const script=auth.filter(f=>f.type==='SERVER_JS').map(f=>f.source).join('\n');new vm.Script(script);
 const calls=[],ctx={SpreadsheetApp:{openById:id=>{calls.push(id);return {getName:()=> 'Private clinic'};}},UrlFetchApp:{fetch:url=>calls.push(url)},HtmlService:{createHtmlOutput:html=>({setTitle:()=>html})}};
 vm.createContext(ctx);vm.runInContext(script,ctx);const html=ctx.doGet();
 assert.equal(calls[0],'S1');assert.match(html,/האישור הושלם/);assert.ok(!html.includes('private-bootstrap'));assert.ok(!html.includes('Private clinic'));assert.ok(!html.includes('/edit'));assert.ok(!html.includes('<script'));
});
function fixture({fail=false,reuse=false,foreign=false}={}){
 const original=files(),calls=[];let head=structuredClone(original),versionSnapshot;
 const request=async(token,url,opt={})=>{calls.push({url,...opt});
  if(url.endsWith('/projects/P1'))return {parentId:'S1'};
  if(url.includes('/drive/'))return {appProperties:{therapayPilot:foreign?'foreign':'v1',therapayScriptId:'P1'}};
  if(url.endsWith('/content')){if(opt.method==='PUT'){head=structuredClone(opt.body.files);return {};}return {files:head};}
  if(url.endsWith('/deployments')){if(opt.method==='POST'){if(fail)throw Error('Deployment unavailable');assert.equal(opt.body.versionNumber,2);return {deploymentId:'AUTH',entryPoints:[{webApp:{url:'https://script.google.com/macros/s/AUTH/exec'}}]};}return {deployments:reuse?[{deploymentConfig:{description:'TheraPay owner authorization v1'},entryPoints:[{webApp:{url:'https://script.google.com/macros/s/AUTH/exec'}}]}]:[]};}
  if(url.endsWith('/versions')){versionSnapshot=structuredClone(head);return {versionNumber:2};}
  throw Error('Unexpected '+url);
 };
 return {request,calls,original,get head(){return head;},get versionSnapshot(){return versionSnapshot;}};
}
test('a separate private authorization deployment restores working source and never updates the published backend',async()=>{
 const f=fixture(),url=await prepareOwnerAuthorization({token:'owner-token',resources,ownerEmail:resources.ownerEmail,request:f.request});
 assert.equal(url,'https://script.google.com/macros/s/AUTH/exec');assert.deepEqual(f.head,f.original);
 assert.equal(JSON.parse(f.versionSnapshot.find(x=>x.name==='appsscript').source).webapp.access,'MYSELF');
 assert.ok(!f.calls.some(x=>x.url.includes('/deployments/BACKEND')));assert.equal(f.calls.filter(x=>x.method==='PUT').length,2);
});
test('failed deployment restores original working source; retries reuse existing approval without uploads',async()=>{
 const f=fixture({fail:true});await assert.rejects(prepareOwnerAuthorization({token:'owner-token',resources,ownerEmail:resources.ownerEmail,request:f.request}),/Deployment unavailable/);assert.deepEqual(f.head,f.original);
 const reuse=fixture({reuse:true});await prepareOwnerAuthorization({token:'owner-token',resources,ownerEmail:resources.ownerEmail,request:reuse.request});assert.ok(!reuse.calls.some(x=>x.method==='PUT'||x.method==='POST'));
});
test('foreign projects and account mismatches are refused before any source changes',async()=>{
 const f=fixture({foreign:true});await assert.rejects(prepareOwnerAuthorization({token:'token',resources,ownerEmail:resources.ownerEmail,request:f.request}));assert.ok(!f.calls.some(x=>x.method));
 assert.throws(()=>privateAuthorizationFiles(files(),'other@example.com','S1'),/אינו שייך/);
});
