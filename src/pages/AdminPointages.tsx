import { useEffect, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'

// ── Types ──────────────────────────────────────────────────────────────────────
type PointageDoc = {
  id: string
  userId: string
  userName: string
  date: string
  typePointage: 'arrivée' | 'départ'
  zoneLabel: string
  timestamp: any
  statut: 'validé' | 'refusé'
  distanceToZone: number
  accuracy: number
}

type EmployeeDay = {
  userId: string
  userName: string
  arrivee: PointageDoc | null
  depart: PointageDoc | null
}

type DayData = {
  date: string
  employees: EmployeeDay[]
}

type Mode = 'semaine' | 'mois'

// ── Helpers ────────────────────────────────────────────────────────────────────
function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10)
}

function getWeekBounds(offset: number) {
  const now = new Date()
  const monday = new Date(now)
  const day = now.getDay() === 0 ? 7 : now.getDay()
  monday.setDate(now.getDate() - day + 1 + offset * 7)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return {
    start: toDateStr(monday),
    end: toDateStr(sunday),
    label: `Semaine du ${monday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} au ${sunday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`,
  }
}

function getMonthBounds(offset: number) {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return {
    start: toDateStr(d),
    end: toDateStr(last),
    label: d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
  }
}

function formatHeure(ts: any): string {
  if (!ts?.toDate) return '—'
  return ts.toDate().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function formatHeureRaw(ts: any): string {
  if (!ts?.toDate) return ''
  return ts.toDate().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function calcDuree(arrivee: PointageDoc | null, depart: PointageDoc | null): string {
  if (!arrivee?.timestamp?.toDate || !depart?.timestamp?.toDate) return '—'
  const ms = depart.timestamp.toDate().getTime() - arrivee.timestamp.toDate().getTime()
  if (ms <= 0) return '—'
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return `${h}h${String(m).padStart(2, '0')}`
}

function calcDureeMinutes(arrivee: PointageDoc | null, depart: PointageDoc | null): number {
  if (!arrivee?.timestamp?.toDate || !depart?.timestamp?.toDate) return 0
  return Math.floor((depart.timestamp.toDate().getTime() - arrivee.timestamp.toDate().getTime()) / 60000)
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

function groupByDateAndEmployee(docs: PointageDoc[]): DayData[] {
  const byDate: Record<string, Record<string, EmployeeDay>> = {}

  for (const p of docs) {
    if (!byDate[p.date]) byDate[p.date] = {}
    if (!byDate[p.date][p.userId]) {
      byDate[p.date][p.userId] = { userId: p.userId, userName: p.userName, arrivee: null, depart: null }
    }
    const emp = byDate[p.date][p.userId]
    if (p.typePointage === 'arrivée' && p.statut === 'validé') {
      if (!emp.arrivee || p.timestamp?.toDate?.() < emp.arrivee.timestamp?.toDate?.()) {
        emp.arrivee = p
      }
    }
    if (p.typePointage === 'départ' && p.statut === 'validé') {
      if (!emp.depart || p.timestamp?.toDate?.() > emp.depart.timestamp?.toDate?.()) {
        emp.depart = p
      }
    }
  }

  return Object.entries(byDate)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, emps]) => ({
      date,
      employees: Object.values(emps).sort((a, b) => a.userName.localeCompare(b.userName, 'fr')),
    }))
}

