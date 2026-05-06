// Script Node.js — Trouver et supprimer le doublon Layal
// Usage : node scripts/fix_layal_doublon.js [--delete]
//
// Sans --delete : affiche les deux comptes et lequel supprimer
// Avec --delete : supprime le doublon (garde le plus récent / celui qui fonctionne)

const admin = require('firebase-admin')
const serviceAccount = require('../cuisine-yorgios-firebase-adminsdk-fbsvc-1c759ed390.json')

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://cuisine-yorgios.firebaseio.com',
})

const db = admin.firestore()
db.settings({ databaseId: 'test' })
const auth = admin.auth()

const DRY_RUN = !process.argv.includes('--delete')

async function main() {
  console.log(DRY_RUN ? '\n[DRY RUN] Analyse des doublons Layal…\n' : '\n[SUPPRESSION] Nettoyage doublon Layal…\n')

  // 1. Trouver tous les users Firestore avec "layal" dans le nom (insensible casse)
  const snap = await db.collection('users').get()
  const layals = snap.docs.filter(d => {
    const name = (d.data().displayName || '').toLowerCase()
    return name.includes('layal')
  })

  if (layals.length === 0) {
    console.log('Aucun utilisateur "Layal" trouvé dans Firestore.')
    process.exit(0)
  }

  console.log(`${layals.length} compte(s) "Layal" trouvé(s) dans Firestore :\n`)

  const usersWithAuth = []
  for (const d of layals) {
    const data = d.data()
    let authRecord = null
    let authError = null
    try {
      authRecord = await auth.getUser(d.id)
    } catch (e) {
      authError = e.message
    }

    const info = {
      uid: d.id,
      displayName: data.displayName,
      email: data.email,
      role: data.role,
      createdAt: data.createdAt?.toDate?.()?.toISOString() ?? 'N/A',
      authExists: !!authRecord,
      authDisabled: authRecord?.disabled ?? null,
      authEmail: authRecord?.email ?? null,
      authError,
    }

    usersWithAuth.push(info)
    console.log(`  UID        : ${info.uid}`)
    console.log(`  Nom        : ${info.displayName}`)
    console.log(`  Email FS   : ${info.email}`)
    console.log(`  Email Auth : ${info.authEmail ?? '—'}`)
    console.log(`  Rôle       : ${info.role}`)
    console.log(`  Créé le    : ${info.createdAt}`)
    console.log(`  Auth exist : ${info.authExists}`)
    if (info.authDisabled !== null) console.log(`  Auth disabled: ${info.authDisabled}`)
    if (info.authError) console.log(`  Auth erreur: ${info.authError}`)
    console.log()
  }

  if (layals.length < 2) {
    console.log('Un seul compte Layal, rien à supprimer.')
    process.exit(0)
  }

  // Heuristique : garder celui dont Auth fonctionne ET non désactivé
  // En cas d'égalité, garder le plus récent (createdAt)
  const working = usersWithAuth.filter(u => u.authExists && !u.authDisabled)
  const broken  = usersWithAuth.filter(u => !u.authExists || u.authDisabled)

  let toKeep, toDelete

  if (working.length === 1 && broken.length >= 1) {
    toKeep   = working[0]
    toDelete = broken
  } else if (working.length >= 2) {
    // Les deux fonctionnent : garder le plus récent
    const sorted = [...working].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    toKeep   = sorted[0]
    toDelete = sorted.slice(1)
  } else {
    // Aucun ne fonctionne — garder quand même le moins cassé
    const sorted = [...usersWithAuth].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    toKeep   = sorted[0]
    toDelete = sorted.slice(1)
    console.log('⚠️  Aucun compte Layal totalement fonctionnel trouvé.')
  }

  console.log('─────────────────────────────────────')
  console.log(`✅ GARDER  : ${toKeep.displayName} (${toKeep.uid}) — ${toKeep.email}`)
  for (const td of toDelete) {
    console.log(`🗑  SUPPRIMER : ${td.displayName} (${td.uid}) — ${td.email}`)
  }
  console.log('─────────────────────────────────────\n')

  if (DRY_RUN) {
    console.log('Relancer avec --delete pour effectuer la suppression.')
    process.exit(0)
  }

  // Suppression
  for (const td of toDelete) {
    if (td.authExists) {
      await auth.deleteUser(td.uid)
      console.log(`  Auth supprimé : ${td.uid}`)
    }
    await db.collection('users').doc(td.uid).delete()
    console.log(`  Firestore supprimé : ${td.uid}`)
  }

  console.log('\n✅ Doublon(s) supprimé(s). Il reste un seul compte Layal.')
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
