/**
 * MIGRATION : planning-yorgios-3bdb2 → cuisine-yorgios
 * Copie les collections : users, employees, planningWeeks
 *
 * PRÉREQUIS :
 *   secrets/firebase-admin.json          ← clé cuisine-yorgios (depuis pms-cuisine)
 *   secrets/firebase-admin-planning.json ← clé planning-yorgios-3bdb2
 *
 * Pour obtenir la clé planning :
 *   Firebase Console → planning-yorgios-3bdb2 → ⚙️ → Comptes de service
 *   → Générer une nouvelle clé privée → sauvegarder sous secrets/firebase-admin-planning.json
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const CUISINE_KEY  = resolve(__dirname, '../secrets/firebase-admin.json');
const PLANNING_KEY = resolve(__dirname, '../secrets/firebase-admin-planning.json');

if (!existsSync(CUISINE_KEY)) {
  console.error(`❌ Clé manquante : secrets/firebase-admin.json
  → Copier depuis : pms-cuisine/secrets/firebase-admin.json`);
  process.exit(1);
}
if (!existsSync(PLANNING_KEY)) {
  console.error(`❌ Clé manquante : secrets/firebase-admin-planning.json
  → Firebase Console → planning-yorgios-3bdb2 → ⚙️ Comptes de service → Générer clé privée`);
  process.exit(1);
}

const planningApp = admin.initializeApp(
  { credential: admin.credential.cert(JSON.parse(readFileSync(PLANNING_KEY, 'utf8'))) },
  'planning'
);
const cuisineApp = admin.initializeApp(
  { credential: admin.credential.cert(JSON.parse(readFileSync(CUISINE_KEY, 'utf8'))) },
  'cuisine'
);

const srcDb  = planningApp.firestore();
const destDb = cuisineApp.firestore('test');

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║   Migration planning-yorgios → cuisine-yorgios      ║');
console.log('╚══════════════════════════════════════════════════════╝');

async function copyCollection(name) {
  console.log(`\n━━━ ${name} ━━━`);
  const snap = await srcDb.collection(name).get();
  if (snap.empty) { console.log('  ⚠️  Vide'); return 0; }
  console.log(`  ${snap.size} docs trouvés`);
  const CHUNK = 400; let total = 0;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = destDb.batch();
    docs.slice(i, i + CHUNK).forEach(doc => {
      batch.set(
        destDb.collection(name).doc(doc.id),
        { ...doc.data(), migrated_from: 'planning-yorgios-3bdb2', migrated_at: new Date() },
        { merge: true }
      );
    });
    await batch.commit();
    total += Math.min(CHUNK, docs.length - i);
    console.log(`  → ${total}/${docs.size} écrits`);
    await sleep(300);
  }
  console.log(`  ✅ ${name} : ${total} docs`);
  return total;
}

async function main() {
  let total = 0;
  total += await copyCollection('users');
  total += await copyCollection('employees');
  total += await copyCollection('planningWeeks');
  console.log(`\n✅ Migration terminée — ${total} documents au total`);
  console.log(`
⚠️  Auth Firebase (comptes email/password) → à migrer séparément :
   firebase use planning-yorgios-3bdb2
   firebase auth:export /tmp/users_export.json --format=json
   firebase use cuisine-yorgios
   firebase auth:import /tmp/users_export.json
`);
}
main().catch(e => { console.error('❌', e.message); process.exit(1); });
