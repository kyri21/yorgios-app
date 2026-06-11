import React, { useMemo, useState } from 'react'
import type { Employee, AbsenceType, WeekEvents } from '../../types'

interface Props {
  emp: Employee
  initialDateISO: string
  weekEvents: WeekEvents
  userRole?: string
  onConfirm: (startISO: string, endISO: string, type: AbsenceType, minutes?: number, hours?: number) => void
  onRemove: (startISO: string, endISO: string) => void
  onReplace: (startISO: string, endISO: string, type: AbsenceType, minutes?: number, hours?: number) => void
  onClose: () => void
}

type EventTypeMeta = { label: string; emoji: string; color: string; hasMinutes?: boolean; hasHours?: boolean }

const EVENT_TYPES: { type: AbsenceType; meta: EventTypeMeta }[] = [
  { type: 'jour_off',   meta: { label: 'Jour off',   emoji: '🌙', color: '#6366f1' } },
  { type: 'conge',      meta: { label: 'Congé payé', emoji: '🏖', color: '#0ea5e9' } },
  { type: 'sans_solde', meta: { label: 'Sans solde', emoji: '📋', color: '#f59e0b' } },
  { type: 'absence',    meta: { label: 'Absence',    emoji: '⚠️', color: '#ef4444' } },
  { type: 'retard',     meta: { label: 'Retard',     emoji: '⏰', color: '#f97316', hasMinutes: true } },
  { type: 'malade',     meta: { label: 'Arrêt maladie', emoji: '🤒', color: '#dc2626', hasHours: true } },
]

function isStartWithinOneMonth(dateISO: string): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const oneMonthLater = new Date(today.getFullYear(), today.getMonth() + 1, today.getDate())
  return new Date(dateISO + 'T00:00:00') < oneMonthLater
}

