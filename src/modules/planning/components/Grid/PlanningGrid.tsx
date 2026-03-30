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
  tooltip?: string
  onPointerDown: () => void; onPointerEnter: () => void; onPointerUp: () => void
  onContextMenu: (e: React.MouseEvent) => void
}

function Cell({ employees, byId, canEdit, isRestricted, tooltip, onPointerDown, onPointerEnter, onPointerUp, onContextMenu }: CellProps) {
  return (
    <div title={tooltip} style={{
      border: '1px solid rgba(255,255,255,0.07)', borderRadius: '4px',
      cursor: isRestricted ? 'not-allowed' : canEdit ? 'crosshair' : 'default',
      touchAction: 'none', userSelect: 'none', display: 'flex', flexWrap: 'wrap',
      alignContent: 'flex-start', gap: '2px', padding: '2px', boxSizing: 'border-box',
      background: isRestricted ? 'rgba(239,68,68,0.09)' : employees.length > 0 ? 'rgba(255,255,255,0.04)' : 'transparent',
      transition: 'background 0.05s', minWidth: 0, overflow: 'hidden',
    }}
      onPointerDown={canEdit && !isRestricted ? (e => { e.preventDefault(); onPointerDown() }) : undefined}
      onPointerEnter={canEdit && !isRestricted ? onPointerEnter : undefined}
      onPointerUp={canEdit && !isRestricted ? onPointerUp : undefined}
      onContextMenu={onContextMenu}
    >
      {employees.map(empId => {
        const emp = byId[empId]; if (!emp) return null
        return <span key={empId} title={emp.name} style={{ background: emp.color, color: '#fff', borderRadius: '3px', padding: '0 3px', fontSize: '10px', fontWeight: 700, lineHeight: '16px', flexShrink: 0 }}>{emp.initials}</span>
      })}
    </div>
  )
}

const EVENT_META: Record<AbsenceType, { emoji: string; color: string; label: string }> = {
  jour_off: { emoji: '🌙', color: '#6366f1', label: 'Jour off' },
  conge: { emoji: '🏖', color: '#0ea5e9', label: 'Congé' },
  sans_solde: { emoji: '📋', color: '#f59e0b', label: 'Sans solde' },
  absence: { emoji: '⚠️', color: '#ef4444', label: 'Absence' },
  retard: { emoji: '⏰', color: '#f97316', label: 'Retard' },
  heures_supp: { emoji: '➕', color: '#22c55e', label: 'Heures supp' },
}

function toLocalISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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
    <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `38px repeat(7, 1fr)`, gridTemplateRows: `22px repeat(${HOURS.length}, 1fr)`, gap: '2px', minHeight: 0 }}
      onPointerUp={stopPaint} onPointerLeave={stopPaint} onContextMenu={e => e.preventDefault()}>
      <div />
      {DAYS_LABELS.map((_, i) => {
        const d = addDays(monday, i), isToday = d.toDateString() === new Date().toDateString()
        const dateISO = toLocalISO(d)
        const dayEventsForSelected = selectedEmpId ? (weekEvents[dateISO] ?? []).filter(e => e.empId === selectedEmpId) : []
        return (
          <div key={i} style={{ background: isToday ? 'var(--primary)' : 'var(--surface-low)', borderRadius: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, color: isToday ? '#fff' : 'var(--on-surface)', gap: '3px', overflow: 'hidden' }}>
            {dayLabel(monday, i)}
            {dayEventsForSelected.map((ev, idx) => {
              const meta = EVENT_META[ev.type]
              return <span key={idx} title={`${meta.label}${ev.minutes ? ` (${ev.minutes}min)` : ''}`} style={{ fontSize: '9px', background: meta.color, borderRadius: '3px', padding: '0 2px', lineHeight: '14px', flexShrink: 0 }}>{meta.emoji}</span>
            })}
          </div>
        )
      })}
      {HOURS.map(h => (
        <React.Fragment key={h}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: '5px', fontSize: '10px', fontWeight: 600, color: '#475569' }}>{h}h</div>
          {DAYS_LABELS.map((_, d) => {
            const empIds = draft[d]?.hours[String(h)] ?? []
            const selEmp = selectedEmpId ? byId[selectedEmpId] : null
            const isRestricted = canEdit && !!selEmp && (selEmp.restrictions ?? []).some(rule => rule.days.includes(d) && rule.hours.includes(String(h)))
            const selEmpName = selEmp?.name
            const tooltip = !canEdit || !selEmpName ? undefined
              : isRestricted ? `🚫 ${selEmpName} — créneau indisponible`
              : empIds.includes(selectedEmpId!) ? `✕ Retirer ${selEmpName}`
              : `+ Ajouter ${selEmpName}`
            return <Cell key={d} employees={empIds} byId={byId} canEdit={canEdit} isRestricted={isRestricted}
              tooltip={tooltip}
              onPointerDown={() => startPaint(d, h)} onPointerEnter={() => continuePaint(d, h)}
              onPointerUp={stopPaint} onContextMenu={e => handleContextMenu(e, d)} />
          })}
        </React.Fragment>
      ))}
    </div>
  )
}
