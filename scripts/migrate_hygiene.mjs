/**
 * MIGRATION : Hygiène.xlsx → Firestore collection "hygiene_corner"
 *
 * Onglets source : Quotidien (1042 lignes), Hebdomadaire (31), Mensuel (12)
 * Colonnes : Date | Tâche1 | Tâche2 | … (✅ ou vide)
 *
 * Doc Firestore ID : "{type}-{YYYY-MM-DD}"
 * Ex : "Quotidien-2025-04-08"
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module'; const require = createRequire(import.meta.url); const XLSX = require('xlsx');
import { batchWrite } from './_firebase_admin.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(__dirname, '../reference/data/Hygiene.xlsx');
// Si le fichier a un nom avec accent, essayer les deux
const FILE_ALT = resolve(__dirname, '../reference/data/Hygiène.xlsx');

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) {
    return val.toISOString().split('T')[0]; // YYYY-MM-DD
  }
  const s = String(val).trim();
  // Format DD/MM/YYYY
  const m1 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2]}-${m1[1]}`;
  // Format YYYY-MM-DD
  const m2 = s.match(/^\d{4}-\d{2}-\d{2}/);
  if (m2) return m2[0];
  return null;
}

async function migrateSheet(ws, type) {
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  const docs = [];

  for (const row of rows) {
    const date = parseDate(row['Date']);
    if (!date) continue;

    // Toutes les colonnes sauf "Date" → tâches
    const taches = {};
    for (const [col, val] of Object.entries(row)) {
      if (col === 'Date') continue;
      taches[col] = String(val).trim() === '✅';
    }

    docs.push({
      id: `${type}-${date}`,
      data: {
        type,
        date,
        taches,
        source:     'migration_v1',
        updated_at: new Date(),
      }
    });
  }
  console.log(`  ${type} : ${docs.length} lignes`);
  return docs;
}

async function main() {
  console.log('🧼 Migration hygiène corner…');
  
  const { existsSync } = await import('fs');
  const filePath = existsSync(FILE) ? FILE : FILE_ALT;

  const wb = XLSX.readFile(filePath);
  const allDocs = [];

  for (const type of ['Quotidien', 'Hebdomadaire', 'Mensuel']) {
    if (!wb.SheetNames.includes(type)) {
      console.warn(`  ⚠️ Onglet "${type}" introuvable`);
      continue;
    }
    const docs = await migrateSheet(wb.Sheets[type], type);
    allDocs.push(...docs);
  }

  console.log(`  Total : ${allDocs.length} relevés à migrer`);
  await batchWrite('hygiene_corner', allDocs);
}

main().catch(e => { console.error(e); process.exit(1); });
