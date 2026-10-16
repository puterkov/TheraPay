import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as domain from '../domain.js';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'');
function fixture(){
  class Element{
    constructor(){this.textContent='';this.hidden=false;this.disabled=false;this.value='';this.dataset={};this.listeners={};this.elements={};this.classList={toggle(){}};}
    addEventListener(type,fn){this.listeners[type]=fn;}
    setAttribute(){}removeAttribute(){}showModal(){this.open=true;}close(){this.open=false;}reset(){}remove(){}closest(){return this;}
    append(e){this.textContent+=e.textContent||'';}replaceChildren(e){this.textContent=e.textContent||'';}
    querySelector(selector){if(selector==='[role=status]')return null;if(selector==='[type=submit]')return this.submitButton??=new Element();return new Element();}
  }
  const elements=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()]));
  for(const id of ['appointment-form','pay-form','settings-form','patient-form','task-form'])for(const key of ['patientId','paymentDate','paymentMethod','amount','url','accessToken','signature','rememberAccess','date','name','phone','rate','status','text','dueDate','remindDays'])elements[id].elements[key]=new Element();
  const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
  const sessionStorage=storage();const localStorage=storage();const queue=[];const calls=[];
  const context={...domain,console,URL,URLSearchParams,AbortController,Intl,Date,crypto,setTimeout,clearTimeout,sessionStorage,localStorage,location:{search:''},window:{scrollTo(){}},FormData:class{constructor(form){this.form=form;}*[Symbol.iterator](){const keys=this.form===elements['patient-form']?['name','phone','rate','status','text','dueDate','remindDays']:['patientId','date','amount'];for(const key of keys)yield [key,this.form.elements[key].value];}},
    document:{getElementById:id=>{if(!elements[id])throw Error('Missing element '+id);return elements[id];},addEventListener(){},querySelectorAll:selector=>selector==='dialog'?['patient','appointment','message','pay','appointment-details'].map(id=>elements[id]):selector==='.view'?['dashboard','patients','appointments','collection','documents','settings','tasks'].map(id=>Object.assign(elements[id],{id})):[],createTextNode:text=>({textContent:text}),createElement:()=>new Element()},
    fetch:async(url,options)=>{calls.push(JSON.parse(options.body));const result=await queue.shift();if(result instanceof Error)throw result;if(!result)throw Error('Unexpected request');return {ok:true,json:async()=>result};}
  };
  vm.createContext(context);vm.runInContext(source,context);sessionStorage.setItem('THERAPAY_ACCESS_TOKEN','fixture-access');
  const data={success:true,apiVersion:2,environment:'sandbox',morningConfigured:true,supportsEmailDelivery:true,supportsEditing:true,patients:[{id:'p1',name:'בדיקה',phone:'0541234567',rate:350,status:'פעיל'}],appointments:[{id:'a1',patientId:'p1',clientName:'בדיקה',date:'2020-01-01',amount:350,isPaid:false},{id:'a2',patientId:'p1',clientName:'בדיקה',date:'2020-01-02',amount:350,isPaid:false}]};
  const run=code=>vm.runInContext(code,context);
  return {context,sessionStorage,localStorage,elements,queue,calls,data,run,async connect(){queue.push(structuredClone(data));await run('load()');}};
}
test('connection fields live only in a settings page, not in the dashboard or a modal',()=>{
  const settings=html.match(/<section id="settings"[\s\S]*?<\/section>/)[0];
  assert.ok(settings.includes('id="settings-form"'));assert.ok(settings.includes('name="accessToken"'));
  assert.ok(!html.replace(settings,'').includes('name="accessToken"'));
  assert.ok(!html.includes('<dialog id="settings"'));
});
test('temporary refresh failure preserves the authenticated connection and loaded appointments',async()=>{
  const f=fixture();await f.connect();f.queue.push(new TypeError('network unavailable'));
  await assert.rejects(f.run('load()'));
  assert.equal(f.run('state.connected'),true);assert.equal(f.run('state.refreshFailed'),true);
  assert.equal(f.run('state.appointments.length'),2);assert.equal(f.sessionStorage.getItem('THERAPAY_ACCESS_TOKEN'),'fixture-access');
  assert.equal(f.run('state.loading'),false);assert.match(f.elements.connection.textContent,/מחובר/);
});
test('confirmed invoice success settles only selected sessions even when the following refresh fails',async()=>{
  const f=fixture();await f.connect();f.run('state.selected=new Set(["a1"]);state.recipient={id:"MORNING-1",emails:["invoice@example.com"]}');
  f.elements['pay-form'].elements.paymentMethod.value='bit';f.elements['pay-form'].elements.paymentDate.value=domain.today();
  f.queue.push({success:true,apiVersion:2,docNumber:'101',pdfUrl:'https://example.com/doc.pdf',environment:'sandbox',paymentLabel:'ביט'},new TypeError('network unavailable'));
  await f.elements['pay-form'].listeners.submit({preventDefault(){},target:f.elements['pay-form']});
  assert.equal(f.run('state.connected'),true);assert.equal(f.run('state.appointments[0].isPaid'),true);assert.equal(f.run('state.appointments[1].isPaid'),false);
  assert.equal(f.run('state.appointments[0].docNumber'),'101');assert.equal(f.run('chosen().length'),0);
  assert.equal(f.sessionStorage.getItem('THERAPAY_ACCESS_TOKEN'),'fixture-access');assert.equal(f.sessionStorage.getItem('THERAPAY_ATTEMPT'),null);
  assert.match(f.elements['pay-result'].textContent,/הופק/);assert.match(f.elements.notice.textContent,/החיבור נשמר/);
  assert.equal(f.calls.filter(c=>c.action==='createMorningDoc').length,1);
  f.queue.push(structuredClone(f.data));await f.run('load()');assert.equal(f.run('state.refreshFailed'),false);
});
test('explicit authentication failure requires login again',async()=>{
  const f=fixture();await f.connect();f.queue.push({success:false,apiVersion:2,code:'AUTH',message:'קוד שגוי'});
  await assert.rejects(f.run('load()'));
  assert.equal(f.run('state.connected'),false);assert.equal(f.sessionStorage.getItem('THERAPAY_ACCESS_TOKEN'),null);
});
test('appointment filters combine patient and named month/year and survive refresh',async()=>{
  const f=fixture();f.data.patients.push({id:'p2',name:'מטופל נוסף',phone:'0521234567',rate:400,status:'פעיל'});
  f.data.appointments.push({id:'a3',patientId:'p2',clientName:'מטופל נוסף',date:'2020-01-03',amount:400,isPaid:false},{id:'a4',patientId:'p1',clientName:'בדיקה',date:'2021-01-03',amount:350,isPaid:false});
  await f.connect();assert.match(f.elements['appointments-month'].innerHTML,/ינואר 2020/);assert.match(f.elements['appointments-month'].innerHTML,/ינואר 2021/);
  f.elements['appointments-patient'].listeners.change({target:{value:'p1'}});
  f.elements['appointments-month'].listeners.change({target:{value:'2020-01'}});
  assert.equal((f.elements['all-appointments'].innerHTML.match(/data-record-row/g)||[]).length,2);
  assert.ok(!f.elements['all-appointments'].innerHTML.includes('מטופל נוסף'));
  f.queue.push(structuredClone(f.data));await f.run('load()');
  assert.equal(f.elements['appointments-patient'].value,'p1');assert.equal(f.elements['appointments-month'].value,'2020-01');
  f.elements['appointments-patient'].listeners.change({target:{value:'p2'}});
  assert.equal((f.elements['all-appointments'].innerHTML.match(/data-record-row/g)||[]).length,1);
  f.elements['appointments-month'].listeners.change({target:{value:'2021-01'}});
  assert.match(f.elements['all-appointments'].innerHTML,/אין פגישות להצגה/);
});
test('remembered access survives closing the tab session and explicit logout removes it',async()=>{const f=fixture();await f.connect();assert.equal(f.localStorage.getItem('THERAPAY_ACCESS_TOKEN'),'fixture-access');f.sessionStorage.removeItem('THERAPAY_ACCESS_TOKEN');assert.equal(f.run('accessToken()'),'fixture-access');f.elements.disconnect.listeners.click();assert.equal(f.run('accessToken()'),'');});
test('remember opt-out uses only tab storage and authentication rejection clears both stores',async()=>{const f=fixture();f.localStorage.setItem('THERAPAY_REMEMBER','false');await f.connect();assert.equal(f.localStorage.getItem('THERAPAY_ACCESS_TOKEN'),null);assert.equal(f.run('accessToken()'),'fixture-access');f.run('rememberAccess("remembered-access",true)');f.queue.push({success:false,apiVersion:2,code:'AUTH',message:'קוד שגוי'});await assert.rejects(f.run('load()'));assert.equal(f.run('accessToken()'),'');});
test('opening payment reads the registered recipient before enabling issuance',async()=>{const f=fixture();await f.connect();f.queue.push({success:true,apiVersion:2,recipient:{id:'MORNING-1',emails:['invoice@example.com']}});await f.run('showPayment()');assert.equal(f.run('state.recipient.id'),'MORNING-1');assert.match(f.elements['pay-email'].textContent,/invoice@example.com/);assert.equal(f.elements.issue.disabled,false);assert.equal(f.calls.filter(c=>c.action==='createMorningDoc').length,0);});
test('old backend without mail capability cannot silently issue an unsent invoice',async()=>{const f=fixture();f.data.supportsEmailDelivery=false;await f.connect();await f.run('showPayment()');assert.equal(f.elements.issue.disabled,true);assert.match(f.elements['pay-email'].textContent,/עדכון בקנד/);assert.equal(f.calls.filter(c=>c.action==='createMorningDoc').length,0);});

