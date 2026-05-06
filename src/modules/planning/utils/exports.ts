import * as XLSX from 'xlsx'
import type { WeekDraft, Employee, MonthlyEmployeeStats, WeekEvents } from '../types'
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

// ── Helpers export mensuel ─────────────────────────────────────────

const DAY_FR = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam']
const MON_FR = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc']

function fmtShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${DAY_FR[new Date(y, m - 1, d).getDay()]} ${d} ${MON_FR[m - 1]}`
}

function fmtFullDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${DAY_FR[new Date(y, m - 1, d).getDay()]}. ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}

function weekRangeLabel(mon: Date): string {
  const sun = addDays(mon, 6)
  const f = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
  return `${f(mon)} → ${f(sun)}`
}

const EVENT_LABELS: Record<string, string> = {
  conge: 'Congé payé', sans_solde: 'Sans solde', absence: 'Absence injustifiée',
  retard: 'Retard', malade: 'Arrêt maladie', jour_off: 'Jour off', parti_tot: 'Parti tôt',
}

type EventEntry = { dateISO: string; minutes?: number; hours?: number }

function buildEventIndex(
  empIds: string[],
  rawWeekData: { mon: Date; events: WeekEvents }[]
): Record<string, Record<string, EventEntry[]>> {
  const index: Record<string, Record<string, EventEntry[]>> = {}
  empIds.forEach(id => { index[id] = {} })
  rawWeekData.forEach(({ events }) => {
    Object.entries(events).forEach(([dateISO, dayEvts]) => {
      dayEvts.forEach(evt => {
        if (!index[evt.empId]) return
        if (!index[evt.empId][evt.type]) index[evt.empId][evt.type] = []
        index[evt.empId][evt.type].push({ dateISO, minutes: evt.minutes, hours: evt.hours })
      })
    })
  })
  Object.values(index).forEach(types =>
    Object.values(types).forEach(list => list.sort((a, b) => a.dateISO.localeCompare(b.dateISO)))
  )
  return index
}

const HDR_STYLE = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '004275' } }, alignment: { horizontal: 'center' } }
const TOTAL_STYLE = { font: { bold: true }, fill: { fgColor: { rgb: 'E8ECF0' } } }
const DETAIL_STYLE = { font: { italic: true, color: { rgb: '5A5A55' } }, fill: { fgColor: { rgb: 'F8F6F2' } } }

export function exportMonthlyExcel(
  month: Date,
  employees: Employee[],
  stats: MonthlyEmployeeStats[],
  weeks: Date[],
  rawWeekData: { mon: Date; events: WeekEvents }[],
  primes?: Record<string, number | null>
) {
  const monthLabel = month.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  const eventIndex = buildEventIndex(stats.map(s => s.empId), rawWeekData)

  // ── Feuille 1 : Tableau par semaine (vue app) ──────────────────
  const COLS = ['Employé', 'Semaine', 'H.travaillées', 'H.supp', 'H.Dimanche', 'H.Fériés', 'Congés', 'Sans solde', 'Absences', 'Retard', 'Parti tôt', 'J.Off', 'Prime']
  const NC = COLS.length
  const aoa: (string | number)[][] = [
    [`Planning Matias — ${monthLabel}`],
    [`Généré le ${new Date().toLocaleDateString('fr-FR')} — Document comptable confidentiel`],
    [],
    COLS,
  ]

  // Row index tracking for styles
  const totalRows: number[] = []
  const detailRows: number[] = []

  const primeRows: number[] = []

  stats.forEach(stat => {
    const empEvts = eventIndex[stat.empId] ?? {}
    const prime = primes?.[stat.empId] ?? null

    stat.weeks.forEach((wc, wi) => {
      aoa.push([
        wi === 0 ? stat.name : '',
        weeks[wi] ? weekRangeLabel(weeks[wi]) : `S${wi + 1}`,
        wc.heuresTravaillees > 0 ? `${wc.heuresTravaillees}h` : '—',
        wc.heuresSupp > 0 ? `${wc.heuresSupp}h` : '—',
        wc.heuresDimanche > 0 ? `${wc.heuresDimanche}h` : '—',
        wc.heuresFerie > 0 ? `${wc.heuresFerie}h` : '—',
        wc.conges > 0 ? `${wc.conges}j` : '—',
        wc.sansSolde > 0 ? `${wc.sansSolde}j` : '—',
        wc.absences > 0 ? `${wc.absences}j` : '—',
        wc.retardMinutes > 0 ? `${wc.retardMinutes}min` : '—',
        wc.partiTotHeures > 0 ? `${wc.partiTotHeures}h` : '—',
        wc.joursOff > 0 ? `${wc.joursOff}j` : '—',
        '',
      ])
    })

    // Ligne TOTAL
    const t = stat.total
    totalRows.push(aoa.length)
    if (prime != null) primeRows.push(aoa.length)
    aoa.push([
      '', 'TOTAL',
      `${t.heuresTravaillees}h`,
      t.heuresSupp > 0 ? `${t.heuresSupp}h` : '—',
      t.heuresDimanche > 0 ? `${t.heuresDimanche}h` : '—',
      t.heuresFerie > 0 ? `${t.heuresFerie}h` : '—',
      t.conges > 0 ? `${t.conges}j` : '—',
      t.sansSolde > 0 ? `${t.sansSolde}j` : '—',
      t.absences > 0 ? `${t.absences}j` : '—',
      t.retardMinutes > 0 ? `${t.retardMinutes}min` : '—',
      t.partiTotHeures > 0 ? `${t.partiTotHeures}h` : '—',
      t.joursOff > 0 ? `${t.joursOff}j` : '—',
      prime != null ? prime : '',
    ])

    // Lignes détail — retards, congés, sans solde, absences
    const retards = empEvts['retard']
    if (retards?.length) {
      detailRows.push(aoa.length)
      aoa.push(['', '  ↳ Retards', retards.map(e => `${fmtShortDate(e.dateISO)} (${e.minutes}min)`).join('  ·  '), ...Array(NC - 3).fill('')])
    }
    const conges = empEvts['conge']
    if (conges?.length) {
      detailRows.push(aoa.length)
      aoa.push(['', '  ↳ Congés payés', conges.map(e => fmtShortDate(e.dateISO)).join('  ·  '), ...Array(NC - 3).fill('')])
    }
    const sansSolde = empEvts['sans_solde']
    if (sansSolde?.length) {
      detailRows.push(aoa.length)
      aoa.push(['', '  ↳ Sans solde', sansSolde.map(e => fmtShortDate(e.dateISO)).join('  ·  '), ...Array(NC - 3).fill('')])
    }
    const absences = empEvts['absence']
    if (absences?.length) {
      detailRows.push(aoa.length)
      aoa.push(['', '  ↳ Absences', absences.map(e => fmtShortDate(e.dateISO)).join('  ·  '), ...Array(NC - 3).fill('')])
    }

    aoa.push([]) // séparateur entre employés
  })

  const PRIME_STYLE = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '004275' } }, alignment: { horizontal: 'center' } }

  const ws1 = XLSX.utils.aoa_to_sheet(aoa)
  ws1['!cols'] = [
    { wch: 18 }, { wch: 40 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 10 },
    { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 },
  ]

  // Styles header (row index 3 = COLS row)
  COLS.forEach((_, ci) => {
    const ref = XLSX.utils.encode_cell({ r: 3, c: ci })
    if (ws1[ref]) ws1[ref].s = HDR_STYLE
  })
  // Styles lignes TOTAL
  totalRows.forEach(r => {
    for (let c = 0; c < NC; c++) {
      const ref = XLSX.utils.encode_cell({ r, c })
      if (ws1[ref]) ws1[ref].s = TOTAL_STYLE
    }
  })
  // Style prime dans les lignes TOTAL qui ont une prime
  primeRows.forEach(r => {
    const ref = XLSX.utils.encode_cell({ r, c: NC - 1 })
    if (ws1[ref]) ws1[ref].s = PRIME_STYLE
  })
  // Styles lignes détail
  detailRows.forEach(r => {
    for (let c = 0; c < NC; c++) {
      const ref = XLSX.utils.encode_cell({ r, c })
      if (ws1[ref]) ws1[ref].s = DETAIL_STYLE
    }
  })

  // ── Feuille 2 : Événements détaillés (liste chronologique) ────
  const evtCols = ['Date', 'Employé', 'Type', 'Détail']
  const evtAoa: (string | number)[][] = [evtCols]

  const allEvts: { dateISO: string; empName: string; typeLabel: string; detail: string }[] = []
  rawWeekData.forEach(({ events }) => {
    Object.entries(events).forEach(([dateISO, dayEvts]) => {
      dayEvts.forEach(evt => {
        const s = stats.find(st => st.empId === evt.empId)
        if (!s) return
        let detail = ''
        if (evt.type === 'retard' && evt.minutes) detail = `${evt.minutes} min de retard`
        else if (evt.type === 'malade' && evt.hours) detail = `${evt.hours}h non travaillées`
        else if (evt.type === 'parti_tot' && evt.hours) detail = `parti ${evt.hours}h en avance`
        allEvts.push({ dateISO, empName: s.name, typeLabel: EVENT_LABELS[evt.type] ?? evt.type, detail })
      })
    })
  })

  allEvts.sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.empName.localeCompare(b.empName))
  allEvts.forEach(e => evtAoa.push([fmtFullDate(e.dateISO), e.empName, e.typeLabel, e.detail]))

  const ws2 = XLSX.utils.aoa_to_sheet(evtAoa)
  ws2['!cols'] = [{ wch: 20 }, { wch: 18 }, { wch: 22 }, { wch: 40 }]
  evtCols.forEach((_, ci) => {
    const ref = XLSX.utils.encode_cell({ r: 0, c: ci })
    if (ws2[ref]) ws2[ref].s = HDR_STYLE
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws1, `Planning ${monthLabel}`)
  XLSX.utils.book_append_sheet(wb, ws2, 'Événements')

  const filename = `planning_${month.getFullYear()}_${String(month.getMonth() + 1).padStart(2, '0')}_${monthLabel.replace(/\s/g, '_')}.xlsx`
  XLSX.writeFile(wb, filename)
}
