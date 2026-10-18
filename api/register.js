import {onboardingConfig} from '../onboarding-config.js';

// Only distribution registration is relayed. Clinic passwords, Morning keys,
// patient records and Google access tokens never pass through this endpoint.
export function createRegistrationHandler({fetchImpl=fetch,registryUrl=process.env.REGISTRY_URL||onboardingConfig.registryUrl}={}){
 return async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({success:false,message:'פעולה לא נתמכת'});}
  let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{return res.status(400).json({success:false,message:'בקשת רישום לא תקינה'});}
  if(!body||typeof body!=='object'||Object.keys(body).some(k=>!['name','idToken'].includes(k))||typeof body.name!=='string'||!body.name.trim()||body.name.length>100||typeof body.idToken!=='string'||!body.idToken||body.idToken.length>8000)return res.status(400).json({success:false,message:'בקשת רישום לא תקינה'});
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(registryUrl))return res.status(503).json({success:false,message:'שירות הרישום עדיין אינו מוגדר'});
  try{
   const response=await fetchImpl(registryUrl,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'register',name:body.name.trim(),idToken:body.idToken}),redirect:'follow',signal:AbortSignal.timeout(45000)});
   const data=await response.json();
   if(!response.ok)return res.status(502).json({success:false,message:'שירות הרישום אינו זמין כרגע. נסו שוב.'});
   if(!data.success)return res.status(401).json({success:false,message:'אימות הרישום לא הושלם. התחברו שוב עם Google.'});
   if(typeof data.receipt!=='string'||!data.receipt||data.receipt.length>1000)throw new Error('Invalid registry response');
   return res.status(200).json({success:true,receipt:data.receipt});
  }catch{return res.status(502).json({success:false,message:'החיבור לשירות הרישום התעכב. נסו שוב.'});}
 };
}
export default createRegistrationHandler();
