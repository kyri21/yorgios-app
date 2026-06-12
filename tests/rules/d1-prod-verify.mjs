// D1 — Vérification PROD du mécanisme permAllows() avec les comptes audit.
// Collection testée : actions_correctives (aucun trigger email/FCM).
// Le doc settings/permissions est snapshoté puis restauré À L'IDENTIQUE.
// Lancement : node tests/rules/d1-prod-verify.mjs
import { readFileSync } from 'node:fs'
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc, updateDoc, deleteField,
} from 'firebase/firestore'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
})
const auth = getAuth(app)
const db = getFirestore(app, 'test')

const CREDS = {
  cuisine: ['audit.cuisine@yorgios.fr', 'AuditCuisine2026'],
  manager: ['audit.manager@yorgios.fr', 'AuditManager2026'],
}

let passed = 0, failed = 0
const failures = []
function ok(label) { passed++; console.log(`  ✓ ${label}`) }
function ko(label, extra) { failed++; failures.push(label); console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`) }

async function expectAllowed(label, p) {
  try { await p; ok(label) } catch (e) { ko(label, e.code || e.message) }
}
async function expectDenied(label, p) {
  try { await p; ko(label, 'opération AUTORISÉE alors que refus attendu') }
  catch (e) {
    if (e.code === 'permission-denied') ok(label)
    else ko(label, `erreur inattendue : ${e.code || e.message}`)
  }
}

async function login(role) {
  await signOut(auth).catch(() => {})
  const [email, pwd] = CREDS[role]
  await signInWithEmailAndPassword(auth, email, pwd)
}

const AC_TEST = {
  type: 'temperature',
  date: new Date().toISOString().slice(0, 10),
  refId: 'TEST_AUDIT_D1',
  problem: 'TEST AUDIT D1 — à ignorer',
  action: 'Doc de test automatique D1, supprimé immédiatement',
  createdAt: new Date(),
  createdBy: 'audit',
  createdByName: 'AUDIT D1',
}
const acRef = id => doc(db, 'actions_correctives', `test_audit_d1_${id}`)
const permRef = doc(db, 'settings', 'permissions')

// ════════ 1. Cuisine : garde de rôle inchangée ════════
console.log('\n1. audit.cuisine — garde de rôle sur actions_correctives')
await login('cuisine')
const permSnapAsCuisine = await getDoc(permRef)
console.log(`  ℹ settings/permissions existe en prod : ${permSnapAsCuisine.exists()}`)
if (permSnapAsCuisine.exists()) console.log(`  ℹ contenu : ${JSON.stringify(permSnapAsCuisine.data())}`)
await expectAllowed('create AC (isAnyRole)', setDoc(acRef('cuisine'), AC_TEST))
await expectDenied('delete AC cuisine → refusé (garde rôle)', deleteDoc(acRef('cuisine')))

// ════════ 2. Manager : fail-open par défaut ════════
console.log('\n2. audit.manager — fail-open (delete autorisé par défaut)')
await login('manager')
await expectAllowed('delete AC (perm absente/true ⇒ autorisé) [nettoie le doc cuisine]', deleteDoc(acRef('cuisine')))
await setDoc(acRef('manager'), AC_TEST)

// ════════ 3. Manager : perm explicitement false ⇒ refus serveur ════════
console.log('\n3. audit.manager — action_delete_ac=false ⇒ refus côté serveur')
const before = await getDoc(permRef)
const hadDoc = before.exists()
const hadKey = hadDoc && before.data()?.manager && 'action_delete_ac' in before.data().manager
const prevVal = hadKey ? before.data().manager.action_delete_ac : undefined
await setDoc(permRef, { manager: { action_delete_ac: false } }, { merge: true })
await expectDenied('delete AC manager (false explicite) → refusé', deleteDoc(acRef('manager')))

// ════════ 4. Restauration exacte + nettoyage ════════
console.log('\n4. Restauration de settings/permissions + nettoyage')
if (!hadDoc) {
  await deleteDoc(permRef)
  ok('doc permissions supprimé (état initial : absent)')
} else if (!hadKey) {
  await updateDoc(permRef, { 'manager.action_delete_ac': deleteField() })
  ok('clé manager.action_delete_ac retirée (état initial : absente)')
} else {
  await updateDoc(permRef, { 'manager.action_delete_ac': prevVal })
  ok(`clé manager.action_delete_ac restaurée à ${prevVal}`)
}
const after = await getDoc(permRef)
const restoredOk = (!hadDoc && !after.exists())
  || (hadDoc && JSON.stringify(after.data()) === JSON.stringify(before.data()))
restoredOk ? ok('état permissions identique à l\'initial (vérifié)') : ko('RESTAURATION DIVERGENTE — vérifier settings/permissions !')
await expectAllowed('delete AC manager (après restauration) [nettoyage]', deleteDoc(acRef('manager')))
const leftover1 = await getDoc(acRef('cuisine'))
const leftover2 = await getDoc(acRef('manager'))
!leftover1.exists() && !leftover2.exists() ? ok('aucun doc de test résiduel') : ko('DOC DE TEST RÉSIDUEL — nettoyer actions_correctives !')

await signOut(auth).catch(() => {})
console.log(`\n══════ PROD : ${passed} ✓ / ${failed} ✗ ══════`)
if (failures.length) { failures.forEach(f => console.log(`  - ${f}`)); process.exit(1) }
process.exit(0)
