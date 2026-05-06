const admin = require('firebase-admin');
const path = require('path');
const serviceAccount = require(path.join(__dirname, '..', 'cuisine-yorgios-firebase-adminsdk-fbsvc-1c759ed390.json'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
db.settings({ databaseId: 'test' });

async function main() {
  const allSnap = await db.collection('lots_cuisine').get();
  const start = new Date('2026-04-06T00:00:00.000Z');
  const end   = new Date('2026-04-10T00:00:00.000Z');

  const inPeriod = allSnap.docs.filter(d => {
    const ts = d.data().createdAt;
    if (!ts) return false;
    const date = ts.toDate();
    return date >= start && date < end;
  });

  console.log(`Lots 6→9 avril restants: ${inPeriod.length}`);
  inPeriod.forEach(d => {
    const data = d.data();
    console.log(`  [${d.id}] ${data.lotCode||'?'} — ${data.productName||'?'} — sent=${!!data.sent} archived=${!!data.archived} — ${data.createdAt?.toDate?.()?.toISOString?.()}`);
  });
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
