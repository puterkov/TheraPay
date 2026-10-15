import { today, money, validDate, defaultSelection, selectedAppointments, total, phoneForWhatsApp, displayDate, paymentMessage, applyIssuedDocument } from './domain.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const demo = new URLSearchParams(location.search).get('demo') === '1';
const state = { patients:[], appointments:[], patientId:'', month:today().slice(0,7), appointmentsPatient:'ALL', appointmentsMonth:'ALL', selected:new Set(), view:'dashboard', connected:false, loaded:false, loading:false, refreshFailed:false, environment:'sandbox', morningConfigured:false, emailDelivery:false, recipient:null, busy:false };
let recipientLookup=0;
let attempt = readAttempt();
function readAttempt() { try { return JSON.parse(sessionStorage.getItem('THERAPAY_ATTEMPT') || 'null'); } catch { return null; } }
function notice(text, error = false) { $('notice').textContent = text; $('notice').hidden = false; $('notice').classList.toggle('error', error); }
function patient() { return state.patients.find(p => p.id === state.patientId); }
function chosen() { return selectedAppointments(state.appointments, state.selected, state.patientId); }
function apiUrl() { return localStorage.getItem('APPS_SCRIPT_URL') || 'https://script.google.com/macros/s/AKfycbwQbZlqV_kHG6IaffOtnoJ7x1ufiWa9Z9rFJs7eUaLO1hc-d1-4l2WeiEBaZFCn5uq5aA/exec'; }
function uuid() { return crypto.randomUUID(); }
function safeLink(url) { try { const u = new URL(url); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } }
function accessToken(){return sessionStorage.getItem('THERAPAY_ACCESS_TOKEN')||localStorage.getItem('THERAPAY_ACCESS_TOKEN')||'';}
function rememberAccess(token,remember){sessionStorage.setItem('THERAPAY_ACCESS_TOKEN',token);localStorage.setItem('THERAPAY_REMEMBER',String(remember));if(remember)localStorage.setItem('THERAPAY_ACCESS_TOKEN',token);else localStorage.removeItem('THERAPAY_ACCESS_TOKEN');}
function forgetAccess(){sessionStorage.removeItem('THERAPAY_ACCESS_TOKEN');localStorage.removeItem('THERAPAY_ACCESS_TOKEN');}

async function api(action, payload = {}) {
  if (demo) throw new Error('מצב הדגמה אינו מחובר לשרת.');
  const token = accessToken();
  if (!apiUrl() || !token) { const error=new Error('יש להתחבר לקליניקה דרך ההגדרות.');error.code='AUTH';throw error; }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 65000);
  try {
    const response = await fetch(apiUrl(), { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify({ ...payload, action, accessToken:token }), signal:controller.signal, redirect:'follow', credentials:'omit' });
    if (!response.ok) { const error=new Error('שגיאת תקשורת עם השרת.');if(response.status===401||response.status===403)error.code='AUTH';throw error; }
    let data;
    try { data = await response.json(); } catch { throw new Error('השרת לא החזיר נתונים תקינים. יש לבדוק את פריסת Apps Script.'); }
    if (!data.success) { const error = new Error(data.message || 'הפעולה נכשלה'); error.code = data.code; throw error; }
    if (data.apiVersion !== 2) throw new Error('יש לעדכן את הבקנד לגרסה 2 לפני החיבור לממשק הזה.');
    return data;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) throw new Error(action==='getAllData'?'לא התקבלו נתונים מהשרת. אפשר לנסות לרענן שוב דרך ההגדרות.':action==='createMorningDoc'?'לא התקבלה תשובה מהשרת. יש לבדוק את Morning לפני ניסיון נוסף; הבקשה נשמרה למניעת כפילות.':'לא התקבלה תשובה לשמירה. אפשר לנסות שוב עם אותם פרטים; מזהה הבקשה נשמר למניעת כפילות.');
    throw error;
  } finally { clearTimeout(timeout); }
}

