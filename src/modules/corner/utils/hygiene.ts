export type HygieneKind = 'hebdo' | 'mensuel'

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

/** Décale une date sur le jeudi de sa semaine ISO — la semaine ISO est
 *  définie par le jeudi qu'elle contient. */
function thursdayOfISOWeek(d: Date): Date {
  const date = new Date(d)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7))
  return date
}

export function getISOWeek(d: Date): number {
  const thursday = thursdayOfISOWeek(d)
  const week1 = new Date(thursday.getFullYear(), 0, 4)
  return 1 + Math.round(
    ((thursday.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7
  )
}

/** Année ISO : celle du jeudi de la semaine, pas celle du jour consulté.
 *  Sans ça, le 1er janvier 2027 produirait « 2027-W53 » alors qu'il
 *  appartient à la semaine 53 de 2026. */
export function getISOWeekYear(d: Date): number {
  return thursdayOfISOWeek(d).getFullYear()
}

export function getPeriodId(kind: HygieneKind, ref: Date): string {
  if (kind === 'hebdo') {
    return `${getISOWeekYear(ref)}-W${pad(getISOWeek(ref))}_hebdo`
  }
  return `${ref.getFullYear()}-${pad(ref.getMonth() + 1)}_mensuel`
}

export function getPeriodBounds(kind: HygieneKind, ref: Date): { start: Date; end: Date } {
  if (kind === 'hebdo') {
    const dow = ref.getDay() === 0 ? 6 : ref.getDay() - 1 // lundi = 0
    const start = new Date(ref)
    start.setDate(ref.getDate() - dow)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    end.setHours(23, 59, 59, 999)
    return { start, end }
  }
  const start = new Date(ref.getFullYear(), ref.getMonth(), 1, 0, 0, 0, 0)
  // Jour 0 du mois suivant = dernier jour du mois courant.
  const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59, 999)
  return { start, end }
}

/** Une période est faite quand TOUS ses items sont cochés.
 *  L'ancienne convention « le document existe » comptait une checklist
 *  remplie à 2/5 comme terminée. */
export function isHygieneDone(
  items: Record<string, boolean> | undefined | null,
  ids: string[],
): boolean {
  if (!items) return false
  return ids.every(id => items[id] === true)
}
