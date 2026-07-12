// Diagnostic no-show pour "Oreline" — lecture seule.
// Reproduit la logique de detectNoShow pour voir POURQUOI elle est (ou non) alertée.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY = resolve(__dirname, '../cuisine-yorgios-firebase-adminsdk-fbsvc-1c759ed390.json');
const sa = JSON.parse(readFileSync(KEY, 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore('test');

// 1) Fiche(s) employé Oreline
const empSnap = await db.collection('employees').get();
const orelines = empSnap.docs.filter(d => (d.data().name || '').toLowerCase().includes('oreline'));
console.log(`\n=== EMPLOYÉS "Oreline" : ${orelines.length} ===`);
for (const d of orelines) {
  const e = d.data();
  console.log(`  id=${d.id}  name="${e.name}"  active=${e.active}  suspended=${e.suspended}  subStatus=${e.subStatus ?? '-'}`);
}
const orelineIds = orelines.map(d => d.id);

// 2) Lien compte utilisateur (users.employeeId == empId)
console.log(`\n=== LIEN COMPTE (users.employeeId) ===`);
for (const empId of orelineIds) {
  const us = await db.collection('users').where('employeeId', '==', empId).get();
  if (us.empty) {
    console.log(`  empId=${empId} → ❌ AUCUN compte lié`);
  } else {
    us.docs.forEach(u => console.log(`  empId=${empId} → ✅ user=${u.id} email=${u.data().email} role=${u.data().role} displayName=${u.data().displayName ?? '-'}`));
  }
}
// Y a-t-il un user "oreline" par email/nom mais SANS employeeId (ou pointant ailleurs) ?
const usByName = (await db.collection('users').get()).docs.filter(u => {
  const s = JSON.stringify(u.data()).toLowerCase();
  return s.includes('oreline');
});
console.log(`\n=== USERS contenant "oreline" (email/nom) : ${usByName.length} ===`);
usByName.forEach(u => console.log(`  user=${u.id} email=${u.data().email} role=${u.data().role} employeeId=${u.data().employeeId ?? '(non lié)'}`));

// 3) Planning du jour — Oreline est-elle prévue ? sous quel empId ?
const today = new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
const dateObj = new Date(today + 'T12:00:00Z');
const jsDay = dateObj.getUTCDay();
const dayIndex = jsDay === 0 ? 6 : jsDay - 1;
const monday = new Date(dateObj); monday.setUTCDate(monday.getUTCDate() - dayIndex);
const weekId = monday.toISOString().slice(0, 10);
console.log(`\n=== PLANNING today=${today} weekId=${weekId} dayIndex=${dayIndex} ===`);
const daySnap = await db.doc(`planningWeeks/${weekId}/days/${dayIndex}`).get();
if (!daySnap.exists) {
  console.log(`  ❌ planningWeeks/${weekId}/days/${dayIndex} n'existe pas`);
} else {
  const hoursMap = daySnap.data()?.hours || {};
  const firstHourByEmp = {};
  for (const [h, emps] of Object.entries(hoursMap)) {
    for (const empId of emps) {
      const hour = parseInt(h);
      if (firstHourByEmp[empId] === undefined || hour < firstHourByEmp[empId]) firstHourByEmp[empId] = hour;
    }
  }
  const scheduled = Object.keys(firstHourByEmp);
  console.log(`  empIds prévus aujourd'hui (${scheduled.length}): ${scheduled.join(', ')}`);
  for (const empId of orelineIds) {
    const prevue = firstHourByEmp[empId] !== undefined ? ('✅ dès ' + firstHourByEmp[empId] + 'h') : '❌ non planifiée ce jour';
    console.log(`  Oreline empId=${empId} prévue ? ${prevue}`);
  }
}

// 4) Events du jour couvrant Oreline (congé/maladie/absence...)
const evSnap = await db.doc(`planningWeeks/${weekId}/events/${today}`).get();
const events = evSnap.exists ? (evSnap.data()?.events ?? []) : [];
console.log(`\n=== EVENTS du jour (${events.length}) concernant Oreline ===`);
events.filter(e => orelineIds.includes(e.empId)).forEach(e => console.log(`  empId=${e.empId} type=${e.type}`));

// 5) Marqueurs no-show existants pour Oreline (idempotence)
console.log(`\n=== MARQUEURS pointages_noshow pour Oreline ===`);
const nsSnap = await db.collection('pointages_noshow').get();
const nsOreline = nsSnap.docs.filter(d => orelineIds.includes(d.data().employeeId) || (d.data().employeeName || '').toLowerCase().includes('oreline') || d.id.toLowerCase().includes('oreline'));
if (!nsOreline.length) console.log('  (aucun)');
nsOreline.forEach(d => console.log(`  ${d.id} → ${JSON.stringify(d.data())}`));

console.log('\n=== FIN DIAG ===');
