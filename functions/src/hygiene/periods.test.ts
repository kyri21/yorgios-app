import { describe, it, expect } from 'vitest'
import {
  getPeriodId, resolveJalon, isHygieneDone,
  mergeHygieneSettings, DEFAULT_HYGIENE_SETTINGS,
  HEBDO_IDS, MENSUEL_IDS, QUOTIDIEN_IDS,
} from './periods'

const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h, 0, 0)

describe('listes d\'items (serveur)', () => {
  // Verrouille le nombre d'items : le récap du lundi juge « fait / pas fait »
  // sur ces listes. Un item oublié ici rendrait une checklist incomplète
  // « faite » dans l'email du patron, à l'inverse du Dashboard.
  it('compte 13 items quotidiens, 5 hebdo, 1 mensuel', () => {
    expect(QUOTIDIEN_IDS).toHaveLength(13)
    expect(HEBDO_IDS).toHaveLength(5)
    expect(MENSUEL_IDS).toHaveLength(1)
  })
})

describe('getPeriodId (serveur)', () => {
  it('produit les mêmes identifiants que le client', () => {
    expect(getPeriodId('hebdo', at(2026, 7, 28))).toBe('2026-W31_hebdo')
    expect(getPeriodId('mensuel', at(2026, 7, 28))).toBe('2026-07_mensuel')
  })

  it('utilise l\'année ISO au passage du nouvel an', () => {
    expect(getPeriodId('hebdo', at(2027, 1, 1))).toBe('2026-W53_hebdo')
  })
})

describe('valeurs par défaut', () => {
  // Ce test verrouille l'accord avec src/utils/hygieneSettings.ts, qui
  // duplique volontairement ces valeurs. Toute divergence casse ici.
  it('reproduit les horaires de la révision 1', () => {
    expect(DEFAULT_HYGIENE_SETTINGS.hebdo.rappel1).toEqual({ actif: true, jour: 4, heure: 10 })
    expect(DEFAULT_HYGIENE_SETTINGS.hebdo.rappel2).toEqual({ actif: true, jour: 6, heure: 10 })
    expect(DEFAULT_HYGIENE_SETTINGS.hebdo.escalade).toEqual({ actif: true, jour: 0, heure: 18 })
    expect(DEFAULT_HYGIENE_SETTINGS.mensuel.rappel1).toEqual({ actif: true, joursAvantFin: 7, heure: 10 })
    expect(DEFAULT_HYGIENE_SETTINGS.mensuel.rappel2).toEqual({ actif: true, joursAvantFin: 2, heure: 10 })
    expect(DEFAULT_HYGIENE_SETTINGS.mensuel.escalade).toEqual({ actif: true, joursAvantFin: 0, heure: 18 })
  })

  it('active email et push sauf le push d\'escalade', () => {
    expect(DEFAULT_HYGIENE_SETTINGS.canaux.designation).toEqual({ email: true, push: true })
    expect(DEFAULT_HYGIENE_SETTINGS.canaux.rappel).toEqual({ email: true, push: true })
    expect(DEFAULT_HYGIENE_SETTINGS.canaux.escalade).toEqual({ email: true, push: false })
  })

  it('considère les rappels actifs par défaut', () => {
    expect(DEFAULT_HYGIENE_SETTINGS.rappelsEnabled).toBe(true)
  })
})

describe('mergeHygieneSettings', () => {
  it('rend les défauts sur un document absent', () => {
    expect(mergeHygieneSettings(undefined)).toEqual(DEFAULT_HYGIENE_SETTINGS)
    expect(mergeHygieneSettings(null)).toEqual(DEFAULT_HYGIENE_SETTINGS)
    expect(mergeHygieneSettings({})).toEqual(DEFAULT_HYGIENE_SETTINGS)
  })

  // Le cas réel : un document écrit par la révision 1, qui ne connaissait
  // que deux champs. Il doit produire le comportement d'origine.
  it('complète un document de la révision 1', () => {
    const r1 = { rappelsEnabled: true, escaladeDestinataires: ['a@b.fr'] }
    const merged = mergeHygieneSettings(r1)
    expect(merged.escaladeDestinataires).toEqual(['a@b.fr'])
    expect(merged.hebdo).toEqual(DEFAULT_HYGIENE_SETTINGS.hebdo)
    expect(merged.canaux).toEqual(DEFAULT_HYGIENE_SETTINGS.canaux)
  })

  it('fusionne champ par champ, sans écraser les voisins', () => {
    const merged = mergeHygieneSettings({ hebdo: { rappel1: { heure: 8 } } })
    expect(merged.hebdo.rappel1).toEqual({ actif: true, jour: 4, heure: 8 })
    expect(merged.hebdo.rappel2).toEqual(DEFAULT_HYGIENE_SETTINGS.hebdo.rappel2)
  })

  it('traite rappelsEnabled absent comme actif, false comme inactif', () => {
    expect(mergeHygieneSettings({}).rappelsEnabled).toBe(true)
    expect(mergeHygieneSettings({ rappelsEnabled: false }).rappelsEnabled).toBe(false)
  })

  it('ignore un escaladeDestinataires qui n\'est pas un tableau', () => {
    expect(mergeHygieneSettings({ escaladeDestinataires: 'a@b.fr' }).escaladeDestinataires).toEqual([])
  })
})

