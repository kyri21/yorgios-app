// Diagnostic : compare les noms dans ruptures_actives avec le catalogue + leurs priorités
import { db } from './_firebase_admin.mjs'
import { Timestamp } from 'firebase-admin/firestore'

// 1. Lire tous les docs ruptures_actives viewed=false des dernières 24h
const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 1); cutoff.setHours(13,0,0,0)
const rSnap = await db.collection('ruptures_actives')
  .where('viewed', '==', false)
  .get()

console.log(`\n📋 ${rSnap.size} doc(s) ruptures_actives actifs\n`)
const allNames = new Set()
for (const d of rSnap.docs) {
  const data = d.data()
  const t = data.createdAt?.toDate()
  console.log(`  [${t?.getHours()}h${String(t?.getMinutes()).padStart(2,'0')}] ${data.personne} — ${data.ruptures?.length ?? 0} ruptures`)
  for (const n of (data.ruptures ?? [])) allNames.add(n)
  for (const n of (data.presqueRuptures ?? [])) allNames.add(n)
}

// 2. Lire le catalogue
const catSnap = await db.collection('catalogue').get()
const catalogueMap = new Map() // name.lower → { name, priority }
for (const d of catSnap.docs) {
  const data = d.data()
  if (data.name) catalogueMap.set(data.name.toLowerCase().trim(), { name: data.name, priority: data.priority ?? null })
}

// 3. Comparer
console.log(`\n🔍 Correspondances nom → priorité catalogue :\n`)
const sorted = [...allNames].sort()
let mismatches = 0
for (const name of sorted) {
  const key = name.toLowerCase().trim()
  const found = catalogueMap.get(key)
  if (!found) {
    console.log(`  ❌ "${name}" — INTROUVABLE dans catalogue`)
    mismatches++
  } else {
    const prio = found.priority
    console.log(`  ${prio != null ? `✅ P${prio}` : '⚪ null'} "${name}" → catalogue: "${found.name}"${found.name !== name ? ` ⚠️ CASSE DIFFÉRENTE` : ''}`)
  }
}

console.log(`\n📊 ${allNames.size} produits uniques — ${mismatches} introuvables dans le catalogue`)

// 4. Lire les niveaux de priorité configurés
const plSnap = await db.collection('settings').doc('priority_levels').get()
if (plSnap.exists) {
  const lvls = plSnap.data().levels ?? []
  console.log(`\n🎨 Niveaux configurés :`)
  for (const l of lvls) console.log(`  P${l.level} — ${l.name} (${l.color})`)
} else {
  console.log(`\n❌ settings/priority_levels introuvable`)
}
