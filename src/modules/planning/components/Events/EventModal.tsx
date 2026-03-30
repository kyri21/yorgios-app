import React, { useState } from 'react'
import type { Employee, AbsenceType, WeekEvents } from '../../types'

interface Props {
  emp: Employee
  initialDateISO: string          // date pré-remplie (depuis le clic droit)
  weekEvents: WeekEvents          // pour afficher les événements existants
  onConfirm: (startISO: string, endISO: string, type: AbsenceType, minutes?: number) => void
  onRemove: (startISO: string, endISO: string) => void
  onClose: () => void
}

type EventTypeMeta = {
  label: string
  emoji: string
  color: string
  hasMinutes?: boolean
}

const EVENT_TYPES: { type: AbsenceType; meta: EventTypeMeta }[] = [
  { type: 'jour_off',   meta: { label: 'Jour off',    emoji: '🌙', color: '#6366f1' } },
  { type: 'conge',      meta: { label: 'Congé payé',  emoji: '🏖', color: '#0ea5e9' } },
  { type: 'sans_solde', meta: { label: 'Sans solde',  emoji: '📋', color: '#f59e0b' } },
  { type: 'absence',    meta: { label: 'Absence',     emoji: '⚠️', color: '#ef4444' } },
  { type: 'retard',     meta: { label: 'Retard',      emoji: '⏰', color: '#f97316', hasMinutes: true } },
]

