import { useEffect, useState } from 'react'
import { loadAuditEntries } from '../../firebase/planning'
import type { AuditEntry, Employee, HoursSnapshot, WeekEvents, DayEvent } from '../../types'
import { DAYS_LABELS } from '../../types'

const TYPE_LABELS: Record<string, string> = {
  conge: 'Congé', sans_solde: 'Sans solde', absence: 'Absence', retard: 'Retard',
  heures_supp: 'Heures supp.', jour_off: 'Jour off', malade: 'Maladie', parti_tot: 'Parti tôt',
}

function fmtHours(hours: string[]): string {
  return hours.map(Number).sort((a, b) => a - b).map(h => `${h}h`).join(', ')
}

/** Regroupe une HoursMap { heure: [empId] } en { empId: [heures] } */
function empHoursOf(map: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  Object.entries(map).forEach(([hour, ids]) => ids.forEach(id => { (out[id] ||= []).push(hour) }))
  return out
}

function diffHours(before: HoursSnapshot, after: HoursSnapshot, name: (id: string) => string): string[] {
  const changes: string[] = []
  for (let i = 0; i < 7; i++) {
    const bb = empHoursOf(before[String(i)] ?? {})
    const aa = empHoursOf(after[String(i)] ?? {})
    const emps = new Set([...Object.keys(bb), ...Object.keys(aa)])
    emps.forEach(id => {
      const bSet = new Set(bb[id] ?? [])
      const aSet = new Set(aa[id] ?? [])
      const added = [...aSet].filter(h => !bSet.has(h))
      const removed = [...bSet].filter(h => !aSet.has(h))
      if (!added.length && !removed.length) return
      const parts: string[] = []
      if (added.length) parts.push(`+${fmtHours(added)}`)
      if (removed.length) parts.push(`−${fmtHours(removed)}`)
      changes.push(`${name(id)} · ${DAYS_LABELS[i]} : ${parts.join('  ')}`)
    })
  }
  return changes
}

function diffEvents(before: WeekEvents, after: WeekEvents, name: (id: string) => string): string[] {
  const changes: string[] = []
  const key = (e: DayEvent) => `${e.empId}|${e.type}`
  const dates = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
  dates.forEach(date => {
    const bMap = new Map((before[date] ?? []).map(e => [key(e), e]))
    const aMap = new Map((after[date] ?? []).map(e => [key(e), e]))
    const dl = new Date(date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' })
    aMap.forEach((e, k) => { if (!bMap.has(k)) changes.push(`${name(e.empId)} · ${dl} : ${TYPE_LABELS[e.type] ?? e.type} ajouté`) })
    bMap.forEach((e, k) => { if (!aMap.has(k)) changes.push(`${name(e.empId)} · ${dl} : ${TYPE_LABELS[e.type] ?? e.type} retiré`) })
  })
  return changes
}

interface Props {
  monday: Date
  isMobile: boolean
  employees: Employee[]
  onClose: () => void
}

export function PlanningHistory({ monday, isMobile, employees, onClose }: Props) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const nameOf = (id: string) => employees.find(e => e.id === id)?.name ?? `#${id.slice(0, 5)}`

  useEffect(() => {
    let alive = true
    setEntries(null)
    setError(null)
    loadAuditEntries(monday)
      .then(list => { if (alive) setEntries(list) })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Chargement impossible') })
    return () => { alive = false }
  }, [monday])

  const panelStyle: React.CSSProperties = isMobile
    ? { position: 'fixed', left: 0, right: 0, bottom: 0, maxHeight: '85vh', borderRadius: '16px 16px 0 0' }
    : { position: 'fixed', top: 0, right: 0, bottom: 0, width: '420px', maxWidth: '100vw', borderRadius: 0 }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(28,28,24,0.45)', display: 'flex',
        justifyContent: isMobile ? 'center' : 'flex-end', alignItems: isMobile ? 'flex-end' : 'stretch' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ ...panelStyle, background: 'var(--surface)', boxShadow: 'var(--shadow-float)', display: 'flex',
          flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px',
          borderBottom: '1px solid var(--border-soft)' }}>
          <div>
            <div className="section-title" style={{ margin: 0, fontSize: '16px' }}>Journal des modifications</div>
            <div style={{ fontSize: '12px', color: 'var(--on-surface-2)' }}>
              Semaine du {monday.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--on-surface-3)', fontSize: '20px', lineHeight: 1, padding: '4px' }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          {error && <div className="chip-danger" style={{ marginBottom: '8px' }}>{error}</div>}
          {entries === null && !error && <div className="spinner" style={{ margin: '32px auto' }} />}
          {entries !== null && entries.length === 0 && !error && (
            <div style={{ color: 'var(--on-surface-2)', fontSize: '13px', textAlign: 'center', padding: '32px 8px' }}>
              Aucune modification enregistrée pour cette semaine.
            </div>
          )}
          {entries?.map(entry => {
            const changes = entry.kind === 'hours'
              ? diffHours(entry.before as HoursSnapshot, entry.after as HoursSnapshot, nameOf)
              : diffEvents(entry.before as WeekEvents, entry.after as WeekEvents, nameOf)
            return (
              <div key={entry.id} style={{ borderBottom: '1px solid var(--border-soft)', padding: '12px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
                  <span style={{ fontWeight: 700, color: 'var(--on-surface)', fontSize: '13px' }}>
                    {entry.authorName || 'Inconnu'}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--on-surface-3)', whiteSpace: 'nowrap' }}>
                    {entry.at
                      ? entry.at.toLocaleString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                      : "à l'instant"}
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--on-surface-2)', margin: '2px 0 6px' }}>
                  {entry.kind === 'hours' ? '🕐 Horaires' : '📋 Absences / événements'}
                </div>
                {changes.length === 0 ? (
                  <div style={{ fontSize: '12px', color: 'var(--on-surface-3)' }}>Modification enregistrée</div>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    {changes.map((c, i) => (
                      <li key={i} style={{ fontSize: '12px', color: 'var(--on-surface)', lineHeight: 1.4 }}>{c}</li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
