/** Réglages des rappels d'hygiène — côté client.
 *
 *  Duplique volontairement functions/src/hygiene/periods.ts : ce projet n'a
 *  aucun mécanisme d'import entre le code client et les Cloud Functions.
 *  Les tests des deux côtés assertent les mêmes valeurs par défaut littérales,
 *  de sorte qu'une divergence casse immédiatement. */

export type JalonKey = 'rappel1' | 'rappel2' | 'escalade'

export type JalonHebdo   = { actif: boolean; jour: number; heure: number }
export type JalonMensuel = { actif: boolean; joursAvantFin: number; heure: number }
export type Canal        = { email: boolean; push: boolean }

export type HygieneSettings = {
  rappelsEnabled: boolean
  escaladeDestinataires: string[]
  hebdo:   Record<JalonKey, JalonHebdo>
  mensuel: Record<JalonKey, JalonMensuel>
  canaux:  { designation: Canal; rappel: Canal; escalade: Canal }
}

export const DEFAULT_HYGIENE_SETTINGS: HygieneSettings = {
  rappelsEnabled: true,
  escaladeDestinataires: [],
  hebdo: {
    rappel1:  { actif: true, jour: 4, heure: 10 },  // jeudi
    rappel2:  { actif: true, jour: 6, heure: 10 },  // samedi
    escalade: { actif: true, jour: 0, heure: 18 },  // dimanche
  },
  mensuel: {
    rappel1:  { actif: true, joursAvantFin: 7, heure: 10 },
    rappel2:  { actif: true, joursAvantFin: 2, heure: 10 },
    escalade: { actif: true, joursAvantFin: 0, heure: 18 },
  },
  canaux: {
    designation: { email: true, push: true },
    rappel:      { email: true, push: true },
    escalade:    { email: true, push: false },
  },
}

/** Ordre CROISSANT de gravité — l'escalade en dernier.
 *
 *  ⚠️ Cet ordre est l'inverse exact de `parGravite` dans
 *  `functions/src/hygiene/periods.ts`, et ce n'est pas une coïncidence : le
 *  serveur parcourt du plus grave au moins grave et retient le premier qui
 *  correspond, tandis que `grouperParCreneau` empile dans cet ordre-ci, ce qui
 *  place le plus grave en dernier. C'est ce qui permet à l'avertissement de
 *  collision de nommer exactement le jalon que le serveur enverra réellement.
 *
 *  Toute modification de l'ordre de priorité doit être répercutée des deux
 *  côtés — sinon l'interface annoncerait un gagnant différent de celui qui
 *  part, ce qui serait pire que pas d'avertissement du tout. */
export const JALONS: JalonKey[] = ['rappel1', 'rappel2', 'escalade']

export const JALON_LABELS: Record<JalonKey, string> = {
  rappel1:  '1er rappel',
  rappel2:  '2e rappel',
  escalade: 'Escalade',
}

/** Dimanche en premier : convention JavaScript de Date.getDay(). */
export const JOURS = [
  { valeur: 0, label: 'Dimanche' },
  { valeur: 1, label: 'Lundi' },
  { valeur: 2, label: 'Mardi' },
  { valeur: 3, label: 'Mercredi' },
  { valeur: 4, label: 'Jeudi' },
  { valeur: 5, label: 'Vendredi' },
  { valeur: 6, label: 'Samedi' },
]

/** Convertit et borne une valeur numérique lue depuis Firestore.
 *
 *  Le document `settings/hygiene_responsables` peut être édité à la main dans
 *  la console Firebase, ou écrit par un script qui sérialise tout en chaînes.
 *  `heure: "10"` comparé en `===` à un nombre dans `resolveJalon` ne
 *  correspondrait JAMAIS : le rappel ne partirait plus jamais, sans erreur,
 *  sans log, l'interface continuant d'afficher « jeu 10h ». Un simple
 *  étalement d'objets laissait passer cette valeur telle quelle.
 *
 *  ⚠️ Copie rigoureusement identique à functions/src/hygiene/periods.ts. */
