// Diag no-show Oreline — partie 3 : reconstruit la décision de detectNoShow
// pour chaque jour PASSÉ où la fiche liée était prévue.
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

const EMP = 'Vyv8CTfKmlNBpc91ULgG';        // Oreline liée
const USER = 'ZbT51CXfv8ZucejUZPR9GdxL71o2';
const today = new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });

// Échantillon de pointages pour confirmer le format des champs
const sample = await db.collection('pointages').where('userId', '==', USER).limit(6).get();
console.log(`=== ÉCHANTILLON POINTAGES Oreline (${sample.size}) — champs réels ===`);
sample.docs.forEach(d => { const p = d.data(); console.log(`  date=${p.date} type=${p.typePointage} statut=${p.statut}`); });

// Toutes les semaines, jours où EMP est prévue, dans le passé (<= today)
const weeks = await db.collection('planningWeeks').get();
const rows = [];
for (const w of weeks.docs) {
  const daysSnap = await db.collection(`planningWeeks/${w.id}/days`).get();
  for (const day of daysSnap.docs) {
    const dayIndex = parseInt(day.id);
    const hoursMap = day.data()?.hours || {};
    let firstHour;
    for (const [h, emps] of Object.entries(hoursMap)) {
      if (emps.includes(EMP)) { const hr = parseInt(h); if (firstHour === undefined || hr < firstHour) firstHour = hr; }
    }
    if (firstHour === undefined) continue;
    // date ISO du jour
    const monday = new Date(w.id + 'T12:00:00Z');
    const d = new Date(monday); d.setUTCDate(d.getUTCDate() + dayIndex);
    const dateISO = d.toISOString().slice(0, 10);
    if (dateISO > today) continue;   // futur → ignore
    rows.push({ dateISO, weekId: w.id, dayIndex, firstHour });
  }
}
rows.sort((a, b) => a.dateISO.localeCompare(b.dateISO));

console.log(`\n=== HISTORIQUE (${rows.length} jours prévus passés) ===`);
for (const r of rows) {
  // couverte par event ?
  const ev = await db.doc(`planningWeeks/${r.weekId}/events/${r.dateISO}`).get();
  const events = ev.exists ? (ev.data()?.events ?? []) : [];
  const cover = events.find(e => e.empId === EMP && ['conge','malade','absence','sans_solde','jour_off'].includes(e.type));
  // pointée ?
  const arr = await db.collection('pointages').where('userId','==',USER).where('date','==',r.dateISO)
    .where('typePointage','==','arrivée').where('statut','==','validé').limit(1).get();
  // marqueur ?
  const marker = await db.doc(`pointages_noshow/${r.dateISO}_${EMP}`).get();

  let verdict;
  if (cover) verdict = `OK couverte (${cover.type})`;
  else if (!arr.empty) verdict = 'OK pointée';
  else if (marker.exists) verdict = '✅ ALERTÉE (marqueur présent)';
  else verdict = '🔴 RATÉ — prévue, non couverte, non pointée, AUCUN marqueur';

  console.log(`  ${r.dateISO} (j${r.dayIndex}, dès ${r.firstHour}h) → ${verdict}`);
}
console.log('\n=== FIN DIAG 3 ===');
