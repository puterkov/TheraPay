import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {backendFiles} from '../onboarding/google.js';
import {passwordPolicyFiles,upgradePasswordPolicy} from '../onboarding/upgrade.js';
const resources={ownerEmail:'owner@example.com',spreadsheetId:'S1',scriptId:'P1',deploymentId:'LIVE',backendUrl:'https://script.google.com/macros/s/LIVE/exec'};
const core=fs.readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8');
const bootstrap=fs.readFileSync(new URL('../distribution/ClinicBootstrap.gs',import.meta.url),'utf8');
function files(legacy=true){const result=backendFiles(core,bootstrap,{ownerEmail:resources.ownerEmail,spreadsheetId:'S1',bootstrapSecret:'private',registryUrl:'registry'});if(legacy){result.find(f=>f.name==='Code').source=result.find(f=>f.name==='Code').source.replace('secret.length<8','secret.length<16');result.find(f=>f.name==='OnboardingBootstrap').source=result.find(f=>f.name==='OnboardingBootstrap').source.replace(/password\.length<8\|\|password\.length>256\|\|!\/\[A-Z\]\/\.test\(password\)\|\|!\/\[0-9\]\/\.test\(password\)\|\|!\/\[\^\\p\{L\}\\p\{N\}\\s\]\/u\.test\(password\)/,'password.length<16||password.length>256');}return result;}
function fixture({legacy=true,foreign=false,failVersion=false,conflict=false,failDeploy=false}={}){
 const published=files(legacy),draft=structuredClone(published);draft.find(f=>f.name==='Code').source+='\n// Preserve unpublished work';
 let head=structuredClone(draft),liveVersion=1,versionFiles,calls=[];
 const deployment=()=>({deploymentId:'LIVE',deploymentConfig:{versionNumber:liveVersion,manifestFileName:'appsscript',description:'TheraPay onboarding pilot'},entryPoints:[{webApp:{url:resources.backendUrl}}]});
 let deploymentReads=0;
 const request=async(token,url,opt={})=>{assert.equal(token,'owner-token');calls.push({url,...opt});
  if(url.endsWith('/projects/P1'))return {parentId:'S1'};
  if(url.includes('/drive/'))return {appProperties:{therapayPilot:foreign?'other':'v1',therapayScriptId:'P1'}};
  if(url.endsWith('/deployments/LIVE')){if(opt.method==='PUT'){if(failDeploy)throw Error('Deployment failed');assert.equal(opt.body.deploymentConfig.versionNumber,2);liveVersion=2;}else if(conflict&&++deploymentReads===2)liveVersion=3;return deployment();}
  if(url.includes('/content?versionNumber='))return {files:liveVersion===1?published:versionFiles};
  if(url.endsWith('/content')){if(opt.method==='PUT'){head=structuredClone(opt.body.files);return {};}return {files:head};}
  if(url.endsWith('/versions')){if(failVersion)throw Error('Version failed');versionFiles=structuredClone(head);return {versionNumber:2};}
  throw Error('Unexpected request');
 };
 return {request,calls,published,draft,get head(){return head;},get liveVersion(){return liveVersion;},get versionFiles(){return versionFiles;}};
}
test('policy patch changes only recognized password rules and preserves secrets and manifest',()=>{
 const before=files(),after=passwordPolicyFiles(before,resources);assert.match(before[0].source,/secret.length<16/);assert.match(before.find(f=>f.name==='OnboardingBootstrap').source,/password.length<16/);assert.match(after[0].source,/secret.length<8/);
 assert.equal(after.find(f=>f.name==='appsscript').source,before.find(f=>f.name==='appsscript').source);
 new vm.Script(after.filter(f=>f.type==='SERVER_JS').map(f=>f.source).join('\n'));
 assert.deepEqual(passwordPolicyFiles(after,resources),after);
 assert.throws(()=>passwordPolicyFiles(before,{...resources,ownerEmail:'other@example.com'}));
});
test('upgrade uses published version, preserves unpublished work and keeps the same deployment URL and configuration',async()=>{
 const f=fixture(),result=await upgradePasswordPolicy({token:'owner-token',resources,ownerEmail:resources.ownerEmail,request:f.request});
 assert.equal(result.updated,true);assert.equal(result.previousVersion,1);assert.equal(f.liveVersion,2);
 assert.deepEqual(f.versionFiles,passwordPolicyFiles(f.published,resources));assert.ok(!f.versionFiles[0].source.includes('Preserve unpublished work'));
 assert.deepEqual(f.head,passwordPolicyFiles(f.draft,resources));
 const update=f.calls.find(x=>x.url.endsWith('/deployments/LIVE')&&x.method==='PUT');assert.equal(update.body.deploymentConfig.description,'TheraPay onboarding pilot');
 assert.ok(!f.calls.some(x=>x.url.includes('/spreadsheets')||x.url.includes('script.google.com/macros')));
});
test('updated backends are a no-op; foreign owners and projects cannot trigger updates',async()=>{
 const f=fixture({legacy:false});assert.equal((await upgradePasswordPolicy({token:'owner-token',resources,ownerEmail:resources.ownerEmail,request:f.request})).updated,false);assert.ok(!f.calls.some(x=>x.method));
 const foreign=fixture({foreign:true});await assert.rejects(upgradePasswordPolicy({token:'owner-token',resources,ownerEmail:resources.ownerEmail,request:foreign.request}));assert.ok(!foreign.calls.some(x=>x.method));
 await assert.rejects(upgradePasswordPolicy({token:'owner-token',resources,ownerEmail:'other@example.com',request:f.request}));
});
test('version or deployment failures restore original draft and do not change live version; concurrent deploys are refused',async()=>{
 for(const option of ['failVersion','failDeploy','conflict']){
  const f=fixture({[option]:true});await assert.rejects(upgradePasswordPolicy({token:'owner-token',resources,ownerEmail:resources.ownerEmail,request:f.request}));assert.deepEqual(f.head,f.draft);assert.equal(f.liveVersion,option==='conflict'?3:1);
 }
});
