import { describe, it, expect } from 'vitest'
import {
  QUOTIDIEN_IDS, HEBDO_IDS, MENSUEL_IDS,
  itemIdsFor, getISOWeek, getISOWeekYear,
  getPeriodId, getPeriodBounds, isHygieneDone,
} from './hygiene'

// Construit une date locale à midi : évite qu'un décalage de fuseau
// fasse basculer la date d'un jour.
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0)

describe('listes d\'items', () => {
  it('contient 13 items quotidiens, 5 hebdo, 1 mensuel', () => {
    expect(QUOTIDIEN_IDS).toHaveLength(13)
    expect(HEBDO_IDS).toHaveLength(5)
    expect(MENSUEL_IDS).toHaveLength(1)
  })

  it('itemIdsFor renvoie la bonne liste', () => {
    expect(itemIdsFor('hebdo')).toEqual(HEBDO_IDS)
    expect(itemIdsFor('mensuel')).toEqual(MENSUEL_IDS)
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

describe('isHygieneDone', () => {
  it('est faux si aucun item', () => {
    expect(isHygieneDone(undefined, HEBDO_IDS)).toBe(false)
    expect(isHygieneDone(null, HEBDO_IDS)).toBe(false)
  })

  it('est faux si la checklist est partielle', () => {
    const items = { int_frigos: true, support_papier: true }
    expect(isHygieneDone(items, HEBDO_IDS)).toBe(false)
  })

  it('est vrai si tous les items sont cochés', () => {
    const items = Object.fromEntries(HEBDO_IDS.map(id => [id, true]))
    expect(isHygieneDone(items, HEBDO_IDS)).toBe(true)
  })

  it('ignore les items décochés explicitement', () => {
    const items = Object.fromEntries(HEBDO_IDS.map(id => [id, true]))
    items[HEBDO_IDS[0]] = false
    expect(isHygieneDone(items, HEBDO_IDS)).toBe(false)
  })

  it('ignore les clés étrangères à la liste', () => {
    const items = Object.fromEntries(HEBDO_IDS.map(id => [id, true]))
    items.item_inconnu = false
    expect(isHygieneDone(items, HEBDO_IDS)).toBe(true)
  })
})
