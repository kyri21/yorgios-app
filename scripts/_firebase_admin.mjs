import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const KEY_PATHS = [
  resolve(__dirname, '../secrets/firebase-admin.json'),
  resolve(__dirname, '../../pms-cuisine/secrets/firebase-admin.json'),
];

const found = KEY_PATHS.find(p => existsSync(p));
if (!found) {
  console.error('❌ Clé firebase-admin.json introuvable dans secrets/');
  process.exit(1);
}

const sa = JSON.parse(readFileSync(found, 'utf8'));
if (!getApps().length) {
  initializeApp({ credential: cert(sa) });
}
console.log(`🔑 Clé chargée : ${found}`);

export const db = getFirestore('test');
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function batchWrite(collection, docs) {
  const CHUNK = 400;
  let total = 0;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = db.batch();
    docs.slice(i, i + CHUNK).forEach(({ id, data }) => {
      const ref = id
        ? db.collection(collection).doc(id)
        : db.collection(collection).doc();
      batch.set(ref, data, { merge: true });
    });
    await batch.commit();
    total += Math.min(CHUNK, docs.length - i);
    console.log(`  → ${total}/${docs.length} docs`);
    await sleep(300);
  }
  console.log(`✅ ${collection} : ${total} docs migrés`);
}
