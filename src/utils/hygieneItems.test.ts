import { describe, it, expect } from 'vitest'
import {
  ITEMS_ORIGINE, CHECKLIST_KINDS, mergeHygieneItems,
  debutPeriode, itemsPourPeriode, idsAttendus, slugPourLabel,
} from './hygieneItems'

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0)

describe("items d'origine", () => {
  it('compte 13 quotidiens, 5 hebdo, 1 mensuel', () => {
    expect(ITEMS_ORIGINE.quotidien).toHaveLength(13)
    expect(ITEMS_ORIGINE.hebdo).toHaveLength(5)
    expect(ITEMS_ORIGINE.mensuel).toHaveLength(1)
  })

  it("n'ont pas de date de création — ils précèdent toute modification", () => {
    for (const k of CHECKLIST_KINDS) {
      for (const item of ITEMS_ORIGINE[k]) expect(item.creeLe).toBeUndefined()
    }
  })

  it('sont tous actifs et ordonnés sans trou', () => {
    for (const k of CHECKLIST_KINDS) {
      ITEMS_ORIGINE[k].forEach((item, i) => {
        expect(item.actif).toBe(true)
        expect(item.ordre).toBe(i)
      })
    }
  })

  it('portent les identifiants historiques exacts', () => {
    expect(ITEMS_ORIGINE.quotidien[0].id).toBe('plats_service')
    expect(ITEMS_ORIGINE.hebdo[0].id).toBe('int_frigos')
    expect(ITEMS_ORIGINE.mensuel[0].id).toBe('placard_rangement')
  })
})

describe("mergeHygieneItems", () => {
  it("rend les items d'origine sur un document absent", () => {
    expect(mergeHygieneItems(undefined)).toEqual(ITEMS_ORIGINE)
    expect(mergeHygieneItems({})).toEqual(ITEMS_ORIGINE)
  })

  it("remplace entièrement une liste fournie", () => {
    const perso = [{ id: 'a', label: 'A', actif: true, ordre: 0 }]
    const merged = mergeHygieneItems({ quotidien: perso })
    expect(merged.quotidien).toEqual(perso)
    // Les listes non fournies gardent leurs items d'origine.
    expect(merged.hebdo).toEqual(ITEMS_ORIGINE.hebdo)
  })

  it("ignore une liste qui n'est pas un tableau", () => {
    expect(mergeHygieneItems({ hebdo: 'nope' }).hebdo).toEqual(ITEMS_ORIGINE.hebdo)
  })

  it("trie par ordre croissant", () => {
    const merged = mergeHygieneItems({ mensuel: [
      { id: 'b', label: 'B', actif: true, ordre: 5 },
      { id: 'a', label: 'A', actif: true, ordre: 1 },
    ] })
    expect(merged.mensuel.map(i => i.id)).toEqual(['a', 'b'])
  })
})

describe("debutPeriode", () => {
  it("rend le jour même à minuit pour le quotidien", () => {
    const d = debutPeriode('quotidien', at(2026, 7, 29, 18))
    expect(d.getDate()).toBe(29)
    expect(d.getHours()).toBe(0)
  })

  it("rend le lundi de la semaine ISO pour l'hebdo", () => {
    const d = debutPeriode('hebdo', at(2026, 7, 30)) // jeudi
    expect(d.getDate()).toBe(27)                     // lundi
    expect(d.getHours()).toBe(0)
  })

  it("rend le 1er du mois pour le mensuel", () => {
    const d = debutPeriode('mensuel', at(2026, 7, 29))
    expect(d.getDate()).toBe(1)
    expect(d.getMonth()).toBe(6)
  })
})