export function EventModal({ emp, initialDateISO, weekEvents, onConfirm, onRemove, onClose }: Props) {
  const [selectedType, setSelectedType] = useState<AbsenceType>('jour_off')
  const [startISO, setStartISO]         = useState(initialDateISO)
  const [endISO, setEndISO]             = useState(initialDateISO)
  const [minutes, setMinutes]           = useState(15)
  const [tab, setTab]                   = useState<'add' | 'remove'>('add')

  const currentTypeMeta = EVENT_TYPES.find(e => e.type === selectedType)!.meta
  const needsMinutes = selectedType === 'retard'

  // Événements existants sur la date initiale pour cet employé
  const existingEvents = (weekEvents[initialDateISO] ?? []).filter(e => e.empId === emp.id)

  function handleConfirm() {
    if (!startISO || !endISO || endISO < startISO) return
    onConfirm(startISO, endISO, selectedType, needsMinutes ? minutes : undefined)
  }

  function handleRemove() {
    if (!startISO || !endISO || endISO < startISO) return
    onRemove(startISO, endISO)
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
          padding: '20px', width: '380px', boxShadow: '0 20px 48px rgba(28,28,24,0.14)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
          <span style={{
            background: emp.color, color: '#fff', borderRadius: '8px',
            padding: '4px 8px', fontSize: '13px', fontWeight: 800,
          }}>
            {emp.initials}
          </span>
          <div>
            <div style={{ color: 'var(--on-surface)', fontWeight: 700, fontSize: '14px', fontFamily: 'Epilogue, sans-serif' }}>{emp.name}</div>
            <div style={{ color: 'var(--on-surface-2)', fontSize: '11px' }}>Événement / Absence</div>
          </div>
          <button
            onClick={onClose}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--on-surface-3)', fontSize: '18px', cursor: 'pointer', lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', background: 'var(--surface-low)', borderRadius: '8px', padding: '3px', marginBottom: '16px' }}>
          {(['add', 'remove'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1, padding: '5px', borderRadius: '6px', border: 'none', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                background: tab === t ? 'var(--primary)' : 'transparent',
                color: tab === t ? '#fff' : 'var(--on-surface-3)',
              }}
            >
              {t === 'add' ? '+ Ajouter' : '✕ Supprimer'}
            </button>
          ))}
        </div>

        {tab === 'add' && (
          <>
            {/* Sélection du type */}
            <div style={{ marginBottom: '14px' }}>
              <div style={{ color: 'var(--on-surface-2)', fontSize: '11px', fontWeight: 600, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Type d'événement</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {EVENT_TYPES.map(({ type, meta }) => (
                  <button
                    key={type}
                    onClick={() => setSelectedType(type)}
                    style={{
                      background: selectedType === type ? meta.color : 'var(--surface-low)',
                      border: `1px solid ${selectedType === type ? meta.color : 'var(--border)'}`,
                      color: selectedType === type ? '#fff' : 'var(--on-surface)',
                      borderRadius: '8px', padding: '5px 10px',
                      fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: '4px',
                    }}
                  >
                    {meta.emoji} {meta.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Minutes (pour retard) */}
            {needsMinutes && (
              <div style={{ marginBottom: '14px' }}>
                <label style={{ color: 'var(--on-surface-2)', fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Durée du retard
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="number"
                    value={minutes}
                    onChange={e => setMinutes(Math.max(1, Number(e.target.value)))}
                    min={1}
                    style={{
                      width: '80px', background: 'var(--surface-low)', border: '1px solid var(--border)',
                      color: 'var(--on-surface)', borderRadius: '8px', padding: '6px 10px', fontSize: '13px',
                    }}
                  />
                  <span style={{ color: 'var(--on-surface-2)', fontSize: '12px' }}>minutes</span>
                </div>
              </div>
            )}

            {/* Plage de dates */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '18px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ color: 'var(--on-surface-2)', fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Date de début
                </label>
                <input
                  type="date"
                  value={startISO}
                  onChange={e => {
                    setStartISO(e.target.value)
                    if (e.target.value > endISO) setEndISO(e.target.value)
                  }}
                  style={dateInputStyle}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ color: 'var(--on-surface-2)', fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Date de fin
                </label>
                <input
                  type="date"
                  value={endISO}
                  min={startISO}
                  onChange={e => setEndISO(e.target.value)}
                  style={dateInputStyle}
                />
              </div>
            </div>

            {/* Résumé */}
            <div style={{
              background: 'var(--surface-low)', borderRadius: '8px', padding: '8px 12px',
              marginBottom: '14px', fontSize: '11px', color: 'var(--on-surface-2)',
            }}>
              {currentTypeMeta.emoji}{' '}
              <span style={{ color: currentTypeMeta.color, fontWeight: 600 }}>{currentTypeMeta.label}</span>
              {needsMinutes && <span> — {minutes} min</span>}
              {' '}du{' '}
              <span style={{ color: 'var(--on-surface)', fontWeight: 600 }}>{formatDate(startISO)}</span>
              {' '}au{' '}
              <span style={{ color: 'var(--on-surface)', fontWeight: 600 }}>{formatDate(endISO)}</span>
            </div>

            <button
              onClick={handleConfirm}
              disabled={!startISO || !endISO || endISO < startISO}
              style={{
                width: '100%', background: currentTypeMeta.color, border: 'none',
                color: '#fff', borderRadius: '10px', padding: '10px',
                fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                opacity: (!startISO || !endISO || endISO < startISO) ? 0.5 : 1,
              }}
            >
              Confirmer
            </button>
          </>
        )}

        {tab === 'remove' && (
          <>
            {/* Événements existants sur la date cliquée */}
            {existingEvents.length > 0 && (
              <div style={{ marginBottom: '14px' }}>
                <div style={{ color: 'var(--on-surface-2)', fontSize: '11px', fontWeight: 600, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Événements le {formatDate(initialDateISO)}
                </div>
                {existingEvents.map((ev, i) => {
                  const meta = EVENT_TYPES.find(e => e.type === ev.type)?.meta
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      background: 'var(--surface-low)', borderRadius: '6px', padding: '5px 8px', marginBottom: '4px',
                    }}>
                      <span>{meta?.emoji}</span>
                      <span style={{ color: meta?.color, fontSize: '11px', fontWeight: 600 }}>{meta?.label}</span>
                      {ev.minutes && <span style={{ color: 'var(--on-surface-3)', fontSize: '11px' }}>— {ev.minutes} min</span>}
                    </div>
                  )
                })}
              </div>
            )}

            {existingEvents.length === 0 && (
              <div style={{ color: 'var(--on-surface-3)', fontSize: '12px', marginBottom: '14px', textAlign: 'center', padding: '8px 0' }}>
                Aucun événement le {formatDate(initialDateISO)}
              </div>
            )}

            {/* Plage de dates à supprimer */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '18px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ color: 'var(--on-surface-2)', fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Du
                </label>
                <input type="date" value={startISO} onChange={e => { setStartISO(e.target.value); if (e.target.value > endISO) setEndISO(e.target.value) }} style={dateInputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ color: 'var(--on-surface-2)', fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Au
                </label>
                <input type="date" value={endISO} min={startISO} onChange={e => setEndISO(e.target.value)} style={dateInputStyle} />
              </div>
            </div>

            <button
              onClick={handleRemove}
              disabled={!startISO || !endISO || endISO < startISO}
              style={{
                width: '100%', background: 'var(--danger)', border: 'none',
                color: '#fff', borderRadius: '10px', padding: '10px',
                fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                opacity: (!startISO || !endISO || endISO < startISO) ? 0.5 : 1,
              }}
            >
              Retirer tous les événements sur cette période
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function formatDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

const dateInputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--surface-low)', border: '1px solid var(--border)',
  color: 'var(--on-surface)', borderRadius: '8px', padding: '6px 8px',
  fontSize: '12px', boxSizing: 'border-box',
}
