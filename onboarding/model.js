export const STEPS=['היכרות','חשבון Google','הגדרות הקליניקה','חיבור Morning','בחירת מטופלים','נוסחי הודעות','סיכום'];
export const DEFAULT_EMAIL='שלום {patientName},\nמצורפת חשבונית מס־קבלה עבור הפגישות בחודש {month}, בסך {amount}.\nתודה,\n{clinicName}';
export const DEFAULT_WHATSAPP='שלום {patientName},\nעבור הפגישות בתאריכים {dates}, בחודש {month}, הסכום לתשלום הוא {amount}.\nתודה,\n{clinicName}';
export function validEmail(s){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s||'').trim());}
export function normalizePhone(s){let n=String(s||'').replace(/[^\d+]/g,'');if(n.startsWith('+972'))n='0'+n.slice(4);if(n.startsWith('00972'))n='0'+n.slice(5);if(/^972\d+$/.test(n))n='0'+n.slice(3);if(/^5\d{8}$/.test(n))n='0'+n;return n;}
export function validPhone(s){return /^0[2-9]\d{7,8}$/.test(normalizePhone(s));}
export function validRate(n){return Number.isFinite(Number(n))&&Number(n)>0&&Math.abs(Number(n)*100-Math.round(Number(n)*100))<1e-6;}
export function validateProfile(p){const e={};if(!String(p.name||'').trim()||p.name.length>100)e.name='יש להזין שם עד 100 תווים';if(!validEmail(p.email))e.email='יש להזין כתובת מייל תקינה';return e;}
export function validateClinic(c){const e={};if(!String(c.clinicName||'').trim()||c.clinicName.length>100)e.clinicName='יש להזין שם קליניקה';if(String(c.password||'').length<16)e.password='בחרו סיסמה או משפט של 16 תווים לפחות';if(c.password!==c.passwordConfirm)e.passwordConfirm='הסיסמאות אינן זהות';if(!validRate(c.defaultRate))e.defaultRate='יש להזין תעריף חיובי, עד שתי ספרות אחרי הנקודה';return e;}
export function mapMorningClient(c,rate){return {id:String(c.id||''),name:String(c.name||''),active:c.active!==false,selected:false,phone:normalizePhone(c.mobile||c.phone||''),email:(c.emails||[]).find(validEmail)||'',rate:Number(rate),originalPhone:normalizePhone(c.mobile||c.phone||''),originalEmails:Array.isArray(c.emails)?[...c.emails]:[],rateEdited:false};}
export function validateSelection(clients){const errors={};const seen=new Set();for(const c of clients.filter(x=>x.selected)){const e=[];if(!/^[\w-]+$/.test(c.id)||seen.has(c.id))e.push('מזהה Morning חסר או כפול');seen.add(c.id);if(!String(c.name||'').trim())e.push('חסר שם');if(!validPhone(c.phone))e.push('נדרש טלפון תקין');if(!validEmail(c.email))e.push('נדרש מייל תקין');if(!validRate(c.rate))e.push('נדרש תעריף חיובי');if(e.length)errors[c.id]=e;}return errors;}
export function contactChanges(clients){return clients.filter(c=>c.selected).filter(c=>normalizePhone(c.phone)!==c.originalPhone||!c.originalEmails.some(e=>String(e).trim().toLowerCase()===c.email.trim().toLowerCase()));}
export function selectedPayload(clients){const errors=validateSelection(clients);if(Object.keys(errors).length)throw new Error('יש להשלים טלפון, מייל ותעריף בכל המטופלים שנבחרו');return clients.filter(c=>c.selected).map(c=>({morningId:c.id,phone:normalizePhone(c.phone),email:c.email.trim(),rate:Number(c.rate)}));}
export function formatTemplate(text,values){return String(text||'').replace(/\{(patientName|month|dates|amount|clinicName)\}/g,(_,key)=>String(values[key]??''));}
// Deliberately excludes password, Morning keys, imported clients and Google tokens.
export function resumableMetadata(state){return {ownerEmail:state.ownerEmail||'',spreadsheetId:state.spreadsheetId||'',scriptId:state.scriptId||'',deploymentId:state.deploymentId||'',backendUrl:state.backendUrl||''};}
const RESOURCE_PREFIX='THERAPAY_PILOT_RESOURCES';
function ownerKey(email){const owner=String(email||'').trim().toLowerCase();return validEmail(owner)?RESOURCE_PREFIX+':'+encodeURIComponent(owner):null;}
export function readAccountResources(storage,email){
 const owner=String(email||'').trim().toLowerCase(),key=ownerKey(owner);if(!key)return {};
 for(const candidate of [key,RESOURCE_PREFIX]){
  try{const saved=JSON.parse(storage.getItem(candidate)||'null');if(saved&&typeof saved==='object'&&String(saved.ownerEmail||'').trim().toLowerCase()===owner)return resumableMetadata({...saved,ownerEmail:owner});}catch{}
 }
 return {};
}
export function saveAccountResources(storage,metadata){
 const owner=String(metadata.ownerEmail||'').trim().toLowerCase(),key=ownerKey(owner);
 if(!key)throw new Error('חסר חשבון Google לשמירת התקדמות ההקמה');
 storage.setItem(key,JSON.stringify(resumableMetadata({...metadata,ownerEmail:owner})));
}
export function registrationPayload(name,idToken){return {action:'register',name:String(name).trim(),idToken};}
