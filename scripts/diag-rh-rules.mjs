// État des règles d'alerte RH : destinataires + qui est flaggé + liens manager.
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

// 1) Destinataires actuels
const ae = (await db.doc('settings/alert_emails').get()).data() ?? {};
console.log('=== settings/alert_emails ===');
console.log('  responsables   :', JSON.stringify(ae.responsables ?? []));
console.log('  rhResponsables :', JSON.stringify(ae.rhResponsables ?? '(absent)'));

// 2) Employés liés à un compte patron/admin/manager (ne pointent pas → à exempter)
console.log('\n=== Employés liés à un compte patron/admin/manager (candidats exemption) ===');
const users = await db.collection('users').get();
const empToRole = {};
for (const u of users.docs) {
  const d = u.data();
  if (d.employeeId && ['patron', 'administrateur', 'manager'].includes(d.role)) {
    empToRole[d.employeeId] = { role: d.role, email: d.email };
  }
}
for (const [empId, info] of Object.entries(empToRole)) {
  const emp = await db.doc(`employees/${empId}`).get();
  console.log(`  ${emp.data()?.name ?? '?'} (empId=${empId}) → role=${info.role} ${info.email}`);
}
if (!Object.keys(empToRole).length) console.log('  (aucun employé planning lié à un compte patron/admin/manager)');

// 3) Marqueurs no-show récents (source potentielle du spam)
console.log('\n=== pointages_noshow — 15 plus récents ===');
const ns = await db.collection('pointages_noshow').get();
const rows = ns.docs.map(d => ({ id: d.id, ...d.data() }))
  .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  .slice(0, 15);
for (const r of rows) {
  const role = empToRole[r.employeeId]?.role ?? 'ops/employé';
  console.log(`  ${r.date}  ${r.employeeName} (${role})  prévu ${r.plannedStartHour}h  resolved=${r.resolved ?? false}`);
}

console.log('\n=== FIN ===');
