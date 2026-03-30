/**
 * Lance toutes les migrations dans l'ordre.
 * Usage : node migrate_all.mjs
 *
 * Ordre important :
 * 1. produits     → doit être fait en premier (les autres collections le référencent)
 * 2. temperatures
 * 3. hygiene
 * 4. livraisons
 * 5. vitrine
 * 6. objectifs
 */
import { execSync } from 'child_process';

const SCRIPTS = [
  { name: 'Produits',      file: 'migrate_produits.mjs' },
  { name: 'Températures',  file: 'migrate_temperatures.mjs' },
  { name: 'Hygiène',       file: 'migrate_hygiene.mjs' },
  { name: 'Livraisons',    file: 'migrate_livraisons.mjs' },
  { name: 'Vitrine',       file: 'migrate_vitrine.mjs' },
  { name: 'Objectifs CA',  file: 'migrate_objectifs.mjs' },
];

console.log('╔══════════════════════════════════════╗');
console.log('║  Migration complète V1 → Firestore  ║');
console.log('╚══════════════════════════════════════╝\n');

let ok = 0, ko = 0;

for (const { name, file } of SCRIPTS) {
  console.log(`\n━━━ ${name} ━━━`);
  try {
    execSync(`node ${file}`, { stdio: 'inherit', cwd: import.meta.dirname ?? '.' });
    ok++;
  } catch (e) {
    console.error(`❌ Erreur dans ${file}`);
    ko++;
  }
}

console.log(`\n╔══════════════════════════════╗`);
console.log(`║  ✅ ${ok} réussi(s)  ❌ ${ko} échoué(s)  ║`);
console.log(`╚══════════════════════════════╝`);
