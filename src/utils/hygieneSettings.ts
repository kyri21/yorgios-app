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

export function mergeHygieneSettings(data: any): HygieneSettings {
  const d = data ?? {}
  const hebdo   = {} as Record<JalonKey, JalonHebdo>
  const mensuel = {} as Record<JalonKey, JalonMensuel>
  for (const cle of JALONS) {
    hebdo[cle]   = { ...DEFAULT_HYGIENE_SETTINGS.hebdo[cle],   ...(d.hebdo?.[cle] ?? {}) }
    mensuel[cle] = { ...DEFAULT_HYGIENE_SETTINGS.mensuel[cle], ...(d.mensuel?.[cle] ?? {}) }
  }
  return {
    // Absent = actif : ne jamais éteindre des rappels par omission.
    rappelsEnabled: d.rappelsEnabled !== false,
    escaladeDestinataires: Array.isArray(d.escaladeDestinataires) ? d.escaladeDestinataires : [],
    hebdo,
    mensuel,
    canaux: {
      designation: { ...DEFAULT_HYGIENE_SETTINGS.canaux.designation, ...(d.canaux?.designation ?? {}) },
      rappel:      { ...DEFAULT_HYGIENE_SETTINGS.canaux.rappel,      ...(d.canaux?.rappel ?? {}) },
      escalade:    { ...DEFAULT_HYGIENE_SETTINGS.canaux.escalade,    ...(d.canaux?.escalade ?? {}) },
    },
  }
}

/** Regroupe les jalons actifs qui partagent un même créneau. Un seul message
 *  partira (le plus grave) : l'interface doit le dire au réglage plutôt que
 *  de laisser le conflit se découvrir à l'usage. */
function grouperParCreneau(entrees: { cle: JalonKey; actif: boolean; creneau: string }[]): JalonKey[][] {
  const parCreneau = new Map<string, JalonKey[]>()
  for (const e of entrees) {
    if (!e.actif) continue
    parCreneau.set(e.creneau, [...(parCreneau.get(e.creneau) ?? []), e.cle])
  }
  return [...parCreneau.values()].filter(groupe => groupe.length > 1)
}

export function collisionsHebdo(config: HygieneSettings): JalonKey[][] {
  return grouperParCreneau(JALONS.map(cle => {
    const j = config.hebdo[cle]
    return { cle, actif: j.actif, creneau: `${j.jour}-${j.heure}` }
  }))
}

export function collisionsMensuel(config: HygieneSettings): JalonKey[][] {
  return grouperParCreneau(JALONS.map(cle => {
    const j = config.mensuel[cle]
    return { cle, actif: j.actif, creneau: `${j.joursAvantFin}-${j.heure}` }
  }))
}
