import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const serviceAccount = JSON.parse(readFileSync(join(__dirname, '..', 'cuisine-yorgios-firebase-adminsdk-fbsvc-1c759ed390.json'), 'utf8'))

const app = initializeApp({ credential: cert(serviceAccount) })
const auth = getAuth(app)
const db = getFirestore(app, 'test')

const users = [
  { email: 'ytimour86@gmail.com',        password: 'timour',   displayName: 'Timour',          role: 'cuisine' },
  { email: 'jrmaissonn@yahoo.com',        password: 'junior',   displayName: 'Junior',          role: 'cuisine' },
  { email: 'mdanioko650@gmail.com',       password: 'danioko',  displayName: 'Danioko',         role: 'cuisine' },
  { email: 'c_ali@hotmail.fr',            password: 'challal',  displayName: 'Ali',             role: 'cuisine' },
  { email: 'perkokko@gmail.com',          password: 'periklis', displayName: 'Periklis',        role: 'cuisine' },
  { email: 'ipad.cuisine@yorgios.fr',     password: 'cuisine',  displayName: 'iPad Cuisine',    role: 'cuisine' },
]

for (const u of users) {
  try {
    // Vérifie si déjà existant
    let uid
    try {
      const existing = await auth.getUserByEmail(u.email)
      uid = existing.uid
      // Met à jour le mdp si l'utilisateur existe déjà
      await auth.updateUser(uid, { password: u.password, displayName: u.displayName })
      console.log(`🔄 Mis à jour : ${u.email} (uid: ${uid})`)
    } catch {
      // Crée le compte Auth
      const userRecord = await auth.createUser({
        email: u.email,
        password: u.password,
        displayName: u.displayName,
      })
      uid = userRecord.uid
      console.log(`✅ Créé : ${u.email} (uid: ${uid})`)
    }

    // Upsert doc Firestore
    await db.collection('users').doc(uid).set({
      uid,
      email: u.email,
      displayName: u.displayName,
      role: u.role,
      createdAt: Timestamp.now(),
    }, { merge: true })

  } catch (err) {
    console.error(`❌ Erreur pour ${u.email}:`, err.message)
  }
}

console.log('\nTerminé.')
process.exit(0)
