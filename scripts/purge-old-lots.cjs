const admin = require('firebase-admin');
const path = require('path');
const serviceAccount = require(path.join(__dirname, '..', 'cuisine-yorgios-firebase-adminsdk-fbsvc-1c759ed390.json'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
db.settings({ databaseId: 'test' });

async function main() {
  const start = new Date('2026-04-06T00:00:00.000Z');
  const end   = new Date('2026-04-10T00:00:00.000Z');

  const allSentSnap = await db.collection('lots_cuisine').where('sent', '==', true).get();
  const targetLots = allSentSnap.docs.filter(d => {
    const ts = d.data().createdAt;
    if (!ts) return false;
    const date = ts.toDate();
    return date >= start && date < end;
  });

  console.log(`Lots sent=true (6→9 avril) : ${targetLots.length}`);
  if (targetLots.length === 0) { console.log('Rien à supprimer.'); process.exit(0); }

  let count = 0;
  const toDelete = [];

  for (const lotDoc of targetLots) {
    const data = lotDoc.data();
    const createdAt = data.createdAt?.toDate?.()?.toISOString?.() ?? '?';
    console.log(`  [${lotDoc.id}] ${data.lotCode||'?'} — ${data.productName||'?'} — ${createdAt}`);

    // Chercher la livraison via query sur lotId
    const livSnap = await db.collection('livraisons').doc(lotDoc.id).get();
    const livData = livSnap.data ? livSnap.data() : null;

    if (livData) {
      if (livData.receptionAt || livData.result) {
        console.log(`    → Suppression (livraison reçue, result=${livData.result})`);
        toDelete.push(lotDoc.id);
        count++;
      } else {
        console.log(`    → IGNORÉ (livraison non encore réceptionnée)`);
      }
    } else {
      console.log(`    → Suppression (lot orphelin, pas de livraison)`);
      toDelete.push(lotDoc.id);
      count++;
    }
  }

  if (count === 0) { console.log('Aucun lot éligible.'); process.exit(0); }

  for (const id of toDelete) {
    await db.collection('lots_cuisine').doc(id).delete();
    console.log(`  ✓ Supprimé: ${id}`);
  }

  console.log(`\n✅ ${count} lot(s) supprimé(s).`);
  process.exit(0);
}

main().catch(err => { console.error('Erreur :', err.message); process.exit(1); });
