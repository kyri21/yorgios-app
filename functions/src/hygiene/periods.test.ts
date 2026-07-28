import { describe, it, expect } from 'vitest'
import {
  getPeriodId, resolveJalon, estComplete, ITEMS_ORIGINE_IDS,
  mergeHygieneSettings, DEFAULT_HYGIENE_SETTINGS,
} from './periods'

const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h, 0, 0)

describe('listes d\'items (serveur)', () => {
  // Verrouille le nombre d'items : le récap du lundi juge « fait / pas fait »
  // sur ces listes. Un item oublié ici rendrait une checklist incomplète
  // « faite » dans l'email du patron, à l'inverse du Dashboard.
  it('compte 13 items quotidiens, 5 hebdo, 1 mensuel', () => {
    expect(ITEMS_ORIGINE_IDS.quotidien).toHaveLength(13)
    expect(ITEMS_ORIGINE_IDS.hebdo).toHaveLength(5)
    expect(ITEMS_ORIGINE_IDS.mensuel).toHaveLength(1)
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

// ⚠️ TEST MIROIR — le même existe dans src/utils/hygieneSettings.test.ts.
// Les deux copies de mergeHygieneSettings sont dupliquées à la main (aucun
// import cross-package dans ce projet) : ces tests cassent si elles divergent.
describe('mergeHygieneSettings — validation des valeurs lues (miroir client)', () => {
  // Le document peut être édité à la main dans la console Firebase, ou écrit
  // par un script qui sérialise en chaînes. `heure: "10"` comparé en === à un
  // nombre ne correspondrait jamais : le rappel ne partirait plus JAMAIS,
  // sans erreur ni log, l'interface affichant toujours « jeu 10h ».
  it('convertit une heure écrite en chaîne', () => {
    const merged = mergeHygieneSettings({ hebdo: { rappel1: { heure: '8' } } })
    expect(merged.hebdo.rappel1.heure).toBe(8)
    // Et la conversion suffit pour que le jalon se déclenche à nouveau.
    expect(resolveJalon('hebdo', at(2026, 7, 30, 8), merged)).toBe('rappel1')
  })

  it('convertit jour et joursAvantFin écrits en chaînes', () => {
    const merged = mergeHygieneSettings({
      hebdo:   { rappel1: { jour: '2' } },
      mensuel: { rappel1: { joursAvantFin: '3' } },
    })
    expect(merged.hebdo.rappel1.jour).toBe(2)
    expect(merged.mensuel.rappel1.joursAvantFin).toBe(3)
  })

  it('ramène les valeurs hors bornes dans leur plage', () => {
    const merged = mergeHygieneSettings({
      hebdo:   { rappel1: { jour: 9, heure: 42 }, rappel2: { jour: -3, heure: -1 } },
      mensuel: { rappel1: { joursAvantFin: 99 }, rappel2: { joursAvantFin: -5 } },
    })
    expect(merged.hebdo.rappel1).toEqual({ actif: true, jour: 6, heure: 23 })
    expect(merged.hebdo.rappel2).toEqual({ actif: true, jour: 0, heure: 0 })
    expect(merged.mensuel.rappel1.joursAvantFin).toBe(30)
    expect(merged.mensuel.rappel2.joursAvantFin).toBe(0)
  })

  it('replie sur le défaut du champ quand la conversion échoue', () => {
    const merged = mergeHygieneSettings({
      hebdo: { rappel1: { heure: 'dix', jour: null } },
    })
    expect(merged.hebdo.rappel1).toEqual(DEFAULT_HYGIENE_SETTINGS.hebdo.rappel1)
  })

  it('arrondit une valeur décimale', () => {
    expect(mergeHygieneSettings({ hebdo: { rappel1: { heure: 10.6 } } }).hebdo.rappel1.heure).toBe(11)
  })

  // "false" est une chaîne non vide, donc vraie en JS : sans booléen strict,
  // un jalon affiché comme désactivé continuerait d'envoyer.
  it('traite la chaîne "false" comme un actif à false', () => {
    const merged = mergeHygieneSettings({
      hebdo:  { rappel1: { actif: 'false' } },
      canaux: { rappel: { push: 'false' } },
      rappelsEnabled: 'false',
    })
    expect(merged.hebdo.rappel1.actif).toBe(false)
    expect(merged.canaux.rappel.push).toBe(false)
    expect(merged.rappelsEnabled).toBe(false)
    expect(resolveJalon('hebdo', at(2026, 7, 30, 10), merged)).toBeNull()
  })

  it('traite la chaîne "true" comme un actif à true', () => {
    expect(mergeHygieneSettings({ hebdo: { rappel1: { actif: 'true' } } }).hebdo.rappel1.actif).toBe(true)
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

describe('estComplete', () => {
  const tousCoches = (ids: string[]) => Object.fromEntries(ids.map(id => [id, true]))

  it('est faux sur un document absent', () => {
    expect(estComplete(undefined, 'hebdo')).toBe(false)
    expect(estComplete(null, 'hebdo')).toBe(false)
  })

  // La protection décisive : un document antérieur à l'édition des items
  // se juge sur les items d'ORIGINE, jamais sur une liste courante qui aurait
  // pu s'allonger depuis. Sans ça, le premier ajout d'item aurait basculé
  // tout l'historique en incomplet.
  it('juge un document sans itemsAttendus sur les items d’origine', () => {
    const doc = { items: tousCoches(ITEMS_ORIGINE_IDS.hebdo) }
    expect(estComplete(doc, 'hebdo')).toBe(true)
  })

  it('est faux si un item d’origine manque', () => {
    const items = tousCoches(ITEMS_ORIGINE_IDS.hebdo)
    delete items[ITEMS_ORIGINE_IDS.hebdo[0]]
    expect(estComplete({ items }, 'hebdo')).toBe(false)
  })

  it('juge sur itemsAttendus quand il est présent', () => {
    const doc = { items: { a: true, b: true }, itemsAttendus: ['a', 'b'] }
    expect(estComplete(doc, 'hebdo')).toBe(true)
  })

  it('ignore les items cochés hors de itemsAttendus', () => {
    const doc = { items: { a: true, vieux: true }, itemsAttendus: ['a'] }
    expect(estComplete(doc, 'hebdo')).toBe(true)
  })

  it('est faux si un item attendu manque', () => {
    const doc = { items: { a: true }, itemsAttendus: ['a', 'b'] }
    expect(estComplete(doc, 'hebdo')).toBe(false)
  })

  it('couvre le quotidien', () => {
    const doc = { items: tousCoches(ITEMS_ORIGINE_IDS.quotidien) }
    expect(estComplete(doc, 'quotidien')).toBe(true)
    expect(ITEMS_ORIGINE_IDS.quotidien).toHaveLength(13)
  })
})
