import React, { useState, useEffect } from 'react'
import type { Employee, MonthlyEmployeeStats } from '../../types'
import { loadWeek, loadWeekEvents, addDays } from '../../firebase/planning'
import { computeWeekCounters } from '../../hooks/usePlanning'
import { weeksInMonth, weekLabel, weekDaysInMonth } from '../../utils/dateUtils'
import type { WeekDraft, WeekEvents } from '../../types'
import { exportMonthlyPDF } from '../../utils/pdfExport'
import { exportMonthlyExcel } from '../../utils/exports'
import { PrimesTab } from './PrimesTab'
import type { PrimeMois, PrimeEmploye } from '../../firebase/primes'
import { calcPrime, calcCaPrime, hygieneBonus, getBareme, getContractAt } from '../../utils/primes'

interface Props {
  month: Date
  employees: Employee[]
  canEdit: boolean
  uid: string
}

type Tab = 'stats' | 'primes'

export function MonthlyView({ month, employees, canEdit, uid }: Props) {
  const [stats, setStats]         = useState<MonthlyEmployeeStats[]>([])
  const [weeks, setWeeks]         = useState<Date[]>([])
  const [loading, setLoading]     = useState(false)
  const [tab, setTab]             = useState<Tab>('stats')
  const [primeMois, setPrimeMois]   = useState<PrimeMois | null>(null)
  const [primesEmp, setPrimesEmp]   = useState<PrimeEmploye[]>([])

  useEffect(() => {
    if (employees.length === 0) return
    setLoading(true)
    async function load() {
      const wks = weeksInMonth(month)
      setWeeks(wks)
      const weekData = await Promise.all(wks.map(async mon => {
        const [draft, events] = await Promise.all([loadWeek(mon), loadWeekEvents(mon)])
        return { mon, draft, events }
      }))
      const empStats: MonthlyEmployeeStats[] = employees.map(emp => {
        const weekCounters = weekData.map(({ mon, draft, events }) => {
          const allowedIndices = weekDaysInMonth(mon, month)
          const isPartialWeek = allowedIndices.length < 7

          // Filtre le draft : ne garder que les jours du mois cible
          const filteredDraft: WeekDraft = {}
          allowedIndices.forEach(i => { if (draft[i]) filteredDraft[i] = draft[i] })

          // Filtre les events : ne garder que les ISO dates du mois cible
          const allowedISOs = new Set(allowedIndices.map(i => {
            const d = addDays(mon, i)
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          }))
          const filteredEvents: WeekEvents = {}
          Object.entries(events).forEach(([dateISO, evts]) => {
            if (allowedISOs.has(dateISO)) filteredEvents[dateISO] = evts
          })

          const effectiveHours = getContractAt(emp, mon)
          const empForWeek = effectiveHours !== emp.weeklyCapHours
            ? { ...emp, weeklyCapHours: effectiveHours }
            : emp
          const counter = computeWeekCounters(filteredDraft, filteredEvents, [empForWeek])[0]

          // Heures supp = 0 sur semaine incomplète
          if (isPartialWeek) return { ...counter, heuresSupp: 0 }
          return counter
        })
        const total = weekCounters.reduce((acc, c) => ({
          heuresTravaillees: acc.heuresTravaillees + c.heuresTravaillees,
          heuresSupp:        acc.heuresSupp        + c.heuresSupp,
          heuresDimanche:    acc.heuresDimanche    + c.heuresDimanche,
          conges:            acc.conges            + c.conges,
          sansSolde:         acc.sansSolde         + c.sansSolde,
          absences:          acc.absences          + c.absences,
          retardMinutes:     acc.retardMinutes     + c.retardMinutes,
          joursOff:          acc.joursOff          + c.joursOff,
          maladesHeures:     acc.maladesHeures     + c.maladesHeures,
          partiTotHeures:    acc.partiTotHeures    + c.partiTotHeures,
        }), { heuresTravaillees: 0, heuresSupp: 0, heuresDimanche: 0, conges: 0, sansSolde: 0, absences: 0, retardMinutes: 0, joursOff: 0, maladesHeures: 0, partiTotHeures: 0 })
        return { empId: emp.id, name: emp.name, weeks: weekCounters, total }
      })
      setStats(empStats)
      setLoading(false)
    }
    load()
  }, [month, employees])

  function handlePrimesChange(mois: PrimeMois | null, emps: PrimeEmploye[]) {
    setPrimeMois(mois)
    setPrimesEmp(emps)
  }

  // Calcul prime par empId pour affichage dans stats
  function getPrime(empId: string): number | null {
    const emp = employees.find(e => e.id === empId)
    const ep  = primesEmp.find(p => p.empId === empId)
    if (!emp || !ep || !primeMois) return null
    const caPrime = calcCaPrime(primeMois.caRealise, primeMois.caObjectif)
    const hb = primeMois.hygieneActif ? hygieneBonus(primeMois.hygieneScore) : 0
    return calcPrime(emp.weeklyCapHours, ep.comportementOk, ep.ponctualiteOk, caPrime, hb, emp.primeComportement, emp.primePonctualite)
  }

  if (loading) return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--on-surface-2)', fontSize: '13px' }}>Chargement du mois…</div>
  if (employees.length === 0) return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--on-surface-2)', fontSize: '13px' }}>Aucun employé</div>

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px', display: 'flex', flexDirection: 'column' }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', background: 'var(--surface-low)', borderRadius: '8px', padding: '3px', gap: '2px' }}>
          {(['stats', 'primes'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '4px 12px', borderRadius: '6px', border: 'none', fontSize: '11px', fontWeight: 700, cursor: 'pointer',
              background: tab === t ? 'var(--primary)' : 'transparent',
              color: tab === t ? '#fff' : 'var(--on-surface-3)',
            }}>
              {t === 'stats' ? '📊 Stats' : '🏆 Primes'}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {tab === 'stats' && (
          <>
            <button onClick={() => exportMonthlyExcel(month, employees, stats)} disabled={stats.length === 0}
              style={{ background: '#16a34a', border: 'none', color: '#fff', borderRadius: '8px', padding: '5px 12px', cursor: 'pointer', fontSize: '11px', fontWeight: 600, opacity: stats.length === 0 ? 0.5 : 1 }}>
              📊 Excel
            </button>
            <button onClick={() => exportMonthlyPDF(month, employees, stats)} disabled={stats.length === 0}
              style={{ background: 'var(--primary)', border: 'none', color: '#fff', borderRadius: '8px', padding: '5px 12px', cursor: 'pointer', fontSize: '11px', fontWeight: 600, opacity: stats.length === 0 ? 0.5 : 1 }}>
              📄 PDF
            </button>
          </>
        )}
      </div>

      {/* ── ONGLET STATS ── */}
      {tab === 'stats' && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <thead>
              <tr>
                <th style={thSt}>Employé</th>
                <th style={thSt}>Semaine</th>
                <th style={thSt}>Heures</th>
                <th style={thSt}>Supp</th>
                <th style={{ ...thSt, background: '#6366f1' }}>🌙 Dim</th>
                <th style={thSt}>Congés</th>
                <th style={thSt}>S.Solde</th>
                <th style={thSt}>Absences</th>
                <th style={thSt}>Retard</th>
                <th style={thSt}>Parti tôt</th>
                <th style={thSt}>J.Off</th>
                <th style={{ ...thSt, background: '#2d5a8e' }}>🏆 Prime</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((stat, si) => {
                const emp = employees.find(e => e.id === stat.empId)
                const prime = getPrime(stat.empId)
                return (
                  <React.Fragment key={si}>
                    {stat.weeks.map((wc, wi) => (
                      <tr key={`${si}-${wi}`} style={{ background: wi % 2 === 0 ? 'var(--surface-low)' : 'var(--surface)' }}>
                        {wi === 0 && (
                          <td rowSpan={stat.weeks.length + 1} style={{ ...tdSt, fontWeight: 700, color: emp?.color ?? 'var(--on-surface)', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: emp?.color ?? 'var(--on-surface-3)', marginRight: 5, verticalAlign: 'middle' }} />
                            {stat.name}
                          </td>
                        )}
                        <td style={{ ...tdSt, color: 'var(--on-surface-2)', whiteSpace: 'nowrap' }}>{weeks[wi] ? weekLabel(weeks[wi]).replace('Semaine du ', '') : `S${wi + 1}`}</td>
                        <td style={tdSt}>{wc.heuresTravaillees}h</td>
                        <td style={{ ...tdSt, color: wc.heuresSupp > 0 ? 'var(--success)' : 'var(--on-surface-3)' }}>{wc.heuresSupp > 0 ? `${wc.heuresSupp}h` : '—'}</td>
                        <td style={{ ...tdSt, color: wc.heuresDimanche > 0 ? '#6366f1' : 'var(--on-surface-3)', fontWeight: wc.heuresDimanche > 0 ? 700 : 400 }}>{wc.heuresDimanche > 0 ? `${wc.heuresDimanche}h` : '—'}</td>
                        <td style={{ ...tdSt, color: wc.conges > 0 ? 'var(--primary)' : 'var(--on-surface-3)' }}>{wc.conges > 0 ? `${wc.conges}j` : '—'}</td>
                        <td style={{ ...tdSt, color: wc.sansSolde > 0 ? 'var(--warning)' : 'var(--on-surface-3)' }}>{wc.sansSolde > 0 ? `${wc.sansSolde}j` : '—'}</td>
                        <td style={{ ...tdSt, color: wc.absences > 0 ? 'var(--danger)' : 'var(--on-surface-3)' }}>{wc.absences > 0 ? `${wc.absences}j` : '—'}</td>
                        <td style={{ ...tdSt, color: wc.retardMinutes > 0 ? 'var(--warning)' : 'var(--on-surface-3)' }}>{wc.retardMinutes > 0 ? `${wc.retardMinutes}min` : '—'}</td>
                        <td style={{ ...tdSt, color: wc.partiTotHeures > 0 ? 'var(--danger)' : 'var(--on-surface-3)' }}>
                          {wc.partiTotHeures > 0 ? `${wc.partiTotHeures}h` : '—'}
                        </td>
                        <td style={{ ...tdSt, color: wc.joursOff > 0 ? '#6366f1' : 'var(--on-surface-3)' }}>{wc.joursOff > 0 ? `${wc.joursOff}j` : '—'}</td>
                        {wi === 0 && (
                          <td rowSpan={stat.weeks.length + 1} style={{ ...tdSt, verticalAlign: 'middle', textAlign: 'center', background: 'rgba(0,66,117,0.04)' }}>
                            {prime != null
                              ? <span style={{ fontWeight: 800, fontSize: '13px', color: prime > 0 ? 'var(--primary)' : 'var(--on-surface-3)' }}>{prime}€</span>
                              : <span style={{ fontSize: '10px', color: 'var(--on-surface-3)', fontStyle: 'italic' }}>→ Primes</span>}
                          </td>
                        )}
                      </tr>
                    ))}
                    {/* Total row */}
                    <tr style={{ background: 'var(--surface-mid)', borderTop: '1px solid var(--border)' }}>
                      <td style={{ ...tdSt, fontWeight: 700 }}>Total</td>
                      <td style={{ ...tdSt, fontWeight: 700 }}>{stat.total.heuresTravaillees}h</td>
                      <td style={{ ...tdSt, fontWeight: 700, color: stat.total.heuresSupp > 0 ? 'var(--success)' : 'var(--on-surface-3)' }}>{stat.total.heuresSupp > 0 ? `${stat.total.heuresSupp}h` : '—'}</td>
                      <td style={{ ...tdSt, fontWeight: 700, color: stat.total.heuresDimanche > 0 ? '#6366f1' : 'var(--on-surface-3)' }}>{stat.total.heuresDimanche > 0 ? `${stat.total.heuresDimanche}h` : '—'}</td>
                      <td style={{ ...tdSt, fontWeight: 700, color: stat.total.conges > 0 ? 'var(--primary)' : 'var(--on-surface-3)' }}>{stat.total.conges > 0 ? `${stat.total.conges}j` : '—'}</td>
                      <td style={{ ...tdSt, fontWeight: 700, color: stat.total.sansSolde > 0 ? 'var(--warning)' : 'var(--on-surface-3)' }}>{stat.total.sansSolde > 0 ? `${stat.total.sansSolde}j` : '—'}</td>
                      <td style={{ ...tdSt, fontWeight: 700, color: stat.total.absences > 0 ? 'var(--danger)' : 'var(--on-surface-3)' }}>{stat.total.absences > 0 ? `${stat.total.absences}j` : '—'}</td>
                      <td style={{ ...tdSt, fontWeight: 700, color: stat.total.retardMinutes > 0 ? 'var(--warning)' : 'var(--on-surface-3)' }}>{stat.total.retardMinutes > 0 ? `${stat.total.retardMinutes}min` : '—'}</td>
                      <td style={{ ...tdSt, fontWeight: 700, color: stat.total.partiTotHeures > 0 ? 'var(--danger)' : 'var(--on-surface-3)' }}>
                        {stat.total.partiTotHeures > 0 ? `${stat.total.partiTotHeures}h` : '—'}
                      </td>
                      <td style={{ ...tdSt, fontWeight: 700, color: stat.total.joursOff > 0 ? '#6366f1' : 'var(--on-surface-3)' }}>{stat.total.joursOff > 0 ? `${stat.total.joursOff}j` : '—'}</td>
                    </tr>
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── ONGLET PRIMES ── */}
      {tab === 'primes' && (
        <PrimesTab
          month={month}
          employees={employees}
          stats={stats}
          canEdit={canEdit}
          uid={uid}
          onPrimesChange={handlePrimesChange}
        />
      )}
    </div>
  )
}

const thSt: React.CSSProperties = { background: 'var(--primary)', color: '#fff', padding: '5px 8px', textAlign: 'left', fontWeight: 700, fontSize: '11px', whiteSpace: 'nowrap' }
const tdSt: React.CSSProperties = { padding: '4px 8px', color: 'var(--on-surface)', borderBottom: '1px solid var(--border-soft)', fontSize: '11px' }
