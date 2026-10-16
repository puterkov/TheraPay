import { today, money, taskReminderDate, actionableTasks, dashboardMetrics, validDate, defaultSelection, selectedAppointments, total, phoneForWhatsApp, displayDate, paymentMessage, applyIssuedDocument } from './domain.js?v=tasks-20261016';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const demo = new URLSearchParams(location.search).get('demo') === '1';
const state = { patients:[], appointments:[], tasks:[], supportsTasks:false, tasksError:'', taskEdit:null, patientId:'', month:today().slice(0,7), appointmentsPatient:'ALL', appointmentsMonth:'ALL', documentsPatient:'ALL', documentsMonth:'ALL', selected:new Set(), view:'dashboard', connected:false, loaded:false, loading:false, refreshFailed:false, environment:'sandbox', morningConfigured:false, emailDelivery:false, recipient:null, editing:{}, supportsEditing:false, busy:false };
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
    state.appointments = data.appointments;state.supportsTasks=data.supportsTasks===true;
    state.connected = true;
    state.loaded = true;
    state.refreshFailed = false;
    $('settings-result').textContent='';
    state.environment = data.environment;
    state.morningConfigured = data.morningConfigured;
    state.emailDelivery = data.supportsEmailDelivery===true;state.supportsEditing=data.supportsEditing===true;
    rememberAccess(accessToken(),localStorage.getItem('THERAPAY_REMEMBER')!=='false');
    if (!patient()) { state.patientId = state.patients[0]?.id || ''; resetSelection(); }
    state.selected = new Set(chosen().map(a => a.id));
    render();
    $('notice').hidden=true;
    if(state.supportsTasks)await loadTasks();
  } catch (error) {
    // A failed read is not a logout. Only an explicit authentication failure invalidates access.
    if(error.code==='AUTH'){state.connected=false;forgetAccess();}
    state.refreshFailed=state.loaded;
    $('settings-result').textContent=error.message;
    render();
    notice(state.loaded && error.code!=='AUTH' ? 'רענון הנתונים לא הושלם. מוצגים הנתונים האחרונים; אפשר לנסות שוב דרך ההגדרות.' : error.message,true);
    throw error;
  } finally {state.loading=false;$('refresh').disabled=false;renderConnectionStatus();updateSelection();renderTasks();}
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
  return `<tr class="${selectable?(a.isPaid?'selection-locked':!validDate(a.date)?'selection-locked':'selection-available'):''}" data-record-row data-detail="${esc(a.id)}">${selection}<td class="date-cell"><button class="row-open" data-detail="${esc(a.id)}" aria-label="פרטי פגישה ${esc(displayDate(a.date))}"><span dir="ltr">${esc(date)}</span></button></td>${selectable?'':`<td class="name-cell">${esc(a.clientName)}</td>`}<td class="amount-cell">${esc(money(a.amount))}</td><td><span class="status-pill ${a.isPaid?'paid':'pending'}">${a.isPaid?'שולם':selectable?'לבחירה':'ממתין'}</span></td></tr>`;
}
function appointmentTable(rows,selectable=false,caption='פגישות'){
  return `<div class="session-table-wrap"><table class="session-table ${selectable?'collection-table':'appointments-table'}"><caption class="sr-only">${esc(caption)}</caption><thead><tr>${selectable?'<th scope="col" class="pick-cell"><span class="sr-only">בחירה</span></th>':''}<th scope="col">תאריך</th>${selectable?'':'<th scope="col">מטופל</th>'}<th scope="col">סכום</th><th scope="col">סטטוס</th></tr></thead>${rows}</table></div>`;
}
function showAppointmentDetails(id){
  const a=state.appointments.find(a=>a.id===id);if(!a)return;
  const link=safeLink(a.pdfUrl);
  $('appointment-detail-content').innerHTML=`<dl class="session-details"><dt>מטופל</dt><dd>${esc(a.clientName)}</dd><dt>תאריך</dt><dd>${esc(displayDate(a.date))}</dd><dt>סכום</dt><dd>${esc(money(a.amount))}</dd><dt>סטטוס</dt><dd>${a.isPaid?'שולם':'ממתין לתשלום'}</dd><dt>אמצעי תשלום</dt><dd>${esc(a.paymentMethod||'—')}</dd><dt>מספר חשבונית</dt><dd>${esc(a.docNumber||'—')}</dd></dl>${link?`<a class="button secondary" href="${esc(link)}" target="_blank" rel="noopener noreferrer">צפייה במסמך ↗</a>`:''}`;
  $('appointment-detail-content').innerHTML+=a.isPaid?'<p class="small muted">פגישה ששולמה · הפרטים נשמרים בהתאם למסמך שהופק.</p>':`<button data-edit-appointment="${esc(a.id)}" class="secondary">עריכת פגישה</button>`;
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
  const apps = state.appointments.filter(a => a.patientId === p.id && !a.isPaid).sort((a,b) => a.date.localeCompare(b.date));
  const groups = [
    ['חודשים קודמים · חובות מסומנים מראש', apps.filter(a => !a.isPaid && validDate(a.date) && a.date < state.month+'-01')],
    ['החודש הנבחר · לבחירה לפי הצורך', apps.filter(a => !a.isPaid && a.date.slice(0,7) === state.month)],
    ['פגישות עתידיות', apps.filter(a => !a.isPaid && validDate(a.date) && a.date.slice(0,7) > state.month)],
    ['נדרש תיקון תאריך בגיליון', apps.filter(a => !a.isPaid && !validDate(a.date))]
  ];
  const rows=groups.filter(([,list])=>list.length).map(([title,list])=>`<tbody><tr class="table-group"><th colspan="4" scope="rowgroup">${esc(title)}</th></tr>${list.map(a=>appointmentRow(a,true)).join('')}</tbody>`).join('');
  $('appointment-groups').innerHTML=rows?appointmentTable(rows,true,'פגישות לתשלום עבור '+p.name):'<div class="empty">אין פגישות לתשלום למטופל הזה.</div>';
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
  $('patient-list').innerHTML = state.patients.length?`<div class="session-table-wrap"><table class="session-table patients-table"><caption class="sr-only">מטופלים · פרטי קשר ותעריף לפגישה</caption><thead><tr><th scope="col">מטופל</th><th scope="col">טלפון</th><th scope="col">תעריף</th><th scope="col">עריכה</th></tr></thead><tbody>${state.patients.map(p=>`<tr><td class="name-cell">${esc(p.name)}<small class="patient-status">${esc(p.status)}</small></td><td class="patient-phone"><span dir="ltr">${esc(p.phone||'—')}</span></td><td class="amount-cell">${esc(money(p.rate))}</td><td class="patient-edit-cell"><button class="quiet patient-edit" data-edit-patient="${esc(p.id)}" aria-label="עריכת ${esc(p.name)}"><span aria-hidden="true">✎</span><span class="edit-label">עריכה</span></button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">טרם נוספו מטופלים.</div>';
  renderAppointments();
  renderDocuments();
  renderTasks();
  view(state.view);
}

