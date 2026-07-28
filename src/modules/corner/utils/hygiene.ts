import { ITEMS_ORIGINE, type ChecklistKind } from '../../../utils/hygieneItems'

export type HygieneKind = 'hebdo' | 'mensuel'

/** Identifiants des items d'origine, dérivés de la définition unique du
 *  client. Côté fonctions Cloud ils sont redéclarés — aucun import n'existe
 *  entre les deux packages — mais côté client une seule source suffit. */
export const ITEMS_ORIGINE_IDS: Record<ChecklistKind, string[]> = {
  quotidien: ITEMS_ORIGINE.quotidien.map(i => i.id),
  hebdo:     ITEMS_ORIGINE.hebdo.map(i => i.id),
  mensuel:   ITEMS_ORIGINE.mensuel.map(i => i.id),
}

/** Une période est faite quand tous les items QUI LUI ÉTAIENT DEMANDÉS sont
 *  cochés. Le document porte lui-même sa référence (`itemsAttendus`), donc
 *  aucune lecture supplémentaire n'est nécessaire ici. */
export function estComplete(docData: any, kind: ChecklistKind): boolean {
  if (!docData) return false
  const attendus: string[] = Array.isArray(docData.itemsAttendus) && docData.itemsAttendus.length
    ? docData.itemsAttendus
    : ITEMS_ORIGINE_IDS[kind]
  const items = docData.items ?? {}
  return attendus.every(id => items[id] === true)
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
