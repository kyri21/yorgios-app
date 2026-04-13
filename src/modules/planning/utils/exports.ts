import * as XLSX from 'xlsx'
import type { WeekDraft, Employee, MonthlyEmployeeStats } from '../types'
import { HOURS } from '../types'
import { addDays, weekId } from '../firebase/planning'

export function exportCSV(monday: Date, draft: WeekDraft, employees: Employee[]) {
  const byId: Record<string, Employee> = {}
  employees.forEach(e => { byId[e.id] = e })
  const rows: string[] = ['date,jour,heure_debut,heure_fin,employes']
  for (let i = 0; i < 7; i++) {
    const day = addDays(monday, i)
    const iso = day.toISOString().slice(0, 10)
    const hours = draft[i]?.hours ?? {}
    HOURS.forEach(h => {
      const emps = (hours[String(h)] ?? []).map(id => byId[id]?.name ?? id).join('|')
      if (emps) rows.push(`${iso},${i},${h}:00,${h + 1}:00,"${emps}"`)
    })
  }
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  downloadBlob(blob, `planning_${weekId(monday)}.csv`)
}

export function exportICS(monday: Date, draft: WeekDraft, emp: Employee) {
  const lines: string[] = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    `X-WR-CALNAME:Planning Matias - ${emp.name}`,
    'PRODID:-//Matias//Planning//FR'
  ]
  for (let i = 0; i < 7; i++) {
    const day = addDays(monday, i)
    const hours = draft[i]?.hours ?? {}
    let startH: number | null = null, endH: number | null = null
    const flush = () => {
      if (startH === null || endH === null) return
      const s = dtFormat(day, startH, 0), e = dtFormat(day, endH, 0)
      const uid = `${emp.id}-${day.toISOString().slice(0, 10)}-${startH}@matias`
      lines.push('BEGIN:VEVENT', `UID:${uid}`,
        `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
        `DTSTART:${s}`, `DTEND:${e}`, `SUMMARY:${emp.name} - Service`, 'END:VEVENT')
      startH = null; endH = null
    }
    HOURS.forEach(h => {
      const present = (hours[String(h)] ?? []).includes(emp.id)
      if (present) { if (startH === null) startH = h; endH = h + 1 } else flush()
    })
    flush()
  }
  lines.push('END:VCALENDAR')
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8;' })
  downloadBlob(blob, `${emp.name}_${weekId(monday)}.ics`)
}

function dtFormat(date: Date, h: number, m: number): string {
  const d = new Date(date); d.setHours(h, m, 0, 0)
  return d.toISOString().replace(/[-:]/g, '').slice(0, 15)
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export function exportMonthlyExcel(month: Date, employees: Employee[], stats: MonthlyEmployeeStats[]) {
  const monthLabel = month.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })

  // Feuille récap mois
  const headers = ['Employé', 'Heures travaillées', 'Heures supp', 'H. Dimanche', 'H. Fériés', 'Congés', 'Sans solde', 'Absences', 'Retard (min)', 'Jours off']
  const rows = stats.map(s => [
    s.name,
    s.total.heuresTravaillees,
    s.total.heuresSupp,
    s.total.heuresDimanche,
    s.total.heuresFerie,
    s.total.conges,
    s.total.sansSolde,
    s.total.absences,
    s.total.retardMinutes,
    s.total.joursOff,
  ])

  const wsData = [headers, ...rows]
  const ws = XLSX.utils.aoa_to_sheet(wsData)

  // Largeurs colonnes
  ws['!cols'] = [{ wch: 20 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 10 }]

  // Style headers (gras)
  headers.forEach((_, i) => {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c: i })
    if (!ws[cellRef]) return
    ws[cellRef].s = { font: { bold: true }, fill: { fgColor: { rgb: 'E8760A' } }, alignment: { horizontal: 'center' } }
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Récap mois')

  // Feuille détail par semaine
  if (stats.length > 0 && stats[0].weeks.length > 0) {
    const detailHeaders = ['Employé', ...stats[0].weeks.map((_, i) => `Semaine ${i + 1}`), 'Total']
    const detailRows = stats.map(s => [
      s.name,
      ...s.weeks.map(w => w.heuresTravaillees),
      s.total.heuresTravaillees,
    ])
    const ws2 = XLSX.utils.aoa_to_sheet([detailHeaders, ...detailRows])
    ws2['!cols'] = [{ wch: 20 }, ...stats[0].weeks.map(() => ({ wch: 12 })), { wch: 10 }]
    XLSX.utils.book_append_sheet(wb, ws2, 'Détail semaines')
  }

  const filename = `planning_${month.getFullYear()}_${String(month.getMonth() + 1).padStart(2, '0')}_${monthLabel.replace(/\s/g, '_')}.xlsx`
  XLSX.writeFile(wb, filename)
}
