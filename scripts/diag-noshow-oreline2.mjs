// Diag no-show Oreline — partie 2 : heure courante, pointages du jour,
// et surtout OÙ les fiches doublons non liées apparaissent dans le planning.
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

const LINKED = 'Vyv8CTfKmlNBpc91ULgG';                 // Oreline liée (active)
const UNLINKED = ['HZol9dKjypvFyeaXF8WG', 'LytHKbR2zEIDlmWEbcir']; // doublons non liés
const USER = 'ZbT51CXfv8ZucejUZPR9GdxL71o2';           // compte Oreline

// Heure courante Paris
const now = new Date();
const parisNow = now.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
const today = now.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
console.log(`\n=== MAINTENANT (Paris) : ${parisNow}  |  today=${today} ===`);

// Pointages d'Oreline aujourd'hui (tous types)
const ptSnap = await db.collection('pointages').where('userId', '==', USER).where('date', '==', today).get();
console.log(`\n=== POINTAGES Oreline aujourd'hui (${ptSnap.size}) ===`);
ptSnap.docs.forEach(d => { const p = d.data(); console.log(`  ${d.id} type=${p.typePointage} statut=${p.statut} heure=${p.heure ?? '-'}`); });

// Scan de TOUTES les semaines de planning : où apparaissent les empIds (liée + doublons) ?
console.log(`\n=== SCAN PLANNING — occurrences par empId (semaine/jour) ===`);
const weeks = await db.collection('planningWeeks').get();
const hits = { [LINKED]: [], [UNLINKED[0]]: [], [UNLINKED[1]]: [] };
for (const w of weeks.docs) {
  const daysSnap = await db.collection(`planningWeeks/${w.id}/days`).get();
  for (const day of daysSnap.docs) {
    const hoursMap = day.data()?.hours || {};
    const present = new Set();
    for (const emps of Object.values(hoursMap)) for (const id of emps) present.add(id);
    for (const id of [LINKED, ...UNLINKED]) {
      if (present.has(id)) hits[id].push(`${w.id}/j${day.id}`);
    }
  }
}
for (const [id, list] of Object.entries(hits)) {
  const tag = id === LINKED ? 'LIÉE ✅' : 'DOUBLON NON LIÉ ❌';
  console.log(`  ${id} (${tag}) : ${list.length} jour(s) planifié(s)`);
  if (list.length) console.log(`      ${list.slice(-15).join(', ')}${list.length > 15 ? ' …' : ''}`);
}

console.log('\n=== FIN DIAG 2 ===');
