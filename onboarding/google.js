import {resumableMetadata} from './model.js';
export const GOOGLE_SCOPES=['openid','email','profile','https://www.googleapis.com/auth/drive.file','https://www.googleapis.com/auth/script.projects','https://www.googleapis.com/auth/script.deployments'];
export function randomSecret(){const bytes=crypto.getRandomValues(new Uint8Array(32));return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');}
function googleOperation(path,method){
  const {hostname,pathname}=new URL(path);
  if(hostname==='www.googleapis.com')return method==='PATCH'?'שמירת פרטי ההקמה ב־Drive':pathname.endsWith('/files')?'חיפוש הקמה קודמת ב־Drive':'בדיקת גיליון ב־Drive';
  if(hostname==='sheets.googleapis.com')return pathname.endsWith('/spreadsheets')?'יצירת גיליון פרטי':pathname.includes('batchUpdate')?'יצירת כותרות הגיליון':'קריאת כותרות הגיליון';
  if(pathname.endsWith('/content'))return method==='PUT'?'שמירת קוד הבקנד':'קריאת קוד הבקנד';
  if(pathname.endsWith('/deployments'))return method==='POST'?'פריסת הבקנד':'בדיקת פריסות קיימות';
  if(pathname.endsWith('/versions'))return 'יצירת גרסת בקנד';
  return method==='POST'?'יצירת פרויקט Apps Script':'בדיקת פרויקט Apps Script';
}
function googleErrorCode(data){
  // Return only diagnostic enums/field paths, never arbitrary Google messages:
  // validation errors may quote submitted source code, names or bootstrap credentials.
  const status=String(data?.error?.status||'');
  const reason=String(data?.error?.errors?.[0]?.reason||'');
  const codes=[status,reason].filter(v=>/^[A-Za-z_]{2,60}$/.test(v));
  const fields=(data?.error?.details||[]).flatMap(d=>d.fieldViolations||[]).map(v=>String(v.field||'')).filter(v=>/^[a-zA-Z][a-zA-Z0-9_.\[\]]{0,90}$/.test(v));
  return [...new Set([...codes,...fields])].join(' · ');
}
export async function googleRequest(token,path,{method='GET',body,fetchImpl=fetch}={}){
  const response=await fetchImpl(path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  let data;try{data=await response.json();}catch{throw new Error('Google החזיר תשובה לא תקינה');}
  if(!response.ok){const stage=googleOperation(path,method),code=googleErrorCode(data),detail=' ['+response.status+(code?' · '+code:'')+']';if(response.status===401)throw new Error(stage+': פג תוקף ההרשאה. לחצו שוב על חיבור Google.'+detail);if(response.status===403)throw new Error(stage+': Google לא אישר את הפעולה. יש לוודא שההרשאות אושרו ושממשקי Google הופעלו בפרויקט הניסוי.'+detail);throw new Error(stage+': הפעולה ב־Google לא הושלמה'+detail+'. אפשר לנסות שוב.');}return data;
}
export function workspaceProperties(current){
  const url=String(current.backendUrl||'');
  // Drive allows only 124 UTF-8 bytes for each key and value together.
  if(url&&!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url))throw new Error('כתובת הבקנד שהוחזרה אינה תקינה');
  return {therapayPilot:'v1',therapayScriptId:current.scriptId||'',therapayDeploymentId:current.deploymentId||'',therapayBackend0:url.slice(0,80),therapayBackend1:url.slice(80,160),therapayBackend2:url.slice(160)};
}
export function backendFiles(core,bootstrap,config){
  if(!config.spreadsheetId||!config.bootstrapSecret||!config.ownerEmail)throw new Error('חסרים פרטי הקמה');
  return [
    {name:'Code',type:'SERVER_JS',source:core.replace('function doPost(e)', 'function clinicDoPost(e)')},
    {name:'OnboardingBootstrap',type:'SERVER_JS',source:'var PILOT_BOOTSTRAP = '+JSON.stringify(config)+';\n'+bootstrap},
    {name:'appsscript',type:'JSON',source:JSON.stringify({timeZone:'Asia/Jerusalem',runtimeVersion:'V8',exceptionLogging:'STACKDRIVER',oauthScopes:['https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/script.external_request'],webapp:{access:'ANYONE_ANONYMOUS',executeAs:'USER_DEPLOYING'}})}
  ];
}
export async function provisionWorkspace({token,ownerEmail,clinicName,metadata={},core,bootstrap,registryUrl,checkpoint=()=>{},progress=()=>{},request=googleRequest}){
  const current={...resumableMetadata(metadata),ownerEmail};
  if(metadata.ownerEmail&&metadata.ownerEmail!==ownerEmail)throw new Error('ההקמה השמורה שייכת לחשבון Google אחר. חזרו לחשבון המקורי.');
  const save=()=>checkpoint(resumableMetadata(current));
  const publish=async()=>{if(current.spreadsheetId)await request(token,'https://www.googleapis.com/drive/v3/files/'+current.spreadsheetId,{method:'PATCH',body:{appProperties:workspaceProperties(current)}});};
  if(!current.spreadsheetId){
    progress('בודק אם כבר הוקמה קליניקה בחשבון שלך…');
    const q=encodeURIComponent("trashed = false and appProperties has { key='therapayPilot' and value='v1' }");
    const found=await request(token,'https://www.googleapis.com/drive/v3/files?q='+q+'&fields=files(id,appProperties),nextPageToken&pageSize=100');
    if(found.nextPageToken||(found.files||[]).length>1)throw new Error('נמצאו כמה הקמות קודמות. לא יצרנו קליניקה נוספת; יש לבחור את הקליניקה הרצויה לפני המשך.');
    if(found.files?.length){const file=found.files[0],props=file.appProperties||{};current.spreadsheetId=file.id;current.scriptId=props.therapayScriptId||'';current.backendUrl=props.therapayBackendUrl||[props.therapayBackend0,props.therapayBackend1,props.therapayBackend2].map(v=>v||'').join('');current.deploymentId=props.therapayDeploymentId||'';save();}
  }
  let createdScript=false;
  if(!current.spreadsheetId){
    progress('יוצר גיליון פרטי בחשבון שלך…');
    // Let Sheets choose its supported default locale. The app formats Hebrew,
    // dates and currency itself; an optional locale must not block provisioning.
    const sheet=await request(token,'https://sheets.googleapis.com/v4/spreadsheets',{method:'POST',body:{properties:{title:'TheraPay · '+clinicName,timeZone:'Asia/Jerusalem'},sheets:[{properties:{title:'Patients'}},{properties:{title:'Appointments'}}]}});
    current.spreadsheetId=sheet.spreadsheetId;save();await publish();
  }
  const marker=await request(token,'https://www.googleapis.com/drive/v3/files/'+current.spreadsheetId+'?fields=id,appProperties');
  if(marker.appProperties?.therapayPilot!=='v1')throw new Error('הגיליון אינו מזוהה כהקמה של TheraPay. לא שינינו קבצים.');
  progress('מכין את טבלאות הקליניקה…');
  // Only create headers on a new, empty sheet. Never overwrite existing patient data on resume.
  const ranges=await request(token,'https://sheets.googleapis.com/v4/spreadsheets/'+current.spreadsheetId+'/values:batchGet?ranges=Patients!A1:H1&ranges=Appointments!A1:K1');
  const headers=[['מזהה מטופל','שם מלא','טלפון','תעריף ברירת מחדל','סטטוס','morning_client_id','מייל'],['מזהה פגישה','תאריך ושעה','תאריך','שם המטופל','סכום לתשלום','סטטוס תשלום','אמצעי תשלום','מספר חשבונית','morning_status','pdf_url','מזהה מטופל']];
  if(!Array.isArray(ranges.valueRanges)||ranges.valueRanges.length!==2)throw new Error('לא ניתן לקרוא את שתי טבלאות הקליניקה.');
  ranges.valueRanges.forEach((range,i)=>{if(range.values?.length&&headers[i].some(h=>!range.values[0].includes(h)))throw new Error('כותרות הגיליון הקיים השתנו. לא החלפנו אותן.');});
  const data=ranges.valueRanges.flatMap((range,i)=>range.values?.length?[]:[{range:(i===0?'Patients':'Appointments')+'!A1',values:[headers[i]]}]);
  if(data.length)await request(token,'https://sheets.googleapis.com/v4/spreadsheets/'+current.spreadsheetId+'/values:batchUpdate',{method:'POST',body:{valueInputOption:'RAW',data}});
  if(!current.scriptId){progress('יוצר בקנד פרטי בחשבון שלך…');const script=await request(token,'https://script.googleapis.com/v1/projects',{method:'POST',body:{title:'TheraPay · '+clinicName,parentId:current.spreadsheetId}});current.scriptId=script.scriptId;createdScript=true;save();await publish();}
  const project=await request(token,'https://script.googleapis.com/v1/projects/'+current.scriptId);
  if(project.parentId!==current.spreadsheetId)throw new Error('פרויקט הקוד אינו שייך לגיליון ההקמה. לא שינינו קבצים.');
  const ownedFile=await request(token,'https://www.googleapis.com/drive/v3/files/'+current.spreadsheetId+'?fields=id,appProperties');
  if(ownedFile.appProperties?.therapayPilot!=='v1'||ownedFile.appProperties?.therapayScriptId!==current.scriptId)throw new Error('הגיליון אינו מזוהה כהקמה של TheraPay. לא שינינו קבצים.');
  let secret;
  const content=await request(token,'https://script.googleapis.com/v1/projects/'+current.scriptId+'/content');
  const existing=(content.files||[]).find(f=>f.name==='OnboardingBootstrap');
  if(existing){const match=existing.source.match(/^var PILOT_BOOTSTRAP = (\{[^\n]+\});/);if(!match)throw new Error('לא ניתן לחדש את ההקמה הקיימת. לא שינינו את הקבצים.');const cfg=JSON.parse(match[1]);if(cfg.ownerEmail!==ownerEmail||cfg.spreadsheetId!==current.spreadsheetId)throw new Error('הקבצים אינם תואמים לחשבון ההקמה');secret=cfg.bootstrapSecret;}
  else{
    if(!createdScript&&(content.files||[]).some(f=>f.type==='SERVER_JS'))throw new Error('נמצא קוד קיים שאינו מזוהה כהקמת TheraPay. לא החלפנו אותו.');
    secret=randomSecret();progress('מכין את הבקנד להפעלה…');
    await request(token,'https://script.googleapis.com/v1/projects/'+current.scriptId+'/content',{method:'PUT',body:{files:backendFiles(core,bootstrap,{ownerEmail,spreadsheetId:current.spreadsheetId,bootstrapSecret:secret,registryUrl})}});
  }
  if(!current.backendUrl){
    progress('מכין כתובת חיבור פרטית…');
    const deployments=await request(token,'https://script.googleapis.com/v1/projects/'+current.scriptId+'/deployments');
    let deployment=(deployments.deployments||[]).find(d=>d.deploymentConfig?.description==='TheraPay onboarding pilot'&&d.entryPoints?.some(e=>e.webApp?.url));
    if(!deployment){const version=await request(token,'https://script.googleapis.com/v1/projects/'+current.scriptId+'/versions',{method:'POST',body:{description:'TheraPay onboarding pilot'}});deployment=await request(token,'https://script.googleapis.com/v1/projects/'+current.scriptId+'/deployments',{method:'POST',body:{versionNumber:version.versionNumber,manifestFileName:'appsscript',description:'TheraPay onboarding pilot'}});}
    const url=deployment.entryPoints?.find(e=>e.webApp?.url)?.webApp.url;if(!url)throw new Error('Google לא החזיר כתובת Web App. נדרש לבדוק את הפריסה; לא יצרנו גיליון נוסף.');
    current.deploymentId=deployment.deploymentId;current.backendUrl=url;save();await publish();
  }
  return {...resumableMetadata(current),bootstrapSecret:secret,authorizationUrl:'https://script.google.com/home/projects/'+current.scriptId+'/edit'};
}
export async function clinicRequest(url,action,payload={}){
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url))throw new Error('כתובת הבקנד אינה תקינה');
  const control=new AbortController(),timeout=setTimeout(()=>control.abort(),65000);
  try{const response=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...payload,action}),credentials:'omit',redirect:'follow',signal:control.signal});let data;try{data=await response.json();}catch{throw new Error('הבקנד עדיין אינו זמין. יש להשלים את אישור ההרשאות בחשבון Google שלך.');}if(!response.ok||!data.success)throw new Error(data.message||'הפעולה לא הושלמה');return data;}catch(error){if(error.name==='AbortError')throw new Error('הפעולה התעכבה. אפשר לנסות שוב בלי ליצור חשבון נוסף.');throw error;}finally{clearTimeout(timeout);}
}