test('successful connection leaves settings, while failed connection stays there',async()=>{
  const f=fixture();const form=f.elements['settings-form'];
  form.elements.url.value='https://script.google.com/macros/s/test/exec';form.elements.accessToken.value='fixture-access';
  f.run("view('settings')");f.queue.push(structuredClone(f.data));
  await form.listeners.submit({preventDefault(){},target:form});
  assert.equal(f.run('state.view'),'dashboard');assert.equal(f.elements.settings.hidden,true);
  f.run("view('settings')");f.queue.push(new TypeError('offline'));
  await form.listeners.submit({preventDefault(){},target:form});assert.equal(f.run('state.view'),'settings');
});

test('documents filter whole documents by patient and session month without reducing totals',async()=>{
  const f=fixture();f.data.appointments[0].docNumber='101';f.data.appointments[1].docNumber='101';f.data.appointments[1].date='2020-02-02';
  f.data.patients.push({id:'p2',name:'אחר',rate:400});
  f.data.appointments.push({id:'a3',patientId:'p2',clientName:'אחר',date:'2020-01-03',amount:400,docNumber:'102'});
  await f.connect();assert.match(f.elements['document-list'].innerHTML,/<table/);
  f.elements['documents-patient'].listeners.change({target:{value:'p1'}});
  f.elements['documents-month'].listeners.change({target:{value:'2020-02'}});
  assert.match(f.elements['document-list'].innerHTML,/700/);assert.ok(!f.elements['document-list'].innerHTML.includes('102'));
  f.queue.push(structuredClone(f.data));await f.run('load()');assert.equal(f.elements['documents-month'].value,'2020-02');
  f.elements['documents-patient'].listeners.change({target:{value:'p2'}});assert.match(f.elements['document-list'].innerHTML,/אין מסמכים/);
});

