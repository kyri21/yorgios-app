/**
 * MIGRATION : releve_temperature.xlsx → Firestore collection "temperatures"
 *
 * Structure source : un onglet par semaine ("Semaine 16 2025", etc.)
 * Chaque onglet a 7 lignes (frigos) × 14 colonnes (Lundi Matin … Dimanche Soir)
 *
 * Doc Firestore ID : "{annee}-S{semaine}-{frigo_slug}"
 * Ex : "2025-S16-frigo_1"
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module'; const require = createRequire(import.meta.url); const XLSX = require('xlsx');
import { db, batchWrite } from './_firebase_admin.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(__dirname, '../reference/data/releve_temperature.xlsx');

const JOURS = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
const MOMENTS = ['Matin','Soir'];

function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .normalize('NFD').replace(/\p{Diacritic}/gu,'')
    .replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
}

function parseTemp(val) {
  if (val === null || val === undefined || val === '') return null;
  // Excel peut retourner un objet Date pour des valeurs comme "1.4" mal formatées
  if (val instanceof Date) return null;
  const n = parseFloat(String(val).replace(',', '.'));
  return isNaN(n) ? null : n;
}

function parseSemaine(title) {
  // "Semaine 16 2025" → { semaine: 16, annee: 2025 }
  const m = title.match(/(\d+)\s+(\d{4})/);
  if (!m) return null;
  return { semaine: parseInt(m[1]), annee: parseInt(m[2]) };
}

async function main() {
  console.log('🌡️  Migration températures…');
  const wb = XLSX.readFile(FILE);
  const docs = [];

  for (const sheetName of wb.SheetNames) {
    const parsed = parseSemaine(sheetName);
    if (!parsed) { console.warn(`  ⚠️ Onglet ignoré : ${sheetName}`); continue; }
    const { semaine, annee } = parsed;

    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    for (const row of rows) {
      const frigoRaw = String(row['Frigo/Vitrine'] || '').trim();
      if (!frigoRaw) continue;

      // Construire l'objet releves { "Lundi Matin": 2.1, ... }
      const releves = {};
      for (const jour of JOURS) {
        for (const moment of MOMENTS) {
          // Tolérance sur la clé "Mecredi" (faute dans la V1)
          const key = jour === 'Mercredi'
            ? (row[`Mercredi ${moment}`] !== undefined ? `Mercredi ${moment}` : `Mecredi ${moment}`)
            : `${jour} ${moment}`;
          releves[`${jour} ${moment}`] = parseTemp(row[key]);
        }
      }

      docs.push({
        id: `${annee}-S${String(semaine).padStart(2,'0')}-${slugify(frigoRaw)}`,
        data: {
          frigo:         frigoRaw,
          semaine,
          annee,
          semaine_label: sheetName,
          releves,
          source:        'migration_v1',
          updated_at:    new Date(),
        }
      });
    }
  }

  console.log(`  ${docs.length} relevés à migrer (${wb.SheetNames.length} semaines)`);
  await batchWrite('temperatures', docs);
}

main().catch(e => { console.error(e); process.exit(1); });
