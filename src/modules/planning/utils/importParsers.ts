import type { Employee, WeekDraft } from '../types'
import { HOURS } from '../types'
import { mondayOf, weekId, emptyWeekDraft } from '../firebase/planning'

export interface ImportRow {
  date: Date
  empName: string
  slots: number[]
}

export interface ImportResult {
  rows: ImportRow[]
  errors: string[]
  unknownNames: string[]
}

export interface WeekImport {
  monday: Date
  weekId: string
  draft: WeekDraft
}

function toDayIndex(d: Date): number { return (d.getDay() + 6) % 7 }

function normName(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

function findEmployee(name: string, employees: Employee[]): Employee | undefined {
  const norm = normName(name)
  return employees.find(e => normName(e.name) === norm)
}

export function parseCSV(text: string, employees: Employee[]): ImportResult {
  const lines = text.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const rows: ImportRow[] = [], errors: string[] = []
  const unknownSet = new Set<string>()
  const startLine = lines[0]?.toLowerCase().includes('date') ? 1 : 0
  for (let i = startLine; i < lines.length; i++) {
    const parts = lines[i].split(',').map(p => p.replace(/^"|"$/g, '').trim())
    if (parts.length < 4) { errors.push(`Ligne ${i + 1}: trop peu de colonnes`); continue }
    const isExportFormat = parts.length >= 5 && (parts[1] === '0' || /^\d$/.test(parts[1]))
    let dateStr: string, empNames: string[], debut: number, fin: number
    if (isExportFormat) {
      dateStr = parts[0]; debut = parseInt(parts[2]); fin = parseInt(parts[3]) - 1
      empNames = (parts[4] ?? '').split('|').map(n => n.trim()).filter(Boolean)
    } else {
      dateStr = parts[0]; empNames = [parts[1]]; debut = parseInt(parts[2]); fin = parseInt(parts[3])
    }
    const date = new Date(dateStr + 'T12:00:00')
    if (isNaN(date.getTime())) { errors.push(`Ligne ${i + 1}: date invalide "${dateStr}"`); continue }
    if (isNaN(debut) || isNaN(fin) || debut > fin) { errors.push(`Ligne ${i + 1}: plage horaire invalide (${debut}–${fin})`); continue }
    const slots = Array.from({ length: fin - debut + 1 }, (_, k) => debut + k).filter(h => HOURS.includes(h))
    for (const empName of empNames) {
      if (!findEmployee(empName, employees)) unknownSet.add(empName)
      rows.push({ date, empName, slots })
    }
  }
  return { rows, errors, unknownNames: [...unknownSet] }
}

export function parseICS(text: string, employees: Employee[]): ImportResult & { calName: string } {
  const rows: ImportRow[] = [], errors: string[] = []
  const unknownSet = new Set<string>()
  const calNameMatch = text.match(/X-WR-CALNAME:(.*)/)
  const calName = calNameMatch ? calNameMatch[1].replace('Planning Matias - ', '').trim() : ''
  const vevents = text.split('BEGIN:VEVENT').slice(1)
  for (let i = 0; i < vevents.length; i++) {
    const ve = vevents[i]
    const dtstartRaw = ve.match(/DTSTART[^:]*:([\dT]+Z?)/)?.[1]
    const dtendRaw = ve.match(/DTEND[^:]*:([\dT]+Z?)/)?.[1]
    const summary = ve.match(/SUMMARY:(.*)/)?.[1]?.trim() ?? ''
    if (!dtstartRaw || !dtendRaw) { errors.push(`Événement ${i + 1}: DTSTART ou DTEND manquant`); continue }
    const parse = (s: string) => ({
      date: new Date(parseInt(s.slice(0,4)), parseInt(s.slice(4,6))-1, parseInt(s.slice(6,8))),
      hour: parseInt(s.slice(9,11))
    })
    const { date, hour: startHour } = parse(dtstartRaw)
    const { hour: endHour } = parse(dtendRaw)
    if (isNaN(date.getTime())) { errors.push(`Événement ${i + 1}: date invalide`); continue }
    const empName = summary.split(' - ')[0].trim() || calName
    const slots = Array.from({ length: endHour - startHour }, (_, k) => startHour + k).filter(h => HOURS.includes(h))
    if (!slots.length) continue
    if (!findEmployee(empName, employees)) unknownSet.add(empName)
    rows.push({ date, empName, slots })
  }
  return { rows, errors, unknownNames: [...unknownSet], calName }
}

export function buildWeekImports(rows: ImportRow[], employees: Employee[], nameMap: Record<string, string>): WeekImport[] {
  const byId: Record<string, Employee> = {}
  employees.forEach(e => { byId[e.id] = e })
  const weekMap = new Map<string, WeekImport>()
  for (const row of rows) {
    const emp = employees.find(e => e.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim() === row.empName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim())
      ?? (nameMap[row.empName] ? byId[nameMap[row.empName]] : undefined)
    if (!emp) continue
    const mon = mondayOf(row.date)
    const wid = weekId(mon)
    if (!weekMap.has(wid)) weekMap.set(wid, { monday: mon, weekId: wid, draft: emptyWeekDraft() })
    const entry = weekMap.get(wid)!
    const dayIdx = toDayIndex(row.date)
    row.slots.forEach(h => {
      const cell = entry.draft[dayIdx]?.hours[String(h)]
      if (cell && !cell.includes(emp.id)) cell.push(emp.id)
    })
  }
  return [...weekMap.values()].sort((a, b) => a.monday.getTime() - b.monday.getTime())
}

export function countSlots(weeks: WeekImport[]): number {
  let total = 0
  weeks.forEach(({ draft }) => {
    for (let d = 0; d < 7; d++) Object.values(draft[d]?.hours ?? {}).forEach(ids => { total += ids.length })
  })
  return total
}
