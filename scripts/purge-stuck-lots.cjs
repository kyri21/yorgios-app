const admin = require('firebase-admin');
const path = require('path');
const serviceAccount = require(path.join(__dirname, '..', 'cuisine-yorgios-firebase-adminsdk-fbsvc-1c759ed390.json'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
db.settings({ databaseId: 'test' });

async function main() {
  // Les 2 lots stuck actifs du 8 avril
  const stuck = ['uZ897xhvvO1un0dJpNib', 'wTPAHavL0M8VfFaqmXgd'];
  for (const id of stuck) {
    const snap = await db.collection('lots_cuisine').doc(id).get();
    if (snap.exists) {
      const d = snap.data();
      console.log(`Suppression: [${id}] ${d.lotCode||'?'} — ${d.productName||'?'} — sent=${!!d.sent} archived=${!!d.archived}`);
      await db.collection('lots_cuisine').doc(id).delete();
      console.log(`  ✓ Supprimé`);
    } else {
      console.log(`[${id}] introuvable`);
    }
  }
  console.log('\n✅ Terminé.');
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