function renderDashboard() {
  $('dashboard-date').textContent = new Intl.DateTimeFormat('he-IL',{dateStyle:'full',timeZone:'Asia/Jerusalem'}).format(new Date());
  const metrics=dashboardMetrics(state.patients,state.appointments);
  const monthName=m=>new Intl.DateTimeFormat('he-IL',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(m+'-01'));
  $('stat-patients').textContent=metrics.activePatients;
  $('stat-previous').textContent=money(metrics.previousIncome);
  $('stat-previous-month').textContent=monthName(metrics.previous);
  $('stat-current').textContent=money(metrics.currentForecast);
  $('stat-current-month').textContent=monthName(metrics.current);
  $('stat-debt').textContent=money(metrics.debt);
}

function renderAppointments(){
  const patients=$('appointments-patient'),months=$('appointments-month');
  if(!state.patients.some(p=>p.id===state.appointmentsPatient))state.appointmentsPatient='ALL';
  patients.innerHTML='<option value="ALL">כל המטופלים</option>'+state.patients.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  patients.value=state.appointmentsPatient;
  const calendar=dashboardMetrics(state.patients,state.appointments);
  const availableMonths=[...new Set([calendar.previous,calendar.current,...state.appointments.filter(a=>validDate(a.date)).map(a=>a.date.slice(0,7))])].sort().reverse();
  if(!availableMonths.includes(state.appointmentsMonth))state.appointmentsMonth='ALL';
  months.innerHTML='<option value="ALL">כל החודשים</option>'+availableMonths.map(m=>`<option value="${m}">${esc(new Intl.DateTimeFormat('he-IL',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(m+'-01')))}</option>`).join('');
  months.value=state.appointmentsMonth;
  const list=state.appointments.filter(a=>(state.appointmentsPatient==='ALL'||a.patientId===state.appointmentsPatient)&&(state.appointmentsMonth==='ALL'||a.date.slice(0,7)===state.appointmentsMonth)).sort((a,b)=>b.date.localeCompare(a.date));
  $('all-appointments').innerHTML=list.length?appointmentTable('<tbody>'+list.map(a=>appointmentRow(a)).join('')+'</tbody>'):'<div class="empty">אין פגישות להצגה.</div>';
}

