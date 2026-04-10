import React, { useRef, useCallback } from 'react'
import type { WeekDraft, Employee, WeekEvents, AbsenceType } from '../../types'
import { HOURS, DAYS_LABELS } from '../../types'
import { dayLabel } from '../../utils/dateUtils'
import { addDays } from '../../firebase/planning'

interface Props {
  monday: Date; draft: WeekDraft; byId: Record<string, Employee>
  selectedEmpId: string | null; canEdit: boolean
  onPaintCell: (dayIndex: number, hour: number, empId: string, mode: 'add' | 'remove') => void
  weekEvents?: WeekEvents; onCellContextMenu?: (dateISO: string) => void
}

interface CellProps {
  employees: string[]; byId: Record<string, Employee>; canEdit: boolean; isRestricted: boolean
  tooltip?: string; extraStyle?: React.CSSProperties
  onPointerDown: () => void; onPointerEnter: () => void; onPointerUp: () => void
  onContextMenu: (e: React.MouseEvent) => void
}

function Cell({ employees, byId, canEdit, isRestricted, tooltip, extraStyle, onPointerDown, onPointerEnter, onPointerUp, onContextMenu }: CellProps) {
  return (
    <div title={tooltip} style={{
      cursor: isRestricted ? 'not-allowed' : canEdit ? 'crosshair' : 'default',
      touchAction: 'none', userSelect: 'none', display: 'flex', flexWrap: 'wrap',
      alignContent: 'flex-start', gap: '2px', padding: '2px', boxSizing: 'border-box',
      transition: 'background 0.05s', minWidth: 0, overflow: 'hidden',
      ...extraStyle,
    }}
      onPointerDown={canEdit && !isRestricted ? (e => { e.preventDefault(); onPointerDown() }) : undefined}
      onPointerEnter={canEdit && !isRestricted ? onPointerEnter : undefined}
      onPointerUp={canEdit && !isRestricted ? onPointerUp : undefined}
      onContextMenu={onContextMenu}
    >
      {employees.map(empId => {
        const emp = byId[empId]; if (!emp) return null
        return <span key={empId} title={emp.name} style={{
          background: emp.color, color: '#fff', borderRadius: '3px',
          padding: '0 3px', fontSize: '10px', fontWeight: 700, lineHeight: '16px', flexShrink: 0,
        }}>{emp.initials}</span>
      })}
    </div>
  )
}

const EVENT_META: Record<AbsenceType, { emoji: string; color: string; label: string }> = {
  jour_off:    { emoji: '🌙', color: '#6366f1', label: 'Jour off' },
  conge:       { emoji: '🏖', color: '#0ea5e9', label: 'Congé' },
  sans_solde:  { emoji: '📋', color: '#f59e0b', label: 'Sans solde' },
  absence:     { emoji: '⚠️', color: '#ef4444', label: 'Absence' },
  retard:      { emoji: '⏰', color: '#f97316', label: 'Retard' },
  heures_supp: { emoji: '➕', color: '#22c55e', label: 'Heures supp' },
  malade:      { emoji: '🤒', color: '#dc2626', label: 'Malade' },
  parti_tot:   { emoji: '🚪', color: '#9333ea', label: 'Parti plus tôt' },
}

function toLocalISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const MIDI_HOURS = new Set([12, 13, 14])

