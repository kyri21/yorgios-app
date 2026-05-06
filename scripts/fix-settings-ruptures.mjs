import { db } from './_firebase_admin.mjs'

await db.collection('settings').doc('ruptures').set({
  produits: [
    'Briam',
    'Moussaka',
    'Brochette de Poulet Mariné au Citron',
    'Boulette Kefta',
    'Riz Épinard',
    'Orzo Nature',
    'Tzatziki',
    'Houmous Classique',
    'Tiropita épinards, Olives de Kalamata & Feta',
    'Tiropita Menthe, Feta',
  ]
}, { merge: true })

console.log('✅ settings/ruptures.produits mis à jour avec les noms exacts du catalogue')