export function EventModal({ emp, initialDateISO, weekEvents, userRole, onConfirm, onRemove, onReplace, onClose }: Props) {
  const [selectedType, setSelectedType]   = useState<AbsenceType>('jour_off')
  const [startISO, setStartISO]           = useState(initialDateISO)
  const [endISO, setEndISO]               = useState(initialDateISO)
  const [minutes, setMinutes]             = useState(15)
  const [hoursLost, setHoursLost]         = useState(7)
  const [tab, setTab]                     = useState<'add' | 'modify'>('add')
  const [congeInfoPending, setCongeInfoPending] = useState(false)

  const currentTypeMeta = EVENT_TYPES.find(e => e.type === selectedType)!.meta
  const needsMinutes = selectedType === 'retard'
  const needsHours = currentTypeMeta.hasHours === true

  // Événements détectés pour cet employé dans la plage sélectionnée (semaine courante seulement)
  const existingInRange = useMemo(() => {
    const result: Array<{ iso: string; type: AbsenceType; minutes?: number }> = []
    const d = new Date(startISO + 'T12:00:00')
    const end = new Date(endISO + 'T12:00:00')
    while (d <= end) {
      const iso = d.toISOString().slice(0, 10)
      ;(weekEvents[iso] ?? [])
        .filter(e => e.empId === emp.id)
        .forEach(e => result.push({ iso, type: e.type, minutes: e.minutes }))
      d.setDate(d.getDate() + 1)
    }
    return result
  }, [weekEvents, emp.id, startISO, endISO])

  const canBypassMonthCheck = !!userRole && ['patron', 'administrateur', 'manager'].includes(userRole)
  const congeBlocked = selectedType === 'conge' && !canBypassMonthCheck && isStartWithinOneMonth(startISO)

  function handleConfirm() {
    if (!startISO || !endISO || endISO < startISO) return
    if (selectedType === 'conge') {
      setCongeInfoPending(true)
      return
    }
    onConfirm(startISO, endISO, selectedType, needsMinutes ? minutes : undefined, needsHours ? hoursLost : undefined)
  }

  function handleCongeConfirmed() {
    setCongeInfoPending(false)
    onConfirm(startISO, endISO, 'conge', undefined)
  }

  function handleReplace() {
    if (!startISO || !endISO || endISO < startISO) return
    onReplace(startISO, endISO, selectedType, needsMinutes ? minutes : undefined, needsHours ? hoursLost : undefined)
  }

  function handleRemove() {
    if (!startISO || !endISO || endISO < startISO) return
    onRemove(startISO, endISO)
  }

  const rangeInvalid = !startISO || !endISO || endISO < startISO

  if (congeInfoPending) {
    return (
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400 }}
      >
        <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg)', padding: '24px', width: '340px', boxShadow: '0 20px 48px rgba(28,28,24,0.18)', textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>🏖</div>
          <div style={{ fontFamily: 'Epilogue, sans-serif', fontWeight: 800, fontSize: '15px', color: 'var(--on-surface)', marginBottom: '10px' }}>
            Demande de congé enregistrée
          </div>
          <div style={{ fontSize: '13px', color: 'var(--on-surface-2)', lineHeight: 1.55, marginBottom: '20px' }}>
            Toutes demandes de jours de congés ne sont pas automatiquement acceptées.<br />
            <strong style={{ color: 'var(--on-surface)' }}>Merci d'attendre la validation de votre manager.</strong>
          </div>
          <button
            onClick={handleCongeConfirmed}
            style={{ background: '#0ea5e9', border: 'none', color: '#fff', borderRadius: '10px', padding: '10px 24px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', width: '100%' }}
          >
            Compris ✓
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg)', padding: '20px', width: '380px', boxShadow: '0 20px 48px rgba(28,28,24,0.14)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
          <span style={{ background: emp.color, color: '#fff', borderRadius: '8px', padding: '4px 8px', fontSize: '13px', fontWeight: 800 }}>
            {emp.initials}
          </span>
          <div>
            <div style={{ color: 'var(--on-surface)', fontWeight: 700, fontSize: '14px', fontFamily: 'Epilogue, sans-serif' }}>{emp.name}</div>
            <div style={{ color: 'var(--on-surface-2)', fontSize: '11px' }}>Événement / Absence</div>
          </div>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--on-surface-3)', fontSize: '18px', cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', background: 'var(--surface-low)', borderRadius: '8px', padding: '3px', marginBottom: '16px' }}>
          {(['add', 'modify'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: '5px', borderRadius: '6px', border: 'none', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              background: tab === t ? 'var(--primary)' : 'transparent',
              color: tab === t ? '#fff' : 'var(--on-surface-3)',
            }}>
              {t === 'add' ? '+ Ajouter' : '✏️ Modifier / Supprimer'}
            </button>
          ))}
        </div>

        {/* ── Onglet AJOUTER ── */}
        {tab === 'add' && (
          <>
            <div style={{ marginBottom: '14px' }}>
              <div style={labelStyle}>Type d'événement</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {EVENT_TYPES.map(({ type, meta }) => (
                  <button key={type} onClick={() => setSelectedType(type)} style={{
                    background: selectedType === type ? meta.color : 'var(--surface-low)',
                    border: `1px solid ${selectedType === type ? meta.color : 'var(--border)'}`,
                    color: selectedType === type ? '#fff' : 'var(--on-surface)',
                    borderRadius: '8px', padding: '5px 10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '4px',
                  }}>
                    {meta.emoji} {meta.label}
                  </button>
                ))}
              </div>
            </div>

            {needsMinutes && (
              <div style={{ marginBottom: '14px' }}>
                <label style={{ ...labelStyle, display: 'block', marginBottom: '6px' }}>Durée du retard</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="number" value={minutes} onChange={e => setMinutes(Math.max(1, Number(e.target.value)))} min={1}
                    style={{ width: '80px', background: 'var(--surface-low)', border: '1px solid var(--border)', color: 'var(--on-surface)', borderRadius: '8px', padding: '6px 10px', fontSize: '13px' }} />
                  <span style={{ color: 'var(--on-surface-2)', fontSize: '12px' }}>minutes</span>
                </div>
              </div>
            )}

            {needsHours && (
              <div style={{ marginBottom: '14px' }}>
                <label style={{ ...labelStyle, display: 'block', marginBottom: '6px' }}>Heures manquées (par jour)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="number" value={hoursLost} onChange={e => setHoursLost(Math.max(0, Number(e.target.value)))} min={0} step={0.5}
                    style={{ width: '80px', background: 'var(--surface-low)', border: '1px solid var(--border)', color: 'var(--on-surface)', borderRadius: '8px', padding: '6px 10px', fontSize: '13px' }} />
                  <span style={{ color: 'var(--on-surface-2)', fontSize: '12px' }}>heures</span>
                </div>
              </div>
            )}

            <DateRangePicker startISO={startISO} endISO={endISO} onStartChange={v => { setStartISO(v); if (v > endISO) setEndISO(v) }} onEndChange={setEndISO} />

            <div style={{ background: 'var(--surface-low)', borderRadius: '8px', padding: '8px 12px', marginBottom: '14px', fontSize: '11px', color: 'var(--on-surface-2)' }}>
              {currentTypeMeta.emoji}{' '}
              <span style={{ color: currentTypeMeta.color, fontWeight: 600 }}>{currentTypeMeta.label}</span>
              {needsMinutes && <span> — {minutes} min</span>}
              {needsHours && <span> — {hoursLost}h/jour</span>}
              {' '}du{' '}<span style={{ color: 'var(--on-surface)', fontWeight: 600 }}>{formatDate(startISO)}</span>
              {' '}au{' '}<span style={{ color: 'var(--on-surface)', fontWeight: 600 }}>{formatDate(endISO)}</span>
            </div>

            {selectedType === 'conge' && congeBlocked && (
              <div style={{ background: 'rgba(192,57,43,0.08)', borderRadius: '8px', padding: '10px 12px', marginBottom: '12px', fontSize: '12px', color: 'var(--danger)', fontWeight: 600, lineHeight: 1.5 }}>
                ⛔ Demande trop proche (moins d'un mois) — merci de contacter directement votre manager.
              </div>
            )}

            <button onClick={handleConfirm} disabled={rangeInvalid || congeBlocked} style={{
              width: '100%', background: currentTypeMeta.color, border: 'none', color: '#fff',
              borderRadius: '10px', padding: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
              opacity: (rangeInvalid || congeBlocked) ? 0.5 : 1,
            }}>
              Confirmer
            </button>
          </>
        )}

        {/* ── Onglet MODIFIER / SUPPRIMER ── */}
        {tab === 'modify' && (
          <>
            <DateRangePicker startISO={startISO} endISO={endISO} onStartChange={v => { setStartISO(v); if (v > endISO) setEndISO(v) }} onEndChange={setEndISO} />

            {/* Événements détectés */}
            <div style={{ marginBottom: '14px' }}>
              <div style={labelStyle}>Événements détectés sur la période</div>
              {existingInRange.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--on-surface-3)', padding: '6px 0' }}>
                  Aucun événement trouvé dans la semaine affichée.
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {[...new Map(existingInRange.map(e => [e.type, e])).values()].map(({ type, minutes: m }) => {
                    const meta = EVENT_TYPES.find(e => e.type === type)?.meta
                    return (
                      <span key={type} style={{
                        fontSize: 11, padding: '3px 8px', borderRadius: 6, fontWeight: 600,
                        background: `${meta?.color}18`, color: meta?.color,
                        border: `1px solid ${meta?.color}40`,
                      }}>
                        {meta?.emoji} {meta?.label}{m ? ` (${m} min)` : ''}
                      </span>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Sélecteur nouveau type */}
            <div style={{ marginBottom: '14px' }}>
              <div style={labelStyle}>Nouveau type</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {EVENT_TYPES.map(({ type, meta }) => (
                  <button key={type} onClick={() => setSelectedType(type)} style={{
                    background: selectedType === type ? meta.color : 'var(--surface-low)',
                    border: `1px solid ${selectedType === type ? meta.color : 'var(--border)'}`,
                    color: selectedType === type ? '#fff' : 'var(--on-surface)',
                    borderRadius: '8px', padding: '5px 10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '4px',
                  }}>
                    {meta.emoji} {meta.label}
                  </button>
                ))}
              </div>

              {needsMinutes && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: 10 }}>
                  <input type="number" value={minutes} onChange={e => setMinutes(Math.max(1, Number(e.target.value)))} min={1}
                    style={{ width: '80px', background: 'var(--surface-low)', border: '1px solid var(--border)', color: 'var(--on-surface)', borderRadius: '8px', padding: '6px 10px', fontSize: '13px' }} />
                  <span style={{ color: 'var(--on-surface-2)', fontSize: '12px' }}>minutes</span>
                </div>
              )}

              {needsHours && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: 10 }}>
                  <input type="number" value={hoursLost} onChange={e => setHoursLost(Math.max(0, Number(e.target.value)))} min={0} step={0.5}
                    style={{ width: '80px', background: 'var(--surface-low)', border: '1px solid var(--border)', color: 'var(--on-surface)', borderRadius: '8px', padding: '6px 10px', fontSize: '13px' }} />
                  <span style={{ color: 'var(--on-surface-2)', fontSize: '12px' }}>heures manquées / jour</span>
                </div>
              )}
            </div>

            {/* Bouton changer type */}
            <button onClick={handleReplace} disabled={rangeInvalid} style={{
              width: '100%', background: currentTypeMeta.color, border: 'none', color: '#fff',
              borderRadius: '10px', padding: '10px', fontSize: '13px', fontWeight: 700,
              cursor: rangeInvalid ? 'default' : 'pointer', opacity: rangeInvalid ? 0.5 : 1,
              marginBottom: 8,
            }}>
              {currentTypeMeta.emoji} Remplacer par « {currentTypeMeta.label} »
            </button>

            {/* Séparateur */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 10px' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span style={{ fontSize: 10, color: 'var(--on-surface-3)', fontWeight: 600 }}>OU</span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>

            {/* Bouton supprimer */}
            <button onClick={handleRemove} disabled={rangeInvalid} style={{
              width: '100%', background: 'transparent', border: '1.5px solid var(--danger)', color: 'var(--danger)',
              borderRadius: '10px', padding: '10px', fontSize: '13px', fontWeight: 700,
              cursor: rangeInvalid ? 'default' : 'pointer', opacity: rangeInvalid ? 0.5 : 1,
            }}>
              Supprimer tous les événements
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function DateRangePicker({ startISO, endISO, onStartChange, onEndChange }: {
  startISO: string; endISO: string
  onStartChange: (v: string) => void; onEndChange: (v: string) => void
}) {
  return (
    <div style={{ display: 'flex', gap: '10px', marginBottom: '14px' }}>
      <div style={{ flex: 1 }}>
        <label style={{ ...labelStyle, display: 'block', marginBottom: '5px' }}>Date de début</label>
        <input type="date" value={startISO} onChange={e => onStartChange(e.target.value)} style={dateInputStyle} />
      </div>
      <div style={{ flex: 1 }}>
        <label style={{ ...labelStyle, display: 'block', marginBottom: '5px' }}>Date de fin</label>
        <input type="date" value={endISO} min={startISO} onChange={e => onEndChange(e.target.value)} style={dateInputStyle} />
      </div>
    </div>
  )
}

function formatDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

const labelStyle: React.CSSProperties = {
  color: 'var(--on-surface-2)', fontSize: '11px', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.05em',
}

const dateInputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--surface-low)', border: '1px solid var(--border)',
  color: 'var(--on-surface)', borderRadius: '8px', padding: '6px 8px',
  fontSize: '12px', boxSizing: 'border-box',
}
