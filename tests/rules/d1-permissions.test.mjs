// D1 — Tests des règles Firestore permAllows() (fail-open)
// Lancement : firebase emulators:exec --only firestore --project demo-d1 "node tests/rules/d1-permissions.test.mjs"
import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
import { doc, setDoc, deleteDoc } from 'firebase/firestore'

const ROLES = {
  u_patron: 'patron',
  u_admin: 'administrateur',
  u_manager: 'manager',
  u_corner: 'corner',
  u_cuisine: 'cuisine',
}

let passed = 0
let failed = 0
const failures = []

async function check(label, promise, expectAllowed) {
  try {
    if (expectAllowed) await assertSucceeds(promise)
    else await assertFails(promise)
    passed++
    console.log(`  ✓ ${label}`)
  } catch (e) {
    failed++
    failures.push(label)
    console.log(`  ✗ ${label} — ${e.message?.split('\n')[0]}`)
  }
}

async function seed(env, permissionsDoc) {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore()
    for (const [uid, role] of Object.entries(ROLES)) {
      await setDoc(doc(db, 'users', uid), { role })
    }
    // Un doc cible par rôle et par collection (un delete réussi consomme le doc)
    for (const uid of Object.keys(ROLES)) {
      await setDoc(doc(db, 'lots_cuisine', `lot_${uid}`), { lotCode: 'L1', productName: 'Tzatziki' })
      await setDoc(doc(db, 'livraisons', `liv_${uid}`), { lotCode: 'L1', productName: 'Tzatziki' })
      await setDoc(doc(db, 'non_conformites', `nc_${uid}`), { livraisonId: 'liv', decision: 'Jeté' })
      await setDoc(doc(db, 'actions_correctives', `ac_${uid}`), { type: 'temperature', action: 'x' })
    }
    if (permissionsDoc) await setDoc(doc(db, 'settings', 'permissions'), permissionsDoc)
  })
}

function del(env, uid, coll, prefix) {
  const db = env.authenticatedContext(uid).firestore()
  return deleteDoc(doc(db, coll, `${prefix}_${uid}`))
}

const rules = readFileSync('firestore.rules', 'utf8')
const env = await initializeTestEnvironment({
  projectId: 'demo-d1',
  firestore: { rules },
})

// ════════ Scénario A — doc settings/permissions ABSENT (fail-open intégral) ════════
// Comportement attendu = comportement actuel de prod, à l'identique.
console.log('\nScénario A — sans doc settings/permissions (fail-open = comportement actuel)')
await seed(env, null)
// lots_cuisine : isAnyRole()
for (const uid of ['u_patron', 'u_admin', 'u_manager', 'u_corner', 'u_cuisine'])
  await check(`lots_cuisine delete ${ROLES[uid]} → autorisé`, del(env, uid, 'lots_cuisine', 'lot'), true)
// livraisons : isCuisine() = patron/admin/manager/cuisine, PAS corner
for (const uid of ['u_patron', 'u_admin', 'u_manager', 'u_cuisine'])
  await check(`livraisons delete ${ROLES[uid]} → autorisé`, del(env, uid, 'livraisons', 'liv'), true)
await check('livraisons delete corner → refusé (garde rôle)', del(env, 'u_corner', 'livraisons', 'liv'), false)
// non_conformites + actions_correctives : isPatronOrManager()
for (const uid of ['u_patron', 'u_admin', 'u_manager']) {
  await check(`non_conformites delete ${ROLES[uid]} → autorisé`, del(env, uid, 'non_conformites', 'nc'), true)
  await check(`actions_correctives delete ${ROLES[uid]} → autorisé`, del(env, uid, 'actions_correctives', 'ac'), true)
}
for (const uid of ['u_corner', 'u_cuisine']) {
  await check(`non_conformites delete ${ROLES[uid]} → refusé (garde rôle)`, del(env, uid, 'non_conformites', 'nc'), false)
  await check(`actions_correctives delete ${ROLES[uid]} → refusé (garde rôle)`, del(env, uid, 'actions_correctives', 'ac'), false)
}

// ════════ Scénario B — permissions explicitement FALSE ════════
console.log('\nScénario B — perms explicitement false (seul cas bloquant)')
await seed(env, {
  manager: { action_delete_livraison: false, action_delete_ac: false },
  cuisine: { action_delete_lot: false },
})
await check('livraisons delete manager (false) → refusé', del(env, 'u_manager', 'livraisons', 'liv'), false)
await check('livraisons delete cuisine (clé absente) → autorisé', del(env, 'u_cuisine', 'livraisons', 'liv'), true)
await check('lots_cuisine delete cuisine (false) → refusé', del(env, 'u_cuisine', 'lots_cuisine', 'lot'), false)
await check('lots_cuisine delete corner (rôle absent du doc) → autorisé', del(env, 'u_corner', 'lots_cuisine', 'lot'), true)
await check('lots_cuisine delete manager (clé absente) → autorisé', del(env, 'u_manager', 'lots_cuisine', 'lot'), true)
await check('actions_correctives delete manager (false) → refusé', del(env, 'u_manager', 'actions_correctives', 'ac'), false)
await check('non_conformites delete manager (même clé AC, false) → refusé', del(env, 'u_manager', 'non_conformites', 'nc'), false)
// Anti-lockout : patron/administrateur jamais bloqués (absents du doc)
await check('livraisons delete patron → toujours autorisé', del(env, 'u_patron', 'livraisons', 'liv'), true)
await check('actions_correctives delete administrateur → toujours autorisé', del(env, 'u_admin', 'actions_correctives', 'ac'), true)
await check('non_conformites delete patron → toujours autorisé', del(env, 'u_patron', 'non_conformites', 'nc'), true)

// ════════ Scénario C — permissions explicitement TRUE ════════
console.log('\nScénario C — perms explicitement true')
await seed(env, {
  manager: { action_delete_livraison: true, action_delete_ac: true, action_delete_lot: true },
  cuisine: { action_delete_lot: true, action_delete_livraison: true },
})
await check('livraisons delete manager (true) → autorisé', del(env, 'u_manager', 'livraisons', 'liv'), true)
await check('lots_cuisine delete cuisine (true) → autorisé', del(env, 'u_cuisine', 'lots_cuisine', 'lot'), true)
await check('actions_correctives delete manager (true) → autorisé', del(env, 'u_manager', 'actions_correctives', 'ac'), true)

// ════════ Scénario D — doc présent mais malformé / partiel (fail-open) ════════
console.log('\nScénario D — doc partiel : la garde de rôle reste le plancher')
await seed(env, { manager: {} })
await check('livraisons delete manager (map vide) → autorisé', del(env, 'u_manager', 'livraisons', 'liv'), true)
await check('livraisons delete corner (garde rôle inchangée) → refusé', del(env, 'u_corner', 'livraisons', 'liv'), false)
await check('lots_cuisine delete corner → autorisé', del(env, 'u_corner', 'lots_cuisine', 'lot'), true)

await env.cleanup()

console.log(`\n══════ RÉSULTAT : ${passed} ✓ / ${failed} ✗ ══════`)
if (failures.length) {
  console.log('Échecs :')
  failures.forEach(f => console.log(`  - ${f}`))
  process.exit(1)
}