describe('resolveJalon — hebdo, configuration par défaut', () => {
  const CFG = DEFAULT_HYGIENE_SETTINGS

  it('rend rappel1 le jeudi à 10h', () => {
    expect(resolveJalon('hebdo', at(2026, 7, 30, 10), CFG)).toBe('rappel1')
  })

  it('ne rend rien le jeudi à 18h', () => {
    expect(resolveJalon('hebdo', at(2026, 7, 30, 18), CFG)).toBeNull()
  })

  it('rend rappel2 le samedi à 10h', () => {
    expect(resolveJalon('hebdo', at(2026, 8, 1, 10), CFG)).toBe('rappel2')
  })

  it('rend escalade le dimanche à 18h', () => {
    expect(resolveJalon('hebdo', at(2026, 8, 2, 18), CFG)).toBe('escalade')
  })

  it('ne rend rien un lundi', () => {
    expect(resolveJalon('hebdo', at(2026, 7, 27, 10), CFG)).toBeNull()
  })
})

describe('resolveJalon — mensuel, configuration par défaut', () => {
  const CFG = DEFAULT_HYGIENE_SETTINGS

  it('rend rappel1 sept jours avant la fin de juillet (le 24)', () => {
    expect(resolveJalon('mensuel', at(2026, 7, 24, 10), CFG)).toBe('rappel1')
  })

  // Février 2026 compte 28 jours : sept jours avant la fin, c'est le 21.
  it('rend rappel1 le 21 février 2026', () => {
    expect(resolveJalon('mensuel', at(2026, 2, 21, 10), CFG)).toBe('rappel1')
    expect(resolveJalon('mensuel', at(2026, 2, 24, 10), CFG)).toBeNull()
  })

  it('rend rappel1 le 22 février 2028 (année bissextile)', () => {
    expect(resolveJalon('mensuel', at(2028, 2, 22, 10), CFG)).toBe('rappel1')
  })

  it('rend escalade le dernier jour à 18h', () => {
    expect(resolveJalon('mensuel', at(2026, 7, 31, 18), CFG)).toBe('escalade')
    expect(resolveJalon('mensuel', at(2026, 2, 28, 18), CFG)).toBe('escalade')
  })
})

describe('resolveJalon — configuration personnalisée', () => {
  it('suit un jour et une heure déplacés', () => {
    const cfg = mergeHygieneSettings({ hebdo: { rappel1: { jour: 2, heure: 8 } } })
    expect(resolveJalon('hebdo', at(2026, 7, 28, 8), cfg)).toBe('rappel1')   // mardi 8h
    expect(resolveJalon('hebdo', at(2026, 7, 30, 10), cfg)).toBeNull()       // ancien créneau
  })

  it('ignore un jalon désactivé', () => {
    const cfg = mergeHygieneSettings({ hebdo: { rappel1: { actif: false } } })
    expect(resolveJalon('hebdo', at(2026, 7, 30, 10), cfg)).toBeNull()
  })

  // Règle de collision : le plus grave l'emporte, un seul message part.
  it('donne l\'escalade quand deux jalons partagent un créneau', () => {
    const cfg = mergeHygieneSettings({
      hebdo: { rappel2: { jour: 0, heure: 18 } },   // même créneau que l\'escalade
    })
    expect(resolveJalon('hebdo', at(2026, 8, 2, 18), cfg)).toBe('escalade')
  })

  it('donne rappel2 quand il entre en collision avec rappel1', () => {
    const cfg = mergeHygieneSettings({
      hebdo: { rappel1: { jour: 6, heure: 10 } },   // même créneau que rappel2
    })
    expect(resolveJalon('hebdo', at(2026, 8, 1, 10), cfg)).toBe('rappel2')
  })

  it('accepte un rappel mensuel le dernier jour', () => {
    const cfg = mergeHygieneSettings({ mensuel: { rappel2: { joursAvantFin: 0, heure: 9 } } })
    expect(resolveJalon('mensuel', at(2026, 7, 31, 9), cfg)).toBe('rappel2')
  })
})

describe('isHygieneDone (serveur)', () => {
  it('exige tous les items', () => {
    expect(isHygieneDone({ int_frigos: true }, HEBDO_IDS)).toBe(false)
    expect(isHygieneDone(
      Object.fromEntries(HEBDO_IDS.map(id => [id, true])), HEBDO_IDS,
    )).toBe(true)
    expect(isHygieneDone({ placard_rangement: true }, MENSUEL_IDS)).toBe(true)
  })
})
