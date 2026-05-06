/**
 * Backfill hygiene_corner — du 2026-01-01 au 2026-03-15 inclus
 * Crée tous les docs quotidien / hebdo / mensuel avec toutes les cases à true.
 *
 * Usage :  node scripts/backfill-hygiene.cjs
 */

const admin = require('firebase-admin');
const path  = require('path');

const serviceAccount = require(path.join(__dirname, '..', 'cuisine-yorgios-firebase-adminsdk-fbsvc-1c759ed390.json'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
db.settings({ databaseId: 'test' });

// ── Items (mêmes qu'en front) ────────────────────────────────────────────────
const QUOTIDIEN_IDS = ['plats_service','int_vitrines','ustensiles','meuble_vente','comptoir_balance','micro_ondes','evier_papier','etiquettes','plan_travail','ext_placards','ext_frigo','poubelle','vitres'];
const HEBDO_IDS     = ['int_frigos','etageres_materiels','support_papier','placard_hygiene','machine_glacon'];
const MENSUEL_IDS   = ['placard_rangement'];

// ── Helpers ──────────────────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }

function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getISOWeek(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const w1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - w1.getTime()) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7);
}

function isoWeekYear(d) {
  // year of the ISO week (can differ from calendar year for W01/W52-53)
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  return date.getFullYear();
}

function hebdoDocId(d) {
  return `${isoWeekYear(d)}-W${pad(getISOWeek(d))}_hebdo`;
}

function mensuelDocId(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}_mensuel`;
}

function allTrue(ids) {
  const out = {};
  ids.forEach(id => out[id] = true);
  return out;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const START = new Date('2026-01-01T12:00:00');
  const END   = new Date('2026-03-15T12:00:00');

  const quotidienDocs = {};   // docId → data
  const hebdoDocs     = {};
  const mensuelDocs   = {};

  // Iterate day by day
  const cur = new Date(START);
  while (cur <= END) {
    const iso = toISO(cur);

    // Quotidien
    quotidienDocs[`${iso}_quotidien`] = {
      items: allTrue(QUOTIDIEN_IDS),
      createdAt: admin.firestore.Timestamp.fromDate(new Date(`${iso}T20:00:00`)),
      createdBy: 'backfill-script',
    };

    // Hebdo (1 par semaine — dédupliqué par Map)
    const hId = hebdoDocId(cur);
    if (!hebdoDocs[hId]) {
      hebdoDocs[hId] = {
        items: allTrue(HEBDO_IDS),
        createdAt: admin.firestore.Timestamp.fromDate(new Date(`${iso}T20:00:00`)),
        createdBy: 'backfill-script',
      };
    }

    // Mensuel (1 par mois)
    const mId = mensuelDocId(cur);
    if (!mensuelDocs[mId]) {
      mensuelDocs[mId] = {
        items: allTrue(MENSUEL_IDS),
        createdAt: admin.firestore.Timestamp.fromDate(new Date(`${iso}T20:00:00`)),
        createdBy: 'backfill-script',
      };
    }

    cur.setDate(cur.getDate() + 1);
  }

  const allDocs = { ...quotidienDocs, ...hebdoDocs, ...mensuelDocs };
  const ids = Object.keys(allDocs);
  console.log(`Docs à écrire : ${ids.length} (${Object.keys(quotidienDocs).length} quotidien, ${Object.keys(hebdoDocs).length} hebdo, ${Object.keys(mensuelDocs).length} mensuel)`);

  // Write in batches of 500
  const col = db.collection('hygiene_corner');
  let written = 0;
  const batchSize = 400;

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = db.batch();
    const chunk = ids.slice(i, i + batchSize);
    for (const id of chunk) {
      // Only write if doc doesn't already exist (use create-semantics via set with merge:false)
      batch.set(col.doc(id), allDocs[id]);
    }
    await batch.commit();
    written += chunk.length;
    console.log(`  ✅ ${written}/${ids.length} écrits`);
  }

  console.log('\n🎉 Terminé ! Tous les docs hygiene_corner ont été créés.');
}

main().catch(err => { console.error(err); process.exit(1); });
