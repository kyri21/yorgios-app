import { describe, it, expect } from 'vitest'
import {
  DEFAULT_HYGIENE_SETTINGS, mergeHygieneSettings,
  collisionsHebdo, collisionsMensuel, JOURS, JALON_LABELS, enumerer,
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

// ⚠️ TEST MIROIR — le même existe dans functions/src/hygiene/periods.test.ts.
// Les deux copies de mergeHygieneSettings sont dupliquées à la main (aucun
// import cross-package dans ce projet) : ces tests cassent si elles divergent.
describe('mergeHygieneSettings — validation des valeurs lues (miroir serveur)', () => {
  // Le document peut être édité à la main dans la console Firebase, ou écrit
  // par un script qui sérialise en chaînes. `heure: "10"` comparé en === à un
  // nombre côté serveur ne correspondrait jamais : le rappel ne partirait plus
  // JAMAIS, sans erreur ni log, l'interface affichant toujours « jeu 10h ».
  it('convertit une heure écrite en chaîne', () => {
    expect(mergeHygieneSettings({ hebdo: { rappel1: { heure: '8' } } }).hebdo.rappel1.heure).toBe(8)
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
    const merged = mergeHygieneSettings({ hebdo: { rappel1: { heure: 'dix', jour: null } } })
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
  })

  it('traite la chaîne "true" comme un actif à true', () => {
    expect(mergeHygieneSettings({ hebdo: { rappel1: { actif: 'true' } } }).hebdo.rappel1.actif).toBe(true)
  })
})

describe('détection de collision', () => {
  it('ne signale rien sur la configuration par défaut', () => {
    expect(collisionsHebdo(DEFAULT_HYGIENE_SETTINGS)).toEqual([])
    expect(collisionsMensuel(DEFAULT_HYGIENE_SETTINGS)).toEqual([])
  })

  // Le créneau doit remonter jusqu'à l'affichage : c'est lui qui permet de
  // retrouver la ligne fautive dans le bloc de réglages.
  it('signale deux jalons hebdo sur le même créneau, et nomme ce créneau', () => {
    const cfg = mergeHygieneSettings({ hebdo: { rappel2: { jour: 0, heure: 18 } } })
    expect(collisionsHebdo(cfg)).toEqual([
      { jalons: ['rappel2', 'escalade'], creneau: 'dimanche 18h' },
    ])
  })

  it('signale deux jalons mensuels sur le même créneau, et nomme ce créneau', () => {
    const cfg = mergeHygieneSettings({ mensuel: { rappel1: { joursAvantFin: 2, heure: 10 } } })
    expect(collisionsMensuel(cfg)).toEqual([
      { jalons: ['rappel1', 'rappel2'], creneau: '2 jours avant la fin du mois, 10h' },
    ])
  })

  it('nomme « le dernier jour du mois » pour joursAvantFin = 0', () => {
    const cfg = mergeHygieneSettings({ mensuel: { rappel2: { joursAvantFin: 0, heure: 18 } } })
    expect(collisionsMensuel(cfg)).toEqual([
      { jalons: ['rappel2', 'escalade'], creneau: 'le dernier jour du mois, 18h' },
    ])
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
    expect(collisionsHebdo(cfg)).toEqual([
      { jalons: ['rappel1', 'rappel2', 'escalade'], creneau: 'dimanche 18h' },
    ])
  })
})

describe('énumération lisible', () => {
  // « A et B et C » se lisait mal — trois jalons en collision, c'est possible.
  it('sépare par des virgules et termine par « et »', () => {
    expect(enumerer(['A'])).toBe('A')
    expect(enumerer(['A', 'B'])).toBe('A et B')
    expect(enumerer(['A', 'B', 'C'])).toBe('A, B et C')
    expect(enumerer([])).toBe('')
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
