import { db } from './_firebase_admin.mjs'
import { getAuth } from 'firebase-admin/auth'

const auth = getAuth()
const EMAIL    = 'planning@yorgios.fr'
const PASSWORD = 'planning2026'

// Créer le compte Firebase Auth
let uid
try {
  const user = await auth.createUser({ email: EMAIL, password: PASSWORD, displayName: 'Planning Corner' })
  uid = user.uid
  console.log(`✅ Compte créé : ${EMAIL} (uid: ${uid})`)
} catch (e) {
  if (e.code === 'auth/email-already-exists') {
    const user = await auth.getUserByEmail(EMAIL)
    uid = user.uid
    console.log(`ℹ️  Compte existant : ${EMAIL} (uid: ${uid})`)
  } else {
    throw e
  }
}

// Créer le doc Firestore users/{uid}
await db.collection('users').doc(uid).set({
  email: EMAIL,
  displayName: 'Planning Corner',
  role: 'corner',
  createdAt: new Date(),
}, { merge: true })

console.log(`✅ users/${uid} → role: corner`)
console.log(`\n📋 Compte prêt : ${EMAIL} / ${PASSWORD}`)
