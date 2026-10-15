/** TheraPay API v2. Bound to the existing clinic spreadsheet. */
var API_VERSION = 2;
var FIELDS = {
  patient: { id:['מזהה מטופל'], name:['שם מלא','שם'], phone:['טלפון'], rate:['תעריף ברירת מחדל','תעריף'], status:['סטטוס'] },
  appointment: { id:['מזהה פגישה'], timestamp:['תאריך ושעה'], date:['תאריך'], name:['שם המטופל','שם המטופל/ת'], amount:['סכום לתשלום','סכום'], status:['סטטוס תשלום'], method:['אמצעי תשלום'], doc:['מספר חשבונית'], morning:['morning_status'], pdf:['pdf_url'], patientId:['מזהה מטופל'] }
};
function json_(data) { data.apiVersion=API_VERSION; return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
function fail_(message, code) { var e=new Error(message);e.code=code||'VALIDATION';throw e; }
function doGet() { return json_({success:true,message:'TheraPay API',authenticated:false}); }
function doPost(e) {
  var lock;
  try {
    var req=JSON.parse(e && e.postData ? e.postData.contents : '{}');
    var secret=PropertiesService.getScriptProperties().getProperty('APP_ACCESS_TOKEN');
    if(!secret || secret.length<32 || req.accessToken!==secret) return json_({success:false,code:'AUTH',message:'קוד הגישה חסר או שגוי. יש להתחבר מחדש.'});
    lock=LockService.getScriptLock();if(!lock.tryLock(25000))fail_('המערכת מבצעת פעולה אחרת. נסו שוב בעוד רגע.','BUSY');
    var result;
    if(req.action==='getAllData')result=readData_();
    else if(req.action==='addPatient')result=addPatient_(req);
    else if(req.action==='addAppointment')result=addAppointment_(req);
    else if(req.action==='createMorningDoc'||req.action==='createMorningDocument')result=issueDocument_(req);
    else fail_('פעולה לא מוכרת');
    return json_(result);
  } catch(err) { return json_({success:false,code:err.code||'SERVER',message:err.code?err.message:'הפעולה לא הושלמה. יש לבדוק את יומן הביצוע ב־Apps Script לפני ניסיון הפקה נוסף.'}); }
  finally { if(lock&&lock.hasLock())lock.releaseLock(); }
}
function spreadsheet_(){var id=PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');var ss=id?SpreadsheetApp.openById(id):SpreadsheetApp.getActiveSpreadsheet();if(!ss)fail_('יש לקשור את הסקריפט לגיליון או להגדיר SPREADSHEET_ID.');return ss;}
function table_(kind){
  var ss=spreadsheet_();var sheet=kind==='patient'?(ss.getSheetByName('Patients')||ss.getSheetByName('מטופלים')):(ss.getSheetByName('Appointments')||ss.getSheetByName('פגישות'));
  if(!sheet)fail_('לא נמצא גיליון '+kind);
  var values=sheet.getDataRange().getValues();var headers=values[0].map(function(v){return String(v).trim();});var cols={};
  Object.keys(FIELDS[kind]).forEach(function(key){cols[key]=-1;FIELDS[kind][key].some(function(alias){var i=headers.indexOf(alias);if(i>=0){cols[key]=i;return true;}return false;});});
  var required=kind==='patient'?['id','name','phone','rate','status']:['id','date','name','amount','status','method','doc','morning','pdf'];
  required.forEach(function(key){if(cols[key]<0)fail_('חסרה כותרת בגיליון '+sheet.getName()+': '+FIELDS[kind][key][0]);});
  return {sheet:sheet,headers:headers,cols:cols,rows:values.slice(1).map(function(v,i){return {values:v,row:i+2};}).filter(function(r){return r.values.some(function(v){return v!==''&&v!==null;});})};
}
function text_(value){return String(value==null?'':value).trim();}
function val_(t,r,key){return t.cols[key]>=0?r.values[t.cols[key]]:'';}
function date_(value){if(value instanceof Date)return Utilities.formatDate(value,'Asia/Jerusalem','yyyy-MM-dd');var s=text_(value);if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;var m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);return m?m[3]+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[1]).slice(-2):s;}
function validDate_(value){var s=text_(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;var d=new Date(s+'T12:00:00Z');return !isNaN(d.getTime())&&d.toISOString().slice(0,10)===s;}
function today_(){return Utilities.formatDate(new Date(),'Asia/Jerusalem','yyyy-MM-dd');}
function amount_(value){var n=Number(value);if(!isFinite(n)||n<=0||Math.abs(n*100-Math.round(n*100))>0.00001)fail_('יש להזין סכום חיובי עם עד שתי ספרות אחרי הנקודה.');return Math.round(n*100)/100;}
function storedAmount_(value){var n=Number(value);return isFinite(n)&&n>0?n:0;}
function unique_(items,label){var seen={};items.forEach(function(x){if(!x.id||seen[x.id])fail_('מזהה חסר או כפול ב'+label+'. יש לתקן את הגיליון לפני המשך עבודה.');seen[x.id]=true;});}
function patients_(){
  var t=table_('patient');var list=t.rows.map(function(r){var phone=text_(val_(t,r,'phone'));if(/^5\d{8}$/.test(phone))phone='0'+phone;return {id:text_(val_(t,r,'id')),name:text_(val_(t,r,'name')),phone:phone,rate:storedAmount_(val_(t,r,'rate')),status:text_(val_(t,r,'status'))};});unique_(list,'מטופלים');return list;
}
function appointments_(patients){
  var t=table_('appointment');var list=t.rows.map(function(r){
    var name=text_(val_(t,r,'name'));var storedId=text_(val_(t,r,'patientId'));var matches=patients.filter(function(p){return storedId?p.id===storedId:p.name===name;});
    if(matches.length!==1)fail_('לא ניתן לשייך פגישה בשורה '+r.row+' למטופל יחיד. בדקו את השם או את מזהה המטופל בגיליון.');
    var doc=text_(val_(t,r,'doc'));var status=text_(val_(t,r,'status'));var morning=text_(val_(t,r,'morning'));var paidDoc=doc&&doc!=='-'&&doc!=='טיוטה'&&morning!=='draft';
    return {id:text_(val_(t,r,'id')),patientId:matches[0].id,clientName:matches[0].name,date:date_(val_(t,r,'date')),amount:storedAmount_(val_(t,r,'amount')),isPaid:/(^|\s)שולם($|\s)/.test(status)||!!paidDoc,paymentMethod:text_(val_(t,r,'method')),docNumber:paidDoc?doc:'',pdfUrl:text_(val_(t,r,'pdf')),morningStatus:morning,_row:r.row};
  });unique_(list,'פגישות');return {table:t,list:list};
}
function environment_(){var env=PropertiesService.getScriptProperties().getProperty('MORNING_ENV')||'sandbox';if(env!=='sandbox'&&env!=='production')fail_('MORNING_ENV חייב להיות sandbox או production.');return env;}
function readData_(){var p=patients_();var a=appointments_(p).list;var props=PropertiesService.getScriptProperties();return {success:true,patients:p,appointments:a.map(function(x){var copy=Object.assign({},x);delete copy._row;return copy;}),environment:environment_(),morningConfigured:!!(props.getProperty('MORNING_API_KEY')&&props.getProperty('MORNING_API_SECRET'))};}
function literal_(value){var s=text_(value);return /^[=+@\-]/.test(s)?"'"+s:s;}
function append_(t,obj){var row=t.headers.map(function(){return '';});Object.keys(obj).forEach(function(key){if(t.cols[key]>=0)row[t.cols[key]]=obj[key];});t.sheet.appendRow(row);SpreadsheetApp.flush();}
function ensurePatientIdColumn_(t){if(t.cols.patientId<0){t.cols.patientId=t.headers.length;t.headers.push('מזהה מטופל');t.sheet.getRange(1,t.headers.length).setValue('מזהה מטופל');}}

// Durable request journal: a timed out request is never silently re-issued.
function journal_(){var ss=spreadsheet_();var s=ss.getSheetByName('_TheraPayRequests');if(!s){s=ss.insertSheet('_TheraPayRequests');s.appendRow(['request_id','fingerprint','status','response','created_at']);s.hideSheet();SpreadsheetApp.flush();}return s;}
function request_(req,fingerprint){
  if(!/^[a-zA-Z0-9-]{16,100}$/.test(req.requestId||''))fail_('מזהה בקשה חסר או לא תקין.');
  var s=journal_();var rows=s.getDataRange().getValues();
  for(var i=1;i<rows.length;i++)if(rows[i][0]===req.requestId){if(rows[i][1]!==fingerprint)fail_('מזהה בקשה כבר שימש לפעולה אחרת.');return {sheet:s,row:i+1,status:rows[i][2],response:rows[i][3]?JSON.parse(rows[i][3]):null};}
  return {sheet:s,row:0};
}
function record_(record,req,fingerprint,status,response){
  if(!record.row){record.row=record.sheet.getLastRow()+1;record.sheet.appendRow([req.requestId,fingerprint,status,response?JSON.stringify(response):'',new Date()]);}
  else record.sheet.getRange(record.row,3,1,2).setValues([[status,response?JSON.stringify(response):'']]);
  SpreadsheetApp.flush();record.status=status;record.response=response;
}
function fingerprint_(data){return JSON.stringify(data);}
function addPatient_(req){
  var name=text_(req.name);var phone=text_(req.phone);var rate=amount_(req.rate);
  if(!name||name.length>100||/^[=+@\-]/.test(name))fail_('שם המטופל חסר או אינו תקין.');if(!/^\+?[\d\s()-]{8,20}$/.test(phone))fail_('טלפון לא תקין.');
  var fp=fingerprint_(['addPatient',name,phone,rate]);var rec=request_(req,fp);if(rec.status==='done')return rec.response;
  // ID derived from request ID also protects a successful append followed by a journal write failure.
  var id='PAT-'+req.requestId;var t=table_('patient');var existing=patients_();
  if(!existing.some(function(p){return p.id===id;})){
    if(existing.some(function(p){return p.name===name;}))fail_('כבר קיים מטופל בשם זה. יש להשתמש בשם מובחן כדי לשייך נכון פגישות ישנות.');
    append_(t,{id:id,name:literal_(name),phone:literal_(phone),rate:rate,status:'פעיל'});
  }
  var result={success:true,patientId:id};record_(rec,req,fp,'done',result);return result;
}
function addAppointment_(req){
  var p=patients_().filter(function(p){return p.id===req.patientId;})[0];if(!p)fail_('המטופל לא נמצא.');if(!validDate_(req.date))fail_('תאריך הפגישה אינו תקין.');var amount=amount_(req.amount);
  var fp=fingerprint_(['addAppointment',p.id,req.date,amount]);var rec=request_(req,fp);if(rec.status==='done')return rec.response;
  var id='APP-'+req.requestId;var t=table_('appointment');
  if(!t.rows.some(function(r){return text_(val_(t,r,'id'))===id;})){ensurePatientIdColumn_(t);append_(t,{id:id,timestamp:req.date,date:req.date,name:literal_(p.name),patientId:p.id,amount:amount,status:'ממתין לתשלום',method:'',doc:'',morning:'',pdf:''});}
  var result={success:true,appointmentId:id};record_(rec,req,fp,'done',result);return result;
}
function selected_(req,allowPaid){
  var p=patients_();var patient=p.filter(function(p){return p.id===req.patientId;})[0];if(!patient)fail_('המטופל לא נמצא.');
  if(!Array.isArray(req.ids)||!req.ids.length||req.ids.length>200)fail_('יש לבחור פגישות שלמות לתשלום.');
  var ids=req.ids.map(String);if(ids.some(function(id,i){return ids.indexOf(id)!==i;}))fail_('הבקשה מכילה מזהי פגישות כפולים.');
  var bundle=appointments_(p);var list=ids.map(function(id){var app=bundle.list.filter(function(a){return a.id===id;})[0];if(!app||app.patientId!==patient.id)fail_('הפגישות אינן שייכות לאותו מטופל.');if(!allowPaid&&app.isPaid)fail_('אחת הפגישות כבר שולמה. יש לרענן את הנתונים.');if(!validDate_(app.date))fail_('יש לתקן את תאריך הפגישה בגיליון.');amount_(app.amount);return app;});
  var cents=list.reduce(function(sum,a){return sum+Math.round(a.amount*100);},0);if(Math.round(amount_(req.amount)*100)!==cents)fail_('הסכום השתנה בגיליון. יש לרענן את הנתונים לפני הפקה.');
  return {patient:patient,apps:list,table:bundle.table,amount:cents/100};
}
function syncIssued_(result,selection){
  var t=selection.table;selection.apps.forEach(function(a){
    if(a.docNumber&&a.docNumber!==String(result.docNumber))fail_('מספר מסמך קיים שונה. יש לבדוק ידנית את הגיליון.','RECONCILE');
    var updates={status:'שולם',method:result.paymentLabel,doc:String(result.docNumber),morning:result.environment==='sandbox'?'issued_sandbox':'issued',pdf:result.pdfUrl};
    Object.keys(updates).forEach(function(key){t.sheet.getRange(a._row,t.cols[key]+1).setValue(updates[key]);});
  });SpreadsheetApp.flush();
}
function payment_(method,amount,date){
  var labels={bit:'ביט',paybox:'פייבוקס',cash:'מזומן',transfer:'העברה בנקאית'};if(!labels[method])fail_('אמצעי תשלום אינו נתמך.');
  var p={price:amount,date:date,type:method==='transfer'?4:method==='cash'?1:10};if(method==='bit'||method==='paybox')p.appType=method==='paybox'?2:1;
  return {object:p,label:labels[method]};
}
function issueDocument_(req){
  var env=environment_();if(req.isDraft)fail_('תשלום נרשם רק באמצעות מסמך סופי.');
  if(!Array.isArray(req.ids)||!req.ids.length)fail_('יש לבחור פגישות שלמות לתשלום.');
  if(!validDate_(req.paymentDate)||req.paymentDate>today_())fail_('תאריך קבלת התשלום אינו תקין.');
  var fp=fingerprint_(['createMorningDoc',req.patientId,(req.ids||[]).slice().sort(),req.amount,req.paymentMethod,req.paymentDate,env]);
  var rec=request_(req,fp);
  if(rec.status==='issued'||rec.status==='done'){var old=rec.response;syncIssued_(old,selected_(req,true));record_(rec,req,fp,'done',old);return old;}
  if(rec.status==='pending'||rec.status==='unknown')fail_('מצב ההנפקה אינו ודאי. יש לבדוק את Morning ואת יומן _TheraPayRequests. לא נשלחה בקשת הנפקה נוספת.','UNCERTAIN');
  if(rec.status==='rejected')fail_('בקשה זו נדחתה על ידי Morning. יש לתקן את הפרטים וליצור בקשה חדשה.','MORNING_REJECTED');
  var selection=selected_(req,false);var payment=payment_(req.paymentMethod,selection.amount,req.paymentDate);var token=morningToken_(env);
  // Reserve every selected appointment across request IDs before contacting Morning.
  var journalRows=rec.sheet.getDataRange().getValues();
  journalRows.slice(1).forEach(function(row){if(row[0]===req.requestId||['pending','unknown','issued'].indexOf(row[2])<0)return;var saved=row[3]?JSON.parse(row[3]):null;if(saved&&saved.ids&&selection.apps.some(function(a){return saved.ids.indexOf(a.id)>=0;}))fail_('קיימת בקשת הפקה קודמת עבור אחת הפגישות. יש להשלים את הבירור לפני הפקה נוספת.','UNCERTAIN');});
  var reservation={ids:selection.apps.map(function(a){return a.id;}),patientId:selection.patient.id};
  var payload={type:320,lang:'he',currency:'ILS',draft:false,date:today_(),client:{name:selection.patient.name,phone:selection.patient.phone.replace(/[^0-9]/g,''),add:true},income:selection.apps.map(function(a){return {description:'טיפול בקליניקה בתאריך '+a.date,quantity:1,price:a.amount,vatType:1,currency:'ILS'};}),payment:[payment.object]};
  record_(rec,req,fp,'pending',reservation);
  var response;
  try{response=UrlFetchApp.fetch((env==='sandbox'?'https://sandbox.d.greeninvoice.co.il':'https://api.greeninvoice.co.il')+'/api/v1/documents',{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+token},payload:JSON.stringify(payload),muteHttpExceptions:true});}
  catch(e){record_(rec,req,fp,'unknown',reservation);fail_('לא התקבלה תשובה מ־Morning. יש לבדוק אם המסמך הופק לפני ניסיון נוסף.','UNCERTAIN');}
  var code=response.getResponseCode();var doc;
  try{doc=JSON.parse(response.getContentText());}catch(e){record_(rec,req,fp,'unknown',reservation);fail_('התקבלה תשובה לא תקינה מ־Morning. נדרש בירור לפני ניסיון נוסף.','UNCERTAIN');}
  if(code>=400&&code<500&&code!==408&&!doc.id){record_(rec,req,fp,'rejected',reservation);fail_('Morning: '+(doc.errorMessage||doc.message||'המסמך נדחה. בדקו את פרטי התשלום.'),'MORNING_REJECTED');}
  if(code<200||code>=300||!doc.id||!doc.number){record_(rec,req,fp,'unknown',reservation);fail_('מצב המסמך ב־Morning אינו ודאי. נדרש בירור לפני ניסיון נוסף.','UNCERTAIN');}
  var result={success:true,docId:doc.id,docNumber:String(doc.number),pdfUrl:doc.url?(typeof doc.url==='string'?doc.url:doc.url.he||''):'',paymentLabel:payment.label,environment:env,ids:reservation.ids};
  // Persist the remote success BEFORE writing paid status. Retrying only repairs Sheets.
  record_(rec,req,fp,'issued',result);syncIssued_(result,selection);record_(rec,req,fp,'done',result);return result;
}
function morningToken_(env){
  var props=PropertiesService.getScriptProperties();var key=props.getProperty('MORNING_API_KEY'),secret=props.getProperty('MORNING_API_SECRET');if(!key||!secret)fail_('חסרים מפתחות Morning במאפייני הסקריפט.');
  var res=UrlFetchApp.fetch(env==='sandbox'?'https://api.sandbox.morning.dev/idp/v1/oauth/token':'https://api.morning.co/idp/v1/oauth/token',{method:'post',contentType:'application/x-www-form-urlencoded',payload:{grant_type:'client_credentials',client_id:key,client_secret:secret},muteHttpExceptions:true});
  var data;try{data=JSON.parse(res.getContentText());}catch(e){fail_('שגיאה באימות מול Morning.','MORNING_AUTH');}
  if(res.getResponseCode()<200||res.getResponseCode()>=300||!(data.access_token||data.accessToken))fail_('אימות Morning נכשל. בדקו מפתחות וסביבת עבודה.','MORNING_AUTH');return data.access_token||data.accessToken;
}
/** Run once in the editor, then copy APP_ACCESS_TOKEN from Script Properties into the app. */
function setupAccessCode(){var props=PropertiesService.getScriptProperties();if(!props.getProperty('APP_ACCESS_TOKEN'))props.setProperty('APP_ACCESS_TOKEN',Utilities.getUuid()+Utilities.getUuid());if(!props.getProperty('MORNING_ENV'))props.setProperty('MORNING_ENV','sandbox');}
