/** Logique pure des périodes d'hygiène — aucun import firebase, pour
 *  rester testable. Duplique volontairement src/modules/corner/utils/hygiene.ts :
 *  ce projet n'a pas d'import cross-package entre le client et les fonctions.
 *  Les tests des deux côtés vérifient les mêmes identifiants. */

export type HygieneKind = 'hebdo' | 'mensuel'

/** Les jalons ne portent plus un délai dans leur nom : ce délai est réglable.
 *  Appeler « j-3 » un rappel placé à J-5 serait trompeur. */
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

/** Checklist quotidienne — 13 items, recopiés à l'identique de
 *  src/modules/corner/utils/hygiene.ts. Le récapitulatif du lundi en a
 *  besoin pour rendre le même verdict que le Dashboard : sans cette liste
 *  il retombait sur « le document existe = c'est fait ». */
export const QUOTIDIEN_IDS = [
  'plats_service', 'int_vitrines', 'ustensiles', 'meuble_vente',
  'comptoir_balance', 'micro_ondes', 'evier_papier', 'etiquettes',
  'plan_travail', 'ext_placards', 'ext_frigo', 'poubelle', 'vitres',
]

export const HEBDO_IDS = [
  'int_frigos', 'etageres_materiels', 'support_papier',
  'placard_hygiene', 'machine_glacon',
]

export const MENSUEL_IDS = ['placard_rangement']

/** Ces valeurs reproduisent exactement le comportement figé de la révision 1.
 *  Elles sont dupliquées dans src/utils/hygieneSettings.ts — les tests des
 *  deux côtés assertent les mêmes littéraux pour verrouiller cet accord. */
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

const JALONS: JalonKey[] = ['rappel1', 'rappel2', 'escalade']

/** Fusion champ par champ avec les défauts. Un document absent, partiel, ou
 *  écrit par la révision 1 doit produire le comportement d'origine — c'est ce
 *  qui garantit que rendre ces réglages configurables ne casse rien pour qui
 *  n'y touche jamais. */
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

export function itemIdsFor(kind: HygieneKind): string[] {
  return kind === 'hebdo' ? HEBDO_IDS : MENSUEL_IDS
}

const pad = (n: number) => String(n).padStart(2, '0')

function thursdayOfISOWeek(d: Date): Date {
  const date = new Date(d)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7))
  return date
}

function isoWeek(d: Date): number {
  const thursday = thursdayOfISOWeek(d)
  const week1 = new Date(thursday.getFullYear(), 0, 4)
  return 1 + Math.round(
    ((thursday.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7
  )
}

export function getPeriodId(kind: HygieneKind, ref: Date): string {
  if (kind === 'hebdo') {
    return `${thursdayOfISOWeek(ref).getFullYear()}-W${pad(isoWeek(ref))}_hebdo`
  }
  return `${ref.getFullYear()}-${pad(ref.getMonth() + 1)}_mensuel`
}

/** Dernier jour du mois de `d`. Jour 0 du mois suivant = dernier jour du mois courant. */
function lastDayOfMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

/**
 * Quel jalon correspond à cet instant, selon la configuration.
 * `now` doit être une date exprimée en heure murale de Paris.
 *
 * Collision : si deux jalons partagent le même créneau, le plus grave
 * l'emporte et un seul message part. L'interface avertit au réglage.
 */
export function resolveJalon(
  kind: HygieneKind,
  now: Date,
  config: HygieneSettings,
): JalonKey | null {
  const heure = now.getHours()
  // Ordre DÉCROISSANT de gravité : le premier qui correspond gagne, donc en
  // cas de collision sur un même créneau c'est le plus grave qui part.
  // ⚠️ `JALONS` dans src/utils/hygieneSettings.ts porte l'ordre inverse, et
  // l'avertissement de collision de l'interface en dépend pour désigner le
  // bon gagnant. Répercuter toute modification de priorité des deux côtés.
  const parGravite: JalonKey[] = ['escalade', 'rappel2', 'rappel1']

  if (kind === 'hebdo') {
    const jour = now.getDay() // 0 = dimanche
    for (const cle of parGravite) {
      const j = config.hebdo[cle]
      if (j.actif && j.jour === jour && j.heure === heure) return cle
    }
    return null
  }

  const restants = lastDayOfMonth(now) - now.getDate()
  for (const cle of parGravite) {
    const j = config.mensuel[cle]
    if (j.actif && j.joursAvantFin === restants && j.heure === heure) return cle
  }
  return null
}

export function isHygieneDone(
  items: Record<string, boolean> | undefined | null,
  ids: string[],
): boolean {
  if (!items) return false
  return ids.every(id => items[id] === true)
}

/** Heure murale de Paris, quel que soit le fuseau du conteneur.
 *  Même approche que les fonctions planifiées déjà en place. */
export function parisNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }))
}