async function load() {
  if (state.busy || state.loading) return;
  state.loading=true;
  $('connection').textContent = 'טוען…';
  updateSelection();
  $('refresh').disabled=true;
  try {
    const data = await api('getAllData');
    if (!Array.isArray(data.patients) || !Array.isArray(data.appointments)) throw new Error('מבנה הנתונים מהשרת אינו תקין.');
    state.patients = data.patients;
    state.appointments = data.appointments;
    state.connected = true;
    state.loaded = true;
    state.refreshFailed = false;
    $('settings-result').textContent='';
    state.environment = data.environment;
    state.morningConfigured = data.morningConfigured;
    state.emailDelivery = data.supportsEmailDelivery===true;
    rememberAccess(accessToken(),localStorage.getItem('THERAPAY_REMEMBER')!=='false');
    if (!patient()) { state.patientId = state.patients[0]?.id || ''; resetSelection(); }
    state.selected = new Set(chosen().map(a => a.id));
    render();
    $('notice').hidden=true;
  } catch (error) {
    // A failed read is not a logout. Only an explicit authentication failure invalidates access.
    if(error.code==='AUTH'){state.connected=false;forgetAccess();}
    state.refreshFailed=state.loaded;
    $('settings-result').textContent=error.message;
    render();
    notice(state.loaded && error.code!=='AUTH' ? 'רענון הנתונים לא הושלם. מוצגים הנתונים האחרונים; אפשר לנסות שוב דרך ההגדרות.' : error.message,true);
    throw error;
  } finally {state.loading=false;$('refresh').disabled=false;renderConnectionStatus();updateSelection();}
}

