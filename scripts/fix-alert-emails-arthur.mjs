// Ajoute kyriarthur@gmail.com aux destinataires d'alerte (no-show, retard, REFUSE, NC).
// Fix immédiat : Arthur n'était dans AUCUN canal (token FCM mort + absent de la liste email).
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY = resolve(__dirname, '../cuisine-yorgios-firebase-adminsdk-fbsvc-1c759ed390.json');
const sa = JSON.parse(readFileSync(KEY, 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore('test');

const ADD = 'kyriarthur@gmail.com';
const ref = db.doc('settings/alert_emails');
const before = (await ref.get()).data()?.responsables ?? [];
console.log('AVANT :', JSON.stringify(before));

if (before.map(e => e.toLowerCase()).includes(ADD.toLowerCase())) {
  console.log(`ℹ️  ${ADD} déjà présent — rien à faire.`);
} else {
  const after = [...before, ADD];
  await ref.set({ responsables: after }, { merge: true });
  console.log('APRÈS :', JSON.stringify(after));
  console.log(`✅ ${ADD} ajouté aux destinataires d'alerte.`);
}

// Bonus : purge le token FCM mort d'Arthur (kyriazis@outlook.fr) pour ne plus polluer les envois.
const us = await db.collection('users').where('role', '==', 'administrateur').get();
for (const u of us.docs) {
  if (u.data().email === 'kyriazis@outlook.fr' && u.data().fcmToken) {
    await u.ref.update({ fcmToken: FieldValue.delete() });
    console.log(`🧹 Token FCM mort supprimé de ${u.data().email} (se régénère à la réouverture de l'app).`);
  }
}
console.log('\n=== FIN ===');
