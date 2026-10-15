import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8');
function fixture(){
  const writes=[];let failPaidOnce=false;
  class Sheet{
    constructor(name,rows){this.name=name;this.rows=rows;}
    getName(){return this.name;}getLastRow(){return this.rows.length;}hideSheet(){}
    appendRow(row){this.rows.push([...row]);writes.push({name:this.name,row:this.rows.length});}
    getDataRange(){return {getValues:()=>this.rows.map(r=>[...r])};}
    getRange(row,col,height=1,width=1){return {setValue:v=>{if(failPaidOnce&&this.name==='Appointments'&&v==='שולם'){failPaidOnce=false;throw new Error('Sheet temporarily unavailable');}this.rows[row-1]??=[];this.rows[row-1][col-1]=v;writes.push({name:this.name,row,col,v});},setValues:values=>{for(let r=0;r<height;r++)for(let c=0;c<width;c++){this.rows[row+r-1]??=[];this.rows[row+r-1][col+c-1]=values[r][c];}writes.push({name:this.name,row,col});}};}
  }
  const sheets={Patients:new Sheet('Patients',[
    ['מזהה מטופל','שם מלא','טלפון','תעריף ברירת מחדל','סטטוס'],['PAT-1','נועה','0541234567',400,'פעיל'],['PAT-2','נועה כהן','0521234567',350,'פעיל']
  ]),Appointments:new Sheet('Appointments',[
    ['מזהה פגישה','תאריך ושעה','תאריך','שם המטופל','סכום לתשלום','סטטוס תשלום','אמצעי תשלום','מספר חשבונית','morning_status','pdf_url'],
    ['APP-1','2026-09-01','2026-09-01','נועה',400,'ביט / פייבוקס ממתין לתשלום','','','',''],
    ['APP-2','2026-10-01','2026-10-01','נועה',400,'ממתין לתשלום','','','',''],
    ['APP-3','2026-09-01','2026-09-01','נועה כהן',350,'ממתין לתשלום','','','','']
  ])};
  const props={APP_ACCESS_TOKEN:'a'.repeat(48),MORNING_API_KEY:'test-only',MORNING_API_SECRET:'test-only',MORNING_ENV:'sandbox'};
  const ss={getSheetByName:n=>sheets[n],insertSheet:n=>(sheets[n]=new Sheet(n,[]))};
  let documentCalls=0;let remoteMode='ok';let locked=false;
  const response=(status,data)=>({getResponseCode:()=>status,getContentText:()=>JSON.stringify(data)});
  const context={console,Date,JSON,Number,String,Array,Object,Math,isFinite,isNaN,Error,
    SpreadsheetApp:{getActiveSpreadsheet:()=>ss,openById:()=>ss,flush:()=>{}},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:body=>({body,setMimeType(){return this;}})},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k],setProperty:(k,v)=>props[k]=v})},
    LockService:{getScriptLock:()=>({tryLock:()=>{locked=true;return true;},hasLock:()=>locked,releaseLock:()=>locked=false})},
    Utilities:{formatDate:(date)=>date.toISOString().slice(0,10),getUuid:()=>crypto.randomUUID()},
    UrlFetchApp:{fetch:(url,options)=>{if(url.includes('oauth/token'))return response(200,{access_token:'fake-token'});documentCalls++;if(remoteMode==='timeout')throw new Error('timeout');if(remoteMode==='reject')return response(400,{errorMessage:'invalid payment'});return response(200,{id:'DOC-1',number:101,url:{he:'https://example.com/doc.pdf'}});}}
  };
  vm.createContext(context);vm.runInContext(source,context);
  const call=(action,extra={})=>JSON.parse(context.doPost({postData:{contents:JSON.stringify({accessToken:props.APP_ACCESS_TOKEN,action,...extra})}}).body);
  const req={requestId:'request-1234567890',patientId:'PAT-1',ids:['APP-1'],amount:400,paymentMethod:'bit',paymentDate:'2026-01-01'};
  return {context,sheets,writes,props,call,req,get documentCalls(){return documentCalls;},set remoteMode(v){remoteMode=v;},set failPaidOnce(v){failPaidOnce=v;}};
}
test('GET contains no patient data; POST requires a clinic access token',()=>{const f=fixture();assert.equal(JSON.parse(f.context.doGet().body).patients,undefined);assert.equal(f.call('getAllData',{accessToken:''}).code,'AUTH');assert.equal(f.writes.length,0);});
test('read is non-mutating and reads actual rates, IDs and header positions',()=>{const f=fixture();const r=f.call('getAllData');assert.equal(r.success,true);assert.equal(r.patients[0].rate,400);assert.equal(r.appointments[0].id,'APP-1');assert.equal(r.appointments[0].patientId,'PAT-1');assert.equal(f.writes.length,0);});
test('document updates only selected IDs, using separate status/method/doc/pdf columns',()=>{const f=fixture();assert.equal(f.call('createMorningDoc',f.req).success,true);const rows=f.sheets.Appointments.rows;assert.equal(rows[1][5],'שולם');assert.equal(rows[1][6],'ביט');assert.equal(rows[1][7],'101');assert.equal(rows[1][9],'https://example.com/doc.pdf');assert.equal(rows[2][5],'ממתין לתשלום');assert.equal(rows[3][5],'ממתין לתשלום');assert.equal(f.documentCalls,1);});
test('same request replay issues exactly one document',()=>{const f=fixture();f.call('createMorningDoc',f.req);assert.equal(f.call('createMorningDocument',f.req).success,true);assert.equal(f.documentCalls,1);});
test('mixed patients, duplicate IDs, altered amount and already paid selections are rejected',()=>{for(const change of [{ids:['APP-1','APP-3'],amount:750},{ids:['APP-1','APP-1'],amount:800},{amount:1}]){const f=fixture();assert.equal(f.call('createMorningDoc',{...f.req,...change}).success,false);assert.equal(f.documentCalls,0);}const f=fixture();f.call('createMorningDoc',f.req);assert.equal(f.call('createMorningDoc',{...f.req,requestId:'another-request-1234'}).success,false);assert.equal(f.documentCalls,1);});
test('uncertain remote response reserves appointments across request IDs',()=>{const f=fixture();f.remoteMode='timeout';assert.equal(f.call('createMorningDoc',f.req).code,'UNCERTAIN');assert.equal(f.call('createMorningDoc',f.req).code,'UNCERTAIN');assert.equal(f.call('createMorningDoc',{...f.req,requestId:'another-request-1234'}).code,'UNCERTAIN');assert.equal(f.documentCalls,1);assert.notEqual(f.sheets.Appointments.rows[1][5],'שולם');});
test('remote success with Sheets failure can be repaired without reissuing',()=>{const f=fixture();f.failPaidOnce=true;assert.equal(f.call('createMorningDoc',f.req).success,false);assert.equal(f.documentCalls,1);assert.equal(f.call('createMorningDoc',f.req).success,true);assert.equal(f.documentCalls,1);assert.equal(f.sheets.Appointments.rows[1][7],'101');});
test('rejected remote document never marks any appointment paid',()=>{const f=fixture();f.remoteMode='reject';assert.equal(f.call('createMorningDoc',f.req).code,'MORNING_REJECTED');assert.notEqual(f.sheets.Appointments.rows[1][5],'שולם');});
test('patient and appointment writes match headers and are retry safe',()=>{const f=fixture();const p={requestId:'patient-request-12345',name:'תמר',phone:'0541111111',rate:450};const result=f.call('addPatient',p);assert.equal(result.success,true);assert.equal(f.call('addPatient',p).patientId,result.patientId);assert.deepEqual(f.sheets.Patients.rows[3].slice(1),['תמר','0541111111',450,'פעיל']);assert.equal(f.sheets.Patients.rows.length,4);const a={requestId:'appointment-request-1234',patientId:result.patientId,date:'2026-10-15',amount:450};assert.equal(f.call('addAppointment',a).success,true);assert.equal(f.call('addAppointment',a).success,true);const row=f.sheets.Appointments.rows[4];assert.equal(row[3],'תמר');assert.equal(row[4],450);assert.equal(row[6],'');assert.equal(row[7],'');assert.equal(row[10],result.patientId);assert.equal(f.sheets.Appointments.rows.length,5);});
test('header reordering does not change the target columns',()=>{const f=fixture();const t=f.sheets.Appointments;for(const row of t.rows){[row[6],row[7]]=[row[7],row[6]];}assert.equal(f.call('createMorningDoc',f.req).success,true);assert.equal(t.rows[1][6],'101');assert.equal(t.rows[1][7],'ביט');});