function nombreBorne(brut: any, min: number, max: number, defaut: number): number {
  const n = typeof brut === 'string' ? Number(brut.trim()) : brut
  if (typeof n !== 'number' || !Number.isFinite(n)) return defaut
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** Booléen strict. `actif: "false"` sous forme de chaîne est une valeur vraie
 *  en JavaScript : un jalon affiché comme désactivé continuerait d'envoyer.
 *  Convention conservée de `rappelsEnabled` : absent (ou illisible) = actif,
 *  on n'éteint jamais un rappel par omission. */
function booleenStrict(brut: any, defaut: boolean): boolean {
  if (typeof brut === 'boolean') return brut
  if (brut === 'true')  return true
  if (brut === 'false') return false
  return defaut
}

/** Bornes de validation. `joursAvantFin` va jusqu'à 30 : c'est le maximum de
 *  jours restants réellement atteignable dans un mois de 31 jours. La saisie
 *  de la section Paramètres est volontairement plus stricte (0-27, la seule
 *  plage qui se déclenche aussi en février) — son domaine est un sous-ensemble
 *  de celui-ci, jamais l'inverse. */
const BORNES = {
  jour:          { min: 0, max: 6 },
  heure:         { min: 0, max: 23 },
  joursAvantFin: { min: 0, max: 30 },
}

export function mergeHygieneSettings(data: any): HygieneSettings {
  const d = data ?? {}
  const hebdo   = {} as Record<JalonKey, JalonHebdo>
  const mensuel = {} as Record<JalonKey, JalonMensuel>
  for (const cle of JALONS) {
    const defH = DEFAULT_HYGIENE_SETTINGS.hebdo[cle]
    const brutH = d.hebdo?.[cle] ?? {}
    hebdo[cle] = {
      actif: booleenStrict(brutH.actif, defH.actif),
      jour:  nombreBorne(brutH.jour,  BORNES.jour.min,  BORNES.jour.max,  defH.jour),
      heure: nombreBorne(brutH.heure, BORNES.heure.min, BORNES.heure.max, defH.heure),
    }
    const defM = DEFAULT_HYGIENE_SETTINGS.mensuel[cle]
    const brutM = d.mensuel?.[cle] ?? {}
    mensuel[cle] = {
      actif: booleenStrict(brutM.actif, defM.actif),
      joursAvantFin: nombreBorne(
        brutM.joursAvantFin, BORNES.joursAvantFin.min, BORNES.joursAvantFin.max, defM.joursAvantFin,
      ),
      heure: nombreBorne(brutM.heure, BORNES.heure.min, BORNES.heure.max, defM.heure),
    }
  }
  const canal = (brut: any, defaut: Canal): Canal => ({
    email: booleenStrict(brut?.email, defaut.email),
    push:  booleenStrict(brut?.push,  defaut.push),
  })
  return {
    // Absent = actif : ne jamais éteindre des rappels par omission.
    rappelsEnabled: booleenStrict(d.rappelsEnabled, true),
    escaladeDestinataires: Array.isArray(d.escaladeDestinataires) ? d.escaladeDestinataires : [],
    hebdo,
    mensuel,
    canaux: {
      designation: canal(d.canaux?.designation, DEFAULT_HYGIENE_SETTINGS.canaux.designation),
      rappel:      canal(d.canaux?.rappel,      DEFAULT_HYGIENE_SETTINGS.canaux.rappel),
      escalade:    canal(d.canaux?.escalade,    DEFAULT_HYGIENE_SETTINGS.canaux.escalade),
    },
  }
}

/** Un créneau lisible : « dimanche 18h ». C'est lui qui permet de retrouver la
 *  ligne fautive dans le bloc de réglages — sans lui, l'avertissement nomme un
 *  conflit sans dire où le corriger. */
export function formatCreneauHebdo(j: JalonHebdo): string {
  const jour = JOURS.find(x => x.valeur === j.jour)?.label.toLowerCase() ?? `jour ${j.jour}`
  return `${jour} ${j.heure}h`
}

export function formatCreneauMensuel(j: JalonMensuel): string {
  const quand = j.joursAvantFin === 0
    ? 'le dernier jour du mois'
    : `${j.joursAvantFin} jour${j.joursAvantFin > 1 ? 's' : ''} avant la fin du mois`
  return `${quand}, ${j.heure}h`
}

/** Un groupe de jalons actifs partageant un créneau, et ce créneau formaté. */
export type Collision = { jalons: JalonKey[]; creneau: string }

/** Regroupe les jalons actifs qui partagent un même créneau. Un seul message
 *  partira (le plus grave) : l'interface doit le dire au réglage plutôt que
 *  de laisser le conflit se découvrir à l'usage. */
function grouperParCreneau(
  entrees: { cle: JalonKey; actif: boolean; cleCreneau: string; creneau: string }[],
): Collision[] {
  const parCreneau = new Map<string, Collision>()
  for (const e of entrees) {
    if (!e.actif) continue
    const groupe = parCreneau.get(e.cleCreneau) ?? { jalons: [], creneau: e.creneau }
    groupe.jalons.push(e.cle)
    parCreneau.set(e.cleCreneau, groupe)
  }
  return [...parCreneau.values()].filter(groupe => groupe.jalons.length > 1)
}

export function collisionsHebdo(config: HygieneSettings): Collision[] {
  return grouperParCreneau(JALONS.map(cle => {
    const j = config.hebdo[cle]
    return { cle, actif: j.actif, cleCreneau: `${j.jour}-${j.heure}`, creneau: formatCreneauHebdo(j) }
  }))
}

export function collisionsMensuel(config: HygieneSettings): Collision[] {
  return grouperParCreneau(JALONS.map(cle => {
    const j = config.mensuel[cle]
    return {
      cle, actif: j.actif,
      cleCreneau: `${j.joursAvantFin}-${j.heure}`,
      creneau: formatCreneauMensuel(j),
    }
  }))
}

/** « A, B et C » — la simple jonction par « et » produisait « A et B et C ». */
export function enumerer(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? ''
  return `${labels.slice(0, -1).join(', ')} et ${labels[labels.length - 1]}`
}
