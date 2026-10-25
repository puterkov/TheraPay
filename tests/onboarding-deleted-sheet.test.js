import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {provisionWorkspace} from '../onboarding/google.js';
const core=fs.readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8'),bootstrap=fs.readFileSync(new URL('../distribution/ClinicBootstrap.gs',import.meta.url),'utf8');
const metadata={ownerEmail:'owner@example.com',spreadsheetId:'OLD',scriptId:'OLD-SCRIPT',deploymentId:'OLD-DEPLOY',backendUrl:'https://script.google.com/macros/s/OLD-DEPLOY/exec'};
test('trashed remembered Sheet starts a fresh workspace without reusing its old backend or password',async()=>{
 const calls=[],saved=[];let props={therapayPilot:'v1'};
 const request=async(token,url,opt={})=>{calls.push({url,...opt});
  if(url.includes('/files/OLD?'))return {id:'OLD',trashed:true,appProperties:{therapayPilot:'v1'}};
  if(url.includes('/files?q='))return {files:[]};
  if(url==='https://sheets.googleapis.com/v4/spreadsheets')return {spreadsheetId:'NEW'};
  if(url.includes('/files/NEW')){if(opt.method==='PATCH'){props=opt.body.appProperties;return {};}return {id:'NEW',trashed:false,appProperties:props};}
  if(url.includes('values:batchGet'))return {valueRanges:[{},{}]};
  if(url.includes('values:batchUpdate'))return {};
  if(url==='https://script.googleapis.com/v1/projects')return {scriptId:'NEW-SCRIPT'};
  if(url.endsWith('/projects/NEW-SCRIPT'))return {parentId:'NEW'};
  if(url.endsWith('/content'))return opt.method==='PUT'?{}:{files:[]};
  if(url.endsWith('/versions'))return {versionNumber:1};
  if(url.endsWith('/deployments'))return opt.method==='POST'?{deploymentId:'NEW-DEPLOY',entryPoints:[{webApp:{url:'https://script.google.com/macros/s/NEW-DEPLOY/exec'}}]}:{deployments:[]};
  throw Error('Unexpected request');
 };
 const result=await provisionWorkspace({token:'token',ownerEmail:metadata.ownerEmail,clinicName:'Clinic',metadata,core,bootstrap,request,checkpoint:x=>saved.push({...x})});
 assert.equal(result.spreadsheetId,'NEW');assert.equal(result.scriptId,'NEW-SCRIPT');assert.equal(result.deploymentId,'NEW-DEPLOY');assert.ok(result.bootstrapSecret);
 assert.equal(saved[0].ownerEmail,metadata.ownerEmail);for(const key of ['spreadsheetId','scriptId','deploymentId','backendUrl'])assert.equal(saved[0][key],'');
 assert.ok(!calls.some(x=>x.url.includes('/OLD-SCRIPT')||x.url.includes('spreadsheets/OLD')||x.method==='DELETE'));
 assert.ok(!JSON.stringify(saved).includes(result.bootstrapSecret));
});
test('missing access and unrelated remembered files do not erase progress or create replacement resources',async()=>{
 for(const outcome of ['missing','forbidden','unrelated']){
  const calls=[],saved=[];
  await assert.rejects(provisionWorkspace({token:'token',ownerEmail:metadata.ownerEmail,clinicName:'Clinic',metadata,core,bootstrap,request:async(t,url,opt={})=>{calls.push(opt);if(outcome!=='unrelated')throw Error(outcome);return {trashed:true,appProperties:{therapayPilot:'foreign'}};},checkpoint:x=>saved.push(x)}));
  assert.equal(saved.length,0);assert.ok(!calls.some(x=>x.method));
 }
});
