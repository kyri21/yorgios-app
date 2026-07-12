// Teste la VALIDITÉ des tokens FCM patron/admin en DRY-RUN (ne notifie personne).
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY = resolve(__dirname, '../cuisine-yorgios-firebase-adminsdk-fbsvc-1c759ed390.json');
const sa = JSON.parse(readFileSync(KEY, 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore('test');

const snap = await db.collection('users').where('role', 'in', ['patron', 'administrateur']).get();
const targets = snap.docs
  .map(d => ({ email: d.data().email, role: d.data().role, token: d.data().fcmToken }))
  .filter(t => t.token);

console.log(`=== DRY-RUN FCM sur ${targets.length} token(s) patron/admin ===\n`);
const resp = await getMessaging().sendEachForMulticast({
  tokens: targets.map(t => t.token),
  notification: { title: 'test', body: 'test' },
}, true); // dryRun = true → valide le token sans envoyer

resp.responses.forEach((r, i) => {
  const t = targets[i];
  if (r.success) console.log(`  ✅ ${t.email} (${t.role}) — token VALIDE`);
  else console.log(`  ❌ ${t.email} (${t.role}) — INVALIDE : ${r.error?.code} / ${r.error?.message}`);
});
console.log(`\n  successCount=${resp.successCount}  failureCount=${resp.failureCount}`);
console.log('\n=== FIN DIAG FCM ===');