test('invoice shows progress until finished and a short sent confirmation after success',async()=>{
  const f=fixture();await f.connect();f.run('state.selected=new Set(["a1"]);state.recipient={id:"M1",emails:["test@example.com"]}');
  f.elements['pay-form'].elements.paymentMethod.value='bit';f.elements['pay-form'].elements.paymentDate.value=domain.today();
  let finish;f.queue.push(new Promise(resolve=>{finish=resolve;}),structuredClone(f.data));
  const pending=f.elements['pay-form'].listeners.submit({preventDefault(){},target:f.elements['pay-form']});
  assert.equal(f.elements['pay-progress'].hidden,false);assert.equal(f.elements.issue.disabled,true);
  finish({success:true,apiVersion:2,docNumber:'101',emailRequested:true,recipientEmails:['test@example.com']});await pending;
  assert.equal(f.elements['pay-progress'].hidden,true);assert.equal(f.elements['pay-result'].textContent,'המסמך הופק ונשלח.');
});

test('editing fills existing details and submits the ID with original values and save spinner',async()=>{
  for(const type of ['patient','appointment']){
    const f=fixture();await f.connect();f.run(`editRecord('${type}','${type==='patient'?'p1':'a1'}')`);
    const form=f.elements[type+'-form'],button=form.querySelector('[type=submit]');
    if(type==='patient'){assert.equal(form.elements.name.value,'בדיקה');form.elements.name.value='שם חדש';}else{assert.equal(form.elements.date.value,'2020-01-01');form.elements.amount.value='375';}
    let finish;f.queue.push(new Promise(resolve=>{finish=resolve;}),structuredClone(f.data));
    const pending=form.listeners.submit({preventDefault(){},target:form});
    assert.equal(button.disabled,true);assert.match(button.innerHTML,/spinner/);assert.equal(f.run('state.busy'),true);
    const req=f.calls.at(-1);assert.equal(req.action,type==='patient'?'updatePatient':'updateAppointment');assert.equal(req.id,type==='patient'?'p1':'a1');assert.ok(req.expected);
    await form.listeners.submit({preventDefault(){},target:form});assert.equal(f.calls.filter(c=>c.action===req.action).length,1);
    finish({success:true,apiVersion:2});await pending;assert.equal(button.disabled,false);assert.equal(f.run('state.busy'),false);
  }
});

