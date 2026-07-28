import { describe, it, expect } from 'vitest'
import {
  DEFAULT_HYGIENE_SETTINGS, mergeHygieneSettings,
  collisionsHebdo, collisionsMensuel, JOURS, JALON_LABELS,
} from './hygieneSettings'

describe('valeurs par défaut', () => {
  // Ces littéraux doivent être identiques à ceux de
  // functions/src/hygiene/periods.test.ts. Une divergence ferait afficher
  // « jeudi 10h » dans l'interface pendant que la fonction Cloud enverrait
  // le rappel un autre jour, sans aucune erreur visible.
  it('reproduit les horaires de la révision 1', () => {
    const c = DEFAULT_HYGIENE_SETTINGS
    expect(c.hebdo.rappel1).toEqual({ actif: true, jour: 4, heure: 10 })
    expect(c.hebdo.rappel2).toEqual({ actif: true, jour: 6, heure: 10 })
    expect(c.hebdo.escalade).toEqual({ actif: true, jour: 0, heure: 18 })
    expect(c.mensuel.rappel1).toEqual({ actif: true, joursAvantFin: 7, heure: 10 })
    expect(c.mensuel.rappel2).toEqual({ actif: true, joursAvantFin: 2, heure: 10 })
    expect(c.mensuel.escalade).toEqual({ actif: true, joursAvantFin: 0, heure: 18 })
    expect(c.canaux.designation).toEqual({ email: true, push: true })
    expect(c.canaux.rappel).toEqual({ email: true, push: true })
    expect(c.canaux.escalade).toEqual({ email: true, push: false })
    expect(c.rappelsEnabled).toBe(true)
  })
})

describe('mergeHygieneSettings', () => {
  it('rend les défauts sur un document absent', () => {
    expect(mergeHygieneSettings(undefined)).toEqual(DEFAULT_HYGIENE_SETTINGS)
    expect(mergeHygieneSettings({})).toEqual(DEFAULT_HYGIENE_SETTINGS)
  })

  it('complète un document de la révision 1', () => {
    const merged = mergeHygieneSettings({ rappelsEnabled: true, escaladeDestinataires: ['a@b.fr'] })
    expect(merged.escaladeDestinataires).toEqual(['a@b.fr'])
    expect(merged.hebdo).toEqual(DEFAULT_HYGIENE_SETTINGS.hebdo)
  })

  it('fusionne champ par champ', () => {
    const merged = mergeHygieneSettings({ hebdo: { rappel1: { heure: 8 } } })
    expect(merged.hebdo.rappel1).toEqual({ actif: true, jour: 4, heure: 8 })
    expect(merged.hebdo.rappel2).toEqual(DEFAULT_HYGIENE_SETTINGS.hebdo.rappel2)
  })
})

describe('détection de collision', () => {
  it('ne signale rien sur la configuration par défaut', () => {
    expect(collisionsHebdo(DEFAULT_HYGIENE_SETTINGS)).toEqual([])
    expect(collisionsMensuel(DEFAULT_HYGIENE_SETTINGS)).toEqual([])
  })

  it('signale deux jalons hebdo sur le même créneau', () => {
    const cfg = mergeHygieneSettings({ hebdo: { rappel2: { jour: 0, heure: 18 } } })
    expect(collisionsHebdo(cfg)).toEqual([['rappel2', 'escalade']])
  })

  it('signale deux jalons mensuels sur le même créneau', () => {
    const cfg = mergeHygieneSettings({ mensuel: { rappel1: { joursAvantFin: 2, heure: 10 } } })
    expect(collisionsMensuel(cfg)).toEqual([['rappel1', 'rappel2']])
  })

  // Un jalon désactivé n'enverra rien : il ne peut entrer en collision
  // avec personne, et le signaler serait un faux avertissement.
  it('ignore les jalons désactivés', () => {
    const cfg = mergeHygieneSettings({
      hebdo: { rappel2: { jour: 0, heure: 18, actif: false } },
    })
    expect(collisionsHebdo(cfg)).toEqual([])
  })

  it('regroupe trois jalons sur un même créneau', () => {
    const cfg = mergeHygieneSettings({
      hebdo: { rappel1: { jour: 0, heure: 18 }, rappel2: { jour: 0, heure: 18 } },
    })
    expect(collisionsHebdo(cfg)).toEqual([['rappel1', 'rappel2', 'escalade']])
  })
})

describe('libellés', () => {
  it('couvre les sept jours, dimanche en premier', () => {
    expect(JOURS).toHaveLength(7)
    expect(JOURS[0]).toEqual({ valeur: 0, label: 'Dimanche' })
    expect(JOURS[6]).toEqual({ valeur: 6, label: 'Samedi' })
  })

  it('nomme les trois jalons', () => {
    expect(JALON_LABELS.rappel1).toBe('1er rappel')
    expect(JALON_LABELS.rappel2).toBe('2e rappel')
    expect(JALON_LABELS.escalade).toBe('Escalade')
  })
})
