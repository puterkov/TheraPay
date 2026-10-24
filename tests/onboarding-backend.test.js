import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {backendFiles,provisionWorkspace,googleRequest,workspaceProperties} from '../onboarding/google.js';
const core=fs.readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8');
const bootstrap=fs.readFileSync(new URL('../distribution/ClinicBootstrap.gs',import.meta.url),'utf8');

test('Google failures identify the failed operation without exposing submitted data or quoted source',async()=>{
 const privateText='bootstrap-token-and-private-user-name';
 await assert.rejects(googleRequest('private-google-token','https://sheets.googleapis.com/v4/spreadsheets',{method:'POST',body:{properties:{title:privateText}},fetchImpl:async()=>({ok:false,status:400,json:async()=>({error:{status:'INVALID_ARGUMENT',message:privateText,details:[{fieldViolations:[{field:'properties.locale',description:privateText}]}]}})})}),error=>{
  assert.match(error.message,/יצירת גיליון פרטי/);assert.match(error.message,/400.*INVALID_ARGUMENT.*properties.locale/);assert.ok(!error.message.includes(privateText));assert.ok(!error.message.includes('private-google-token'));return true;
 });
 await assert.rejects(googleRequest('token','https://script.googleapis.com/v1/projects/P1/content',{method:'PUT',fetchImpl:async()=>({ok:false,status:400,json:async()=>({error:{status:privateText,message:privateText}})})}),error=>{assert.match(error.message,/שמירת קוד הבקנד/);assert.ok(!error.message.includes(privateText));return true;});
});

