const encoder=new TextEncoder(),decoder=new TextDecoder();
const base64=bytes=>btoa(String.fromCharCode(...bytes));
const bytes=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
// Only encrypted loading snapshots are persisted. Passwords, API keys and Google
// tokens are never part of this payload or sent to the registration service.
export function clientLoadCache({storage,ownerEmail,spreadsheetId,password,cryptoImpl=globalThis.crypto}){
 const identity=String(ownerEmail).trim().toLowerCase()+':'+spreadsheetId;
 const storageKey='THERAPAY_CLIENT_LOAD_V1:'+encodeURIComponent(identity);
 const aad=encoder.encode(identity);let salt,key;
 async function derive(rawSalt){
  if(key&&salt===rawSalt)return key;salt=rawSalt;
  const material=await cryptoImpl.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);
  key=await cryptoImpl.subtle.deriveKey({name:'PBKDF2',salt:bytes(salt),iterations:210000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);return key;
 }
 return {
  async read(){const raw=storage.getItem(storageKey);if(!raw)return null;try{const saved=JSON.parse(raw);if(saved.v!==1)throw Error();const k=await derive(saved.salt);return JSON.parse(decoder.decode(await cryptoImpl.subtle.decrypt({name:'AES-GCM',iv:bytes(saved.iv),additionalData:aad},k,bytes(saved.cipher))));}catch{throw Error('לא ניתן לפתוח את התקדמות הטעינה השמורה. יש לוודא שנכנסת עם סיסמת הקליניקה הנכונה.');}},
  async write(snapshot){
   const k=await derive(salt||base64(cryptoImpl.getRandomValues(new Uint8Array(16))));const iv=cryptoImpl.getRandomValues(new Uint8Array(12));
   const cipher=new Uint8Array(await cryptoImpl.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},k,encoder.encode(JSON.stringify(snapshot))));
   // Chunk base64 conversion to avoid call-stack overflow for large client lists.
   let binary='';for(let i=0;i<cipher.length;i+=8192)binary+=String.fromCharCode(...cipher.subarray(i,i+8192));
   try{storage.setItem(storageKey,JSON.stringify({v:1,salt,iv:base64(iv),cipher:btoa(binary)}));}catch{throw Error('אין מספיק מקום לשמירת התקדמות הטעינה במכשיר. ההתקדמות שנשמרה קודם לא נמחקה.');}
  },
  clear(){storage.removeItem(storageKey);key=null;salt=null;}
 };
}
function validateSnapshot(snapshot){
 if(!snapshot||!Array.isArray(snapshot.clients)||!Number.isInteger(snapshot.nextPage)||snapshot.nextPage<1||!Number.isInteger(snapshot.total)||snapshot.total<0||!Number.isInteger(snapshot.pages)||snapshot.pages<0||snapshot.nextPage>snapshot.pages+2)throw Error('התקדמות הטעינה השמורה אינה תקינה');
 const ids=new Set();for(const c of snapshot.clients){if(!c.id||ids.has(c.id))throw Error('התקדמות הטעינה השמורה אינה תקינה');ids.add(c.id);}
 if(snapshot.clients.length>snapshot.total||(snapshot.complete&&snapshot.clients.length!==snapshot.total))throw Error('התקדמות הטעינה השמורה אינה מלאה');
}
export async function loadClientPages({requestPage,mapClient,cache,progress=()=>{},delay=ms=>new Promise(r=>setTimeout(r,ms))}){
 let snapshot=await cache.read();if(snapshot)validateSnapshot(snapshot);
 if(snapshot?.complete){progress('רשימת הלקוחות השמורה נטענה');return snapshot.clients;}
 const all=snapshot?[...snapshot.clients]:[],seen=new Set(all.map(c=>c.id));let page=snapshot?.nextPage||1,pages=snapshot?.pages||1,total=snapshot?.total??null;
 do{
  progress('טוען לקוחות מ־Morning · עמוד '+page+(total!==null?' · '+all.length+' מתוך '+total+' נשמרו':''));
  let result;for(let attempt=0;;attempt++)try{result=await requestPage(page);break;}catch(error){if(attempt>=2||['AUTH','MORNING_AUTH'].includes(error.code))throw error;progress('החיבור התעכב · מנסה שוב את עמוד '+page);await delay(800*(attempt+1));}
  const incomingTotal=Number(result.total),incomingPages=Number(result.pages);
  if(!Number.isInteger(incomingTotal)||incomingTotal<0||!Number.isInteger(incomingPages)||incomingPages<0||incomingPages>10000||!Array.isArray(result.items)||(result.page!==undefined&&Number(result.page)!==page))throw Error('רשימת Morning לא הוחזרה במבנה תקין');
  if(total!==null&&(incomingTotal!==total||incomingPages!==pages))throw Error('רשימת הלקוחות ב־Morning השתנתה במהלך הטעינה. ההתקדמות נשמרה; אפשר להתחיל טעינה מעודכנת.');
  total=incomingTotal;pages=incomingPages;
  const pageClients=[],pageIds=new Set();for(const client of result.items){const c=mapClient(client);if(!c.id||seen.has(c.id)||pageIds.has(c.id))throw Error('Morning החזיר מזהה לקוח חסר או כפול');pageIds.add(c.id);pageClients.push(c);}
  const next=[...all,...pageClients],complete=page>=pages;
  if(next.length>total||(complete&&next.length!==total))throw Error('רשימת הלקוחות לא הוחזרה במלואה. ההתקדמות הקודמת נשמרה.');
  snapshot={clients:next,nextPage:page+1,pages,total,complete};await cache.write(snapshot);
  all.push(...pageClients);for(const id of pageIds)seen.add(id);page++;
 }while(page<=pages);
 return all;
}
