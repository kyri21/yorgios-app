#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  fix.sh — Corrige les fichiers du projet en place
#  Exécuter depuis le dossier yorgios-app/ :
#    bash fix.sh
# ═══════════════════════════════════════════════════════════════
set -e
cd "$(dirname "$0")"
echo ""
echo "🔧 Correction des scripts de migration…"
echo ""

# ── 1. Corriger l'import XLSX dans tous les scripts ─────────
for f in scripts/migrate_produits.mjs scripts/migrate_temperatures.mjs \
          scripts/migrate_hygiene.mjs scripts/migrate_livraisons.mjs \
          scripts/migrate_vitrine.mjs scripts/migrate_objectifs.mjs; do
  if [ -f "$f" ]; then
    sed -i "s|import \* as XLSX from 'xlsx';|import { createRequire } from 'module'; const require = createRequire(import.meta.url); const XLSX = require('xlsx');|g" "$f"
    echo "  ✅ $f — import XLSX corrigé"
  fi
done

# ── 2. Corriger .firebaserc → cuisine-yorgios ───────────────
cat > .firebaserc << 'RC'
{
  "projects": {
    "default": "cuisine-yorgios"
  }
}
RC
echo "  ✅ .firebaserc → cuisine-yorgios"

# ── 3. Écrire migrate_from_planning.mjs (manquant) ──────────
cat > scripts/migrate_from_planning.mjs << 'MIGRATE_PLANNING'
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
MIGRATE_PLANNING
echo "  ✅ scripts/migrate_from_planning.mjs créé"

# ── 4. Corriger _firebase_admin.mjs pour utiliser require ───
cat > scripts/_firebase_admin.mjs << 'ADMIN'
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const KEY_PATHS = [
  resolve(__dirname, '../secrets/firebase-admin.json'),
  resolve(__dirname, '../../pms-cuisine/secrets/firebase-admin.json'),
  resolve(__dirname, '../../secrets/firebase-admin.json'),
];

const found = KEY_PATHS.find(p => existsSync(p));
if (found) {
  const sa = JSON.parse(readFileSync(found, 'utf8'));
  if (!admin.apps.find(a => a.name === '[DEFAULT]')) {
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  console.log(`🔑 Clé chargée : ${found}`);
} else {
  if (!admin.apps.find(a => a.name === '[DEFAULT]')) {
    admin.initializeApp();
  }
  console.log('🔑 Clé non trouvée → utilise GOOGLE_APPLICATION_CREDENTIALS');
}

export const db = admin.firestore('test');
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function batchWrite(collection, docs) {
  const CHUNK = 400; let total = 0;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = db.batch();
    docs.slice(i, i + CHUNK).forEach(({ id, data }) => {
      const ref = id ? db.collection(collection).doc(id) : db.collection(collection).doc();
      batch.set(ref, data, { merge: true });
    });
    await batch.commit();
    total += Math.min(CHUNK, docs.length - i);
    console.log(`  → ${total}/${docs.length} docs`);
    await sleep(300);
  }
  console.log(`✅ ${collection} : ${total} docs migrés`);
}
ADMIN
echo "  ✅ scripts/_firebase_admin.mjs corrigé"

# ── 5. Sélectionner le bon projet Firebase ──────────────────
echo ""
echo "🔗 Liaison avec cuisine-yorgios…"
firebase use cuisine-yorgios 2>/dev/null || echo "  (firebase use à faire manuellement si erreur)"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  ✅ Corrections appliquées                               ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║                                                          ║"
echo "║  Avant de relancer les migrations :                     ║"
echo "║                                                          ║"
echo "║  1. Remplir .env.local avec les clés cuisine-yorgios    ║"
echo "║     (Firebase Console → cuisine-yorgios → ⚙️ → SDK)    ║"
echo "║                                                          ║"
echo "║  2. Copier la clé admin cuisine :                       ║"
echo "║     cp ../pms-cuisine/secrets/firebase-admin.json \     ║"
echo "║        secrets/firebase-admin.json                      ║"
echo "║                                                          ║"
echo "║  3. Placer les Excel dans reference/data/               ║"
echo "║                                                          ║"
echo "║  4. Relancer :                                          ║"
echo "║     cd scripts && node migrate_all.mjs                  ║"
echo "║                                                          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
