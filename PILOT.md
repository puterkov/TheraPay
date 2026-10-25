# TheraPay — סביבת ניסיון להפצה ואשף הצטרפות

עותק עבודה נפרד: codex/onboarding-pilot. מבוסס על גרסת האתר הפעיל, ללא שינוי ב-main או בבקנד הקיים.

## גבולות
- אין כתובת Apps Script קבועה של הקליניקה; נדרש חיבור מפורש בסביבה זו.
- הנתונים של כל משתמש יישמרו בחשבון Google שלו, בגיליון ובבקנד נפרדים.
- רישום ההפצה יכלול רק שם, מייל וסימון שימוש ראשון שהושלם; ללא נתוני מטופלים, תוכן משימות, חשבוניות או מפתחות.
- אין קריאות ל-Morning או הפקת מסמכים במהלך יצירת סביבת הניסיון.
- אין דחיפה לענף main ואין פריסה לאתר הפעיל במסגרת הפיילוט.
- אחסון הדפדפן של תצוגת הניסיון מופרד באמצעות מקור מקומי ופורט נפרדים.

## החלטות שאושרו
1. חיבור עם Google והקמה אוטומטית ככל האפשר. אישורי Google ניתנים על ידי המשתמש; לא עוקפים מסכי הרשאה.
2. כל מטופל שנבחר לייבוא חייב מייל וטלפון תקינים ותעריף חיובי. מטופלים שלא נבחרו אינם חוסמים את ההמשך.
3. רישום המשתמשים בגיליון Google פרטי של מנהל ההפצה, עם שלוש עמודות בלבד: שם, מייל, שימוש.

## האשף המיועד
פרטי משתמש וקליניקה; חיבור אחסון; בחירת סיסמת קליניקה; חיבור Morning; בחירת לקוחות ותעריפים והשלמת פרטים; נוסחי הודעות ותצוגת סיכום לפני שמירה.
ייבוא יטפל בעימוד ובמזהי Morning קבועים, ולא ייצור מטופלים כפולים. עדכון פרטי קשר ב-Morning יוצג במפורש לפני שמירה. בדיקת חיבור לא תפיק חשבונית.

## מצב המימוש
אשף נפרד בן שבעה שלבים, הדגמה מלאה עם נתונים לדוגמה, קוד הקמה בחשבון המשתמש ושירות רישום נפרד הוכנו. הגדרת Google ושירות הרישום עדיין ריקים במכוון; החיבור החי טרם נבדק. ההדגמה אינה מפיקה מסמך ואינה מעבירה מידע לשירות חיצוני. בהקמה אמיתית בדיקת Morning וייבוא פונים לחשבון שהמשתמש חיבר.

הוראות הקמה ובדיקת מגבלות: [distribution/SETUP.md](distribution/SETUP.md).

## כתובת הפיילוט הקבועה

נוצר פרויקט Vercel נפרד `menashe2/therapay-start`, מזהה `prj_A4dhCzlMlRys1v2HxrETomcgeJFs`. מקור Production בפרויקט זה הוא `codex/onboarding-pilot`; פרויקט `therapay` הקיים נשאר ללא שינוי.

כתובת: https://therapay-start.vercel.app/onboarding.html . נבדקה גישה ישירה ללא מסך Vercel. נדרש להוסיף `https://therapay-start.vercel.app` ל־Authorized JavaScript origins בלקוח Google לפני התחברות מהכתובת החדשה.

התקדמות ההקמה נשמרת כעת בנפרד לכל מייל Google בדפדפן. התקדמות מהגרסה הקודמת מזוהה רק כאשר היא שייכת לחשבון הנוכחי; מעבר חשבון אינו מוחק התקדמות של חשבון אחר. הפרדת החשבונות נבדקה בבדיקות אוטומטיות; חיבור Google מהדומיין החדש עדיין מצריך בדיקה חיה לאחר עדכון origins.

## רישום וזרימת האשף
בכתובת HTTPS הרישום עובר דרך `/api/register` באתר, ומשם לשירות הרישום הקבוע של Apps Script, כדי שהדפדפן לא יהיה תלוי בהפניות של Apps Script. הנתיב מקבל שם ו־Google ID token בלבד; הוא דוחה מפתחות, סיסמאות, access token, פעולה חלופית או כתובת יעד אחרת. אין בו כתיבה ללוג או אחסון. האימות ורישום שלוש העמודות נשארים בשירות הרישום הפרטי. מפתחות Morning ונתוני הקליניקה ממשיכים להישלח ישירות לבקנד הפרטי, ולא דרך הנתיב הזה. בפיתוח מקומי נשמר מסלול הרישום הישיר.

בכל שלב יש כפתור ראשי אחד עם הפעולה הצפויה. חיבור Google מצליח מתקדם אוטומטית, וחיבור Morning מצליח טוען את הלקוחות וממשיך לבחירה. במצב של אישור Google נוסף מוצגים קישור אישור והסבר קצר, והכפתור התחתון ממשיך את הבדיקה. כשל אינו מקדם שלב ולחיצה כפולה נחסמת בזמן פעולה.

## אישור הרשאות ללא עורך קוד
מסלול הניסוי הוחלף: אם הבקנד הפרטי עדיין אינו מורשה להרצה, האשף מכין פריסת אישור נוספת באותו פרויקט. גרסת האישור מוגדרת `MYSELF` ו־`USER_ACCESSING`, ומשתמשת בדיוק באותם scopes של הבקנד. היא מציגה דף אישור/סיום רגיל; האשף אינו מציג עוד קישור לעורך או הוראות להרצת פונקציה.

