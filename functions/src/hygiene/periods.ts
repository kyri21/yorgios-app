/** Logique pure des périodes d'hygiène — aucun import firebase, pour
 *  rester testable. Duplique volontairement src/modules/corner/utils/hygiene.ts :
 *  ce projet n'a pas d'import cross-package entre le client et les fonctions.
 *  Les tests des deux côtés vérifient les mêmes identifiants. */

export type HygieneKind = 'hebdo' | 'mensuel'
export type Jalon = 'j-3' | 'j-1' | 'escalade'

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
 * Quel jalon de rappel correspond à cet instant, s'il y en a un.
 * `now` doit être une date exprimée en heure murale de Paris.
 *
 * Hebdo   : jeudi 10h · samedi 10h · dimanche 18h
 * Mensuel : J-7 10h · J-2 10h · dernier jour 18h — J étant la fin du
 *           mois, calculée par soustraction et jamais sur un numéro fixe.
 */
export function resolveJalon(kind: HygieneKind, now: Date): Jalon | null {
  const heure = now.getHours()

  if (kind === 'hebdo') {
    const jour = now.getDay() // 0 = dimanche
    if (jour === 4 && heure === 10) return 'j-3'
    if (jour === 6 && heure === 10) return 'j-1'
    if (jour === 0 && heure === 18) return 'escalade'
    return null
  }

  const restants = lastDayOfMonth(now) - now.getDate()
  if (restants === 7 && heure === 10) return 'j-3'
  if (restants === 2 && heure === 10) return 'j-1'
  if (restants === 0 && heure === 18) return 'escalade'
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
