import { describe, it, expect } from 'vitest'
import {
  ITEMS_ORIGINE_IDS, estComplete, getISOWeek, getISOWeekYear,
  getPeriodId, getPeriodBounds,
} from './hygiene'

// Construit une date locale à midi : évite qu'un décalage de fuseau
// fasse basculer la date d'un jour.
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0)

describe('listes d\'items', () => {
  it('contient 13 items quotidiens, 5 hebdo, 1 mensuel', () => {
    expect(ITEMS_ORIGINE_IDS.quotidien).toHaveLength(13)
    expect(ITEMS_ORIGINE_IDS.hebdo).toHaveLength(5)
    expect(ITEMS_ORIGINE_IDS.mensuel).toHaveLength(1)
  })
})

describe('getISOWeek', () => {
  it('numérote la première semaine de 2026', () => {
    expect(getISOWeek(at(2026, 1, 1))).toBe(1)
  })

  it('numérote le 28 juillet 2026 en semaine 31', () => {
    expect(getISOWeek(at(2026, 7, 28))).toBe(31)
  })

  it('rattache le 1er janvier 2027 à la semaine 53 de 2026', () => {
    expect(getISOWeek(at(2027, 1, 1))).toBe(53)
  })
})

describe('getISOWeekYear', () => {
  it('rend l\'année civile en milieu d\'année', () => {
    expect(getISOWeekYear(at(2026, 7, 28))).toBe(2026)
  })

  it('rend 2026 pour le 1er janvier 2027 (semaine ISO 53 de 2026)', () => {
    expect(getISOWeekYear(at(2027, 1, 1))).toBe(2026)
  })

  it('rend 2026 pour le 31 décembre 2026', () => {
    expect(getISOWeekYear(at(2026, 12, 31))).toBe(2026)
  })
})

describe('getPeriodId', () => {
  it('produit un identifiant hebdo lisible', () => {
    expect(getPeriodId('hebdo', at(2026, 7, 28))).toBe('2026-W31_hebdo')
  })

  it('produit un identifiant mensuel lisible', () => {
    expect(getPeriodId('mensuel', at(2026, 7, 28))).toBe('2026-07_mensuel')
  })

  // Le cœur de la correction : la même semaine ISO doit produire le même
  // identifiant des deux côtés du 31 décembre.
  it('donne le même identifiant hebdo de part et d\'autre du nouvel an', () => {
    const avant = getPeriodId('hebdo', at(2026, 12, 31))
    const apres = getPeriodId('hebdo', at(2027, 1, 1))
    expect(avant).toBe('2026-W53_hebdo')
    expect(apres).toBe(avant)
  })

  it('remplit le numéro de semaine sur deux chiffres', () => {
    expect(getPeriodId('hebdo', at(2026, 1, 8))).toBe('2026-W02_hebdo')
  })

  it('rattache fin décembre 2024 à la semaine 1 de 2025', () => {
    const avant = getPeriodId('hebdo', at(2024, 12, 30))
    const apres = getPeriodId('hebdo', at(2025, 1, 2))
    expect(avant).toBe('2025-W01_hebdo')
    expect(apres).toBe(avant)
  })
})

describe('getPeriodBounds', () => {
  it('borne la semaine du lundi au dimanche', () => {
    const { start, end } = getPeriodBounds('hebdo', at(2026, 7, 30)) // un jeudi
    expect(start.getDate()).toBe(27)   // lundi 27 juillet
    expect(start.getHours()).toBe(0)
    expect(end.getDate()).toBe(2)      // dimanche 2 août
    expect(end.getMonth()).toBe(7)     // août = index 7
    expect(end.getHours()).toBe(23)
  })

  it('borne le mois du 1er au dernier jour', () => {
    const { start, end } = getPeriodBounds('mensuel', at(2026, 2, 15))
    expect(start.getDate()).toBe(1)
    expect(end.getDate()).toBe(28)     // février 2026 : 28 jours
  })

  it('gère février bissextile', () => {
    const { end } = getPeriodBounds('mensuel', at(2028, 2, 15))
    expect(end.getDate()).toBe(29)
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
