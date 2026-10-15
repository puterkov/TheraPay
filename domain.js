export function today(date = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year','month','day'].map(t => p.find(x => x.type === t).value).join('-');
}
export const money = value => new Intl.NumberFormat('he-IL', { style:'currency', currency:'ILS', maximumFractionDigits:2 }).format(value);
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const d = new Date(value + 'T12:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0,10) === value;
}
export function defaultSelection(appointments, patientId, month) {
  return new Set(appointments.filter(a => a.patientId === patientId && !a.isPaid && validDate(a.date) && a.date < month + '-01').map(a => a.id));
}
export function selectedAppointments(appointments, ids, patientId) {
  return appointments.filter(a => ids.has(a.id) && a.patientId === patientId && !a.isPaid);
}
export function total(appointments) { return appointments.reduce((sum,a) => sum + Math.round(a.amount * 100),0) / 100; }
export function phoneForWhatsApp(value) {
  let digits = String(value || '').replace(/\D/g,'');
  if (digits.startsWith('00972')) digits = digits.slice(2);
  if (/^0[2-9]\d{7,8}$/.test(digits)) digits = '972' + digits.slice(1);
  if (/^972[2-9]\d{7,8}$/.test(digits)) return digits;
  throw new Error('מספר הטלפון חסר או אינו תקין. יש לעדכן את הטלפון בגיליון.');
}
export const displayDate = date => validDate(date) ? new Intl.DateTimeFormat('he-IL', { day:'numeric', month:'long', year:'numeric', timeZone:'UTC' }).format(new Date(date)) : 'תאריך חסר';
export function paymentMessage(patient, appointments, signature = '') {
  const months = [...new Set(appointments.map(a => a.date.slice(0,7)))].sort().map(m => new Intl.DateTimeFormat('he-IL', {month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(m+'-01')));
  return `שלום ${patient.name},\nתזכורת לתשלום עבור הפגישות בחודשים ${months.join(', ')}.\nתאריכי הפגישות: ${appointments.map(a => a.date.split('-').reverse().join('.')).join(', ')}.\nסה״כ לתשלום: ${money(total(appointments))}.\nתודה רבה${signature ? ', '+signature : ''}`;
}
