/** Installed into each user's PRIVATE Apps Script project. No clinic secrets go to the registry. */
function doPost(e){
  var req;try{req=JSON.parse(e&&e.postData?e.postData.contents:'{}');}catch(err){return json_({success:false,message:'בקשה לא תקינה'});}
  if(['pilotProbe','initializeClinic','getMorningClientsPage','importMorningClients','saveClinicMessages','completeOnboarding'].indexOf(req.action)<0){
    var output=clinicDoPost(e);
    if(['addPatient','addAppointment','updatePatient','updateAppointment','saveTask','createMorningDoc'].indexOf(req.action)>=0){try{if(JSON.parse(output.getContent()).success)pilotMarkUsed_();}catch(ignore){}}
    return output;
  }
  var lock=LockService.getScriptLock();
  try{
    if(!lock.tryLock(25000))fail_('פעולה אחרת מתבצעת. נסו שוב בעוד רגע.');
    var props=PropertiesService.getScriptProperties(),result;
    if(req.action==='pilotProbe'||req.action==='initializeClinic'){
      if(!req.bootstrapToken||req.bootstrapToken!==PILOT_BOOTSTRAP.bootstrapSecret)fail_('ההרשאה להגדרה ראשונית אינה תקינה.','AUTH');
      if(req.action==='pilotProbe')result={success:true,initialized:props.getProperty('PILOT_INITIALIZED')==='true'};
      else result=pilotInitialize_(req,props);
    }else{
      var secret=props.getProperty('APP_ACCESS_TOKEN');if(!secret||req.accessToken!==secret)fail_('סיסמת הקליניקה אינה תקינה.','AUTH');
      if(req.action==='getMorningClientsPage')result=pilotClientsPage_(req);
      if(req.action==='importMorningClients')result=pilotImport_(req);
      if(req.action==='saveClinicMessages')result=pilotSaveMessages_(req,props);
      if(req.action==='completeOnboarding'){props.setProperty('PILOT_ONBOARDING_COMPLETE','true');result={success:true};}
    }
    return json_(result);
  }catch(error){return json_({success:false,code:error.code||'SERVER',message:error.code?error.message:'הפעולה לא הושלמה. לא נשלחו פרטים למנהל ההפצה.'});}
  finally{if(lock.hasLock())lock.releaseLock();}
}
// Run once from the user's own editor if Google requests script authorization.
function authorizePilot(){SpreadsheetApp.openById(PILOT_BOOTSTRAP.spreadsheetId).getName();UrlFetchApp.fetch('https://www.google.com/generate_204',{muteHttpExceptions:true});}
function pilotInitialize_(req,props){
  var password=String(req.password||''),name=text_(req.clinicName),key=text_(req.morningKey),secret=text_(req.morningSecret),env=req.environment;
  if(password.length<16||password.length>256||!name||name.length>100||!key||!secret||['sandbox','production'].indexOf(env)<0)fail_('יש להשלים שם קליניקה, סיסמה של 16 תווים לפחות ומפתחות Morning.');
  var rate=amount_(req.defaultRate);
  var values={SPREADSHEET_ID:PILOT_BOOTSTRAP.spreadsheetId,APP_ACCESS_TOKEN:password,MORNING_API_KEY:key,MORNING_API_SECRET:secret,MORNING_ENV:env,CLINIC_NAME:name,DEFAULT_RATE:String(rate),PILOT_RECEIPT:text_(req.registrationReceipt)};
  if(props.getProperty('PILOT_INITIALIZED')==='true'){
    if(Object.keys(values).some(function(k){return props.getProperty(k)!==values[k];}))fail_('החשבון כבר הוגדר. לא הוחלפו סיסמאות או מפתחות.');
    return {success:true,alreadyInitialized:true,environment:env};
  }
  // Validate credentials before persisting any Morning key. This never creates a document.
  var response=UrlFetchApp.fetch(env==='sandbox'?'https://api.sandbox.morning.dev/idp/v1/oauth/token':'https://api.morning.co/idp/v1/oauth/token',{method:'post',contentType:'application/x-www-form-urlencoded',payload:{grant_type:'client_credentials',client_id:key,client_secret:secret},muteHttpExceptions:true});
  var data;try{data=JSON.parse(response.getContentText());}catch(err){fail_('לא התקבלה תשובת אימות תקינה מ־Morning.');}
  if(response.getResponseCode()<200||response.getResponseCode()>=300||!(data.access_token||data.accessToken))fail_('Morning לא אישר את המפתחות. בדקו אותם ואת סביבת העבודה.');
  Object.keys(values).forEach(function(k){props.setProperty(k,values[k]);});props.setProperty('PILOT_INITIALIZED','true');
  return {success:true,environment:env};
}
function pilotClientsPage_(req){
  var page=Number(req.page||1);if(!Number.isInteger(page)||page<1||page>10000)fail_('מספר עמוד לא תקין.');
  var env=environment_(),token=morningToken_(env),data=morningRead_(env,token,'/clients/search',{page:page,pageSize:100});
  if(!Array.isArray(data.items)||!Number.isFinite(Number(data.pages)))fail_('Morning לא החזיר רשימת לקוחות תקינה.');
  return {success:true,page:page,pages:Number(data.pages),total:Number(data.total),items:data.items.map(function(c){return {id:c.id,name:c.name,active:c.active,phone:c.phone||'',mobile:c.mobile||'',emails:Array.isArray(c.emails)?c.emails:[],send:c.send};})};
}
function pilotPhone_(value){var s=text_(value).replace(/[^\d+]/g,'');if(s.indexOf('+972')===0)s='0'+s.slice(4);if(s.indexOf('00972')===0)s='0'+s.slice(5);if(/^972\d+$/.test(s))s='0'+s.slice(3);if(/^5\d{8}$/.test(s))s='0'+s;return s;}
function pilotEmail_(value){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text_(value));}
function pilotImport_(req){
  if(!Array.isArray(req.clients)||!req.clients.length||req.clients.length>20)fail_('יש לבחור עד 20 מטופלים בכל פעולת שמירה.');
  var seen={};req.clients.forEach(function(c){if(!/^[\w-]+$/.test(c.morningId||'')||seen[c.morningId])fail_('מזהה Morning חסר או כפול.');seen[c.morningId]=true;if(!/^0[2-9]\d{7,8}$/.test(pilotPhone_(c.phone))||!pilotEmail_(c.email))fail_('נדרשים מייל וטלפון תקינים לכל מטופל שנבחר.');amount_(c.rate);});
  var env=environment_(),token=morningToken_(env),t=table_('patient');
  ['morningId','email'].forEach(function(k){if(t.cols[k]===undefined||t.cols[k]<0){t.cols[k]=t.headers.length;t.headers.push(k==='morningId'?'morning_client_id':'מייל');t.sheet.getRange(1,t.headers.length).setValue(t.headers[t.cols[k]]);}});
  var result=[];
  req.clients.forEach(function(selected){
    // Read only the selected remote client again; never trust a browser-supplied name or identity.
    var remote=morningRead_(env,token,'/clients/'+encodeURIComponent(selected.morningId));if(remote.id!==selected.morningId)fail_('לקוח Morning אינו תואם לבחירה.');
    var phone=pilotPhone_(selected.phone),email=text_(selected.email),emails=Array.isArray(remote.emails)?remote.emails:[];
    var changePhone=phone!==pilotPhone_(remote.mobile||remote.phone),changeEmail=!emails.some(function(e){return text_(e).toLowerCase()===email.toLowerCase();});
    if((changePhone||changeEmail)&&req.allowContactUpdates!==true)fail_('נדרש אישור מפורש לעדכון פרטי קשר ב־Morning.');
    if(changePhone||changeEmail){
      var body={};
      // Preserve every known customer setting. Do not silently enable their email-send preference.
      ['name','active','send','department','taxId','accountingKey','paymentTerms','bankName','bankBranch','bankAccount','address','city','zip','country','category','subCategory','phone','fax','mobile','remarks','contactPerson','emails','labels'].forEach(function(k){if(remote[k]!==undefined)body[k]=remote[k];});
      if(changePhone)body[remote.mobile?'mobile':'phone']=phone;
      if(changeEmail)body.emails=emails.filter(pilotEmail_).concat([email]);
      var response=UrlFetchApp.fetch((env==='sandbox'?'https://sandbox.d.greeninvoice.co.il':'https://api.greeninvoice.co.il')+'/api/v1/clients/'+encodeURIComponent(remote.id),{method:'put',contentType:'application/json',headers:{Authorization:'Bearer '+token},payload:JSON.stringify(body),muteHttpExceptions:true});
      if(response.getResponseCode()<200||response.getResponseCode()>=300)fail_('עדכון פרטי הקשר ב־Morning לא הושלם. חלק מהלקוחות הקודמים אולי נשמרו; ניסיון חוזר לא ייצור כפילויות.');
    }
    var current=table_('patient'),matches=current.rows.filter(function(r){return text_(val_(current,r,'morningId'))===remote.id;});if(matches.length>1)fail_('קיימים מזהי Morning כפולים בגיליון.');
    var id='PAT-MORNING-'+remote.id;
    var sameName=current.rows.filter(function(r){return text_(val_(current,r,'name'))===text_(remote.name)&&text_(val_(current,r,'morningId'))!==remote.id;});
    if(sameName.length)fail_('קיים מטופל אחר באותו שם. יש להבחין בין השמות ב־Morning לפני ייבוא.');
    var values={name:literal_(remote.name),phone:literal_(phone),rate:amount_(selected.rate),status:'פעיל',morningId:remote.id,email:literal_(email)};
    if(matches.length){id=text_(val_(current,matches[0],'id'));writeRow_(current,matches[0].row,values);}else{values.id=id;append_(current,values);}
    result.push({morningId:remote.id,patientId:id});
  });
  if(result.length)pilotMarkUsed_();return {success:true,imported:result};
}
function pilotSaveMessages_(req,props){
  var email=String(req.emailTemplate||''),whatsapp=String(req.whatsappTemplate||'');
  if(!email.trim()||!whatsapp.trim()||email.length>2000||whatsapp.length>2000)fail_('יש להזין נוסחי הודעה עד 2000 תווים.');
  props.setProperty('EMAIL_TEMPLATE',email);props.setProperty('WHATSAPP_TEMPLATE',whatsapp);return {success:true};
}
function pilotMarkUsed_(){
  var props=PropertiesService.getScriptProperties();if(props.getProperty('PILOT_USAGE_REPORTED')==='true')return;
  var receipt=props.getProperty('PILOT_RECEIPT');if(!receipt||!PILOT_BOOTSTRAP.registryUrl)return;
  try{var response=UrlFetchApp.fetch(PILOT_BOOTSTRAP.registryUrl,{method:'post',contentType:'text/plain',payload:JSON.stringify({action:'markUsed',receipt:receipt}),muteHttpExceptions:true});var data=JSON.parse(response.getContentText());if(response.getResponseCode()===200&&data.success)props.setProperty('PILOT_USAGE_REPORTED','true');}catch(ignore){}
}