function renderDocuments(){
  const patients=$('documents-patient'),months=$('documents-month');
  if(!state.patients.some(p=>p.id===state.documentsPatient))state.documentsPatient='ALL';
  patients.innerHTML='<option value="ALL">כל המטופלים</option>'+state.patients.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  patients.value=state.documentsPatient;
  const docs=new Map();
  state.appointments.filter(a=>a.docNumber).forEach(a=>{
    const key=JSON.stringify([a.patientId||a.clientName,String(a.docNumber)]);
    if(!docs.has(key))docs.set(key,{...a,amount:0,count:0,months:new Set()});
    const d=docs.get(key);d.amount+=Number(a.amount);d.count++;
    if(validDate(a.date))d.months.add(a.date.slice(0,7));
    if(!safeLink(d.pdfUrl)&&safeLink(a.pdfUrl))d.pdfUrl=a.pdfUrl;
  });
  const available=[...new Set([...docs.values()].flatMap(d=>[...d.months]))].sort().reverse();
  if(!available.includes(state.documentsMonth))state.documentsMonth='ALL';
  months.innerHTML='<option value="ALL">כל החודשים</option>'+available.map(m=>`<option value="${m}">${esc(new Intl.DateTimeFormat('he-IL',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(m+'-01')))}</option>`).join('');
  months.value=state.documentsMonth;
  const list=[...docs.values()].filter(d=>(state.documentsPatient==='ALL'||d.patientId===state.documentsPatient)&&(state.documentsMonth==='ALL'||d.months.has(state.documentsMonth)));
  $('document-list').innerHTML=list.length?`<div class="session-table-wrap"><table class="session-table documents-table"><caption class="sr-only">מסמכים שהופקו · הסכום המלא בכל מסמך</caption><thead><tr><th scope="col">מסמך</th><th scope="col">מטופל</th><th scope="col">סכום</th><th scope="col">צפייה</th></tr></thead><tbody>${list.map(d=>`<tr><td>${esc(d.docNumber)}</td><td>${esc(d.clientName)}</td><td class="amount-cell">${esc(money(d.amount))}</td><td>${safeLink(d.pdfUrl)?`<a class="document-link" target="_blank" rel="noopener noreferrer" aria-label="פתיחת מסמך ${esc(d.docNumber)}" href="${esc(safeLink(d.pdfUrl))}">פתיחה ↗</a>`:'—'}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">אין מסמכים להצגה.</div>';
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
    const form = $(name+'-form'); form.reset();delete state.editing[name];delete form.dataset.fingerprint;delete form.dataset.requestId;$(name+'-title').textContent=name==='patient'?'מטופל חדש':'פגישה חדשה';if(name==='patient')$('patient-status-field').hidden=true;
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
function editRecord(type,id){
  if(state.busy)return;
  if(!demo&&!state.supportsEditing){notice('יש לעדכן את Apps Script כדי לאפשר עריכה.',true);return;}
  const record=(type==='patient'?state.patients:state.appointments).find(r=>r.id===id);if(!record)return;
  if(type==='appointment'&&record.isPaid)return;
  const f=$(type+'-form');f.reset();delete f.dataset.fingerprint;delete f.dataset.requestId;
  state.editing[type]={...record};$(type+'-title').textContent=type==='patient'?'עריכת מטופל':'עריכת פגישה';
  if(type==='patient'){
    for(const key of ['name','phone','rate','status'])f.elements[key].value=record[key];$('patient-status-field').hidden=false;
  }else{
    f.elements.patientId.innerHTML=state.patients.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    for(const key of ['patientId','date','amount'])f.elements[key].value=record[key];$('appointment-details').close();
  }
  $(type).showModal();
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
  $('pay-result').textContent=''; $('pay-progress').hidden=true; $('issue').disabled=false;
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
  const editPatient=event.target.closest('[data-edit-patient]');if(editPatient)editRecord('patient',editPatient.dataset.editPatient);
  const editAppointment=event.target.closest('[data-edit-appointment]');if(editAppointment)editRecord('appointment',editAppointment.dataset.editAppointment);
  const editTask=event.target.closest('[data-edit-task]');if(editTask)openTask(editTask.dataset.editTask);
  const open=event.target.closest('[data-open]'); if(open) openDialog(open.dataset.open);
  const close=event.target.closest('[data-close]'); if(close && !state.busy) close.closest('dialog').close();
  const monthTile=event.target.closest('[data-dashboard-month]');if(monthTile&&!state.busy){const metrics=dashboardMetrics(state.patients,state.appointments);state.appointmentsMonth=metrics[monthTile.dataset.dashboardMonth];state.appointmentsPatient='ALL';renderAppointments();view('appointments');}
  const tab=event.target.closest('[data-view]'); if(tab && !state.busy) view(tab.dataset.view);
  const person=event.target.closest('[data-patient]'); if(person) {state.patientId=person.dataset.patient;resetSelection();renderCollection();view('collection');}
  const detail=event.target.closest('[data-detail]');if(detail&&!event.target.closest('.cell-pick')&&!state.busy)showAppointmentDetails(detail.dataset.detail);
});
document.querySelectorAll('dialog').forEach(d => d.addEventListener('cancel',e => {if(state.busy)e.preventDefault();}));
$('patient-filter').addEventListener('change', e => {state.patientId=e.target.value;resetSelection();renderCollection();});
$('appointments-patient').addEventListener('change',e=>{state.appointmentsPatient=e.target.value;renderAppointments();});
$('documents-patient').addEventListener('change',e=>{state.documentsPatient=e.target.value;renderDocuments();});
$('documents-month').addEventListener('change',e=>{state.documentsMonth=e.target.value;renderDocuments();});
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
  const b=f.querySelector('[type=submit]');b.disabled=true;try{await load();view('dashboard');}catch(error){$('settings-result').textContent=error.message;}finally{b.disabled=false;}
});
$('refresh').addEventListener('click',async()=>{try{await load();$('settings-result').textContent='הנתונים עודכנו.';}catch(error){$('settings-result').textContent=error.message;}});
$('disconnect').addEventListener('click',()=>{if(state.loading)return;forgetAccess();state.patients=[];state.appointments=[];state.tasks=[];state.supportsTasks=false;state.tasksError='';state.patientId='';state.selected.clear();state.connected=false;state.loaded=false;state.refreshFailed=false;render();$('settings-result').textContent='התנתקת מהקליניקה.';});
for(const type of ['patient','appointment']) $(type+'-form').addEventListener('submit',async e=>{
  e.preventDefault();if(state.busy)return;if(demo){notice('הדגמה בלבד · השינויים לא נשמרו.');$(type).close();return;}
  const f=e.target,b=f.querySelector('[type=submit]'),original=b.innerHTML,editing=state.editing[type];
  const values=Object.fromEntries(new FormData(f));
  if(type==='patient')values.rate=Number(values.rate);else values.amount=Number(values.amount);
  if(editing){values.id=editing.id;values.expected=type==='patient'?{name:editing.name,phone:editing.phone,rate:editing.rate,status:editing.status}:{patientId:editing.patientId,date:editing.date,amount:editing.amount};}
  const fingerprint=JSON.stringify(values);if(f.dataset.fingerprint!==fingerprint){f.dataset.fingerprint=fingerprint;f.dataset.requestId=uuid();}
  let formStatus=f.querySelector('[role=status]');if(formStatus)formStatus.remove();
  state.busy=true;b.disabled=true;b.innerHTML='<span class="spinner" aria-hidden="true"></span><span>שומר…</span>';f.setAttribute('aria-busy','true');
  try{
    await api((editing?'update':'add')+(type==='patient'?'Patient':'Appointment'),{...values,requestId:f.dataset.requestId});
    f.closest('dialog').close();delete f.dataset.fingerprint;delete f.dataset.requestId;delete state.editing[type];state.busy=false;
    try{await load();notice(editing?'השינויים נשמרו.':type==='patient'?'המטופל נוסף בהצלחה':'הפגישה נוספה בהצלחה');}catch(error){notice('השמירה הושלמה. יש לרענן את הנתונים דרך ההגדרות.',true);}
  }catch(error){formStatus=document.createElement('p');formStatus.setAttribute('role','status');formStatus.textContent=error.message;f.append(formStatus);}
  finally{state.busy=false;b.disabled=false;b.innerHTML=original;f.removeAttribute('aria-busy');}
});
async function loadTasks(){
  try{const data=await api('getTasks');if(!Array.isArray(data.tasks))throw new Error('לא ניתן לקרוא את המשימות.');state.tasks=data.tasks;state.tasksError='';}
  catch(error){state.tasksError='רענון המשימות לא הושלם. אפשר לנסות שוב.';}
  renderTasks();
}
function renderTasks(){
  const available=demo||(state.connected&&state.supportsTasks);
  const due=available?actionableTasks(state.tasks):[];
  $('tasks-alert').hidden=!due.length;
  $('tasks-alert').textContent='✓ משימות לטיפול · '+due.length;
  $('tasks-status').textContent=state.tasksError||(!available?'יש לעדכן את Apps Script ולרענן נתונים בהגדרות להפעלת משימות.':demo?'הדגמה · שינויים במשימות אינם נשמרים.':'');
  const row=t=>`<article class="task-row ${t.completed?'task-completed':''}"><label class="task-check"><input type="checkbox" data-task-toggle="${esc(t.id)}" ${t.completed?'checked':''} aria-label="${t.completed?'פתיחה מחדש':'השלמת משימה'}: ${esc(t.text)}" ${state.busy||state.loading?'disabled':''}></label><div class="task-content"><div class="task-text" title="${esc(t.text)}">${esc(t.text)}</div><small>${t.dueDate?esc(displayDate(t.dueDate)):'ללא תאריך יעד'}${!t.completed&&due.some(x=>x.id===t.id)?' · לטיפול':''}</small></div><button class="quiet task-edit" data-edit-task="${esc(t.id)}" aria-label="עריכת משימה: ${esc(t.text)}">✎</button></article>`;
  const list=available?[...state.tasks].sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')):[];
  $('task-list').innerHTML=list.filter(t=>!t.completed).map(row).join('')||'<div class="empty">אין משימות פתוחות.</div>';
  const done=list.filter(t=>t.completed);$('completed-tasks').hidden=!done.length;$('task-done-list').innerHTML=done.map(row).join('');
  $('new-task').disabled=!available||state.busy||state.loading;
}
function taskPreview(){
  const f=$('task-form');f.elements.remindDays.disabled=!f.elements.dueDate.value;
  const date=taskReminderDate({dueDate:f.elements.dueDate.value,remindDays:f.elements.remindDays.value});
  $('task-reminder-preview').textContent=date?'סימון בדשבורד החל מ־'+displayDate(date)+' ועד להשלמת המשימה.':'ללא תאריך יעד · המשימה תופיע ברשימה בלבד.';
}
function openTask(id=''){
  if(state.busy||state.loading||(!demo&&!state.supportsTasks))return;
  const task=state.tasks.find(t=>t.id===id);state.taskEdit=task?{...task}:null;
  const f=$('task-form');f.reset();delete f.dataset.requestId;delete f.dataset.fingerprint;
  f.elements.text.value=task?.text||'';f.elements.dueDate.value=task?.dueDate||'';f.elements.remindDays.value=String(task?.remindDays??1);
  $('task-title').textContent=task?'עריכת משימה':'משימה חדשה';$('task-result').textContent='';taskPreview();$('task-editor').showModal();
}
async function saveTask(values,requestId){
  if(demo)return {...values,id:values.id||'TASK-'+requestId,revision:(values.expectedRevision||0)+1};
  const result=await api('saveTask',{...values,requestId});return result.task;
}
function acceptTask(task){state.tasksError='';const i=state.tasks.findIndex(t=>t.id===task.id);if(i<0)state.tasks.push(task);else state.tasks[i]=task;renderTasks();}
$('new-task').addEventListener('click',()=>openTask());
$('task-form').elements.dueDate.addEventListener('change',taskPreview);
$('task-form').elements.remindDays.addEventListener('change',taskPreview);
$('task-form').addEventListener('submit',async e=>{
  e.preventDefault();if(state.busy||state.loading)return;const f=e.target,old=state.taskEdit;
  const values={text:f.elements.text.value.trim(),dueDate:f.elements.dueDate.value,remindDays:Number(f.elements.remindDays.value),completed:old?.completed||false};
  if(old){values.id=old.id;values.expectedRevision=old.revision;}
  const fingerprint=JSON.stringify(values);if(f.dataset.fingerprint!==fingerprint){f.dataset.requestId=uuid();f.dataset.fingerprint=fingerprint;}
  const button=f.querySelector('[type=submit]');state.busy=true;button.disabled=true;button.innerHTML='<span class="spinner" aria-hidden="true"></span>שומר…';$('task-result').textContent='';
  try{acceptTask(await saveTask(values,f.dataset.requestId));$('task-editor').close();}catch(error){$('task-result').textContent=error.message;}
  finally{state.busy=false;button.disabled=false;button.textContent='שמור משימה';renderTasks();}
});
async function toggleTask(id,completed){
  if(state.busy||state.loading)return;const task=state.tasks.find(t=>t.id===id);if(!task)return;
  state.busy=true;renderTasks();
  const values={id:task.id,text:task.text,dueDate:task.dueDate,remindDays:task.remindDays,completed,expectedRevision:task.revision};
  // Keep a completion retry's ID when a response is lost.
  const fingerprint=JSON.stringify(values);if(task._pending?.fingerprint!==fingerprint)task._pending={fingerprint,id:uuid()};
  try{acceptTask(await saveTask(values,task._pending.id));state.tasksError='';}
  catch(error){state.tasksError=error.message;}
  finally{state.busy=false;renderTasks();}
}
for(const id of ['task-list','task-done-list'])$(id).addEventListener('change',e=>{if(e.target.dataset.taskToggle)toggleTask(e.target.dataset.taskToggle,e.target.checked);});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')renderTasks();});
if(typeof window.setInterval==='function')window.setInterval(()=>{if(!document.hidden)renderTasks();},60000);

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
  state.busy=true;$('issue').disabled=true;$('issue').textContent='מפיק ושולח…';$('pay-progress').hidden=false;$('pay-form').setAttribute('aria-busy','true');updateSelection();
  try{
    const result=await api('createMorningDoc',{...payload,requestId:attempt.requestId});
    attempt=null;sessionStorage.removeItem('THERAPAY_ATTEMPT');
    $('pay-result').replaceChildren(document.createTextNode(result.emailRequested?'המסמך הופק ונשלח.':'המסמך הופק.'));
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
  }finally{state.busy=false;$('pay-progress').hidden=true;$('pay-form').removeAttribute('aria-busy');$('issue').textContent='הפקת חשבונית מס־קבלה';updateSelection();}
});