describe("itemsPourPeriode — la garantie centrale", () => {
  const nouveau = (creeLe: Date) => ({
    quotidien: [
      ...ITEMS_ORIGINE.quotidien,
      { id: 'nouveau', label: 'Nouveau', actif: true, ordre: 13, creeLe },
    ],
    hebdo: [
      ...ITEMS_ORIGINE.hebdo,
      { id: 'neuf_hebdo', label: 'Neuf', actif: true, ordre: 5, creeLe },
    ],
    mensuel: [
      ...ITEMS_ORIGINE.mensuel,
      { id: 'neuf_mensuel', label: 'Neuf', actif: true, ordre: 1, creeLe },
    ],
  })

  // Le besoin exprimé mot pour mot : « je ne veux pas que si j'ajoute un item
  // le 29 ça me mette le mois passé en incomplet ».
  it("un item créé le 29 ne compte pas pour le mois en cours", () => {
    const s = nouveau(at(2026, 7, 29))
    const ids = idsAttendus(s, 'mensuel', at(2026, 7, 31))
    expect(ids).not.toContain('neuf_mensuel')
    expect(ids).toHaveLength(1)
  })

  it("mais compte pour le mois suivant", () => {
    const s = nouveau(at(2026, 7, 29))
    expect(idsAttendus(s, 'mensuel', at(2026, 8, 3))).toContain('neuf_mensuel')
  })

  // « Idem pour un item hebdo entré le mercredi, la semaine ne doit pas être
  // affichée incomplète ».
  it("un item hebdo créé le mercredi ne compte pas pour la semaine en cours", () => {
    const s = nouveau(at(2026, 7, 29))             // mercredi
    const ids = idsAttendus(s, 'hebdo', at(2026, 7, 31)) // vendredi, même semaine
    expect(ids).not.toContain('neuf_hebdo')
  })

  it("mais compte pour la semaine suivante", () => {
    const s = nouveau(at(2026, 7, 29))
    expect(idsAttendus(s, 'hebdo', at(2026, 8, 5))).toContain('neuf_hebdo')
  })

  it("un item quotidien créé aujourd'hui compte à partir de demain", () => {
    const s = nouveau(at(2026, 7, 29, 14))
    expect(idsAttendus(s, 'quotidien', at(2026, 7, 29, 18))).not.toContain('nouveau')
    expect(idsAttendus(s, 'quotidien', at(2026, 7, 30, 9))).toContain('nouveau')
  })

  it("exclut les items désactivés", () => {
    const s = { ...ITEMS_ORIGINE, mensuel: [
      { ...ITEMS_ORIGINE.mensuel[0], actif: false },
    ] }
    expect(idsAttendus(s, 'mensuel', at(2026, 7, 15))).toEqual([])
  })

  it("inclut les items d'origine quelle que soit la période", () => {
    expect(idsAttendus(ITEMS_ORIGINE, 'quotidien', at(2020, 1, 1))).toHaveLength(13)
  })
})

describe("itemsPourPeriode — période déjà sauvegardée", () => {
  // Deuxième protection : une resauvegarde ne rebat pas les cartes.
  it("respecte itemsAttendus quand il existe, sans le recalculer", () => {
    const s = mergeHygieneItems({})
    const fige = ['plats_service', 'ustensiles']
    const items = itemsPourPeriode(s, 'quotidien', new Date(), fige)
    expect(items.map(i => i.id)).toEqual(fige)
  })

  it("affiche un identifiant inconnu plutôt que de le faire disparaître", () => {
    const s = mergeHygieneItems({})
    const items = itemsPourPeriode(s, 'quotidien', new Date(), ['inconnu_xyz'])
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('inconnu_xyz')
    expect(items[0].label).toBe('inconnu_xyz')
  })

  it("rend un item désactivé s'il figure dans itemsAttendus", () => {
    const s = { ...ITEMS_ORIGINE, mensuel: [{ ...ITEMS_ORIGINE.mensuel[0], actif: false }] }
    const items = itemsPourPeriode(s, 'mensuel', new Date(), ['placard_rangement'])
    expect(items.map(i => i.id)).toEqual(['placard_rangement'])
  })
})

describe("slugPourLabel", () => {
  it("produit un identifiant lisible", () => {
    expect(slugPourLabel('Plan de travail', [])).toBe('plan_de_travail')
  })

  it("retire les accents et la ponctuation", () => {
    expect(slugPourLabel('Évier / Distributeur papier', [])).toBe('evier_distributeur_papier')
  })

  it("suffixe en cas de collision", () => {
    expect(slugPourLabel('Vitres', ['vitres'])).toBe('vitres_2')
    expect(slugPourLabel('Vitres', ['vitres', 'vitres_2'])).toBe('vitres_3')
  })

  it("rend un identifiant utilisable même pour un libellé vide", () => {
    expect(slugPourLabel('   ', []).length).toBeGreaterThan(0)
  })

  // Correctif 5 : la troncature à 40 caractères doit précéder le nettoyage
  // des underscores de bord, sinon la coupe peut laisser un `_` final.
  it("ne se termine jamais par un underscore après troncature d'un libellé long", () => {
    const label = 'a'.repeat(39) + ' extra texte bien plus long que la limite autorisée'
    const slug = slugPourLabel(label, [])
    expect(slug.length).toBeLessThanOrEqual(40)
    expect(slug.endsWith('_')).toBe(false)
  })
})

