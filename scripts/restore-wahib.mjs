// Restauration de la fiche employé "Wahib" désactivée par erreur (active:false).
// Usage :
//   node restore-wahib.mjs         → lecture seule (dry-run), affiche l'état
//   node restore-wahib.mjs --write → réactive la fiche (active:true, suspended:false)
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY = resolve(__dirname, '../cuisine-yorgios-firebase-adminsdk-fbsvc-1c759ed390.json');
const sa = JSON.parse(readFileSync(KEY, 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore('test');

const WRITE = process.argv.includes('--write');

const snap = await db.collection('employees').get();
const matches = snap.docs.filter(d => {
  const n = (d.data().name || '').trim().toLowerCase();
  return n === 'wahib' || n.includes('wahib');
});

console.log(`\n🔎 ${matches.length} fiche(s) correspondant à "Wahib" :\n`);
for (const d of matches) {
  const e = d.data();
  console.log(`  id=${d.id}`);
  console.log(`    name      : ${e.name}`);
  console.log(`    active    : ${e.active}`);
  console.log(`    suspended : ${e.suspended}`);
  console.log(`    subStatus : ${e.subStatus ?? '(aucun)'}`);
  console.log('');
}

if (matches.length !== 1) {
  console.error(`⛔ Attendu exactement 1 fiche, trouvé ${matches.length}. Aucune écriture.`);
  process.exit(1);
}

const ref = matches[0].ref;
if (!WRITE) {
  console.log('ℹ️  DRY-RUN — relancer avec --write pour réactiver la fiche.');
  process.exit(0);
}

await ref.update({ active: true, suspended: false, updatedAt: FieldValue.serverTimestamp() });
console.log('✅ Fiche Wahib réactivée (active:true, suspended:false).');