test('real deployment URLs fit Drive property limits and survive resumable workspace discovery',async()=>{
 const deploymentId='AKfycb'+ 'x'.repeat(82),backendUrl='https://script.google.com/macros/s/'+deploymentId+'/exec';
 const props=workspaceProperties({scriptId:'s'.repeat(58),deploymentId,backendUrl});
 for(const [key,value] of Object.entries(props))assert.ok(Buffer.byteLength(key+value,'utf8')<=124,key+' exceeds Drive property limit');
 let created=false;
 const result=await provisionWorkspace({token:'token',ownerEmail:'owner@example.com',clinicName:'Clinic',core,bootstrap,request:async(t,url,opt={})=>{
  if(url.includes('/drive/v3/files?q='))return {files:[{id:'S1',appProperties:props}]};
  if(url.includes('/drive/v3/files/S1?'))return {appProperties:props};
  if(url.includes('values:batchGet'))return {valueRanges:[{},{}]};
  if(url.includes('values:batchUpdate'))return {};
  if(url.endsWith('/projects/'+props.therapayScriptId))return {parentId:'S1'};
  if(url.endsWith('/content'))return {files:[{name:'OnboardingBootstrap',source:'var PILOT_BOOTSTRAP = '+JSON.stringify({ownerEmail:'owner@example.com',spreadsheetId:'S1',bootstrapSecret:'recovered-private-secret'})+';\n'}]};
  if(opt.method==='POST')created=true;
  throw new Error('Unexpected '+url);
 }});
 assert.equal(result.backendUrl,backendUrl);assert.equal(result.deploymentId,deploymentId);assert.equal(created,false);
});
test('generated backend contains no user Morning keys and uses only the specified owner spreadsheet',()=>{
 const files=backendFiles(core,bootstrap,{ownerEmail:'owner@example.com',spreadsheetId:'S1',bootstrapSecret:'bootstrap-only',registryUrl:'https://script.google.com/macros/s/REGISTRY/exec'});
 assert.equal(files.length,3);assert.match(files[0].source,/function clinicDoPost/);assert.ok(!files[0].source.includes('function doPost('));assert.match(files[1].source,/"spreadsheetId":"S1"/);
 new vm.Script(files.filter(f=>f.type==='SERVER_JS').map(f=>f.source).join('\n'));
 const manifest=JSON.parse(files.find(f=>f.type==='JSON').source);assert.equal(manifest.webapp.executeAs,'USER_DEPLOYING');
});
test('workspace creation checkpoints only resource metadata, and never overwrites an unrelated sheet',async()=>{
 const calls=[],checkpoints=[];let marker={therapayPilot:'v1'},hasScript=false;
 const request=async(token,url,options={})=>{calls.push({url,...options});
 if(url.includes('/drive/v3/files?q='))return {files:[]};
 if(url==='https://sheets.googleapis.com/v4/spreadsheets'){
  assert.equal(options.method,'POST');assert.deepEqual(options.body.properties,{title:'TheraPay · Clinic',timeZone:'Asia/Jerusalem'});
  assert.deepEqual(options.body.sheets.map(s=>s.properties.title),['Patients','Appointments']);
  return {spreadsheetId:'S1'};
 }
 if(options.method==='PATCH'){marker=options.body.appProperties;return {};}
 if(url.includes('/drive/v3/files/S1?'))return {id:'S1',appProperties:marker};
 if(url.includes('values:batchGet'))return {valueRanges:[{},{}]};if(url.includes('values:batchUpdate'))return {};
 if(url==='https://script.googleapis.com/v1/projects'&&options.method==='POST'){hasScript=true;return {scriptId:'P1'};}
 if(url.endsWith('/projects/P1'))return {parentId:'S1'};
 if(url.endsWith('/content'))return options.method==='PUT'?{}:{files:[]};
 if(url.endsWith('/versions'))return {versionNumber:1};
 if(url.endsWith('/deployments'))return options.method==='POST'?{deploymentId:'D1',entryPoints:[{webApp:{url:'https://script.google.com/macros/s/D1/exec'}}]}:{deployments:[]};
 throw new Error('Unexpected '+url);
 };
 const result=await provisionWorkspace({token:'short-lived-google-token',ownerEmail:'owner@example.com',clinicName:'Clinic',core,bootstrap,registryUrl:'registry',request,checkpoint:v=>checkpoints.push(v)});
 assert.equal(result.backendUrl,'https://script.google.com/macros/s/D1/exec');assert.equal(hasScript,true);assert.ok(result.bootstrapSecret.length>=64);
 assert.ok(!JSON.stringify(checkpoints).includes(result.bootstrapSecret));assert.ok(!JSON.stringify(checkpoints).includes('short-lived-google-token'));
 const forbidden=[];await assert.rejects(provisionWorkspace({token:'token',ownerEmail:'owner@example.com',clinicName:'Clinic',metadata:{ownerEmail:'owner@example.com',spreadsheetId:'UNRELATED'},core,bootstrap,request:async(t,url,opt={})=>{forbidden.push(opt.method);return {id:'UNRELATED',appProperties:{}};}}),/לא שינינו/);assert.ok(!forbidden.includes('PUT'));assert.ok(!forbidden.includes('PATCH'));
});
function fixture(){
 const writes=[],requests=[];const sheets={};
 class Sheet{constructor(name,rows){this.name=name;this.rows=rows;}getName(){return this.name;}getLastRow(){return this.rows.length;}appendRow(row){this.rows.push([...row]);writes.push(this.name);}hideSheet(){}getDataRange(){return {getValues:()=>this.rows.map(r=>[...r])};}getRange(r,c,h=1,w=1){return {setValue:v=>{this.rows[r-1]??=[];this.rows[r-1][c-1]=v;writes.push(this.name);},setValues:vs=>{for(let i=0;i<h;i++)for(let j=0;j<w;j++){this.rows[r+i-1]??=[];this.rows[r+i-1][c+j-1]=vs[i][j];}writes.push(this.name);}};}}
 sheets.Patients=new Sheet('Patients',[['מזהה מטופל','שם מלא','טלפון','תעריף ברירת מחדל','סטטוס','morning_client_id','מייל']]);
 sheets.Appointments=new Sheet('Appointments',[['מזהה פגישה','תאריך ושעה','תאריך','שם המטופל','סכום לתשלום','סטטוס תשלום','אמצעי תשלום','מספר חשבונית','morning_status','pdf_url','מזהה מטופל']]);
 const props={};let locked=false;let rejectToken=false;let client={id:'M1',name:'נועה',active:true,send:false,phone:'',emails:[],taxId:'123',remarks:'keep'};
 const response=(status,data)=>({getResponseCode:()=>status,getContentText:()=>JSON.stringify(data)});
 const ss={getSheetByName:name=>sheets[name],getName:()=> 'Clinic',insertSheet:name=>(sheets[name]=new Sheet(name,[]))};
 const context={console,Date,JSON,Number,String,Array,Object,Math,isFinite,isNaN,Error,
 PILOT_BOOTSTRAP:{ownerEmail:'owner@example.com',spreadsheetId:'S1',bootstrapSecret:'private-bootstrap',registryUrl:'https://script.google.com/macros/s/REGISTRY/exec'},
 SpreadsheetApp:{getActiveSpreadsheet:()=>ss,openById:id=>{assert.equal(id,'S1');return ss;},flush(){}},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k],setProperty:(k,v)=>props[k]=v})},
 ContentService:{MimeType:{JSON:'json'},createTextOutput:body=>({setMimeType(){return this;},getContent:()=>body,body})},
 LockService:{getScriptLock:()=>({tryLock(){locked=true;return true;},hasLock:()=>locked,releaseLock(){locked=false;}})},
 Utilities:{formatDate:d=>d.toISOString().slice(0,10)},
 UrlFetchApp:{fetch:(url,options={})=>{requests.push({url,options});if(url.includes('/oauth/token'))return response(rejectToken?401:200,rejectToken?{}:{access_token:'short-lived-morning-token'});if(url.endsWith('/clients/search'))return response(200,{pages:2,total:101,items:[client]});if(url.endsWith('/clients/M1')){if(options.method==='put'){Object.assign(client,JSON.parse(options.payload));return response(200,client);}return response(200,client);}if(url.includes('/REGISTRY/'))return response(200,{success:true});throw new Error('Unexpected URL');}}
 };
 vm.createContext(context);vm.runInContext(core.replace('function doPost(e)','function clinicDoPost(e)')+'\n'+bootstrap,context);
 const call=(action,values={})=>JSON.parse(context.doPost({postData:{contents:JSON.stringify({action,...values})}}).body);
 const init={bootstrapToken:'private-bootstrap',password:'User123!',clinicName:'Clinic',defaultRate:350,morningKey:'private-key',morningSecret:'private-secret',environment:'sandbox',registrationReceipt:'minimal-receipt'};
 return {props,sheets,writes,requests,context,init,call,get client(){return client;},set rejectToken(v){rejectToken=v;}};
}
test('bootstrap rejects unauthenticated configuration and validates Morning before persisting keys',()=>{
 const f=fixture();assert.equal(f.call('initializeClinic',{...f.init,bootstrapToken:'wrong'}).code,'AUTH');assert.equal(f.requests.length,0);assert.deepEqual(f.props,{});
 f.rejectToken=true;assert.equal(f.call('initializeClinic',f.init).success,false);assert.deepEqual(f.props,{});
 f.rejectToken=false;const success=f.call('initializeClinic',f.init);assert.equal(success.success,true);assert.equal(f.props.APP_ACCESS_TOKEN,'User123!');assert.equal(f.props.SPREADSHEET_ID,'S1');assert.ok(!JSON.stringify(success).includes('private-secret'));
 const n=f.requests.length;assert.equal(f.call('initializeClinic',f.init).success,true);assert.equal(f.requests.length,n);assert.equal(f.call('initializeClinic',{...f.init,password:'replacement-password'}).success,false);assert.equal(f.props.APP_ACCESS_TOKEN,'User123!');
});
test('selected import requires contacts, preserves Morning send preference, retries without duplicates and reports only usage receipt',()=>{
 const f=fixture();f.call('initializeClinic',f.init);const payload={accessToken:f.init.password,clients:[{morningId:'M1',phone:'0541234567',email:'patient@example.com',rate:400}]};
 assert.equal(f.call('importMorningClients',payload).success,false);assert.equal(f.writes.length,0);
 assert.equal(f.call('importMorningClients',{...payload,allowContactUpdates:true}).success,true);assert.equal(f.sheets.Patients.rows.length,2);assert.equal(f.sheets.Patients.rows[1][5],'M1');assert.equal(f.client.send,false);assert.equal(f.client.taxId,'123');
 assert.equal(f.call('importMorningClients',{...payload,allowContactUpdates:true}).success,true);assert.equal(f.sheets.Patients.rows.length,2);
 const callbacks=f.requests.filter(r=>r.url.includes('/REGISTRY/'));assert.equal(callbacks.length,1);assert.deepEqual(JSON.parse(callbacks[0].options.payload),{action:'markUsed',receipt:'minimal-receipt'});
 assert.ok(f.requests.every(r=>!r.url.endsWith('/documents')));
});
test('invalid imported contacts are rejected before any remote customer read or write',()=>{
 const f=fixture();f.call('initializeClinic',f.init);const before=f.requests.length;
 assert.equal(f.call('importMorningClients',{accessToken:f.init.password,clients:[{morningId:'M1',phone:'',email:'',rate:350}],allowContactUpdates:true}).success,false);assert.equal(f.requests.length,before);assert.equal(f.writes.length,0);
});


test('bootstrap rejects weak passwords before Morning requests and accepts eight-character login credentials',()=>{
 for(const password of ['Abc12!','abcd123!','Abcdefg!','Abcd1234','Abcd123 ','Abcd123א']){
  const f=fixture();assert.equal(f.call('initializeClinic',{...f.init,password}).success,false);assert.equal(f.requests.length,0);assert.deepEqual(f.props,{});
 }
 const f=fixture();assert.equal(f.call('initializeClinic',f.init).success,true);
 assert.equal(f.call('getAllData',{accessToken:f.init.password}).success,true);
});