describe("creeLeMs — correctif 1 : distinguer absent et illisible", () => {
  // Le scénario exact que la fonctionnalité existe pour empêcher : une date
  // corrompue (édition manuelle Firestore, migration ratée) ne doit JAMAIS
  // rendre un item éligible pour une période qu'il n'a pas pu voir passer.
  const avecCreeLeCorrompu = (creeLe: any) => ({
    ...ITEMS_ORIGINE,
    mensuel: [
      ...ITEMS_ORIGINE.mensuel,
      { id: 'corrompu', label: 'Corrompu', actif: true, ordre: 1, creeLe },
    ],
  })

  it.each([
    ['objet vide', {}],
    ['chaîne invalide', 'pas-une-date'],
    ['objet inattendu', { foo: 'bar' }],
  ])("une date illisible (%s) n'apparaît pour aucune période, courante ou passée", (_label, creeLe) => {
    const s = avecCreeLeCorrompu(creeLe)
    // Période "courante" au sens de l'appel — jamais éligible pour elle-même.
    expect(idsAttendus(s, 'mensuel', at(2026, 7, 29))).not.toContain('corrompu')
    // Ni pour un mois antérieur : aucune application rétroactive.
    expect(idsAttendus(s, 'mensuel', at(2026, 6, 15))).not.toContain('corrompu')
    expect(idsAttendus(s, 'mensuel', at(2020, 1, 1))).not.toContain('corrompu')
  })

  it("un `creeLe` absent reste toujours éligible (item d'origine)", () => {
    // Non-régression : absent ≠ illisible, les deux ne doivent pas être
    // traités pareil.
    expect(idsAttendus(ITEMS_ORIGINE, 'mensuel', at(2020, 1, 1))).toContain('placard_rangement')
  })
})

describe("desactiveLe — correctif 2 : retirer un item n'allège pas une période commencée", () => {
  it("un item désactivé après le début de la période compte encore pour cette période", () => {
    // Checklist mensuelle à un seul item, désactivé le 5 — avant toute
    // sauvegarde de la période. Le mois doit rester exigeant, pas retomber
    // à zéro item.
    const s = { ...ITEMS_ORIGINE, mensuel: [
      { ...ITEMS_ORIGINE.mensuel[0], actif: false, desactiveLe: at(2026, 7, 5) },
    ] }
    expect(idsAttendus(s, 'mensuel', at(2026, 7, 31))).toContain('placard_rangement')
  })

  it("mais plus pour la période suivante", () => {
    const s = { ...ITEMS_ORIGINE, mensuel: [
      { ...ITEMS_ORIGINE.mensuel[0], actif: false, desactiveLe: at(2026, 7, 5) },
    ] }
    expect(idsAttendus(s, 'mensuel', at(2026, 8, 3))).not.toContain('placard_rangement')
  })

  it("désactivé exactement au début de la période → n'est plus compté", () => {
    // Symétrique de la règle de création (`creeLe < debut` strict) : ici
    // `desactiveLe >= debut` compte encore, donc une désactivation pile au
    // début de la période suivante l'exclut bien de celle-ci.
    const s = { ...ITEMS_ORIGINE, mensuel: [
      { ...ITEMS_ORIGINE.mensuel[0], actif: false, desactiveLe: at(2026, 8, 1, 0) },
    ] }
    expect(idsAttendus(s, 'mensuel', at(2026, 8, 15))).toContain('placard_rangement')
    expect(idsAttendus(s, 'mensuel', at(2026, 9, 1))).not.toContain('placard_rangement')
  })

  it("réactiver (desactiveLe effacé) rend l'item de nouveau pleinement éligible", () => {
    const s = { ...ITEMS_ORIGINE, mensuel: [
      { ...ITEMS_ORIGINE.mensuel[0], actif: true }, // desactiveLe absent = réactivé
    ] }
    expect(idsAttendus(s, 'mensuel', at(2026, 7, 31))).toContain('placard_rangement')
  })

  it("inactif sans desactiveLe connu (donnée antérieure au champ) reste exclu — non-régression", () => {
    const s = { ...ITEMS_ORIGINE, mensuel: [
      { ...ITEMS_ORIGINE.mensuel[0], actif: false },
    ] }
    expect(idsAttendus(s, 'mensuel', at(2026, 7, 15))).toEqual([])
  })

  it("desactiveLe illisible ne retire jamais rétroactivement l'item (traité comme maintenant)", () => {
    // Miroir du correctif 1 : une désactivation dont l'instant est inconnu
    // doit rester prudente dans l'autre sens — ne jamais alléger une
    // période, ni la courante ni une passée.
    const s = { ...ITEMS_ORIGINE, mensuel: [
      { ...ITEMS_ORIGINE.mensuel[0], actif: false, desactiveLe: {} },
    ] }
    expect(idsAttendus(s, 'mensuel', at(2026, 7, 29))).toContain('placard_rangement')
    expect(idsAttendus(s, 'mensuel', at(2026, 6, 15))).toContain('placard_rangement')
  })
})

