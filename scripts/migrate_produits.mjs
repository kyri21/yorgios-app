/**
 * MIGRATION : Liste_produits_Yorgios.xlsx → Firestore collection "produits"
 *
 * Structure source (onglet "Produits") :
 *   Produit | Abréviation | catégorie | Dénomination GEP
 *
 * Règles DLC et températures par catégorie GEP (issues de la V1 Streamlit) :
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module'; const require = createRequire(import.meta.url); const XLSX = require('xlsx');
import { db, batchWrite } from './_firebase_admin.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(__dirname, '../reference/data/Liste_produits_Yorgios.xlsx');

// Règles GEP identiques à la V1 (app_yorgios_v1.py → GEP_RULES)
const GEP_RULES = {
  'légume':             { dlc_jours: 5,  temp_max: 8.0,  temp_max_tol: 10.0 },
  'legume':             { dlc_jours: 5,  temp_max: 8.0,  temp_max_tol: 10.0 },
  'viande hachée':      { dlc_jours: 2,  temp_max: 2.0,  temp_max_tol: 3.0  },
  'viande hachee':      { dlc_jours: 2,  temp_max: 2.0,  temp_max_tol: 3.0  },
  'viande':             { dlc_jours: 3,  temp_max: 3.0,  temp_max_tol: 5.0  },
  'lait':               { dlc_jours: 4,  temp_max: 4.0,  temp_max_tol: 6.0  },
  'plat cuisiné':       { dlc_jours: 3,  temp_max: 3.0,  temp_max_tol: 5.0  },
  'plat cuisine':       { dlc_jours: 3,  temp_max: 3.0,  temp_max_tol: 5.0  },
  'pâtisserie':         { dlc_jours: 3,  temp_max: 3.0,  temp_max_tol: 5.0  },
  'patisserie':         { dlc_jours: 3,  temp_max: 3.0,  temp_max_tol: 5.0  },
  'pâtisserie fraîche': { dlc_jours: 3,  temp_max: 3.0,  temp_max_tol: 5.0  },
  'poisson':            { dlc_jours: 2,  temp_max: 2.0,  temp_max_tol: 3.0  },
};

function normalize(s) {
  return String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

function slugify(s) {
  return normalize(s).replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function getGepRule(denominationGep) {
  const key = normalize(denominationGep);
  return GEP_RULES[key] ?? { dlc_jours: 3, temp_max: 4.0, temp_max_tol: 6.0 };
}

async function main() {
  console.log('📦 Migration produits…');
  const wb = XLSX.readFile(FILE);
  const ws = wb.Sheets['Produits'];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  const docs = rows
    .filter(r => r['Produit']?.trim())
    .map(r => {
      const nom    = String(r['Produit']).trim();
      const gepRaw = String(r['Dénomination GEP'] || '').trim();
      const rule   = getGepRule(gepRaw);
      return {
        id: slugify(nom),
        data: {
          nom,
          abreviation:     String(r['Abréviation'] || '').trim(),
          categorie:       String(r['catégorie']   || '').trim(),
          denomination_gep: gepRaw,
          dlc_jours:       rule.dlc_jours,
          temp_max:        rule.temp_max,
          temp_max_tol:    rule.temp_max_tol,
          updated_at:      new Date(),
        }
      };
    });

  console.log(`  ${docs.length} produits à migrer`);
  await batchWrite('produits', docs);
}

main().catch(e => { console.error(e); process.exit(1); });