function resetSelection() { state.selected = defaultSelection(state.appointments, state.patientId, state.month); }
function view(name) {
  state.view = name;
  document.querySelectorAll('.view').forEach(e => e.hidden = e.id !== name);
  document.querySelectorAll('[data-view]').forEach(e => { if(e.dataset.view === name) e.setAttribute('aria-current','page'); else e.removeAttribute('aria-current'); });
  $('collection-dock').hidden = name !== 'collection' || !(state.connected || demo);
  window.scrollTo({top:0});
}
function appointmentRow(a,selectable=false){
  const date=validDate(a.date)?a.date.slice(2).split('-').reverse().join('.'):'חסר תאריך';
  const selection=selectable?`<td class="pick-cell"><label class="cell-pick"><input type="checkbox" data-appointment="${esc(a.id)}" aria-label="בחירת פגישה ${esc(displayDate(a.date))}" ${state.selected.has(a.id)?'checked':''} ${a.isPaid||!validDate(a.date)?'disabled':''}></label></td>`:'';
  return `<tr data-record-row data-detail="${esc(a.id)}">${selection}<td class="date-cell"><button class="row-open" data-detail="${esc(a.id)}" aria-label="פרטי פגישה ${esc(displayDate(a.date))}"><span dir="ltr">${esc(date)}</span></button></td>${selectable?'':`<td class="name-cell">${esc(a.clientName)}</td>`}<td class="amount-cell">${esc(money(a.amount))}</td><td><span class="status-pill ${a.isPaid?'paid':'pending'}">${a.isPaid?'שולם':'ממתין'}</span></td></tr>`;
}
function appointmentTable(rows,selectable=false,caption='פגישות'){
  return `<div class="session-table-wrap"><table class="session-table ${selectable?'collection-table':'appointments-table'}"><caption class="sr-only">${esc(caption)}</caption><thead><tr>${selectable?'<th scope="col" class="pick-cell"><span class="sr-only">בחירה</span></th>':''}<th scope="col">תאריך</th>${selectable?'':'<th scope="col">מטופל</th>'}<th scope="col">סכום</th><th scope="col">סטטוס</th></tr></thead>${rows}</table></div>`;
}
function showAppointmentDetails(id){
  const a=state.appointments.find(a=>a.id===id);if(!a)return;
  const link=safeLink(a.pdfUrl);
  $('appointment-detail-content').innerHTML=`<dl class="session-details"><dt>מטופל</dt><dd>${esc(a.clientName)}</dd><dt>תאריך</dt><dd>${esc(displayDate(a.date))}</dd><dt>סכום</dt><dd>${esc(money(a.amount))}</dd><dt>סטטוס</dt><dd>${a.isPaid?'שולם':'ממתין לתשלום'}</dd><dt>אמצעי תשלום</dt><dd>${esc(a.paymentMethod||'—')}</dd><dt>מספר חשבונית</dt><dd>${esc(a.docNumber||'—')}</dd></dl>${link?`<a class="button secondary" href="${esc(link)}" target="_blank" rel="noopener noreferrer">צפייה במסמך ↗</a>`:''}`;
  $('appointment-details').showModal();
}
function renderCollection() {
  $('month').value = state.month;
  $('patient-filter').innerHTML = '<option value="">בחירת מטופל</option>' + state.patients.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  $('patient-filter').value = state.patientId;
  const p = patient();
  $('patient-meta').hidden = !p;
  $('patient-meta').textContent = p ? `${p.phone || 'טלפון חסר'} · ${money(p.rate)} לפגישה` : '';
  if (!p) { $('appointment-groups').innerHTML = '<div class="empty">בחרו מטופל לצפייה בפגישות וביתרה שלו.</div>'; updateSelection(); return; }
  const apps = state.appointments.filter(a => a.patientId === p.id).sort((a,b) => a.date.localeCompare(b.date));
  const groups = [
    ['חודשים קודמים · חובות מסומנים מראש', apps.filter(a => !a.isPaid && validDate(a.date) && a.date < state.month+'-01')],
    ['החודש הנבחר · לבחירה לפי הצורך', apps.filter(a => !a.isPaid && a.date.slice(0,7) === state.month)],
    ['פגישות עתידיות', apps.filter(a => !a.isPaid && validDate(a.date) && a.date.slice(0,7) > state.month)],
    ['פגישות ששולמו', apps.filter(a => a.isPaid && a.date.slice(0,7) <= state.month)],
    ['נדרש תיקון תאריך בגיליון', apps.filter(a => !a.isPaid && !validDate(a.date))]
  ];
  const rows=groups.filter(([,list])=>list.length).map(([title,list])=>`<tbody><tr class="table-group"><th colspan="4" scope="rowgroup">${esc(title)}</th></tr>${list.map(a=>appointmentRow(a,true)).join('')}</tbody>`).join('');
  $('appointment-groups').innerHTML=rows?appointmentTable(rows,true,'פגישות לתשלום עבור '+p.name):'<div class="empty">עדיין אין פגישות למטופל הזה.</div>';
  updateSelection();
}
function updateSelection() {
  const list = chosen();
  $('selection-count').textContent = patient()?`${patient().name} · ${list.length} פגישות נבחרו`:'יש לבחור מטופל';
  $('selection-total').textContent = money(total(list));
  $('whatsapp').disabled = !list.length || state.busy || state.loading;
  $('payment').disabled = !list.length || state.busy || state.loading || !(demo || state.connected);
}
function renderConnectionStatus(){
  $('connection').textContent=demo?'מצב הדגמה':state.loading?'מרענן נתונים…':state.connected?(state.refreshFailed?'מחובר · הרענון האחרון לא הושלם':'מחובר לקליניקה'):'לא מחובר · יש להזין קוד גישה';
}
function render() {
  $('demo-badge').hidden=!demo;
  renderConnectionStatus();
  renderDashboard();
  renderCollection();
  $('patient-list').innerHTML = state.patients.map(p => `<article class="patient-card"><div class="row"><strong>${esc(p.name)}</strong><span>${esc(money(p.rate))} לפגישה</span></div><div class="small muted">${esc(p.phone)} · ${esc(p.status)}</div></article>`).join('') || '<div class="empty">טרם נוספו מטופלים.</div>';
  renderAppointments();
  const docs = new Map();
  state.appointments.filter(a => a.docNumber).forEach(a => { const key = `${a.clientName}|${a.docNumber}`; if (!docs.has(key)) docs.set(key,{...a,amount:0,count:0}); const d=docs.get(key); d.amount += a.amount; d.count++; });
  $('document-list').innerHTML = [...docs.values()].map(d => `<article class="document-card"><div class="row"><strong>${esc(d.clientName)}</strong><span>${esc(money(d.amount))}</span></div><div class="small muted">מסמך ${esc(d.docNumber)} · ${d.count} פגישות</div>${safeLink(d.pdfUrl) ? `<a target="_blank" rel="noopener noreferrer" href="${esc(safeLink(d.pdfUrl))}">צפייה במסמך ↗</a>` : '<div class="small muted">קישור למסמך לא נשמר בגיליון</div>'}</article>`).join('') || '<div class="empty">טרם נשמרו מסמכים בגיליון.</div>';
  view(state.view);
}