describe("itemsAttendus / merge — correctif 3 : distinguer absent et vide", () => {
  it("respecte une liste attendue explicitement vide, sans repli sur le calcul par date", () => {
    const s = mergeHygieneItems({})
    const items = itemsPourPeriode(s, 'quotidien', new Date(), [])
    expect(items).toEqual([])
  })

  it("mergeHygieneItems respecte une liste explicitement vidée par l'utilisateur", () => {
    const merged = mergeHygieneItems({ quotidien: [] })
    expect(merged.quotidien).toEqual([])
    // Les autres checklists non fournies gardent leur repli normal.
    expect(merged.hebdo).toEqual(ITEMS_ORIGINE.hebdo)
  })
})

describe("formes de date — correctif 4 : Timestamp Firestore, objet sérialisé, Date", () => {
  const timestampLike = (ms: number) => ({ toMillis: () => ms })
  const serialise = (ms: number) => ({ seconds: Math.floor(ms / 1000) })

  it("creeLe en Timestamp Firestore (toMillis) est respecté", () => {
    const creeLe = timestampLike(at(2026, 7, 29).getTime())
    const s = { ...ITEMS_ORIGINE, mensuel: [
      ...ITEMS_ORIGINE.mensuel,
      { id: 'via_timestamp', label: 'Via Timestamp', actif: true, ordre: 1, creeLe },
    ] }
    expect(idsAttendus(s, 'mensuel', at(2026, 7, 31))).not.toContain('via_timestamp')
    expect(idsAttendus(s, 'mensuel', at(2026, 8, 3))).toContain('via_timestamp')
  })

  it("creeLe en objet sérialisé { seconds } est respecté", () => {
    const creeLe = serialise(at(2026, 7, 29).getTime())
    const s = { ...ITEMS_ORIGINE, mensuel: [
      ...ITEMS_ORIGINE.mensuel,
      { id: 'via_seconds', label: 'Via seconds', actif: true, ordre: 1, creeLe },
    ] }
    expect(idsAttendus(s, 'mensuel', at(2026, 7, 31))).not.toContain('via_seconds')
    expect(idsAttendus(s, 'mensuel', at(2026, 8, 3))).toContain('via_seconds')
  })

  it("creeLe en Date native est respecté (cas déjà couvert, gardé pour symétrie)", () => {
    const creeLe = at(2026, 7, 29)
    const s = { ...ITEMS_ORIGINE, mensuel: [
      ...ITEMS_ORIGINE.mensuel,
      { id: 'via_date', label: 'Via Date', actif: true, ordre: 1, creeLe },
    ] }
    expect(idsAttendus(s, 'mensuel', at(2026, 7, 31))).not.toContain('via_date')
    expect(idsAttendus(s, 'mensuel', at(2026, 8, 3))).toContain('via_date')
  })

  it("desactiveLe en Timestamp Firestore (toMillis) est respecté", () => {
    const desactiveLe = timestampLike(at(2026, 7, 5).getTime())
    const s = { ...ITEMS_ORIGINE, mensuel: [
      { ...ITEMS_ORIGINE.mensuel[0], actif: false, desactiveLe },
    ] }
    expect(idsAttendus(s, 'mensuel', at(2026, 7, 31))).toContain('placard_rangement')
    expect(idsAttendus(s, 'mensuel', at(2026, 8, 3))).not.toContain('placard_rangement')
  })

  it("desactiveLe en objet sérialisé { seconds } est respecté", () => {
    const desactiveLe = serialise(at(2026, 7, 5).getTime())
    const s = { ...ITEMS_ORIGINE, mensuel: [
      { ...ITEMS_ORIGINE.mensuel[0], actif: false, desactiveLe },
    ] }
    expect(idsAttendus(s, 'mensuel', at(2026, 7, 31))).toContain('placard_rangement')
    expect(idsAttendus(s, 'mensuel', at(2026, 8, 3))).not.toContain('placard_rangement')
  })
})