test('editing is blocked with old backend and paid appointments remain read only',async()=>{
  const f=fixture();await f.connect();f.run('state.supportsEditing=false;editRecord("patient","p1")');assert.match(f.elements.notice.textContent,/Apps Script/);assert.equal(f.elements.patient.open,undefined);
  f.run('state.supportsEditing=true;state.appointments[0].isPaid=true;editRecord("appointment","a1")');assert.equal(f.elements.appointment.open,undefined);
});

test('collection hides paid appointments and defaults to prior unpaid months only',async()=>{
  const f=fixture();const current=domain.today().slice(0,7);
  f.data.appointments[1].isPaid=true;
  f.data.appointments.push({id:'a3',patientId:'p1',clientName:'בדיקה',date:current+'-01',amount:350,isPaid:false});
  await f.connect();const rows=f.elements['appointment-groups'].innerHTML;
  assert.match(rows,/selection-available/);assert.ok(!rows.includes('data-appointment="a2"'));assert.ok(!rows.includes('פגישות ששולמו'));
  assert.match(rows,/data-appointment="a1"[^>]*checked/);assert.ok(!/data-appointment="a3"[^>]*checked/.test(rows));
  assert.equal(f.run('state.selected.has("a1")'),true);assert.equal(f.run('state.selected.has("a3")'),false);
  f.data.appointments.forEach(a=>a.isPaid=true);f.queue.push(structuredClone(f.data));await f.run('load()');assert.match(f.elements['appointment-groups'].innerHTML,/אין פגישות לתשלום/);
});

test('task alerts appear only from the reminder date and disappear after completion',async()=>{
  const f=fixture();await f.connect();f.run('state.supportsTasks=true;state.tasks=[{id:"t1",text:"private task",dueDate:today(),remindDays:0,completed:false,revision:1}];renderTasks()');
  assert.equal(f.elements['tasks-alert'].hidden,false);assert.ok(!f.elements['tasks-alert'].textContent.includes('private task'));assert.match(f.elements['task-list'].innerHTML,/task-actionable/);
  f.run('state.tasks[0].completed=true;renderTasks()');assert.equal(f.elements['tasks-alert'].hidden,true);
  f.run('state.tasks[0].completed=false;state.tasks[0].dueDate="2099-01-01";renderTasks()');assert.equal(f.elements['tasks-alert'].hidden,true);assert.ok(!f.elements['task-list'].innerHTML.includes('task-actionable'));
  f.run('state.tasks[0].dueDate="";renderTasks()');assert.equal(f.elements['tasks-alert'].hidden,true);
});
test('task API failure does not break the clinic connection or its loaded appointments',async()=>{
  const f=fixture();f.data.supportsTasks=true;f.queue.push(structuredClone(f.data),new TypeError('tasks unavailable'));await f.run('load()');
  assert.equal(f.run('state.connected'),true);assert.equal(f.run('state.appointments.length'),2);assert.match(f.elements['tasks-status'].textContent,/רענון המשימות/);
});
test('task completion persists once and clears the dashboard marker',async()=>{
  const f=fixture();await f.connect();f.run('state.supportsTasks=true;state.tasks=[{id:"t1",text:"test",dueDate:today(),remindDays:0,completed:false,revision:1}];renderTasks()');
  f.queue.push({success:true,apiVersion:2,task:{id:'t1',text:'test',dueDate:domain.today(),remindDays:0,completed:true,revision:2}});
  await f.run('toggleTask("t1",true)');assert.equal(f.elements['tasks-alert'].hidden,true);assert.equal(f.run('state.tasks[0].completed'),true);assert.equal(f.calls.at(-1).expectedRevision,1);
});

test('task form preserves its request ID on retry and saves content with its chosen reminder',async()=>{
  const f=fixture();await f.connect();f.run('state.supportsTasks=true;openTask()');const form=f.elements['task-form'];
  form.elements.text.value='תזכורת קצרה';form.elements.dueDate.value='2026-10-20';form.elements.remindDays.value='0';
  f.queue.push(new TypeError('lost response'));await form.listeners.submit({preventDefault(){},target:form});
  const id=f.calls.at(-1).requestId;assert.ok(f.elements['task-result'].textContent);
  f.queue.push({success:true,apiVersion:2,task:{id:'TASK-1',text:'תזכורת קצרה',dueDate:'2026-10-20',remindDays:0,completed:false,revision:1}});
  await form.listeners.submit({preventDefault(){},target:form});assert.equal(f.calls.at(-1).requestId,id);assert.equal(f.calls.at(-1).remindDays,0);assert.equal(f.run('state.tasks.length'),1);
});
