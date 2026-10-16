import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultSelection,selectedAppointments,total,taskReminderDate,actionableTasks,dashboardMetrics,phoneForWhatsApp,paymentMessage,today,validDate} from '../domain.js';
const apps=[{id:'old',patientId:'p1',date:'2026-09-15',amount:350,isPaid:false},{id:'now',patientId:'p1',date:'2026-10-01',amount:400,isPaid:false},{id:'paid',patientId:'p1',date:'2026-08-01',amount:350,isPaid:true},{id:'other',patientId:'p2',date:'2026-09-15',amount:350,isPaid:false},{id:'bad',patientId:'p1',date:'broken',amount:350,isPaid:false}];
test('October selects only prior unpaid appointments for this patient',()=>assert.deepEqual([...defaultSelection(apps,'p1','2026-10')],['old']));
test('selection cannot include another patient or paid appointments',()=>{const list=selectedAppointments(apps,new Set(['old','now','paid','other']),'p1');assert.equal(total(list),750);assert.equal(list.length,2);});
test('year boundary and Jerusalem daylight saving time use local calendar dates',()=>{assert.equal(today(new Date('2026-12-31T22:30:00Z')),'2027-01-01');assert.equal(today(new Date('2026-10-14T22:30:00Z')),'2026-10-15');assert.equal(validDate('2026-02-30'),false);assert.equal(validDate('2024-02-29'),true);});
test('phone numbers convert to WhatsApp format without missing leading zero',()=>{for(const phone of ['054-1234567','+972541234567','00972541234567'])assert.equal(phoneForWhatsApp(phone),'972541234567');assert.throws(()=>phoneForWhatsApp(''));});
test('message includes actual selected months, dates, patient, total and signature',()=>{const text=paymentMessage({name:'נועה'},apps.slice(0,2),'דנה');for(const word of ['נועה','ספטמבר','אוקטובר','15.09.2026','01.10.2026','750','דנה'])assert.ok(text.includes(word));assert.ok(!text.includes('אוגוסט'));});
test('totals round cents for each whole appointment',()=>assert.equal(total([{amount:.1},{amount:.2}]),.3));

test('dashboard uses session months including paid and unpaid, with only prior unpaid debt',()=>{
  const rows=[...apps,{patientId:'p1',date:'2026-09-16',amount:200,isPaid:true},{patientId:'p2',date:'2026-11-01',amount:900,isPaid:false}];
  const m=dashboardMetrics([{id:'p1',status:'פעיל'},{id:'p2',status:'לא פעיל'}],rows,'2026-10-16');
  assert.equal(m.activePatients,1);assert.equal(m.previousIncome,900);assert.equal(m.currentForecast,400);assert.equal(m.debt,700);assert.equal(m.debtPatients,2);
});
test('dashboard previous month handles January and an empty month',()=>{
  const m=dashboardMetrics([],[{patientId:'p1',date:'2026-12-15',amount:350,isPaid:true}],'2027-01-01');
  assert.equal(m.previous,'2026-12');assert.equal(m.previousIncome,350);assert.equal(m.currentForecast,0);assert.equal(m.debt,0);
});

test('tasks start on their reminder date, or due date without advance reminder',()=>{
  const task={dueDate:'2026-10-20',remindDays:2,completed:false};
  assert.equal(taskReminderDate(task),'2026-10-18');assert.equal(actionableTasks([task],'2026-10-17').length,0);assert.equal(actionableTasks([task],'2026-10-18').length,1);
  assert.equal(actionableTasks([task],'2026-11-01').length,1);assert.equal(actionableTasks([{...task,completed:true}],'2026-11-01').length,0);
  assert.equal(actionableTasks([{...task,remindDays:0}],'2026-10-19').length,0);assert.equal(actionableTasks([{...task,remindDays:0}],'2026-10-20').length,1);
  assert.equal(actionableTasks([{...task,dueDate:''}],'2026-11-01').length,0);
  assert.equal(taskReminderDate({...task,dueDate:'2027-01-01',remindDays:1}),'2026-12-31');
});
