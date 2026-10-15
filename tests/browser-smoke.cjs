// Run with Playwright installed: node tests/browser-smoke.cjs
const {chromium}=require('playwright');
const http=require('node:http');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const p=path.join(root,req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);if(!p.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}try{res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(p));}catch{res.writeHead(404);res.end();}});
(async()=>{let browser;try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});fs.mkdirSync(path.join(root,'test-output'),{recursive:true});
 const errors=[];const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:1});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/?demo=1');await page.locator('input[data-appointment]').first().waitFor();
 assert.equal(await page.locator('input[data-appointment]:checked').count(),3);
 await page.locator('input[data-appointment]').nth(3).check();assert.ok((await page.locator('#selection-total').textContent()).includes('1,400'));
 await page.click('#whatsapp');assert.ok((await page.inputValue('#message-text')).includes('נועה לוי'));await page.locator('#message [data-close]').click();
 await page.selectOption('#patient-filter','PAT-DEMO-2');assert.ok((await page.locator('#selection-total').textContent()).includes('400'));
 await page.selectOption('#patient-filter','PAT-DEMO-1');
 await page.screenshot({path:path.join(root,'test-output/mobile-390.png'),fullPage:true});
 for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:844});for(const view of ['collection','patients','appointments','documents']){await page.locator('[data-view='+view+']').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'horizontal overflow '+width+' '+view);}}
 await page.setViewportSize({width:390,height:844});
 const live=await browser.newPage({viewport:{width:390,height:844},isMobile:true});live.on('pageerror',e=>errors.push(e.message));
 const api='https://script.google.com/macros/s/TEST_BACKEND/exec';let calls=[];let paid=false;
 const data=()=>({success:true,apiVersion:2,environment:'sandbox',morningConfigured:true,patients:[{id:'PAT-1',name:'נועה <בדיקה>',phone:'0541234567',rate:400,status:'פעיל'}],appointments:[{id:'APP-old',patientId:'PAT-1',clientName:'נועה <בדיקה>',date:'2025-01-02',amount:400,isPaid:paid,docNumber:paid?'123':'',pdfUrl:paid?'https://example.com/doc.pdf':''},{id:'APP-current',patientId:'PAT-1',clientName:'נועה <בדיקה>',date:new Date().toISOString().slice(0,7)+'-01',amount:400,isPaid:false,docNumber:'',pdfUrl:''}]});
 await live.addInitScript(url=>{localStorage.setItem('APPS_SCRIPT_URL',url);sessionStorage.setItem('THERAPAY_ACCESS_TOKEN','test-only');},api);
 await live.route(api,async route=>{const req=route.request().postDataJSON();calls.push(req);if(req.action==='createMorningDoc'){paid=true;await route.fulfill({json:{success:true,apiVersion:2,docNumber:'123',pdfUrl:'https://example.com/doc.pdf'}});}else await route.fulfill({json:data()});});
 await live.goto(base);await live.locator('input[data-appointment]').first().waitFor();assert.equal(await live.locator('input[data-appointment]:checked').count(),1);
 await live.click('#payment');await live.locator('input[name=confirmed]').check();await live.click('#issue');await live.waitForFunction(()=>document.querySelector('#pay-result').textContent.includes('הופק'));
 const issuance=calls.filter(x=>x.action==='createMorningDoc');assert.equal(issuance.length,1);assert.deepEqual(issuance[0].ids,['APP-old']);assert.equal(issuance[0].amount,400);
 await live.locator('#pay [data-close]').click();await live.locator('[data-view=documents]').click();assert.equal(await live.locator('#document-list a').count(),1);
 assert.deepEqual(errors,[]);console.log('Browser checks passed: selection, messages, payment request, document link, XSS text rendering, 320/390/768/1280px without horizontal overflow.');
}finally{await browser?.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