function exportCSV(days: DayData[], label: string) {
  const rows: string[] = [
    'Date,Employé,Arrivée,Départ,Durée,Zone arrivée,Zone départ,Statut',
  ]
  for (const day of [...days].reverse()) {
    for (const emp of day.employees) {
      const statut = emp.arrivee && emp.depart ? 'Complet' : emp.arrivee ? 'Départ manquant' : 'Absent'
      rows.push([
        day.date,
        emp.userName,
        formatHeureRaw(emp.arrivee?.timestamp),
        formatHeureRaw(emp.depart?.timestamp),
        calcDuree(emp.arrivee, emp.depart),
        emp.arrivee?.zoneLabel ?? '',
        emp.depart?.zoneLabel ?? '',
        statut,
      ].map(v => `"${v}"`).join(','))
    }
  }
  const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `pointages_${label.replace(/\s+/g, '_')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Icônes ────────────────────────────────────────────────────────────────────
const IconChevron = ({ dir }: { dir: 'left' | 'right' }) => (
  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    {dir === 'left' ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
  </svg>
)

const IconDownload = () => (
  <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
)

// ── Composant ─────────────────────────────────────────────────────────────────
export default function AdminPointages() {
  const [mode, setMode] = useState<Mode>('semaine')
  const [offset, setOffset] = useState(0)
  const [docs, setDocs] = useState<PointageDoc[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const bounds = mode === 'semaine' ? getWeekBounds(offset) : getMonthBounds(offset)
  const days = groupByDateAndEmployee(docs)

  // Stats
  const totalPresents = new Set(days.flatMap(d => d.employees.filter(e => e.arrivee).map(e => e.userId))).size
  const totalJournees = days.reduce((acc, d) => acc + d.employees.filter(e => e.arrivee).length, 0)
  const incomplets = days.reduce((acc, d) => acc + d.employees.filter(e => e.arrivee && !e.depart).length, 0)

  // Totaux par employé
  const empTotals: Record<string, { name: string; totalMin: number; jours: number }> = {}
  for (const day of days) {
    for (const emp of day.employees) {
      if (!empTotals[emp.userId]) empTotals[emp.userId] = { name: emp.userName, totalMin: 0, jours: 0 }
      const min = calcDureeMinutes(emp.arrivee, emp.depart)
      if (min > 0) { empTotals[emp.userId].totalMin += min; empTotals[emp.userId].jours++ }
    }
  }
  const empTotalsList = Object.entries(empTotals)
    .map(([, v]) => v)
    .sort((a, b) => b.totalMin - a.totalMin)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const q = query(
          collection(db, 'pointages'),
          where('date', '>=', bounds.start),
          where('date', '<=', bounds.end),
        )
        const snap = await getDocs(q)
        setDocs(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
      } catch (e: any) {
        setError('Erreur de chargement. ' + (e?.message ?? ''))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [bounds.start, bounds.end])

  function switchMode(m: Mode) {
    setMode(m)
    setOffset(0)
  }

  return (
    <div className="page">

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <p className="section-label" style={{ marginBottom: 4 }}>Administration</p>
          <h1 style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 24, fontWeight: 800, color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0 }}>
            Relevés de pointage
          </h1>
          <p style={{ fontSize: 13, color: 'var(--on-surface-2)', marginTop: 4, fontFamily: 'Manrope, sans-serif' }}>
            Historique · export CSV
          </p>
        </div>
        <button
          onClick={() => exportCSV(days, bounds.label)}
          disabled={days.length === 0}
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            background: days.length > 0 ? 'rgba(0,66,117,0.08)' : 'var(--surface-low)',
            border: `1px solid ${days.length > 0 ? 'rgba(0,66,117,0.2)' : 'var(--border)'}`,
            borderRadius: 10, padding: '9px 14px',
            color: days.length > 0 ? 'var(--primary)' : 'var(--on-surface-3)',
            fontSize: 13, fontWeight: 600, cursor: days.length > 0 ? 'pointer' : 'default',
            fontFamily: 'Manrope, sans-serif',
          }}
        >
          <IconDownload /> Export CSV
        </button>
      </div>

      {/* Mode selector */}
      <div className="nav-tabs">
        {(['semaine', 'mois'] as Mode[]).map(m => (
          <button key={m} onClick={() => switchMode(m)} className={`nav-tab${mode === m ? ' active' : ''}`}>
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      {/* Period navigator */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--surface-low)', borderRadius: 12, padding: '10px 14px',
        border: '1px solid var(--border)',
      }}>
        <button onClick={() => setOffset(o => o - 1)} style={{
          background: 'var(--surface-mid)', border: 'none', borderRadius: 8,
          padding: '6px 10px', cursor: 'pointer', color: 'var(--on-surface)', display: 'flex',
        }}>
          <IconChevron dir="left" />
        </button>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--on-surface)', textAlign: 'center', fontFamily: 'Manrope, sans-serif' }}>
          {bounds.label}
          {offset === 0 && (
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--primary)', fontWeight: 700, letterSpacing: '0.04em' }}>EN COURS</span>
          )}
        </div>
        <button onClick={() => setOffset(o => o + 1)} disabled={offset >= 0} style={{
          background: offset >= 0 ? 'var(--surface-low)' : 'var(--surface-mid)',
          border: 'none', borderRadius: 8, padding: '6px 10px',
          cursor: offset >= 0 ? 'default' : 'pointer',
          color: offset >= 0 ? 'var(--on-surface-3)' : 'var(--on-surface)', display: 'flex',
        }}>
          <IconChevron dir="right" />
        </button>
      </div>

      {/* Stats */}
      {!loading && days.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {[
            { label: 'Employés', value: totalPresents, warn: false },
            { label: 'Journées', value: totalJournees, warn: false },
            { label: 'Sans départ', value: incomplets, warn: incomplets > 0 },
          ].map(stat => (
            <div key={stat.label} className="card" style={{
              textAlign: 'center', padding: '12px 8px',
              outline: stat.warn ? '1px solid rgba(180,83,9,0.25)' : 'none',
              outlineOffset: -1,
            }}>
              <div style={{
                fontSize: 22, fontWeight: 800,
                color: stat.warn ? 'var(--warning)' : 'var(--primary)',
                fontFamily: 'Epilogue, sans-serif',
              }}>
                {stat.value}
              </div>
              <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 2, fontFamily: 'Manrope, sans-serif' }}>{stat.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Récapitulatif par employé */}
      {!loading && empTotalsList.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-soft)' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--on-surface)', fontFamily: 'Manrope, sans-serif' }}>Récapitulatif employés</span>
          </div>
          <div>
            {empTotalsList.map((emp, i) => {
              const h = Math.floor(emp.totalMin / 60)
              const m = String(emp.totalMin % 60).padStart(2, '0')
              return (
                <div key={emp.name} style={{
                  display: 'grid', gridTemplateColumns: '1fr auto auto',
                  gap: 12, padding: '9px 16px', alignItems: 'center',
                  borderTop: i > 0 ? '1px solid var(--border-soft)' : 'none',
                }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--on-surface)', fontFamily: 'Manrope, sans-serif' }}>{emp.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--on-surface-3)', fontFamily: 'Manrope, sans-serif' }}>{emp.jours}j</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)', fontFamily: 'Manrope, sans-serif' }}>{h}h{m}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          <span style={{ color: 'var(--on-surface-3)', fontSize: 14, fontFamily: 'Manrope, sans-serif' }}>Chargement…</span>
        </div>
      )}

      {error && (
        <div style={{ background: 'rgba(192,57,43,0.08)', border: '1px solid rgba(192,57,43,0.2)', borderRadius: 12, padding: '14px 16px', color: 'var(--danger)', fontSize: 14, fontFamily: 'Manrope, sans-serif' }}>
          {error}
        </div>
      )}

      {!loading && !error && days.length === 0 && (
        <div className="card" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
          <div style={{ color: 'var(--on-surface-3)', fontSize: 14, fontFamily: 'Manrope, sans-serif' }}>Aucun pointage sur cette période.</div>
        </div>
      )}

      {/* Days list */}
      {!loading && days.map(day => (
        <div key={day.date} style={{ marginBottom: 20 }}>
          {/* Date header */}
          <div style={{
            fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)',
            textTransform: 'uppercase', letterSpacing: '0.05em',
            marginBottom: 8, paddingLeft: 4,
            display: 'flex', alignItems: 'center', gap: 10,
            fontFamily: 'Manrope, sans-serif',
          }}>
            {formatDateLabel(day.date)}
            <span style={{ color: 'var(--primary)', fontWeight: 700 }}>
              {day.employees.filter(e => e.arrivee).length} présent{day.employees.filter(e => e.arrivee).length > 1 ? 's' : ''}
            </span>
          </div>

          {/* Employee cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {day.employees.map(emp => {
              const complet = !!emp.arrivee && !!emp.depart
              const dureeMin = calcDureeMinutes(emp.arrivee, emp.depart)
              return (
                <div key={emp.userId} className="card" style={{
                  padding: '12px 16px',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto auto',
                  alignItems: 'center', gap: 12,
                }}>
                  {/* Nom */}
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--on-surface)', fontFamily: 'Manrope, sans-serif' }}>{emp.userName}</div>

                  {/* Arrivée */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: 'var(--on-surface-3)', marginBottom: 2, fontFamily: 'Manrope, sans-serif' }}>Arrivée</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: emp.arrivee ? 'var(--success)' : 'var(--on-surface-3)' }}>
                      {emp.arrivee ? formatHeure(emp.arrivee.timestamp) : '—'}
                    </div>
                  </div>

                  {/* Départ */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: 'var(--on-surface-3)', marginBottom: 2, fontFamily: 'Manrope, sans-serif' }}>Départ</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: emp.depart ? 'var(--on-surface)' : 'var(--on-surface-3)' }}>
                      {emp.depart ? formatHeure(emp.depart.timestamp) : '—'}
                    </div>
                  </div>

                  {/* Durée / statut */}
                  <div style={{ textAlign: 'right' }}>
                    {complet ? (
                      <div style={{
                        fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 8,
                        background: dureeMin >= 420 ? 'rgba(45,122,79,0.10)' : 'rgba(180,83,9,0.10)',
                        color: dureeMin >= 420 ? 'var(--success)' : 'var(--warning)',
                        fontFamily: 'Manrope, sans-serif',
                      }}>
                        {calcDuree(emp.arrivee, emp.depart)}
                      </div>
                    ) : emp.arrivee ? (
                      <div style={{ fontSize: 11, color: 'var(--warning)', fontWeight: 600, fontFamily: 'Manrope, sans-serif' }}>Sans départ</div>
                    ) : (
                      <div style={{ fontSize: 11, color: 'var(--on-surface-3)', fontFamily: 'Manrope, sans-serif' }}>Absent</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
