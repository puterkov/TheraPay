import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {clientLoadCache,loadClientPages} from '../onboarding/client-loader.js';
function storage(){const data=new Map();return {data,getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};}
const cacheFor=(store,extra={})=>clientLoadCache({storage:store,ownerEmail:'owner@example.com',spreadsheetId:'S1',password:'Chosen12!',cryptoImpl:webcrypto,...extra});
const mapClient=c=>({...c,selected:false});
test('encrypted checkpoints persist no plaintext client information or credentials and bind to clinic/password',async()=>{
 const store=storage(),cache=cacheFor(store),snapshot={clients:[{id:'M1',name:'Private patient',email:'private@example.com'}],nextPage:2,total:1,pages:1,complete:true};
 await cache.write(snapshot);const raw=[...store.data.values()][0];for(const secret of ['Private patient','private@example.com','Chosen12!'])assert.ok(!raw.includes(secret));
 assert.deepEqual(await cacheFor(store).read(),snapshot);await assert.rejects(cacheFor(store,{password:'Wrong123!'}).read());assert.equal(await cacheFor(store,{spreadsheetId:'OTHER'}).read(),null);
 cache.clear();assert.equal(store.data.size,0);
});
test('large loading interruption resumes after the last committed page with no duplicates; complete snapshots need no network',async()=>{
 const store=storage(),requested=[],total=1250,pages=13;
 const pageResult=page=>({page,total,pages,items:Array.from({length:page===pages?50:100},(_,i)=>({id:'M'+((page-1)*100+i),name:'Name '+i}))});
 await assert.rejects(loadClientPages({cache:cacheFor(store),mapClient,delay:async()=>{},requestPage:async page=>{requested.push(page);if(page===6)throw Error('network interrupted');return pageResult(page);}}));
 assert.deepEqual(requested,[1,2,3,4,5,6,6,6]);const partial=await cacheFor(store).read();assert.equal(partial.clients.length,500);assert.equal(partial.nextPage,6);assert.equal(partial.complete,false);
 requested.length=0;const clients=await loadClientPages({cache:cacheFor(store),mapClient,requestPage:async page=>{requested.push(page);return pageResult(page);}});assert.equal(clients.length,1250);assert.equal(new Set(clients.map(c=>c.id)).size,1250);assert.deepEqual(requested,[6,7,8,9,10,11,12,13]);
 assert.equal((await loadClientPages({cache:cacheFor(store),mapClient,requestPage:async()=>{throw Error('Must use checkpoint');}})).length,1250);
});
test('transient read failures retry but authentication failures do not retry or erase prior progress',async()=>{
 const store=storage(),cache=cacheFor(store);let calls=0;
 const clients=await loadClientPages({cache,mapClient,delay:async()=>{},requestPage:async()=>{if(++calls===1){const error=Error('Morning unavailable');error.code='VALIDATION';throw error;}return {page:1,total:1,pages:1,items:[{id:'M1'}]};}});assert.equal(clients.length,1);assert.equal(calls,2);
 cache.clear();calls=0;await assert.rejects(loadClientPages({cache,mapClient,delay:async()=>{},requestPage:async()=>{calls++;const error=Error('Wrong password');error.code='AUTH';throw error;}}));assert.equal(calls,1);
});
test('duplicate pages, changed totals and incomplete final pages never replace a good checkpoint',async()=>{
 for(const fault of ['duplicate','total','incomplete']){
  const store=storage(),cache=cacheFor(store),snapshot={clients:[{id:'M1'}],nextPage:2,total:2,pages:2,complete:false};await cache.write(snapshot);
  await assert.rejects(loadClientPages({cache,mapClient,requestPage:async()=>({page:2,total:fault==='total'?3:2,pages:2,items:fault==='incomplete'?[]:[{id:fault==='duplicate'?'M1':'M2'}]})}));assert.deepEqual(await cache.read(),snapshot);
 }
});
test('storage quota failure preserves the previous durable checkpoint',async()=>{
 const store=storage(),cache=cacheFor(store),snapshot={clients:[{id:'M1'}],nextPage:2,total:2,pages:2,complete:false};await cache.write(snapshot);store.setItem=()=>{throw Error('Quota');};
 await assert.rejects(loadClientPages({cache,mapClient,requestPage:async()=>({page:2,total:2,pages:2,items:[{id:'M2'}]})}),/אין מספיק מקום/);assert.deepEqual(await cache.read(),snapshot);
});
