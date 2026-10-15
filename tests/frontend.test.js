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
    setAttribute(){}removeAttribute(){}showModal(){}close(){}reset(){}
    append(e){this.textContent+=e.textContent||'';}replaceChildren(e){this.textContent=e.textContent||'';}
    querySelector(){return new Element();}
  }
  const elements=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()]));
  for(const id of ['appointment-form','pay-form','settings-form','patient-form'])for(const key of ['patientId','paymentDate','paymentMethod','amount','url','accessToken','signature'])elements[id].elements[key]=new Element();
  const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
  const sessionStorage=storage();const localStorage=storage();const queue=[];const calls=[];
  const context={...domain,console,URL,URLSearchParams,AbortController,Intl,Date,crypto,setTimeout,clearTimeout,sessionStorage,localStorage,location:{search:''},window:{scrollTo(){}},
    document:{getElementById:id=>{if(!elements[id])throw Error('Missing element '+id);return elements[id];},addEventListener(){},querySelectorAll:selector=>selector==='dialog'?['patient','appointment','message','pay','appointment-details'].map(id=>elements[id]):selector==='.view'?['dashboard','patients','appointments','collection','documents','settings'].map(id=>Object.assign(elements[id],{id})):[],createTextNode:text=>({textContent:text}),createElement:()=>new Element()},
    fetch:async(url,options)=>{calls.push(JSON.parse(options.body));const result=queue.shift();if(result instanceof Error)throw result;if(!result)throw Error('Unexpected request');return {ok:true,json:async()=>result};}
  };
  vm.createContext(context);vm.runInContext(source,context);sessionStorage.setItem('THERAPAY_ACCESS_TOKEN','fixture-access');
  const data={success:true,apiVersion:2,environment:'sandbox',morningConfigured:true,patients:[{id:'p1',name:'בדיקה',phone:'0541234567',rate:350,status:'פעיל'}],appointments:[{id:'a1',patientId:'p1',clientName:'בדיקה',date:'2020-01-01',amount:350,isPaid:false},{id:'a2',patientId:'p1',clientName:'בדיקה',date:'2020-01-02',amount:350,isPaid:false}]};
  const run=code=>vm.runInContext(code,context);
  return {context,sessionStorage,elements,queue,calls,data,run,async connect(){queue.push(structuredClone(data));await run('load()');}};
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
  const f=fixture();await f.connect();f.run('state.selected=new Set(["a1"])');
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
