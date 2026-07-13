// Rectif immédiate : retirer Arthur (congé) des destinataires + seeder les rôles
// exemptés de pointage (patron/admin/manager ne pointent pas → pas de retard/no-show).
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

const REMOVE = 'kyriarthur@gmail.com';
const ref = db.doc('settings/alert_emails');
const cur = (await ref.get()).data() ?? {};

const strip = (arr) => (arr ?? []).filter(e => e.toLowerCase() !== REMOVE.toLowerCase());
const next = {
  responsables:   strip(cur.responsables),
  rhResponsables: strip(cur.rhResponsables),
  // Rôles qui NE pointent pas → exemptés de retard/no-show (modifiable dans Paramètres).
  rhExemptRoles:  Array.isArray(cur.rhExemptRoles) && cur.rhExemptRoles.length
                    ? cur.rhExemptRoles
                    : ['patron', 'administrateur', 'manager'],
};
await ref.set(next, { merge: true });
console.log('responsables   :', JSON.stringify(next.responsables));
console.log('rhResponsables :', JSON.stringify(next.rhResponsables));
console.log('rhExemptRoles  :', JSON.stringify(next.rhExemptRoles));
console.log(`\n✅ ${REMOVE} retiré des destinataires. Rôles exemptés seedés.`);

// Nettoie les faux marqueurs no-show des rôles exemptés (patron/admin/manager) non résolus.
const users = await db.collection('users').get();
const exemptEmpIds = new Set(
  users.docs.filter(u => u.data().employeeId && ['patron','administrateur','manager'].includes(u.data().role))
            .map(u => u.data().employeeId),
);
const ns = await db.collection('pointages_noshow').get();
let cleaned = 0;
for (const d of ns.docs) {
  const m = d.data();
  if (exemptEmpIds.has(m.employeeId) && !m.resolved) {
    await d.ref.update({ resolved: true, resolution: 'exempt_role', resolvedBy: 'system-fix' });
    cleaned++;
  }
}
console.log(`🧹 ${cleaned} faux marqueur(s) no-show (rôle exempté) classé(s) résolus.`);
