// Pré-remplit rhResponsables = responsables actuels, pour que la nouvelle section
// « Alertes RH » soit explicite dans l'UI (WYSIWYG) plutôt qu'un repli invisible.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY = resolve(__dirname, '../cuisine-yorgios-firebase-adminsdk-fbsvc-1c759ed390.json');
const sa = JSON.parse(readFileSync(KEY, 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore('test');

const ref = db.doc('settings/alert_emails');
const cur = (await ref.get()).data() ?? {};
console.log('responsables actuels :', JSON.stringify(cur.responsables ?? []));
console.log('rhResponsables avant  :', JSON.stringify(cur.rhResponsables ?? '(absent)'));

if (Array.isArray(cur.rhResponsables) && cur.rhResponsables.length) {
  console.log('ℹ️  rhResponsables déjà défini — rien à faire.');
} else {
  const seed = cur.responsables ?? [];
  await ref.set({ rhResponsables: seed }, { merge: true });
  console.log('rhResponsables après  :', JSON.stringify(seed), '✅');
}
