/** Central PILOT registry. Stores only Name, Email, Used. Never receives clinic credentials. */
function registryJson_(x){return ContentService.createTextOutput(JSON.stringify(x)).setMimeType(ContentService.MimeType.JSON);}
function doGet(){return registryJson_({success:true,message:'TheraPay registration service'});}
function setupRegistry(){
  var props=PropertiesService.getScriptProperties();if(!props.getProperty('REGISTRY_GOOGLE_CLIENT_ID'))throw new Error('יש להגדיר REGISTRY_GOOGLE_CLIENT_ID במאפייני הסקריפט');
  if(!props.getProperty('REGISTRY_HMAC_SECRET'))props.setProperty('REGISTRY_HMAC_SECRET',Utilities.getUuid()+Utilities.getUuid());
  if(!props.getProperty('REGISTRY_SPREADSHEET_ID')){var ss=SpreadsheetApp.create('TheraPay · משתמשים');ss.getSheets()[0].setName('Users');ss.getSheets()[0].appendRow(['שם','מייל','שימוש']);props.setProperty('REGISTRY_SPREADSHEET_ID',ss.getId());}
}
function registryTable_(){var id=PropertiesService.getScriptProperties().getProperty('REGISTRY_SPREADSHEET_ID');if(!id)throw new Error('הרישום טרם הוגדר');var sheet=SpreadsheetApp.openById(id).getSheetByName('Users');if(!sheet)throw new Error('לא נמצא גיליון הרישום');return sheet;}
function registrySignature_(email){var key=PropertiesService.getScriptProperties().getProperty('REGISTRY_HMAC_SECRET');if(!key)throw new Error('הרישום טרם הוגדר');return Utilities.computeHmacSha256Signature(email,key).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');}
function registryReceipt_(email){return Utilities.base64EncodeWebSafe(email).replace(/=+$/,'')+'.'+registrySignature_(email);}
function registryReceiptEmail_(receipt){if(typeof receipt!=='string'||receipt.length>1000)throw new Error('הרשאת שימוש שגויה');var parts=receipt.split('.');if(parts.length!==2)throw new Error('הרשאת שימוש שגויה');var email=Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();if(registrySignature_(email)!==parts[1])throw new Error('הרשאת שימוש שגויה');return email;}
function doPost(e){
  var lock=LockService.getScriptLock();try{
    var body=e&&e.postData?e.postData.contents:'';if(body.length>12000)throw new Error('בקשה גדולה מדי');var req=JSON.parse(body);
    if(['register','markUsed'].indexOf(req.action)<0)throw new Error('פעולה לא מוכרת');
    var email,name;
    if(req.action==='register'){
      if(typeof req.idToken!=='string'||req.idToken.length>8000)throw new Error('יש להתחבר עם Google');
      // Pilot verification through Google's endpoint. Replace with server-side JWT verification before broad production rollout.
      var response=UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token='+encodeURIComponent(req.idToken),{muteHttpExceptions:true});var claims=JSON.parse(response.getContentText());
      var clientId=PropertiesService.getScriptProperties().getProperty('REGISTRY_GOOGLE_CLIENT_ID');
      if(response.getResponseCode()!==200||!clientId||claims.aud!==clientId||['accounts.google.com','https://accounts.google.com'].indexOf(claims.iss)<0||Number(claims.exp)<=Date.now()/1000||!(claims.email_verified===true||claims.email_verified==='true')||!claims.sub)throw new Error('אימות Google לא הושלם');
      email=String(claims.email||'').trim().toLowerCase();name=String(req.name||claims.name||'').trim();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!name||name.length>100)throw new Error('פרטי משתמש לא תקינים');
    }else email=registryReceiptEmail_(req.receipt);
    if(!lock.tryLock(15000))throw new Error('הרישום עסוק. נסו שוב.');
    var sheet=registryTable_(),rows=sheet.getDataRange().getValues(),row=0;for(var i=1;i<rows.length;i++)if(String(rows[i][1]).toLowerCase()===email){row=i+1;break;}
    if(req.action==='register'){
      var safeName=/^[=+@\-]/.test(name)?"'"+name:name;if(row)sheet.getRange(row,1).setValue(safeName);else sheet.appendRow([safeName,/^[=+@\-]/.test(email)?"'"+email:email,'לא']);
      return registryJson_({success:true,receipt:registryReceipt_(email)});
    }
    if(!row)throw new Error('המשתמש לא רשום');sheet.getRange(row,3).setValue('כן');return registryJson_({success:true});
  }catch(error){return registryJson_({success:false,message:error.message||'הרישום לא הושלם'});}finally{if(lock.hasLock())lock.releaseLock();}
}
