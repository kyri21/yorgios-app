/**
 * Script : assigner catégories + normaliser noms + supprimer doublons
 * Collection : catalogue (DB test)
 * Run : node scripts/categorize-catalogue.cjs
 */

const admin = require('./node_modules/firebase-admin') // fallback
  || require('firebase-admin')

const sa = require('../cuisine-yorgios-firebase-adminsdk-fbsvc-1c759ed390.json')
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()
db.settings({ databaseId: 'test' })

// ─── Doublons à supprimer (nom exact) ────────────────────────────────────────
const TO_DELETE = new Set([
  'Pikles',
  'SALADE RIZ NOIR PASTEQUE FETA',
])

// ─── Non-alimentaires à désactiver ──────────────────────────────────────────
const TO_DEACTIVATE = new Set([
  'gants', 'liquide vaisselle', 'nettoyant surface', 'papier sulfurisé',
])

// ─── Mapping : nom actuel → { newName?, cat } ────────────────────────────────
// newName: null = garder le nom actuel (mais première lettre déjà capitale)
const MAP = {
  // ── Mezze ────────────────────────────────────────────────
  'Anchois':                                          { newName: null,                                    cat: 'Mezze'     },
  'Artichauts':                                       { newName: null,                                    cat: 'Mezze'     },
  'Blini de Courgette':                               { newName: null,                                    cat: 'Mezze'     },
  "Caviar d'Aubergines":                              { newName: null,                                    cat: 'Mezze'     },
  'Feta émiettée':                                    { newName: null,                                    cat: 'Mezze'     },
  'FETA AOP':                                         { newName: 'Feta AOP',                              cat: 'Mezze'     },
  'foisoné de feta':                                  { newName: 'Foisoné de Feta',                       cat: 'Mezze'     },
  'Feuille de Vigne Farcie':                          { newName: null,                                    cat: 'Mezze'     },
  'Houmous Classique':                                { newName: null,                                    cat: 'Mezze'     },
  'Houmous de Saison':                                { newName: null,                                    cat: 'Mezze'     },
  'Olives de Kalamata COLOSSAL':                      { newName: 'Olives de Kalamata Colossal',           cat: 'Mezze'     },
  'Pain Pita':                                        { newName: null,                                    cat: 'Mezze'     },
  'Pickles':                                          { newName: null,                                    cat: 'Mezze'     },
  'Poivrons Rotis':                                   { newName: 'Poivrons Rôtis',                        cat: 'Mezze'     },
  'Tarama':                                           { newName: null,                                    cat: 'Mezze'     },
  'Tapenade olive de kalamata et figues':             { newName: 'Tapenade Olive de Kalamata et Figues',  cat: 'Mezze'     },
  'Tentacules de poulpe':                             { newName: 'Tentacules de Poulpe',                  cat: 'Mezze'     },
  'Tzatziki':                                         { newName: null,                                    cat: 'Mezze'     },
  'Tzatziki aux trois ails':                          { newName: null,                                    cat: 'Mezze'     },
  "Tzatziki d'hiver":                                 { newName: null,                                    cat: 'Mezze'     },
  'Tzatziki de Saison':                               { newName: null,                                    cat: 'Mezze'     },

  // ── Plats ────────────────────────────────────────────────
  'Agneau':                                           { newName: null,                                    cat: 'Plats'     },
  'Aubergine farcie':                                 { newName: 'Aubergine Farcie',                      cat: 'Plats'     },
  'blanquette':                                       { newName: 'Blanquette',                            cat: 'Plats'     },
  'bœuf stifado':                                     { newName: 'Bœuf Stifado',                          cat: 'Plats'     },
  'Briam':                                            { newName: null,                                    cat: 'Plats'     },
  'BROCHETTE AU COCHON MARINÉ':                       { newName: 'Brochette au Cochon Mariné',            cat: 'Plats'     },
  'Chou Farci':                                       { newName: null,                                    cat: 'Plats'     },
  'Gemistes':                                         { newName: null,                                    cat: 'Plats'     },
  'giouvetsi':                                        { newName: 'Giouvetsi',                             cat: 'Plats'     },
  'Haricots vert':                                    { newName: 'Haricots Vert',                         cat: 'Plats'     },
  'Moussaka':                                         { newName: null,                                    cat: 'Plats'     },
  'Moussaka de saison':                               { newName: 'Moussaka de Saison',                    cat: 'Plats'     },
  'MOUSSAKA VEGETARIENNE':                            { newName: 'Moussaka Végétarienne',                 cat: 'Plats'     },
  'Pastitio':                                         { newName: null,                                    cat: 'Plats'     },
  'Potatoes Grecques':                                { newName: null,                                    cat: 'Plats'     },
  'Poulet':                                           { newName: null,                                    cat: 'Plats'     },
  'Poulet Safran':                                    { newName: null,                                    cat: 'Plats'     },

  // ── Bowl ─────────────────────────────────────────────────
  'Boulette Agneau':                                  { newName: null,                                    cat: 'Bowl'      },
  'Boulette Kefta':                                   { newName: null,                                    cat: 'Bowl'      },
  'Boulette Veggie':                                  { newName: null,                                    cat: 'Bowl'      },
  'Brochette de Poulet Mariné au Citron':             { newName: null,                                    cat: 'Bowl'      },
  'Légumes Rôtis':                                    { newName: null,                                    cat: 'Bowl'      },
  'Orzo et Sauce Tomate Maison':                      { newName: null,                                    cat: 'Bowl'      },
  'Orzo nature':                                      { newName: 'Orzo Nature',                           cat: 'Bowl'      },
  'RIZ A LA TOMATE':                                  { newName: 'Riz à la Tomate',                       cat: 'Bowl'      },
  'Riz au Chou':                                      { newName: null,                                    cat: 'Bowl'      },
  'Riz Epinard':                                      { newName: 'Riz Épinard',                           cat: 'Bowl'      },
  'Riz noir':                                         { newName: null,                                    cat: 'Bowl'      },

  // ── Tiropitas ────────────────────────────────────────────
  'Tiropita bleu, tombée de poireaux, noix, feta':   { newName: 'Tiropita Bleu, Tombée de Poireaux, Noix, Feta', cat: 'Tiropitas' },
  'Tiropita butternut, coriandre, harissa, feta':    { newName: 'Tiropita Butternut, Coriandre, Harissa, Feta',  cat: 'Tiropitas' },
  'Tiropita Champignons Persillés':                   { newName: null,                                    cat: 'Tiropitas' },
  'Tiropita Chocolat noisettes':                      { newName: 'Tiropita Chocolat Noisettes',           cat: 'Tiropitas' },
  'Tiropita Chou Fleur, Citron, Amande':              { newName: null,                                    cat: 'Tiropitas' },
  'TIROPITA CORDON BLEU':                             { newName: 'Tiropita Cordon Bleu',                  cat: 'Tiropitas' },
  'Tiropita Courgettes, Petits pois, Menthe, Feta':  { newName: 'Tiropita Courgettes, Petits Pois, Menthe, Feta', cat: 'Tiropitas' },
  'Tiropita épinards, Olives de Kalamata & Feta':    { newName: null,                                    cat: 'Tiropitas' },
  'Tiropita Légumes du Soleil, Feta':                 { newName: null,                                    cat: 'Tiropitas' },
  'Tiropita Menthe, Feta':                            { newName: null,                                    cat: 'Tiropitas' },
  'Tiropita Moussaka':                                { newName: null,                                    cat: 'Tiropitas' },
  'Tiropita Poulet Grenade':                          { newName: null,                                    cat: 'Tiropitas' },
  'Tiropita tomates séchées, menthe, feta':           { newName: 'Tiropita Tomates Séchées, Menthe, Feta', cat: 'Tiropitas' },

  // ── Salades ──────────────────────────────────────────────
  "Salade d'Orzo":                                    { newName: null,                                    cat: 'Salades'   },
  'SALADE DE BLACK EYED PEAS':                        { newName: 'Salade de Black Eyed Peas',             cat: 'Salades'   },
  'SALADE DE HARICOTS GIGANTES':                      { newName: 'Salade de Haricots Gigantes',           cat: 'Salades'   },
  'Salade de lentilles':                              { newName: 'Salade de Lentilles',                   cat: 'Salades'   },
  'Salade de poulpe':                                 { newName: 'Salade de Poulpe',                      cat: 'Salades'   },
  'Salade Fenouil et Orange':                         { newName: null,                                    cat: 'Salades'   },
  'Salade Grecque':                                   { newName: null,                                    cat: 'Salades'   },
  'Salade riz noir pastèque feta':                    { newName: 'Salade Riz Noir Pastèque Feta',         cat: 'Salades'   },
  'Taboulé':                                          { newName: null,                                    cat: 'Salades'   },

  // ── Desserts ─────────────────────────────────────────────
  'brownie':                                          { newName: 'Brownie',                               cat: 'Desserts'  },
  "BROWNIE CHOCOLAT & HUILE D'OLIVE":                 { newName: "Brownie Chocolat & Huile d'Olive",      cat: 'Desserts'  },
  'CAPRICE 400G':                                     { newName: 'Caprice 400G',                          cat: 'Desserts'  },
  'CHEESECAKE À LA FETA ET CONFITURE CERISE':         { newName: 'Cheesecake à la Feta et Confiture Cerise', cat: 'Desserts' },
  'Cookie Chocolat & Fleur de Sel':                   { newName: null,                                    cat: 'Desserts'  },
  'Cookie Chocolat & Olive':                          { newName: null,                                    cat: 'Desserts'  },
  'Cookie Chocolat & Pistache':                       { newName: null,                                    cat: 'Desserts'  },
  'FLAN GREC':                                        { newName: 'Flan Grec',                             cat: 'Desserts'  },
  'Mousse au Chocolat':                               { newName: null,                                    cat: 'Desserts'  },
  'Pastèque':                                         { newName: null,                                    cat: 'Desserts'  },
  'Portokalopita':                                    { newName: null,                                    cat: 'Desserts'  },
  'RIZ AU LAIT CANNELLE':                             { newName: 'Riz au Lait Cannelle',                  cat: 'Desserts'  },
  'Sirop':                                            { newName: null,                                    cat: 'Desserts'  },

  // ── Boissons ─────────────────────────────────────────────
  'BIÈRE MYTHOS':                                     { newName: 'Bière Mythos',                          cat: 'Boissons'  },

  // ── Autre (ingrédients, production, saisonniers) ─────────
  'Concombre':                                        { newName: null,                                    cat: 'Autre'     },
  'Crème':                                            { newName: null,                                    cat: 'Autre'     },
  "GIGOT D'AGNEAU DE PAQUES":                         { newName: "Gigot d'Agneau de Pâques",              cat: 'Autre'     },
  'Jus de Citron':                                    { newName: null,                                    cat: 'Autre'     },
  'Lait':                                             { newName: null,                                    cat: 'Autre'     },
  'Menthe':                                           { newName: null,                                    cat: 'Autre'     },
  'OEUF DE PAQUES':                                   { newName: 'Oeuf de Pâques',                        cat: 'Autre'     },
  'Œufs':                                             { newName: null,                                    cat: 'Autre'     },
  'Tomates':                                          { newName: null,                                    cat: 'Autre'     },
  'tomates séchées':                                  { newName: 'Tomates Séchées',                       cat: 'Autre'     },
  'Vinaigre':                                         { newName: null,                                    cat: 'Autre'     },
  'Vinaigrette':                                      { newName: null,                                    cat: 'Autre'     },
  'yaourt':                                           { newName: 'Yaourt',                                cat: 'Autre'     },

  // ── Autre + désactiver (non-alimentaires) ────────────────
  'cellophane':                                       { newName: 'Cellophane',                            cat: 'Autre'     },
  'gants':                                            { newName: 'Gants',                                 cat: 'Autre'     },
  'liquide vaisselle':                                { newName: 'Liquide Vaisselle',                     cat: 'Autre'     },
  'nettoyant surface':                                { newName: 'Nettoyant Surface',                     cat: 'Autre'     },
  'papier sulfurisé':                                 { newName: 'Papier Sulfurisé',                      cat: 'Autre'     },
  'savon main':                                       { newName: 'Savon Main',                            cat: 'Autre'     },
}