function renderDashboard() {
  $('dashboard-date').textContent = new Intl.DateTimeFormat('he-IL',{dateStyle:'full',timeZone:'Asia/Jerusalem'}).format(new Date());
  $('stat-patients').textContent = state.patients.length;
  $('stat-appointments').textContent = state.appointments.length;
  $('stat-paid').textContent = money(total(state.appointments.filter(a=>a.isPaid)));
  $('stat-debt').textContent = money(total(state.appointments.filter(a=>!a.isPaid)));
}

function renderAppointments(){
  const patients=$('appointments-patient'),months=$('appointments-month');
  if(!state.patients.some(p=>p.id===state.appointmentsPatient))state.appointmentsPatient='ALL';
  patients.innerHTML='<option value="ALL">כל המטופלים</option>'+state.patients.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  patients.value=state.appointmentsPatient;
  const availableMonths=[...new Set(state.appointments.filter(a=>validDate(a.date)).map(a=>a.date.slice(0,7)))].sort().reverse();
  if(!availableMonths.includes(state.appointmentsMonth))state.appointmentsMonth='ALL';
  months.innerHTML='<option value="ALL">כל החודשים</option>'+availableMonths.map(m=>`<option value="${m}">${esc(new Intl.DateTimeFormat('he-IL',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(m+'-01')))}</option>`).join('');
  months.value=state.appointmentsMonth;
  const list=state.appointments.filter(a=>(state.appointmentsPatient==='ALL'||a.patientId===state.appointmentsPatient)&&(state.appointmentsMonth==='ALL'||a.date.slice(0,7)===state.appointmentsMonth)).sort((a,b)=>b.date.localeCompare(a.date));
  $('all-appointments').innerHTML=list.length?appointmentTable('<tbody>'+list.map(a=>appointmentRow(a)).join('')+'</tbody>'):'<div class="empty">אין פגישות להצגה.</div>';
}

