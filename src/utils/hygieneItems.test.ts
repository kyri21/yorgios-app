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
})
