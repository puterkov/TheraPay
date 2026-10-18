import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as model from '../onboarding/model.js';
import {SAMPLE_CLIENTS} from '../onboarding/demo.js';
const source=fs.readFileSync(new URL('../onboarding/wizard.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'');
function fixture(demo=true){
 const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,disabled:false,textContent:'',innerHTML:'',elements:{},listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},scrollIntoView(){}});return elements.get(id);};
 const context={...model,SAMPLE_CLIENTS,config:{},URLSearchParams,TextDecoder,Uint8Array,console,location:{search:demo?'?demo=1':'',protocol:'http:'},window:{scrollTo(){}},document:{getElementById:element,addEventListener(){}},setTimeout,clearTimeout};
 vm.createContext(context);vm.runInContext(source+'\nglobalThis.api={state,render,work,next};',context);
 return {context,api:context.api,element,run:code=>vm.runInContext(code,context)};
}
test('one Google submit both connects and advances; pending approval stays on the same screen with one primary action',async()=>{
 const f=fixture();f.api.state.step=1;let calls=0;
 f.context.connectStub=async()=>{calls++;f.api.state.resourcesReady=true;};f.run('connectWorkspace=connectStub');
 await f.api.work(f.api.next);assert.equal(calls,1);assert.equal(f.api.state.step,2);
 f.api.state.step=1;f.api.state.resourcesReady=false;f.context.connectStub=async()=>{f.api.state.resources={scriptId:'P1'};f.api.render();};f.run('connectWorkspace=connectStub');
 await f.api.work(f.api.next);assert.equal(f.api.state.step,1);assert.equal(f.element('wizard-next').disabled,false);
 assert.equal((f.element('wizard-content').innerHTML.match(/<button/g)||[]).length,0);
});
test('pending owner permission opens only the private Google authorization page and verifies it before advancing',async()=>{
 const f=fixture(false);f.api.state.step=1;f.api.state.profile.email='owner@example.com';
 f.api.state.resources={scriptId:'P1',spreadsheetId:'S1',ownerEmail:'owner@example.com',backendUrl:'https://script.google.com/macros/s/BACKEND/exec',bootstrapSecret:'private',authorizationUrl:'https://script.google.com/macros/s/AUTH/exec'};
 f.api.render();assert.equal(f.element('wizard-authorization').hidden,false);assert.equal(f.element('wizard-next').hidden,true);assert.equal(f.element('wizard-authorization').href,'https://script.google.com/macros/s/AUTH/exec');
 assert.ok(!f.element('wizard-content').innerHTML.includes('/edit'));assert.ok(!f.element('wizard-content').innerHTML.includes('authorizePilot'));
 f.element('wizard-authorization').listeners.click();assert.equal(f.element('wizard-authorization').hidden,true);assert.equal(f.element('wizard-next').hidden,false);assert.equal(f.element('wizard-next').textContent,'בדיקת האישור והמשך');
 let checks=0;f.context.probeStub=async()=>{checks++;f.api.state.resourcesReady=true;};f.run('probe=probeStub');
 await f.api.work(f.api.next);assert.equal(checks,1);assert.equal(f.api.state.step,2);
});
test('double submission cannot open a second Google setup while the first is pending',async()=>{
 const f=fixture();f.api.state.step=1;let release,calls=0;
 f.context.connectStub=()=>{calls++;return new Promise(r=>{release=()=>{f.api.state.resourcesReady=true;r();};});};f.run('connectWorkspace=connectStub');
 const pending=f.api.work(f.api.next);await f.api.work(f.api.next);assert.equal(calls,1);assert.equal(f.element('wizard-form').inert,true);
 release();await pending;assert.equal(f.api.state.step,2);assert.equal(f.element('wizard-form').inert,false);
});
test('successful Morning connection loads clients and advances automatically; a load failure can retry without repeating initialization',async()=>{
 const f=fixture();f.api.state.step=3;
 for(const [key,value] of Object.entries({morningKey:'demo',morningSecret:'demo',environment:'sandbox'}))f.element('wizard-form').elements[key]={value};
 let initializations=0,loads=0;
 f.context.morningStub=async()=>{initializations++;f.api.state.initialized=true;};
 f.context.clientsStub=async()=>{loads++;if(loads===1)throw Error('load failed');f.api.state.clientsLoaded=true;};
 f.run('testMorning=morningStub;loadClients=clientsStub');
 await f.api.work(f.api.next);assert.equal(f.api.state.step,3);assert.equal(f.element('wizard-error').textContent,'load failed');
 await f.api.work(f.api.next);assert.equal(initializations,1);assert.equal(loads,2);assert.equal(f.api.state.step,4);
 assert.equal(f.element('wizard-next').textContent,'המשך לנוסחי ההודעות');assert.equal((f.element('wizard-content').innerHTML.match(/<button/g)||[]).length,0);
});
