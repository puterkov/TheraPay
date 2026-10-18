import {googleRequest} from './google.js';

const DESCRIPTION='TheraPay owner authorization v1';
const OWNER_PAGE=`function doGet() {
  SpreadsheetApp.openById(PILOT_BOOTSTRAP.spreadsheetId).getName();
  UrlFetchApp.fetch('https://www.google.com/generate_204', {muteHttpExceptions:true});
  return HtmlService.createHtmlOutput('<!doctype html><html lang="he" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>TheraPay</title></head><body style="font-family:Arial,sans-serif;background:#0f172a;color:#fff;padding:32px 20px;text-align:center"><h1 style="color:#5eead4">TheraPay</h1><h2>האישור הושלם ✓</h2><p style="line-height:1.9">אפשר לסגור את הלשונית ולחזור לאשף ההקמה.<br>שם לחצו על ״בדיקת האישור והמשך״.</p></body></html>').setTitle('TheraPay · האישור הושלם');
}`;

function webUrl(deployment){const url=deployment.entryPoints?.find(e=>e.webApp?.url)?.webApp.url;if(!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url||''))throw new Error('Google לא החזיר כתובת לאישור ההרשאות');return url;}
function validateOwner(files,ownerEmail,spreadsheetId){
 const bootstrap=files.find(f=>f.name==='OnboardingBootstrap'&&f.type==='SERVER_JS');
 const match=bootstrap?.source.match(/^var PILOT_BOOTSTRAP = (\{[^\n]+\});/);
 if(!match)throw new Error('לא ניתן לזהות את פרויקט ההקמה הפרטי');
 const config=JSON.parse(match[1]);
 if(config.ownerEmail!==ownerEmail||config.spreadsheetId!==spreadsheetId)throw new Error('פרויקט ההקמה אינו שייך לחשבון שנבחר');
}
export function privateAuthorizationFiles(files,ownerEmail,spreadsheetId){
 validateOwner(files,ownerEmail,spreadsheetId);
 const copy=files.map(({name,type,source})=>({name,type,source}));
 const core=copy.find(f=>f.name==='Code'&&f.type==='SERVER_JS'),manifest=copy.find(f=>f.name==='appsscript'&&f.type==='JSON');
 if(!core?.source.includes('function clinicDoPost(e)')||!manifest||copy.some(f=>f.name==='OwnerAuthorization'))throw new Error('לא ניתן להכין אישור לפרויקט הזה בלי לשנות קוד לא מוכר');
 if(copy.filter(f=>f.type==='SERVER_JS').reduce((n,f)=>n+(f.source.match(/function\s+doGet\s*\(/g)||[]).length,0)!==1||!/function\s+doGet\s*\(/.test(core.source))throw new Error('לא ניתן לזהות את נקודת הכניסה לפרויקט');
 core.source=core.source.replace(/function\s+doGet\s*\(/,'function clinicStatusGet(');
 const settings=JSON.parse(manifest.source);
 settings.webapp={access:'MYSELF',executeAs:'USER_ACCESSING'};
 manifest.source=JSON.stringify(settings);
 copy.push({name:'OwnerAuthorization',type:'SERVER_JS',source:OWNER_PAGE});
 return copy;
}

export async function prepareOwnerAuthorization({token,resources,ownerEmail,request=googleRequest,progress=()=>{}}){
 if(!resources.scriptId||!resources.spreadsheetId||resources.ownerEmail!==ownerEmail)throw new Error('חסרים פרטי הקליניקה הפרטית לאישור Google');
 const base='https://script.googleapis.com/v1/projects/'+resources.scriptId;
 const project=await request(token,base);
 if(project.parentId!==resources.spreadsheetId)throw new Error('פרויקט ההקמה אינו שייך לגיליון הפרטי');
 const marker=await request(token,'https://www.googleapis.com/drive/v3/files/'+resources.spreadsheetId+'?fields=id,appProperties');
 if(marker.appProperties?.therapayPilot!=='v1'||marker.appProperties?.therapayScriptId!==resources.scriptId)throw new Error('הפרויקט אינו מזוהה כהקמה של TheraPay');
 const content=await request(token,base+'/content');
 // Validate ownership even when a previous authorization deployment exists.
 validateOwner(content.files||[],ownerEmail,resources.spreadsheetId);
 const deployments=await request(token,base+'/deployments');
 const existing=(deployments.deployments||[]).find(d=>d.deploymentConfig?.description===DESCRIPTION);
 if(existing)return webUrl(existing);
 const authorizationFiles=privateAuthorizationFiles(content.files||[],ownerEmail,resources.spreadsheetId);
 const original=(content.files||[]).map(({name,type,source})=>({name,type,source}));
 progress('מכין מסך אישור פרטי של Google…');
 let deployment;
 // The backend is a versioned deployment. Never update it or change its access.
 // Build a separate owner-only version, then restore the original working source.
 try{
  await request(token,base+'/content',{method:'PUT',body:{files:authorizationFiles}});
  const version=await request(token,base+'/versions',{method:'POST',body:{description:DESCRIPTION}});
  deployment=await request(token,base+'/deployments',{method:'POST',body:{versionNumber:version.versionNumber,manifestFileName:'appsscript',description:DESCRIPTION}});
 }finally{await request(token,base+'/content',{method:'PUT',body:{files:original}});}
 return webUrl(deployment);
}