if(demo){
  const m=state.month;const prev=new Date(Number(m.slice(0,4)),Number(m.slice(5))-2,15);const before=`${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,'0')}`;
  state.patients=[{id:'PAT-DEMO-1',name:'נועה לוי',phone:'050-0000000',rate:350,status:'פעיל'},{id:'PAT-DEMO-2',name:'אורי גפן',phone:'052-0000000',rate:400,status:'פעיל'}];
  state.patientId=state.patients[0].id;state.appointments=[['01',before+'-03',350],['02',before+'-10',350],['03',before+'-24',350],['04',m+'-01',350],['05',m+'-08',350]].map(([id,date,amount])=>({id:'APP-DEMO-'+id,patientId:state.patientId,clientName:'נועה לוי',date,amount,isPaid:false,docNumber:'',pdfUrl:''}));
  Object.assign(state.appointments[4],{isPaid:true,docNumber:'DEMO-1002'});
  state.appointments.push({id:'APP-DEMO-06',patientId:'PAT-DEMO-2',clientName:'אורי גפן',date:before+'-15',amount:400,isPaid:true,docNumber:'DEMO-1001',pdfUrl:''});
  state.tasks=[{id:'TASK-DEMO-1',text:'להכין סיכום חודשי',dueDate:today(),remindDays:0,completed:false,revision:1},{id:'TASK-DEMO-2',text:'לעדכן את פרטי הקליניקה',dueDate:'',remindDays:1,completed:false,revision:1}];
  resetSelection();render();
}else{render();if(apiUrl()&&accessToken())load().catch(()=>{});}