function openDialog(name) {
  if (state.busy) return;
  if (name === 'settings') {
    const form = $('settings-form');
    form.elements.url.value = apiUrl();
    form.elements.accessToken.value = accessToken();
    form.elements.rememberAccess.checked=localStorage.getItem('THERAPAY_REMEMBER')!=='false';
    form.elements.signature.value = localStorage.getItem('THERAPAY_SIGNATURE') || '';
    $('settings-result').textContent='';
    renderConnectionStatus();
    view('settings');
    return;
  }
  if (name === 'patient' || name === 'appointment') {
    if (!state.connected && !demo) { notice('יש להתחבר לקליניקה לפני הוספת נתונים.',true); return openDialog('settings'); }
    if (demo) { notice('זו סביבת הדגמה. שמירת נתונים תתאפשר לאחר חיבור לקליניקה.'); return; }
    const form = $(name+'-form'); form.reset();
    if (name === 'appointment') {
      if (!state.patients.length) { notice('יש להוסיף מטופל לפני רישום פגישה.',true); return; }
      form.elements.patientId.innerHTML = state.patients.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
      form.elements.patientId.value = state.patientId || state.patients[0].id;
      form.elements.date.value = today();
      fillRate();
    }
  }
  $(name).showModal();
}
function fillRate() { const f=$('appointment-form'); f.elements.amount.value = state.patients.find(p => p.id === f.elements.patientId.value)?.rate ?? ''; }
function updateMessageLink() {
  $('whatsapp-link').href = `https://wa.me/${phoneForWhatsApp(patient()?.phone)}?text=${encodeURIComponent($('message-text').value)}`;
}
async function showPayment() {
  if (!chosen().length) return;
  $('pay-form').reset();
  $('pay-form').elements.paymentDate.value = today();
  $('pay-form').elements.paymentDate.max = today();
  $('pay-summary').textContent = `${patient().name} · ${chosen().length} פגישות · ${money(total(chosen()))}`;
  $('pay-environment').textContent = demo ? 'הדגמה בלבד · לא יופק מסמך.' : state.environment === 'sandbox' ? 'סביבת בדיקות Morning · המסמך שיופק הוא מסמך בדיקה.' : 'Morning · הפקת מסמך בחשבון הפעיל.';
  $('pay-result').textContent=''; $('issue').disabled=false;
  state.recipient=null;
  $('pay-email').textContent='בודק את כתובת המייל הרשומה ב־Morning…';
  $('issue').disabled=true;
  $('pay').showModal();
  const lookup=++recipientLookup;
  if(demo){$('pay-email').textContent='הדגמה · כתובת מייל תוצג כאן לפני ההפקה.';$('issue').disabled=false;return;}
  if(!state.emailDelivery){$('pay-email').textContent='נדרש עדכון בקנד כדי להפיק ולשלוח למייל הרשום ב־Morning.';return;}
  try{const data=await api('getMorningRecipient',{patientId:state.patientId});if(lookup!==recipientLookup)return;state.recipient=data.recipient;$('pay-email').textContent='החשבונית תישלח דרך Morning אל: '+data.recipient.emails.join(', ');$('issue').disabled=false;}
  catch(error){if(lookup===recipientLookup)$('pay-email').textContent=error.message;}
}