async function run() {
  const snap = await db.collection('catalogue').get()
  let updated = 0, deleted = 0, skipped = []

  const batch = db.batch()
  let batchCount = 0

  for (const d of snap.docs) {
    const name = (d.data().name || '').trim()

    // ── Suppression doublons ──────────────────────────────
    if (TO_DELETE.has(name)) {
      batch.delete(d.ref)
      batchCount++
      console.log(`🗑  DELETE  "${name}"`)
      deleted++
      continue
    }

    const mapping = MAP[name]
    if (!mapping) {
      skipped.push(name)
      continue
    }

    const updates = { defaultCategory: mapping.cat }

    // Nouveau nom ?
    if (mapping.newName) {
      updates.name = mapping.newName
    }

    // Désactivation ?
    if (TO_DEACTIVATE.has(name)) {
      updates.active = false
    }

    batch.update(d.ref, updates)
    batchCount++

    const displayName = mapping.newName ? `"${name}" → "${mapping.newName}"` : `"${name}"`
    const deactStr = TO_DEACTIVATE.has(name) ? ' [DÉSACTIVÉ]' : ''
    console.log(`✅ [${mapping.cat.padEnd(9)}] ${displayName}${deactStr}`)
    updated++

    // Firestore batch limit = 500
    if (batchCount >= 490) {
      await batch.commit()
      batchCount = 0
    }
  }

  if (batchCount > 0) await batch.commit()

  console.log('\n─────────────────────────────────────────')
  console.log(`✅ Mis à jour : ${updated}`)
  console.log(`🗑  Supprimés : ${deleted}`)
  if (skipped.length) {
    console.log(`⚠️  Non mappés (${skipped.length}) :`)
    skipped.forEach(n => console.log(`   • "${n}"`))
  } else {
    console.log('✅ Tous les produits ont été mappés')
  }
}

run().catch(e => { console.error('ERREUR:', e.message); process.exit(1) })
