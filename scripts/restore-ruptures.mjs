// Restaure les 3 demandes de ruptures du 17/04/2026 perdues après clic "✓ On s'en occupe"
import { db } from './_firebase_admin.mjs'
import { Timestamp } from 'firebase-admin/firestore'

const toTS = (h, m) => {
  const d = new Date(2026, 3, 17, h, m, 0, 0) // mois 0-indexé → avril = 3
  return Timestamp.fromDate(d)
}

const docs = [
  {
    createdAt: toTS(16, 52),
    personne: 'Arthur',
    viewed: false,
    ruptures: [
      'Briam', 'Brochette poulet', 'Moussaka', 'Riz épinard', 'Orzo nature',
      'Tiropita menthe', 'Houmous', 'Blini de Courgette', 'Feuille de Vigne Farcie',
      'Concombre', 'Pastèque', 'Salade de Lentilles', 'Salade Fenouil et Orange',
      'Boulette Agneau', 'Orzo Nature', 'Riz au Chou', 'Riz Épinard',
      'Brochette de Poulet Mariné au Citron', 'Boulette Veggie', 'Olives de Kalamata Colossal',
    ],
    presqueRuptures: [],
  },
  {
    createdAt: toTS(17, 4),
    personne: 'Arthur',
    viewed: false,
    ruptures: [
      'Briam', 'Moussaka', 'Brochette poulet', 'Riz épinard', 'Orzo nature',
      'Tzatziki', 'Tiropita menthe', 'Houmous', 'Blini de Courgette', 'Feuille de Vigne Farcie',
      'Houmous Classique', 'Concombre', 'Pastèque', 'Salade de Lentilles',
      'Taboulé', 'Salade Fenouil et Orange', 'Boulette Agneau',
    ],
    presqueRuptures: [],
  },
  {
    createdAt: toTS(17, 40),
    personne: 'Arthur',
    viewed: false,
    ruptures: ['Moussaka', 'Briam'],
    presqueRuptures: [],
  },
]

const col = db.collection('ruptures_actives')
for (const data of docs) {
  const ref = await col.add(data)
  const t = data.createdAt.toDate()
  console.log(`✅ ${t.getHours()}h${String(t.getMinutes()).padStart(2,'0')} — ${data.ruptures.length} ruptures → ${ref.id}`)
}
console.log('\n🎉 3 docs restaurés. Ouvre le dashboard cuisine pour tester le tri priorité.')
