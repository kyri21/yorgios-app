import { db } from './_firebase_admin.mjs'
import { getAuth } from 'firebase-admin/auth'

const auth = getAuth()
const EMAIL = 'lay.berkous@gmail.com'

// Récupérer le compte Auth
let uid
try {
  const user = await auth.getUserByEmail(EMAIL)
  uid = user.uid
  console.log(`✅ Compte Auth trouvé : ${EMAIL} (uid: ${uid})`)
} catch (e) {
  console.error(`❌ Compte Firebase Auth introuvable pour ${EMAIL}`)
  console.error(e.message)
  process.exit(1)
}

// Vérifier le doc Firestore
const snap = await db.collection('users').doc(uid).get()
if (snap.exists) {
  const data = snap.data()
  console.log(`ℹ️  Doc Firestore existant :`, data)
  if (data.role !== 'corner') {
    console.log(`⚠️  Rôle incorrect : "${data.role}" → correction vers "corner"`)
  }
} else {
  console.log(`⚠️  Doc Firestore ABSENT → création`)
}

// Créer/corriger le doc
await db.collection('users').doc(uid).set({
  uid,
  email: EMAIL,
  displayName: 'Layal',
  role: 'corner',
  createdAt: new Date(),
}, { merge: true })

console.log(`✅ users/${uid} → role: corner — Layal peut maintenant se connecter`)
