export interface RestrictionRule {
  days: number[]
  hours: string[]
}

export interface Employee {
  id: string
  name: string
  initials: string
  color: string
  weeklyCapHours: number
  active: boolean
  restrictions?: RestrictionRule[]
}

export type HoursMap = Record<string, string[]>

export interface DayDraft {
  dayIndex: number
  hours: HoursMap
}

export type WeekDraft = Record<number, DayDraft>

export interface PlanningWeek {
  weekId: string
  mondayDate: string
  updatedAt: Date | null
  updatedBy: string | null
  locked: boolean
}

export type UserRole = 'patron' | 'manager' | 'corner' | 'cuisine'

export interface AppUser {
  uid: string
  email: string
  displayName?: string
  role: UserRole
}

export type AbsenceType =
  | 'conge'
  | 'sans_solde'
  | 'absence'
  | 'retard'
  | 'heures_supp'
  | 'jour_off'

export interface DayEvent {
  empId: string
  type: AbsenceType
  minutes?: number
  note?: string
}

export type WeekEvents = Record<string, DayEvent[]>

export interface EmpWeekCounter {
  empId: string
  heuresTravaillees: number
  heuresContrat: number
  heuresSupp: number
  conges: number
  sansSolde: number
  absences: number
  retardMinutes: number
  joursOff: number
}

export interface MonthlyEmployeeStats {
  empId: string
  name: string
  weeks: EmpWeekCounter[]
  total: {
    heuresTravaillees: number
    heuresSupp: number
    conges: number
    sansSolde: number
    absences: number
    retardMinutes: number
    joursOff: number
  }
}

export const HOURS = Array.from({ length: 13 }, (_, i) => i + 8)
export const DAYS_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

export function canEdit(role: string): boolean {
  return role === 'patron' || role === 'administrateur' || role === 'manager'
}

export const EMPLOYEE_COLOR_SUGGESTIONS: Record<string, string> = {
  'Markella':  '#FF1493',
  'Sébastien': '#722F37',
  'Elena':     '#2E7D32',
  'Arthur':    '#E65100',
}
