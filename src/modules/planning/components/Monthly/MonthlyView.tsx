import React, { useState, useEffect } from 'react'
import type { Employee, MonthlyEmployeeStats } from '../../types'
import { loadWeek, loadWeekEvents } from '../../firebase/planning'
import { computeWeekCounters } from '../../hooks/usePlanning'
import { weeksInMonth, weekLabel } from '../../utils/dateUtils'
import { exportMonthlyPDF } from '../../utils/pdfExport'
import { exportMonthlyExcel } from '../../utils/exports'

interface Props { month: Date; employees: Employee[] }

export function MonthlyView({ month, employees }: Props) {
  const [stats, setStats] = useState<MonthlyEmployeeStats[]>([])
  const [weeks, setWeeks] = useState<Date[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (employees.length === 0) return
    async function load() {
      setLoading(true)
      const wks = weeksInMonth(month)
      setWeeks(wks)
      const weekData = await Promise.all(wks.map(async (mon) => {
        const [draft, events] = await Promise.all([loadWeek(mon), loadWeekEvents(mon)])
        return { mon, draft, events }
      }))
      const empStats: MonthlyEmployeeStats[] = employees.map(emp => {
        const weekCounters = weekData.map(({ draft, events }) => computeWeekCounters(draft, events, [emp])[0])
        const total = weekCounters.reduce((acc, c) => ({
          heuresTravaillees: acc.heuresTravaillees + c.heuresTravaillees,
          heuresSupp: acc.heuresSupp + c.heuresSupp,
          conges: acc.conges + c.conges,
          sansSolde: acc.sansSolde + c.sansSolde,
          absences: acc.absences + c.absences,
          retardMinutes: acc.retardMinutes + c.retardMinutes,
          joursOff: acc.joursOff + c.joursOff,
        }), { heuresTravaillees: 0, heuresSupp: 0, conges: 0, sansSolde: 0, absences: 0, retardMinutes: 0, joursOff: 0 })
        return { empId: emp.id, name: emp.name, weeks: weekCounters, total }
      })
      setStats(empStats)
      setLoading(false)
    }
    load()
  }, [month, employees])

  if (loading) return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--on-surface-2)', fontSize: '13px' }}>Chargement du mois…</div>
  if (employees.length === 0) return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--on-surface-2)', fontSize: '13px' }}>Aucun employé</div>

  const colHeaders = ['Heures', 'Supp', 'Congés', 'S.Solde', 'Absences', 'Retard', 'J.Off']

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginBottom: '8px' }}>
        <button onClick={() => exportMonthlyExcel(month, employees, stats)} disabled={stats.length === 0}
          style={{ background: '#16a34a', border: 'none', color: '#fff', borderRadius: '8px', padding: '5px 14px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, opacity: stats.length === 0 ? 0.5 : 1 }}>
          📊 Exporter Excel
        </button>
        <button onClick={() => exportMonthlyPDF(month, employees, stats)} disabled={stats.length === 0}
          style={{ background: 'var(--primary)', border: 'none', color: '#fff', borderRadius: '8px', padding: '5px 14px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, opacity: stats.length === 0 ? 0.5 : 1 }}>
          📄 Exporter PDF
        </button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
          <thead>
            <tr>
              <th style={thStyle}>Employé</th>
              <th style={thStyle}>Semaine</th>
              {colHeaders.map(h => <th key={h} style={thStyle}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {stats.map((stat, si) => {
              const emp = employees.find(e => e.id === stat.empId)
              return (
                <React.Fragment key={si}>
                  {stat.weeks.map((wc, wi) => (
                    <tr key={`${si}-${wi}`} style={{ background: wi % 2 === 0 ? 'var(--surface-low)' : 'var(--surface)' }}>
                      {wi === 0 && (
                        <td rowSpan={stat.weeks.length + 1} style={{ ...tdStyle, fontWeight: 700, color: emp?.color ?? 'var(--on-surface)', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: emp?.color ?? 'var(--on-surface-3)', marginRight: 5, verticalAlign: 'middle' }} />
                          {stat.name}
                        </td>
                      )}
                      <td style={{ ...tdStyle, color: 'var(--on-surface-2)', whiteSpace: 'nowrap' }}>{weeks[wi] ? weekLabel(weeks[wi]).replace('Semaine du ', '') : `S${wi + 1}`}</td>
                      <td style={tdStyle}>{wc.heuresTravaillees}h</td>
                      <td style={{ ...tdStyle, color: wc.heuresSupp > 0 ? 'var(--success)' : 'var(--on-surface-3)' }}>{wc.heuresSupp}h</td>
                      <td style={{ ...tdStyle, color: wc.conges > 0 ? 'var(--primary)' : 'var(--on-surface-3)' }}>{wc.conges}j</td>
                      <td style={{ ...tdStyle, color: wc.sansSolde > 0 ? 'var(--warning)' : 'var(--on-surface-3)' }}>{wc.sansSolde}j</td>
                      <td style={{ ...tdStyle, color: wc.absences > 0 ? 'var(--danger)' : 'var(--on-surface-3)' }}>{wc.absences}j</td>
                      <td style={{ ...tdStyle, color: wc.retardMinutes > 0 ? 'var(--warning)' : 'var(--on-surface-3)' }}>{wc.retardMinutes}min</td>
                      <td style={{ ...tdStyle, color: wc.joursOff > 0 ? '#6366f1' : 'var(--on-surface-3)' }}>{wc.joursOff}j</td>
                    </tr>
                  ))}
                  <tr style={{ background: 'var(--surface-mid)', borderTop: '1px solid var(--border)' }}>
                    <td style={{ ...tdStyle, fontWeight: 700, color: 'var(--on-surface)' }}>Total</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: 'var(--on-surface)' }}>{stat.total.heuresTravaillees}h</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: stat.total.heuresSupp > 0 ? 'var(--success)' : 'var(--on-surface-3)' }}>{stat.total.heuresSupp}h</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: stat.total.conges > 0 ? 'var(--primary)' : 'var(--on-surface-3)' }}>{stat.total.conges}j</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: stat.total.sansSolde > 0 ? 'var(--warning)' : 'var(--on-surface-3)' }}>{stat.total.sansSolde}j</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: stat.total.absences > 0 ? 'var(--danger)' : 'var(--on-surface-3)' }}>{stat.total.absences}j</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: stat.total.retardMinutes > 0 ? 'var(--warning)' : 'var(--on-surface-3)' }}>{stat.total.retardMinutes}min</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: stat.total.joursOff > 0 ? '#6366f1' : 'var(--on-surface-3)' }}>{stat.total.joursOff}j</td>
                  </tr>
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const thStyle: React.CSSProperties = { background: 'var(--primary)', color: 'var(--on-primary)', padding: '5px 8px', textAlign: 'left', fontWeight: 700, fontSize: '11px', whiteSpace: 'nowrap' }
const tdStyle: React.CSSProperties = { padding: '4px 8px', color: 'var(--on-surface)', borderBottom: '1px solid var(--border-soft)', fontSize: '11px' }
