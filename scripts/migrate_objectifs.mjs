/**
 * MIGRATION : europoseidon_liaison.xlsx (onglet "Objectifs")
 *             → Firestore collection "objectifs_ca"
 *
 * Colonnes source : Objectif valeur | Ht | Résultat
 * 13 lignes (Janvier → Janvier suivant)
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module'; const require = createRequire(import.meta.url); const XLSX = require('xlsx');
import { batchWrite } from './_firebase_admin.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(__dirname, '../reference/data/europoseidon_liaison.xlsx');

function parseNum(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = parseFloat(String(val).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
}

function slugMois(mois) {
  return String(mois || '').normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().trim().replace(/\s+/g, '_');
}

async function main() {
  console.log('📊 Migration objectifs CA…');
  const wb = XLSX.readFile(FILE);
  const ws = wb.Sheets['Objectifs'];
  if (!ws) { console.error('Onglet "Objectifs" introuvable'); process.exit(1); }

  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  const docs = rows
    .filter(r => r['Objectif valeur']?.toString().trim())
    .map(r => {
      const mois = String(r['Objectif valeur']).trim();
      const ht   = parseNum(r['Ht']);
      const res  = parseNum(r['Résultat']);
      return {
        id: slugMois(mois),
        data: {
          mois,
          objectif_ht: ht,
          resultat:    res,
          prime:       (ht !== null && res !== null) ? (res >= ht ? '✅' : '❌') : '',
          source:      'migration_v1',
          updated_at:  new Date(),
        }
      };
    });

  console.log(`  ${docs.length} mois à migrer`);
  await batchWrite('objectifs_ca', docs);
}

main().catch(e => { console.error(e); process.exit(1); });
