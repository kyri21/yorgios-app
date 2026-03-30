/**
 * MIGRATION : europoseidon_liaison.xlsx (onglet "Livraison Température")
 *             → Firestore collection "livraisons"
 *
 * Colonnes source :
 *   Produit | Température départ (°C) | Horodatage départ |
 *   Température réception (°C) | Dénomination GEP | Résultat réception | Lien photo
 *
 * 83 lignes existantes
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module'; const require = createRequire(import.meta.url); const XLSX = require('xlsx');
import { FieldValue } from 'firebase-admin/firestore';
import { batchWrite } from './_firebase_admin.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(__dirname, '../reference/data/europoseidon_liaison.xlsx');

function parseTemp(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = parseFloat(String(val).replace(',', '.'));
  return isNaN(n) ? null : n;
}

function parseTimestamp(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  const s = String(val).trim();
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

async function main() {
  console.log('🚚 Migration livraisons…');
  const wb = XLSX.readFile(FILE, { cellDates: true });
  const ws = wb.Sheets['Livraison Température'];
  if (!ws) { console.error('Onglet "Livraison Température" introuvable'); process.exit(1); }

  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  console.log(`  ${rows.length} lignes à migrer`);

  const docs = rows
    .filter(r => r['Produit']?.toString().trim())
    .map((r, i) => {
      const tempDep = parseTemp(r['Température départ (°C)']);
      const tempRec = parseTemp(r['Température réception (°C)']);
      const hDep    = parseTimestamp(r['Horodatage départ']);

      return {
        id: `v1_liv_${String(i + 1).padStart(4, '0')}`,
        data: {
          produit:              String(r['Produit']).trim(),
          denomination_gep:     String(r['Dénomination GEP'] || '').trim(),
          temp_depart:          tempDep,
          horodatage_depart:    hDep,
          temp_reception:       tempRec,
          horodatage_reception: null,   // non disponible dans la V1
          resultat:             String(r['Résultat réception'] || '').trim(),
          photo_url:            String(r['Lien photo'] || '').trim(),
          source:               'migration_v1',
          updated_at:           new Date(),
        }
      };
    });

  await batchWrite('livraisons', docs);
}

main().catch(e => { console.error(e); process.exit(1); });