הפריסה הפעילה של הבקנד אינה מתעדכנת. יצירת גרסת האישור משתמשת זמנית במקור העבודה, ושחזור המקור מתבצע ב־finally גם בכשל. הבדיקות מכסות בעלות, הרשאות פרטיות, שימור המקור, מניעת שינוי פרויקט זר ושימוש חוזר בפריסת אישור קיימת. אישור Google עצמו והעובדה שהוא מאפשר אחר כך את הרצת גרסת הבקנד דורשים עדיין אימות חי בחשבון המשתמש; בדיקות מדומות אינן מאמתות את מדיניות Google בזמן ריצה.

## שכחת סיסמת הקליניקה
במסך כניסה לקליניקה קיימת נוסף ״שכחתי את סיסמת הקליניקה״. הפעולה דורשת שוב OAuth לאותו חשבון Google ומכינה פריסת איפוס נפרדת, `MYSELF` / `USER_ACCESSING`, עם אותם scopes. הסיסמה החדשה נבחרת ונשמרת במסך Google הפרטי באמצעות google.script.run; היא אינה נשלחת לשרת Vercel או לגיליון ההפצה. שרת האיפוס בודק 16–256 תווים ואישור זהה, משתמש בנעילת הסקריפט, ומעדכן רק APP_ACCESS_TOKEN בקליניקה שכבר אותחלה. הפריסה הפעילה של הבקנד ומפתחות Morning אינם משתנים. מסך הסיום אינו מחזיר את הסיסמה ומנחה להיכנס איתה באשף. בדיקות מכסות אי־התאמת חשבון, פרטיות הפריסה, שינוי שדה יחיד, אישור סיסמה, מניעת לחיצה כפולה וניקוי השדות. התהליך החי עדיין מצריך בדיקה של בעל החשבון ואישוריו ב־Google.


### Personal Apps Script API permission
New accounts are guided through Google Apps Script API activation at https://script.google.com/home/usersettings before provisioning. The wizard displays the signed-in email, one primary settings link, then a check-and-continue action. Opening the link does not mark provisioning successful: actual Google operations must succeed. A script API 403 returns new accounts to the settings action with safe diagnostics; it may also mean denied scopes or a project API issue, so the UI asks users to verify the switch rather than asserting it is disabled. Existing private authorization and password-reset flows stay separate.


New clinic passwords require 8–256 characters, an ASCII uppercase letter, a digit and a non-letter/non-number/non-whitespace special character. Validation runs in onboarding, bootstrap, and the private reset page/client and server. Existing long passwords remain valid for login. Private reset deployment uses v2; a legacy backend with the 16-character authentication guard is refused before offering an 8-character reset to prevent lockout. Already deployed private backends need an owner-authorized upgrade; publishing the frontend alone cannot change those deployments.


### Owner-authorized password-policy upgrade
The Google connection and forgot-password preparation now call upgradePasswordPolicy. It verifies the owner, Drive marker, bound project, deployment ID and URL, reads the deployed version (not editor HEAD), changes only recognized password length/creation rules, creates a version and updates the same deployment. Scopes, access, URL, credentials, Sheet data and invoice behavior are preserved. Unpublished HEAD changes are restored and receive only the same narrow policy patch after a verified deployment. Failure or conflicting deployment stops progress. No local/private data is sent to the distributor. Applying this to a real clinic requires the owner to sign in and authorize the existing Google connection; no live clinic was upgraded during automated tests.


Remembered onboarding resources now check Drive trashed state before resuming. A confirmed trashed pilot Sheet discards only the current owner’s resource pointers, searches for any non-trashed existing pilot and otherwise provisions new resources. It never deletes or restores old files, reads their patient data, or reuses old backend credentials. Access failures, missing files and foreign markers do not automatically erase progress or create duplicate clinics. This correction affects the onboarding flow; existing direct clinic sessions are not invalidated merely by changing frontend code.


Google settings link is now secondary inside the instruction panel, with check-and-continue always available; navigation no longer depends on a click event surviving an Android external-tab transition. Partial project creation no longer masquerades as owner consent. Script API GET 404s are retried three times with bounded delays (0.5, 1.5, 3 seconds); writes are never automatically retried. Individual deployment reads have a distinct operation label. Freshly created backends skip the legacy password migration. These changes are mock tested; the reported live-account 404 needs a user retry to confirm its cause/repair.


### Resumable large Morning client loading
Client-list reads checkpoint after each successfully validated page, encrypted locally with AES-GCM and a PBKDF2-derived key from the clinic password (210,000 SHA-256 iterations, random salt and IV, owner/Sheet bound additional data). Raw client PII, clinic passwords, Morning keys and Google tokens are never stored as plaintext in this cache or sent to the registry. On the same browser/device, re-entering the clinic resumes loading after the last committed page; complete snapshots can reopen without fetching again. Read-only page calls retry transient failures up to twice; AUTH/MORNING_AUTH do not retry. Malformed, duplicate, changed and incomplete pages cannot replace a good checkpoint. Storage exhaustion leaves the last checkpoint intact and stops loading. Completed onboarding removes the cache. Incognito closure/site-data clearing removes the checkpoint; this is not server-side backup. Client selection is rendered in 40-row pages to bound mobile DOM/memory usage. This patch does not promise persistent saving of selection edits after loading; it addresses interruption during fetching.
