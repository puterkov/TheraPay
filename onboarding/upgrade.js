import {googleRequest} from './google.js';

const DESCRIPTION='TheraPay password policy 8 v1';
const clean=files=>files.map(({name,type,source})=>({name,type,source}));
function owner(files,resources){
 const source=files.find(f=>f.name==='OnboardingBootstrap'&&f.type==='SERVER_JS')?.source;
 const match=source?.match(/^var PILOT_BOOTSTRAP = (\{[^\n]+\});/);
 if(!match)throw new Error('לא ניתן לזהות את הבקנד של הקליניקה לעדכון');
 const config=JSON.parse(match[1]);
 if(config.ownerEmail!==resources.ownerEmail||config.spreadsheetId!==resources.spreadsheetId)throw new Error('הבקנד אינו שייך לחשבון הקליניקה שנבחר');
 const manifest=files.find(f=>f.name==='appsscript'&&f.type==='JSON');
 const webapp=manifest&&JSON.parse(manifest.source).webapp;
 if(webapp?.executeAs!=='USER_DEPLOYING'||webapp?.access!=='ANYONE_ANONYMOUS'||files.some(f=>f.name==='OwnerAuthorization'))throw new Error('לא ניתן לעדכן פריסה שאינה הבקנד של הקליניקה');
}
export function passwordPolicyFiles(files,resources){
 owner(files,resources);const copy=clean(files);
 const core=copy.find(f=>f.name==='Code'&&f.type==='SERVER_JS');
 if(!core?.source.includes('function clinicDoPost(e)'))throw new Error('קוד הבקנד אינו מזוהה לעדכון');
 const old='secret.length<16',current='secret.length<8';
 if(core.source.split(old).length===2&&!core.source.includes(current))core.source=core.source.replace(old,current);
 else if(core.source.split(current).length!==2||core.source.includes(old))throw new Error('כלל הסיסמה בבקנד אינו מזוהה. לא שינינו אותו.');
 const bootstrap=copy.find(f=>f.name==='OnboardingBootstrap');
 const legacy='password.length<16||password.length>256';
 if(bootstrap.source.includes(legacy)){
  if(bootstrap.source.split(legacy).length!==2)throw new Error('כלל ההקמה אינו מזוהה לעדכון');
  bootstrap.source=bootstrap.source.replace(legacy,'password.length<8||password.length>256||!/[A-Z]/.test(password)||!/[0-9]/.test(password)||!/[^\\p{L}\\p{N}\\s]/u.test(password)').replace('סיסמה של 16 תווים לפחות','סיסמה של לפחות 8 תווים, כולל מספר, אות גדולה באנגלית ותו מיוחד');
 }
 return copy;
}
function matches(deployment,resources){return deployment?.deploymentId===resources.deploymentId&&deployment.entryPoints?.some(e=>e.webApp?.url===resources.backendUrl)&&Number.isInteger(deployment.deploymentConfig?.versionNumber);}
export async function upgradePasswordPolicy({token,resources,ownerEmail,request=googleRequest,progress=()=>{}}){
 if(resources.ownerEmail!==ownerEmail||!resources.scriptId||!resources.spreadsheetId||!resources.deploymentId)throw new Error('חסרים פרטי בעל הקליניקה לעדכון');
 const base='https://script.googleapis.com/v1/projects/'+resources.scriptId;
 const project=await request(token,base);
 if(project.parentId!==resources.spreadsheetId)throw new Error('פרויקט הקליניקה אינו שייך לגיליון שנבחר');
 const marker=await request(token,'https://www.googleapis.com/drive/v3/files/'+resources.spreadsheetId+'?fields=id,appProperties');
 if(marker.appProperties?.therapayPilot!=='v1'||marker.appProperties?.therapayScriptId!==resources.scriptId)throw new Error('הקליניקה אינה מזוהה כסביבת ההפצה');
 const endpoint=base+'/deployments/'+resources.deploymentId;
 const deployment=await request(token,endpoint);
 if(!matches(deployment,resources))throw new Error('כתובת הקליניקה אינה תואמת לפריסה. לא שינינו פריסה.');
 const versionNumber=deployment.deploymentConfig.versionNumber;
 const published=await request(token,base+'/content?versionNumber='+versionNumber);
 const updated=passwordPolicyFiles(published.files||[],resources);
 const head=await request(token,base+'/content');
 const original=clean(head.files||[]),updatedHead=passwordPolicyFiles(original,resources);
 const publishedChanged=JSON.stringify(clean(published.files||[]))!==JSON.stringify(updated);
 const headChanged=JSON.stringify(original)!==JSON.stringify(updatedHead);
 if(!publishedChanged){if(headChanged)await request(token,base+'/content',{method:'PUT',body:{files:updatedHead}});return {updated:false};}
 progress('מעדכן את הקליניקה לתמיכה בסיסמה החדשה…');
 let nextVersion;
 // Only the two password rules change. Build from the published version, not
 // unpublished editor changes. Preserve those changes in HEAD after versioning.
 try{
  await request(token,base+'/content',{method:'PUT',body:{files:updated}});
  nextVersion=await request(token,base+'/versions',{method:'POST',body:{description:DESCRIPTION}});
 }finally{await request(token,base+'/content',{method:'PUT',body:{files:original}});}
 const latest=await request(token,endpoint);
 if(!matches(latest,resources)||latest.deploymentConfig.versionNumber!==versionNumber)throw new Error('הפריסה השתנתה בזמן העדכון. נסו שוב.');
 await request(token,endpoint,{method:'PUT',body:{deploymentConfig:{scriptId:resources.scriptId,versionNumber:nextVersion.versionNumber,manifestFileName:deployment.deploymentConfig.manifestFileName||'appsscript',description:deployment.deploymentConfig.description||'TheraPay onboarding pilot'}}});
 const verified=await request(token,endpoint);
 if(!matches(verified,resources)||verified.deploymentConfig.versionNumber!==nextVersion.versionNumber)throw new Error('לא ניתן לאמת שהעדכון הושלם. נסו שוב.');
 if(headChanged)await request(token,base+'/content',{method:'PUT',body:{files:updatedHead}});
 return {updated:true,previousVersion:versionNumber,versionNumber:nextVersion.versionNumber};
}
