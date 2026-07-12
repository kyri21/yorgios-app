// Diag no-show — chaîne de LIVRAISON de l'alerte (FCM + email) + nature du marqueur 06-29.
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

// 1) Destinataires FCM : patron/admin ont-ils un fcmToken ?
console.log('=== FCM — patron/administrateur (cibles no-show) ===');
const us = await db.collection('users').where('role', 'in', ['patron', 'administrateur']).get();
us.docs.forEach(u => {
  const d = u.data();
  const tok = d.fcmToken ? `token ${String(d.fcmToken).slice(0, 12)}…` : '❌ AUCUN fcmToken';
  console.log(`  ${d.email} (${d.role}) → ${tok}`);
});

// 2) Emails d'alerte (getAlertEmails) moins managers
console.log('\n=== EMAILS — settings/alert_emails ===');
const ae = await db.doc('settings/alert_emails').get();
console.log('  responsables =', JSON.stringify(ae.data()?.responsables ?? '(absent → fallback)'));
const mgr = await db.collection('users').where('role', '==', 'manager').get();
console.log('  managers (exclus) =', mgr.docs.map(d => d.data().email).join(', ') || '(aucun)');

// 3) Le marqueur 06-29 : détail complet (pour juger s'il vient de la CF live)
console.log('\n=== MARQUEUR 2026-06-29 ===');
const mk = await db.doc('pointages_noshow/2026-06-29_Vyv8CTfKmlNBpc91ULgG').get();
if (mk.exists) {
  const m = mk.data();
  const at = m.alertedAt?._seconds ? new Date(m.alertedAt._seconds * 1000).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) : m.alertedAt;
  console.log('  ', JSON.stringify({ ...m, alertedAt: at }));
}

console.log('\n=== FIN DIAG DELIVERY ===');
