import test from 'node:test';
import assert from 'node:assert/strict';
import {validateClinic,validateSelection,mapMorningClient,selectedPayload,contactChanges,resumableMetadata,formatTemplate,readAccountResources,saveAccountResources} from '../onboarding/model.js';

test('switching Google accounts resumes each owner separately without deleting an earlier setup',()=>{
 const data=new Map(),storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
 data.set('THERAPAY_PILOT_RESOURCES',JSON.stringify({ownerEmail:'first@example.com',spreadsheetId:'FIRST',password:'not-preserved'}));
 assert.deepEqual(readAccountResources(storage,'second@example.com'),{});
 saveAccountResources(storage,{ownerEmail:'second@example.com',spreadsheetId:'SECOND',googleToken:'not-preserved',password:'not-preserved'});
 assert.equal(readAccountResources(storage,' FIRST@EXAMPLE.COM ').spreadsheetId,'FIRST');
 assert.equal(readAccountResources(storage,'second@example.com').spreadsheetId,'SECOND');
 saveAccountResources(storage,{ownerEmail:'first@example.com',spreadsheetId:'FIRST',scriptId:'P1'});
 assert.equal(readAccountResources(storage,'first@example.com').scriptId,'P1');
 assert.equal(readAccountResources(storage,'second@example.com').spreadsheetId,'SECOND');
 assert.ok(data.has('THERAPAY_PILOT_RESOURCES'));assert.ok(!JSON.stringify(readAccountResources(storage,'first@example.com')).includes('not-preserved'));
 assert.ok(!data.get('THERAPAY_PILOT_RESOURCES:second%40example.com').includes('not-preserved'));
 data.set('THERAPAY_PILOT_RESOURCES:second%40example.com','broken');assert.deepEqual(readAccountResources(storage,'second@example.com'),{});
 assert.throws(()=>saveAccountResources(storage,{spreadsheetId:'UNKNOWN'}));
});
test('selected patients require valid phone, email and rate; unselected patients do not block',()=>{const a=mapMorningClient({id:'M1',name:'נועה',emails:[]},350);assert.deepEqual(validateSelection([a]),{});a.selected=true;assert.equal(validateSelection([a]).M1.length,2);a.phone='+972541234567';a.email='a@example.com';assert.deepEqual(validateSelection([a]),{});assert.equal(selectedPayload([a])[0].phone,'0541234567');assert.equal(contactChanges([a]).length,1);a.rate=-1;assert.throws(()=>selectedPayload([a]));});
test('clinic password must be chosen and confirmed with a valid default rate',()=>{assert.equal(Object.keys(validateClinic({clinicName:'דנה',password:'a'.repeat(16),passwordConfirm:'a'.repeat(16),defaultRate:350})).length,0);assert.ok(validateClinic({clinicName:'דנה',password:'short',passwordConfirm:'wrong',defaultRate:0}).password);});
test('resumable metadata never stores credentials or patient records',()=>{const value=resumableMetadata({ownerEmail:'owner@example.com',spreadsheetId:'S1',password:'private',morningKey:'key',clients:[{name:'private'}],googleToken:'private'});assert.deepEqual(Object.keys(value),['ownerEmail','spreadsheetId','scriptId','deploymentId','backendUrl']);assert.ok(!JSON.stringify(value).includes('private'));});
test('message templates substitute known fields without evaluating content',()=>{assert.equal(formatTemplate('שלום {patientName}: {amount}',{patientName:'נועה',amount:'350 ₪'}),'שלום נועה: 350 ₪');});