document.addEventListener('click', event => {
  const open=event.target.closest('[data-open]'); if(open) openDialog(open.dataset.open);
  const close=event.target.closest('[data-close]'); if(close && !state.busy) close.closest('dialog').close();
  const tab=event.target.closest('[data-view]'); if(tab && !state.busy) view(tab.dataset.view);
  const person=event.target.closest('[data-patient]'); if(person) {state.patientId=person.dataset.patient;resetSelection();renderCollection();view('collection');}
  const detail=event.target.closest('[data-detail]');if(detail&&!event.target.closest('.cell-pick')&&!state.busy)showAppointmentDetails(detail.dataset.detail);
});
document.querySelectorAll('dialog').forEach(d => d.addEventListener('cancel',e => {if(state.busy)e.preventDefault();}));
$('patient-filter').addEventListener('change', e => {state.patientId=e.target.value;resetSelection();renderCollection();});
$('appointments-patient').addEventListener('change',e=>{state.appointmentsPatient=e.target.value;renderAppointments();});
$('appointments-month').addEventListener('change',e=>{state.appointmentsMonth=e.target.value;renderAppointments();});
$('month').addEventListener('change',e=>{if(/^\d{4}-\d{2}$/.test(e.target.value)){state.month=e.target.value;resetSelection();renderCollection();}});
$('appointment-groups').addEventListener('change',e=>{const id=e.target.dataset.appointment;if(id){e.target.checked?state.selected.add(id):state.selected.delete(id);updateSelection();}});
$('appointment-form').elements.patientId.addEventListener('change',fillRate);
$('whatsapp').addEventListener('click',()=>{try{phoneForWhatsApp(patient()?.phone);$('message-text').value=paymentMessage(patient(),chosen(),localStorage.getItem('THERAPAY_SIGNATURE')||'');updateMessageLink();$('message').showModal();}catch(e){notice(e.message,true);}});
$('message-text').addEventListener('input',updateMessageLink);
if(demo) $('whatsapp-link').addEventListener('click',e=>{e.preventDefault();notice('מצב הדגמה · לא נפתחת שיחה למספר הבדוי.');$('message').close();});
$('payment').addEventListener('click',showPayment);
$('settings-form').addEventListener('submit',async e=>{
  e.preventDefault(); const f=e.target; let u;
  try{u=new URL(f.elements.url.value.trim());if(u.protocol!=='https:'||u.hostname!=='script.google.com'||!/^\/macros\/s\/[\w-]+\/exec$/.test(u.pathname)||u.search)throw new Error();}catch{notice('יש להזין כתובת Web App שמסתיימת ב־/exec, מתוך Apps Script.',true);return;}
  localStorage.setItem('APPS_SCRIPT_URL',u.href);localStorage.setItem('THERAPAY_SIGNATURE',f.elements.signature.value.trim());rememberAccess(f.elements.accessToken.value.trim(),f.elements.rememberAccess.checked);
  const b=f.querySelector('[type=submit]');b.disabled=true;try{await load();$('settings-result').textContent='החיבור הושלם והנתונים נטענו.';}catch(error){$('settings-result').textContent=error.message;}finally{b.disabled=false;}
});
$('refresh').addEventListener('click',async()=>{try{await load();$('settings-result').textContent='הנתונים עודכנו.';}catch(error){$('settings-result').textContent=error.message;}});
$('disconnect').addEventListener('click',()=>{if(state.loading)return;forgetAccess();state.patients=[];state.appointments=[];state.patientId='';state.selected.clear();state.connected=false;state.loaded=false;state.refreshFailed=false;render();$('settings-result').textContent='התנתקת מהקליניקה.';});
for(const type of ['patient','appointment']) $(type+'-form').addEventListener('submit',async e=>{
  e.preventDefault();const f=e.target;const b=f.querySelector('[type=submit]');b.disabled=true;
  const values=Object.fromEntries(new FormData(f));
  if(type==='patient')values.rate=Number(values.rate);else values.amount=Number(values.amount);
  // The same form submission keeps its request ID after network failure.
  const fingerprint=JSON.stringify(values);if(f.dataset.fingerprint!==fingerprint){f.dataset.fingerprint=fingerprint;f.dataset.requestId=uuid();}
  let formStatus=f.querySelector('[role=status]');if(formStatus)formStatus.remove();
  try{await api(type==='patient'?'addPatient':'addAppointment',{...values,requestId:f.dataset.requestId});f.closest('dialog').close();delete f.dataset.fingerprint;delete f.dataset.requestId;await load();notice(type==='patient'?'המטופל נוסף בהצלחה':'הפגישה נוספה בהצלחה');}catch(error){notice(error.message,true);formStatus=document.createElement('p');formStatus.setAttribute('role','status');formStatus.textContent=error.message;f.append(formStatus);}finally{b.disabled=false;}
});
$('pay-form').addEventListener('submit',async e=>{
  e.preventDefault();if(state.busy||state.loading||!chosen().length)return;
  if(demo){$('pay-result').textContent='הדגמה בלבד · כאן תופק חשבונית מס־קבלה. לא בוצעה הנפקה.';return;}
  if(!state.morningConfigured){$('pay-result').textContent='מפתחות Morning טרם הוגדרו בבקנד.';return;}
  if(!state.emailDelivery||!state.recipient){$('pay-result').textContent='יש לבדוק את כתובת המייל ב־Morning לפני ההפקה.';return;}
  const f=e.target;const payload={patientId:state.patientId,ids:chosen().map(a=>a.id).sort(),amount:total(chosen()),paymentMethod:f.elements.paymentMethod.value,paymentDate:f.elements.paymentDate.value};
  payload.morningClientId=state.recipient.id;payload.recipientEmails=state.recipient.emails;
  const fingerprint=JSON.stringify(payload);
  if(attempt && attempt.fingerprint!==fingerprint){$('pay-result').textContent='קיימת בקשת הפקה קודמת שטרם אושרה. חזרו לאותה בחירה ולאותו תאריך ואמצעי תשלום, או בדקו את Morning ואת יומן הבקשות לפני איפוס ידני.';return;}
  if(!attempt){attempt={fingerprint,requestId:uuid()};sessionStorage.setItem('THERAPAY_ATTEMPT',JSON.stringify(attempt));}
  state.busy=true;$('issue').disabled=true;$('issue').textContent='מפיק מסמך…';updateSelection();
  try{
    const result=await api('createMorningDoc',{...payload,requestId:attempt.requestId});
    attempt=null;sessionStorage.removeItem('THERAPAY_ATTEMPT');
    $('pay-result').replaceChildren(document.createTextNode('המסמך '+result.docNumber+' הופק והפגישות עודכנו.'));
    if(result.emailRequested)$('pay-result').append(document.createTextNode(' המסמך נמסר ל־Morning עם בקשת שליחה אל '+result.recipientEmails.join(', ')+'.'));
    const url=safeLink(result.pdfUrl);if(url){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=' צפייה במסמך ↗';$('pay-result').append(a);}
    state.appointments=applyIssuedDocument(state.appointments,payload.patientId,payload.ids,result);
    state.connected=true;
    state.loaded=true;
    state.selected.clear();state.busy=false;
    render();
    try{await load();}catch(error){notice(error.code==='AUTH'?'המסמך הופק. קוד הגישה נדחה בעת הרענון; יש להתחבר דרך ההגדרות.':'המסמך הופק והפגישות שנבחרו עודכנו. הרענון לא הושלם; החיבור נשמר ואפשר לרענן דרך ההגדרות.',true);}
    $('issue').disabled=true;
  }catch(error){
    $('pay-result').textContent=error.message;
    if(error.code==='VALIDATION'||error.code==='MORNING_REJECTED'){attempt=null;sessionStorage.removeItem('THERAPAY_ATTEMPT');}
    $('issue').disabled=false;
  }finally{state.busy=false;$('issue').textContent='הפקת חשבונית מס־קבלה';updateSelection();}
});

if(demo){
  const m=state.month;const prev=new Date(Number(m.slice(0,4)),Number(m.slice(5))-2,15);const before=`${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,'0')}`;
  state.patients=[{id:'PAT-DEMO-1',name:'נועה לוי',phone:'050-0000000',rate:350,status:'פעיל'},{id:'PAT-DEMO-2',name:'אורי גפן',phone:'052-0000000',rate:400,status:'פעיל'}];
  state.patientId=state.patients[0].id;state.appointments=[['01',before+'-03',350],['02',before+'-10',350],['03',before+'-24',350],['04',m+'-01',350],['05',m+'-08',350]].map(([id,date,amount])=>({id:'APP-DEMO-'+id,patientId:state.patientId,clientName:'נועה לוי',date,amount,isPaid:false,docNumber:'',pdfUrl:''}));
  state.appointments.push({id:'APP-DEMO-06',patientId:'PAT-DEMO-2',clientName:'אורי גפן',date:before+'-15',amount:400,isPaid:false,docNumber:'',pdfUrl:''});
  resetSelection();render();
}else{render();if(apiUrl()&&accessToken())load().catch(()=>{});}
