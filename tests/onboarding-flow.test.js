import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as model from '../onboarding/model.js';
import {SAMPLE_CLIENTS} from '../onboarding/demo.js';
const source=fs.readFileSync(new URL('../onboarding/wizard.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'');
function fixture(demo=true){
 const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,disabled:false,textContent:'',innerHTML:'',elements:{},listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},scrollIntoView(){}});return elements.get(id);};
 const context={...model,SAMPLE_CLIENTS,upgradePasswordPolicy:async()=>({updated:false}),config:{},URLSearchParams,TextDecoder,Uint8Array,console,location:{search:demo?'?demo=1':'',protocol:'http:'},window:{scrollTo(){}},document:{getElementById:element,addEventListener(){}},setTimeout,clearTimeout};
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
 f.api.state.awaitingOwnerApproval=true;f.api.state.resources={scriptId:'P1',spreadsheetId:'S1',ownerEmail:'owner@example.com',backendUrl:'https://script.google.com/macros/s/BACKEND/exec',bootstrapSecret:'private',authorizationUrl:'https://script.google.com/macros/s/AUTH/exec'};
 f.api.render();assert.equal(f.element('wizard-authorization').hidden,false);assert.equal(f.element('wizard-next').hidden,true);assert.equal(f.element('wizard-authorization').href,'https://script.google.com/macros/s/AUTH/exec');
 assert.ok(!f.element('wizard-content').innerHTML.includes('/edit'));assert.ok(!f.element('wizard-content').innerHTML.includes('authorizePilot'));
 f.element('wizard-authorization').listeners.click();assert.equal(f.element('wizard-authorization').hidden,true);assert.equal(f.element('wizard-next').hidden,false);assert.equal(f.element('wizard-next').textContent,'בדיקת האישור והמשך');
 let checks=0;f.context.probeStub=async()=>{checks++;f.api.state.resourcesReady=true;};f.run('probe=probeStub');
 await f.api.work(f.api.next);assert.equal(checks,1);assert.equal(f.api.state.step,2);
});
test('forgot-password flow verifies the same Google owner and prepares a private reset link without reading or changing the password',async()=>{
 const f=fixture(false);f.api.state.step=1;f.api.state.profile.email='owner@example.com';f.api.state.resources={initialized:true,ownerEmail:'owner@example.com',scriptId:'P1',spreadsheetId:'S1'};
 let prepares=0;f.context.requestGoogleAccess=()=>Promise.resolve('owner-token');f.context.googleRequest=async()=>({email:'owner@example.com',email_verified:true});f.context.prepareOwnerAuthorization=async input=>{prepares++;assert.equal(input.purpose,'reset');assert.equal(input.ownerEmail,'owner@example.com');assert.equal(input.token,'owner-token');assert.ok(!('password' in input));return 'https://script.google.com/macros/s/RESET/exec';};
 await f.context.preparePasswordReset();assert.equal(prepares,1);assert.equal(f.api.state.step,1);assert.match(f.element('wizard-content').innerHTML,/פתיחת איפוס הסיסמה/);assert.ok(!f.element('wizard-content').innerHTML.includes('owner-token'));assert.equal(f.element('wizard-form').inert,false);
 const other=fixture(false);other.api.state.step=1;other.api.state.profile.email='owner@example.com';other.context.requestGoogleAccess=()=>Promise.resolve('token');other.context.googleRequest=async()=>({email:'other@example.com',email_verified:true});other.context.prepareOwnerAuthorization=async()=>{throw Error('Must not prepare another account');};await other.context.preparePasswordReset();assert.match(other.element('wizard-error').textContent,/אותו חשבון/);assert.equal(other.api.state.resources.passwordResetUrl,undefined);
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


test('Google settings is a secondary link and check-and-continue remains visible without back navigation',async()=>{
 const f=fixture(false);f.api.state.step=1;f.api.state.profile.email='new@example.com';f.api.render();
 assert.equal(f.element('wizard-api-settings').hidden,true);assert.equal(f.element('wizard-next').hidden,false);
 assert.match(f.element('wizard-content').innerHTML,/https:\/\/script.google.com\/home\/usersettings/);
 assert.match(f.element('wizard-content').innerHTML,/new@example.com/);
 assert.equal(f.element('wizard-next').textContent,'הפעלתי — בדיקה והמשך');
 let calls=0;f.context.connectStub=async()=>{calls++;f.api.state.resourcesReady=true;};f.run('connectWorkspace=connectStub');
 await f.api.work(f.api.next);assert.equal(calls,1);assert.equal(f.api.state.step,2);
});

test('partial project creation and a 404 do not display Google approval instructions',async()=>{
 const f=fixture(false);f.api.state.step=1;f.api.state.resources={scriptId:'P1',spreadsheetId:'S1'};f.api.render();
 assert.ok(!f.element('wizard-content').innerHTML.includes('האישור הושלם'));
 assert.equal(f.element('wizard-authorization').hidden,true);
 f.context.probeStub=async()=>{const error=Error('Missing deployed page');error.code='HTTP_404';throw error;};f.run('probe=probeStub');
 await assert.rejects(f.context.verifyOrPrepareAuthorization(),/Missing deployed page/);
 assert.equal(f.api.state.awaitingOwnerApproval,false);
});


test('brand-new backend proceeds to probe without invoking the legacy upgrade',async()=>{
 const f=fixture(false);f.api.state.step=1;f.api.state.profile.email='owner@example.com';
 f.run('loadGis=async()=>{};requestGoogleAccess=async()=>"token";probe=async()=>{state.resourcesReady=true;};');
 f.context.googleRequest=async()=>({email:'owner@example.com',email_verified:true});
 f.context.fetch=async()=>({ok:true,text:async()=> 'source'});f.context.localStorage={getItem:()=>null};
 f.context.provisionWorkspace=async()=>({ownerEmail:'owner@example.com',spreadsheetId:'S1',scriptId:'P1',backendUrl:'https://script.google.com/macros/s/D1/exec',bootstrapSecret:'private',createdFresh:true});
 f.context.upgradePasswordPolicy=async()=>{throw Error('Fresh backend must not be upgraded');};
 await f.api.work(f.api.next);assert.equal(f.api.state.step,2);assert.equal(f.element('wizard-error').hidden,true);
});


test('large client list renders only forty rows while selection counts and search cover all clients',()=>{
 const f=fixture();f.api.state.step=4;f.api.state.clientsLoaded=true;
 f.api.state.clients=Array.from({length:1250},(_,i)=>({id:'M'+i,name:'Client '+i,phone:'0541234567',email:'p@example.com',rate:350,selected:i===999}));
 f.api.render();assert.equal((f.element('client-picker').innerHTML.match(/<article/g)||[]).length,40);assert.match(f.element('client-picker').innerHTML,/עמוד 1 מתוך 32/);assert.equal(f.element('import-count').textContent,'מטופל אחד נבחר');
 f.api.state.clientsPage=1;f.api.render();assert.match(f.element('client-picker').innerHTML,/data-client-id="M40"/);assert.ok(!f.element('client-picker').innerHTML.includes('data-client-id="M0"'));
 f.api.state.search='Client 999';f.api.render();assert.equal((f.element('client-picker').innerHTML.match(/<article/g)||[]).length,1);assert.match(f.element('client-picker').innerHTML,/data-client-id="M999" checked/);
});