export function PlanningGrid({ monday, draft, byId, selectedEmpId, canEdit, onPaintCell, weekEvents = {}, onCellContextMenu }: Props) {
  const painting = useRef(false), paintMode = useRef<'add' | 'remove'>('add')

  const startPaint = useCallback((dayIndex: number, hour: number) => {
    if (!selectedEmpId || !canEdit) return
    const current = draft[dayIndex]?.hours[String(hour)] ?? []
    paintMode.current = current.includes(selectedEmpId) ? 'remove' : 'add'
    painting.current = true
    onPaintCell(dayIndex, hour, selectedEmpId, paintMode.current)
  }, [selectedEmpId, canEdit, draft, onPaintCell])

  const continuePaint = useCallback((dayIndex: number, hour: number) => {
    if (!painting.current || !selectedEmpId) return
    onPaintCell(dayIndex, hour, selectedEmpId, paintMode.current)
  }, [selectedEmpId, onPaintCell])

  const stopPaint = useCallback(() => { painting.current = false }, [])

  const handleContextMenu = useCallback((e: React.MouseEvent, dayIdx: number) => {
    e.preventDefault()
    if (!canEdit || !selectedEmpId || !onCellContextMenu) return
    onCellContextMenu(toLocalISO(addDays(monday, dayIdx)))
  }, [canEdit, selectedEmpId, onCellContextMenu, monday])

  return (
    <div
      style={{
        flex: 1, display: 'grid',
        gridTemplateColumns: `38px repeat(7, 1fr) 38px`,
        gridTemplateRows: `24px repeat(${HOURS.length}, 1fr)`,
        gap: '0',
        minHeight: 0,
        border: '1px solid var(--border)',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
      onPointerUp={stopPaint} onPointerLeave={stopPaint} onContextMenu={e => e.preventDefault()}
    >
      {/* ── Header row ── */}
      <div style={{ background: 'var(--surface-mid)', borderBottom: '1px solid var(--border)' }} />
      {DAYS_LABELS.map((_, i) => {
        const d = addDays(monday, i)
        const isToday = d.toDateString() === new Date().toDateString()
        const dateISO = toLocalISO(d)
        const dayEventsForSelected = selectedEmpId
          ? (weekEvents[dateISO] ?? []).filter(e => e.empId === selectedEmpId)
          : []
        return (
          <div key={i} style={{
            background: isToday ? 'var(--primary)' : 'var(--surface-mid)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '11px', fontWeight: 700,
            color: isToday ? '#fff' : 'var(--on-surface)',
            gap: '3px', overflow: 'hidden',
            borderLeft: '2px solid var(--border)',
            borderBottom: '1px solid var(--border)',
          }}>
            {dayLabel(monday, i)}
            {dayEventsForSelected.map((ev, idx) => {
              const meta = EVENT_META[ev.type]
              const detail = ev.minutes ? `${ev.minutes}min` : ev.hours ? `${ev.hours}h` : ''
              return (
                <span key={idx}
                  title={`${meta.label}${detail ? ` (${detail})` : ''}`}
                  style={{ fontSize: '9px', background: meta.color, color: '#fff', borderRadius: '3px', padding: '0 2px', lineHeight: '14px', flexShrink: 0 }}
                >
                  {meta.emoji}
                </span>
              )
            })}
          </div>
        )
      })}
      <div style={{ background: 'var(--surface-mid)', borderBottom: '1px solid var(--border)' }} />

      {/* ── Hour rows ── */}
      {HOURS.map((h, rowIdx) => {
        const isMidi = MIDI_HOURS.has(h)
        const isMidiStart = h === 12
        const isMidiEnd = h === 14
        const isAlt = rowIdx % 2 === 1
        const rowBg = isMidi ? 'rgba(251,191,36,0.07)' : isAlt ? 'var(--surface-low)' : 'var(--surface)'
        const hourColor = isMidi ? '#b45309' : 'var(--on-surface-3)'
        const topBorder = isMidiStart ? '2px solid rgba(217,119,6,0.4)' : '1px solid var(--border-soft)'
        const bottomBorder = isMidiEnd ? '2px solid rgba(217,119,6,0.25)' : undefined

        const hourLabelBaseStyle: React.CSSProperties = {
          display: 'flex', alignItems: 'center',
          fontSize: '10px', fontWeight: isMidi ? 800 : 600,
          color: hourColor, background: rowBg,
          borderTop: topBorder,
          borderBottom: bottomBorder,
        }

        return (
          <React.Fragment key={h}>
            {/* Left hour label */}
            <div style={{ ...hourLabelBaseStyle, justifyContent: 'flex-end', paddingRight: '6px' }}>
              {h}h
            </div>

            {/* 7 day cells */}
            {DAYS_LABELS.map((_, d) => {
              const empIds = draft[d]?.hours[String(h)] ?? []
              const selEmp = selectedEmpId ? byId[selectedEmpId] : null
              const isRestricted = canEdit && !!selEmp
                && (selEmp.restrictions ?? []).some(rule => rule.days.includes(d) && rule.hours.includes(String(h)))
              const selEmpName = selEmp?.name
              const tooltip = !canEdit || !selEmpName ? undefined
                : isRestricted ? `🚫 ${selEmpName} — créneau indisponible`
                : empIds.includes(selectedEmpId!) ? `✕ Retirer ${selEmpName}`
                : `+ Ajouter ${selEmpName}`

              const cellBg = isRestricted
                ? 'rgba(239,68,68,0.07)'
                : isMidi
                  ? 'rgba(251,191,36,0.09)'
                  : empIds.length > 0
                    ? (isAlt ? 'var(--surface-high)' : 'var(--surface-mid)')
                    : rowBg

              return (
                <Cell
                  key={d}
                  employees={empIds}
                  byId={byId}
                  canEdit={canEdit}
                  isRestricted={isRestricted}
                  tooltip={tooltip}
                  extraStyle={{
                    background: cellBg,
                    borderLeft: '2px solid var(--border)',
                    borderTop: topBorder,
                    borderBottom: bottomBorder,
                  }}
                  onPointerDown={() => startPaint(d, h)}
                  onPointerEnter={() => continuePaint(d, h)}
                  onPointerUp={stopPaint}
                  onContextMenu={e => handleContextMenu(e, d)}
                />
              )
            })}

            {/* Right hour label */}
            <div style={{ ...hourLabelBaseStyle, justifyContent: 'flex-start', paddingLeft: '6px', borderLeft: '2px solid var(--border)' }}>
              {h}h
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )
}
