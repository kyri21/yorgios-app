import { describe, it, expect } from 'vitest'
import { getPeriodId, resolveJalon, isHygieneDone, HEBDO_IDS, MENSUEL_IDS } from './periods'

const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h, 0, 0)

describe('getPeriodId (serveur)', () => {
  it('produit les mêmes identifiants que le client', () => {
    expect(getPeriodId('hebdo', at(2026, 7, 28))).toBe('2026-W31_hebdo')
    expect(getPeriodId('mensuel', at(2026, 7, 28))).toBe('2026-07_mensuel')
  })

  it('utilise l\'année ISO au passage du nouvel an', () => {
    expect(getPeriodId('hebdo', at(2027, 1, 1))).toBe('2026-W53_hebdo')
  })
})

describe('resolveJalon — hebdo', () => {
  // Semaine du lundi 27 juillet au dimanche 2 août 2026.
  it('rend j-3 le jeudi à 10h', () => {
    expect(resolveJalon('hebdo', at(2026, 7, 30, 10))).toBe('j-3')
  })

  it('ne rend rien le jeudi à 18h', () => {
    expect(resolveJalon('hebdo', at(2026, 7, 30, 18))).toBeNull()
  })

  it('rend j-1 le samedi à 10h', () => {
    expect(resolveJalon('hebdo', at(2026, 8, 1, 10))).toBe('j-1')
  })

  it('rend escalade le dimanche à 18h', () => {
    expect(resolveJalon('hebdo', at(2026, 8, 2, 18))).toBe('escalade')
  })

  it('ne rend rien le dimanche à 10h', () => {
    expect(resolveJalon('hebdo', at(2026, 8, 2, 10))).toBeNull()
  })

  it('ne rend rien un lundi', () => {
    expect(resolveJalon('hebdo', at(2026, 7, 27, 10))).toBeNull()
  })
})

describe('resolveJalon — mensuel', () => {
  it('rend j-3 sept jours avant la fin de juillet (le 24)', () => {
    expect(resolveJalon('mensuel', at(2026, 7, 24, 10))).toBe('j-3')
  })

  // Février 2026 compte 28 jours : J-7 tombe le 21, pas le 24.
  it('rend j-3 le 21 février 2026', () => {
    expect(resolveJalon('mensuel', at(2026, 2, 21, 10))).toBe('j-3')
    expect(resolveJalon('mensuel', at(2026, 2, 24, 10))).toBeNull()
  })

  it('rend j-3 le 22 février 2028 (année bissextile)', () => {
    expect(resolveJalon('mensuel', at(2028, 2, 22, 10))).toBe('j-3')
  })

  it('rend j-1 deux jours avant la fin du mois', () => {
    expect(resolveJalon('mensuel', at(2026, 7, 29, 10))).toBe('j-1')
  })

  it('rend escalade le dernier jour à 18h', () => {
    expect(resolveJalon('mensuel', at(2026, 7, 31, 18))).toBe('escalade')
    expect(resolveJalon('mensuel', at(2026, 2, 28, 18))).toBe('escalade')
  })

  it('ne rend rien le dernier jour à 10h', () => {
    expect(resolveJalon('mensuel', at(2026, 7, 31, 10))).toBeNull()
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
