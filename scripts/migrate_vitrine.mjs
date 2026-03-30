/**
 * MIGRATION : europoseidon_liaison.xlsx (onglet "Vitrine")
 *             → Firestore collection "corner_stock"
 *
 * Colonnes source : date_ajout | produit | numero_de_lot | date_fab | dlc | date_retrait
 * 3917 lignes existantes
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module'; const require = createRequire(import.meta.url); const XLSX = require('xlsx');
import { batchWrite } from './_firebase_admin.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(__dirname, '../reference/data/europoseidon_liaison.xlsx');

function parseDate(val) {
  if (!val) return '';
  if (val instanceof Date) return val.toISOString().split('T')[0];
  return String(val).trim().split('T')[0] || '';
}

async function main() {
  console.log('🖥️  Migration vitrine…');
  const wb = XLSX.readFile(FILE, { cellDates: true });
  const ws = wb.Sheets['Vitrine'];
  if (!ws) { console.error('Onglet "Vitrine" introuvable'); process.exit(1); }

  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  console.log(`  ${rows.length} lignes à migrer`);

  const docs = rows
    .filter(r => r['produit']?.toString().trim())
    .map((r, i) => ({
      id: `v1_vitrine_${String(i + 1).padStart(5, '0')}`,
      data: {
        produit:       String(r['produit'] || '').trim(),
        date_ajout:    parseDate(r['date_ajout']),
        date_fab:      parseDate(r['date_fab']),
        dlc:           parseDate(r['dlc']),
        date_retrait:  parseDate(r['date_retrait']),
        numero_de_lot: String(r['numero_de_lot'] || '').trim(),
        source:        'migration_v1',
        updated_at:    new Date(),
      }
    }));

  await batchWrite('corner_stock', docs);
}

main().catch(e => { console.error(e); process.exit(1); });
