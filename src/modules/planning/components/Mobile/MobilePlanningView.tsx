import React, { useState, useEffect } from 'react'
import type { WeekDraft, Employee, WeekEvents, AbsenceType } from '../../types'
import { DAYS_LABELS, HOURS } from '../../types'
import { weekLabel } from '../../utils/dateUtils'
import { addDays } from '../../firebase/planning'
import { EventModal } from '../Events/EventModal'

interface Props {
  monday: Date
  draft: WeekDraft
  employees: Employee[]
  weekEvents: WeekEvents
  loading: boolean
  slow?: boolean
  error?: string | null
  onRetry?: () => void
  canEdit: boolean
  userRole?: string
  dirty: boolean
  saving: boolean
  onPrevWeek: () => void
  onNextWeek: () => void
  onSetEmpDayHours: (dayIndex: number, empId: string, startHour: number | null, endHour: number) => void
  onSetEventRange: (startISO: string, endISO: string, empId: string, type: AbsenceType, minutes?: number, hours?: number) => void | Promise<void>
  onRemoveEventRange: (startISO: string, endISO: string, empId: string) => void | Promise<void>
  onRemoveDayEvent: (dateISO: string, empId: string, type?: string) => void
  onSave: () => void | Promise<void>
}

const EVENT_META: Record<AbsenceType, { emoji: string; label: string; color: string }> = {
  jour_off:    { emoji: '🌙', label: 'Jour off',        color: '#6366f1' },
  conge:       { emoji: '🏖', label: 'Congé',           color: '#0ea5e9' },
  sans_solde:  { emoji: '📋', label: 'Sans solde',      color: '#b45309' },
  absence:     { emoji: '⚠️', label: 'Absence',         color: '#c0392b' },
  retard:      { emoji: '⏰', label: 'Retard',           color: '#b45309' },
  heures_supp: { emoji: '➕', label: 'Heures supp',     color: '#2d7a4f' },
  malade:      { emoji: '🤒', label: 'Malade',          color: '#dc2626' },
  parti_tot:   { emoji: '🚪', label: 'Parti plus tôt',  color: '#9333ea' },
}

function eventDetail(ev: { minutes?: number; hours?: number }): string {
  if (ev.minutes) return ` · ${ev.minutes} min`
  if (ev.hours)   return ` · ${ev.hours}h`
  return ''
}

function toLocalISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getEmpSchedule(dayDraft: WeekDraft[number] | undefined, empId: string) {
  if (!dayDraft) return { working: false, startHour: null as number | null, endHour: null as number | null }
  const hours = Object.entries(dayDraft.hours)
    .filter(([, emps]) => emps.includes(empId))
    .map(([h]) => parseInt(h))
    .sort((a, b) => a - b)
  if (hours.length === 0) return { working: false, startHour: null, endHour: null }
  return { working: true, startHour: hours[0], endHour: hours[hours.length - 1] + 1 }
}

function hasDayWorkers(dayDraft: WeekDraft[number] | undefined): boolean {
  if (!dayDraft) return false
  return Object.values(dayDraft.hours).some(emps => emps.length > 0)
}

const START_OPTIONS = HOURS                       // 8 … 20
const END_OPTIONS = HOURS.map(h => h + 1)         // 9 … 21

export function MobilePlanningView({
  monday, draft, employees, weekEvents, loading, slow, error, onRetry,
  canEdit, userRole, dirty, saving,
  onPrevWeek, onNextWeek,
  onSetEmpDayHours, onSetEventRange, onRemoveEventRange, onRemoveDayEvent, onSave,
}: Props) {
  const todayISO = toLocalISO(new Date())

  function todayDayIndex() {
    for (let i = 0; i < 7; i++) {
      if (toLocalISO(addDays(monday, i)) === todayISO) return i
    }
    return 0
  }

  const [selectedDay, setSelectedDay] = useState(() => todayDayIndex())
  const [sheetEmpId, setSheetEmpId]   = useState<string | null>(null)
  const [eventEmpId, setEventEmpId]   = useState<string | null>(null)
  const [editStart, setEditStart]     = useState(9)
  const [editEnd, setEditEnd]         = useState(17)

  useEffect(() => {
    setSelectedDay(todayDayIndex())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monday])

  const selectedDate = addDays(monday, selectedDay)
  const selectedISO = toLocalISO(selectedDate)
  const dayDraft = draft[selectedDay]
  const dayEvents = weekEvents[selectedISO] || []

  const schedules = employees.map(emp => {
    const schedule = getEmpSchedule(dayDraft, emp.id)
    const events = dayEvents.filter(e => e.empId === emp.id)
    return { emp, ...schedule, events }
  })

  const working   = schedules.filter(s => s.working)
  const withEvent = schedules.filter(s => !s.working && s.events.length > 0)
  const resting   = schedules.filter(s => !s.working && s.events.length === 0)

  const dateLabel = selectedDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

  const byId = Object.fromEntries(employees.map(e => [e.id, e]))
  const sheetEmp = sheetEmpId ? byId[sheetEmpId] : null
  const eventEmp = eventEmpId ? byId[eventEmpId] : null
  const sheetSchedule = sheetEmp ? getEmpSchedule(dayDraft, sheetEmp.id) : null
  const sheetEvents = sheetEmp ? dayEvents.filter(e => e.empId === sheetEmp.id) : []

  function openSheet(empId: string) {
    if (!canEdit) return
    const sched = getEmpSchedule(dayDraft, empId)
    setEditStart(sched.startHour ?? 9)
    setEditEnd(sched.endHour ?? 17)
    setSheetEmpId(empId)
  }

  function applyHours() {
    if (!sheetEmp) return
    const end = Math.max(editEnd, editStart + 1)
    onSetEmpDayHours(selectedDay, sheetEmp.id, editStart, end)
    setSheetEmpId(null)
  }

  function clearHours() {
    if (!sheetEmp) return
    onSetEmpDayHours(selectedDay, sheetEmp.id, null, 0)
    setSheetEmpId(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface)', overflow: 'hidden', position: 'relative' }}>

      {/* Week navigator */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px 6px', flexShrink: 0,
        borderBottom: '1px solid var(--border-soft)',
      }}>
        <button onClick={onPrevWeek} className="btn-secondary" style={{ padding: '5px 14px', fontSize: 16, fontWeight: 700 }}>‹</button>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--on-surface)', letterSpacing: '-0.01em', fontFamily: 'Epilogue, sans-serif' }}>
          {weekLabel(monday)}
        </span>
        <button onClick={onNextWeek} className="btn-secondary" style={{ padding: '5px 14px', fontSize: 16, fontWeight: 700 }}>›</button>
      </div>

      {/* Day pills */}
      <div style={{ display: 'flex', gap: 5, padding: '8px 14px 10px', flexShrink: 0, background: 'var(--surface-low)' }}>
        {DAYS_LABELS.map((label, i) => {
          const d = addDays(monday, i)
          const iso = toLocalISO(d)
          const isToday    = iso === todayISO
          const isSelected = i === selectedDay
          const hasWork    = hasDayWorkers(draft[i])

          return (
            <button
              key={i}
              onClick={() => setSelectedDay(i)}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                padding: '7px 2px 5px', borderRadius: 12, border: 'none', cursor: 'pointer',
                background: isSelected ? 'var(--primary)' : isToday ? 'rgba(0,66,117,0.10)' : 'transparent',
                WebkitTapHighlightColor: 'transparent', transition: 'all 0.12s',
              }}
            >
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                color: isSelected ? 'rgba(255,255,255,0.80)' : 'var(--on-surface-3)', marginBottom: 2,
              }}>{label}</span>
              <span style={{
                fontSize: 15, fontWeight: 800, lineHeight: 1,
                color: isSelected ? '#fff' : isToday ? 'var(--primary)' : 'var(--on-surface)',
              }}>{d.getDate()}</span>
              <span style={{
                width: 4, height: 4, borderRadius: '50%', marginTop: 4,
                background: hasWork ? (isSelected ? 'rgba(255,255,255,0.7)' : 'var(--primary)') : 'transparent',
              }} />
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px 90px' }}>

        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          marginBottom: 12, marginTop: 16,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)',
            textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'Manrope, sans-serif',
          }}>
            {dateLabel}
          </div>
          {canEdit && (
            <span style={{ fontSize: 10, color: 'var(--on-surface-3)' }}>Touchez un employé pour modifier</span>
          )}
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="skeleton" style={{ height: 68, borderRadius: 14 }} />
            <div className="skeleton" style={{ height: 68, borderRadius: 14 }} />
            <div className="skeleton" style={{ height: 68, borderRadius: 14 }} />
            <div style={{ textAlign: 'center', marginTop: 6, color: 'var(--on-surface-2)', fontSize: 13, fontFamily: 'Manrope, sans-serif' }}>
              {slow ? 'Ça prend plus de temps que prévu…' : 'Chargement du planning…'}
            </div>
            {slow && onRetry && (
              <div style={{ textAlign: 'center', marginTop: 4 }}>
                <button className="btn-secondary" onClick={onRetry}>Réessayer</button>
              </div>
            )}
          </div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: '40px 16px', fontFamily: 'Manrope, sans-serif' }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>⚠️</div>
            <div style={{ color: 'var(--on-surface)', fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
              Chargement impossible
            </div>
            <div style={{ color: 'var(--on-surface-2)', fontSize: 13, marginBottom: 16 }}>
              Vérifie ta connexion, puis réessaie.
            </div>
            {onRetry && <button className="btn-primary" onClick={onRetry}>Réessayer</button>}
          </div>
        ) : working.length === 0 && withEvent.length === 0 && !canEdit ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--on-surface-3)', fontSize: 14, fontFamily: 'Manrope, sans-serif' }}>
            Aucun employé ce jour
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

            {/* Employés qui travaillent */}
            {working.map(({ emp, startHour, endHour, events }) => {
              const ev = events[0]
              return (
                <div
                  key={emp.id}
                  onClick={() => openSheet(emp.id)}
                  style={{
                    background: 'var(--surface-low)', borderRadius: 14, padding: '13px 14px',
                    borderLeft: `4px solid ${emp.color}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    cursor: canEdit ? 'pointer' : 'default', WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 38, height: 38, borderRadius: 10, background: emp.color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 800, color: '#fff', flexShrink: 0,
                    }}>{emp.initials}</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--on-surface)', fontFamily: 'Manrope, sans-serif' }}>{emp.name}</div>
                      {ev && (
                        <div style={{ fontSize: 11, color: EVENT_META[ev.type].color, fontWeight: 600, marginTop: 2 }}>
                          {EVENT_META[ev.type].emoji} {EVENT_META[ev.type].label}{eventDetail(ev)}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--on-surface)', fontVariantNumeric: 'tabular-nums', fontFamily: 'Epilogue, sans-serif' }}>
                        {startHour}h – {endHour}h
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 1 }}>
                        {endHour! - startHour!}h de travail
                      </div>
                    </div>
                    {canEdit && <span style={{ color: 'var(--on-surface-3)', fontSize: 16 }}>›</span>}
                  </div>
                </div>
              )
            })}

            {/* Absences / événements */}
            {withEvent.map(({ emp, events }) => {
              const ev = events[0]
              if (!ev) return null
              const meta = EVENT_META[ev.type]
              return (
                <div
                  key={emp.id}
                  onClick={() => openSheet(emp.id)}
                  style={{
                    background: 'var(--surface-low)', borderRadius: 14, padding: '13px 14px',
                    borderLeft: `4px solid ${meta.color}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, opacity: 0.85,
                    cursor: canEdit ? 'pointer' : 'default', WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 38, height: 38, borderRadius: 10, background: emp.color + '22',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 800, color: emp.color, flexShrink: 0,
                    }}>{emp.initials}</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--on-surface-2)', fontFamily: 'Manrope, sans-serif' }}>{emp.name}</div>
                      <div style={{ fontSize: 11, color: meta.color, fontWeight: 600, marginTop: 2 }}>
                        {meta.emoji} {meta.label}{eventDetail(ev)}
                      </div>
                    </div>
                  </div>
                  {canEdit && <span style={{ color: 'var(--on-surface-3)', fontSize: 16, flexShrink: 0 }}>›</span>}
                </div>
              )
            })}
          </div>
        )}

        {/* Repos */}
        {resting.length > 0 && (working.length > 0 || withEvent.length > 0) && (
          canEdit ? (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                En repos — touchez pour planifier
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {resting.map(s => (
                  <button
                    key={s.emp.id}
                    onClick={() => openSheet(s.emp.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      background: 'var(--surface-low)', border: '1px solid var(--border)',
                      borderRadius: 999, padding: '6px 12px', cursor: 'pointer',
                      fontSize: 12, fontWeight: 600, color: 'var(--on-surface-2)',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.emp.color }} />
                    {s.emp.name}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{
              marginTop: 18, padding: '10px 14px', background: 'var(--surface-low)',
              borderRadius: 10, fontSize: 12, color: 'var(--on-surface-3)', lineHeight: 1.5,
              fontFamily: 'Manrope, sans-serif',
            }}>
              En repos : {resting.map(s => s.emp.name).join(', ')}
            </div>
          )
        )}

        {/* Stats du jour */}
        {working.length > 0 && (
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, background: 'rgba(0,66,117,0.08)', borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--primary)', fontFamily: 'Epilogue, sans-serif' }}>{working.length}</div>
              <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 2, fontFamily: 'Manrope, sans-serif' }}>
                employé{working.length > 1 ? 's' : ''}
              </div>
            </div>
            <div style={{ flex: 1, background: 'var(--surface-low)', borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--on-surface)', fontFamily: 'Epilogue, sans-serif' }}>
                {working.reduce((s, w) => s + (w.endHour! - w.startHour!), 0)}h
              </div>
              <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 2, fontFamily: 'Manrope, sans-serif' }}>total heures</div>
            </div>
          </div>
        )}
      </div>

      {/* Barre Enregistrer */}
      {canEdit && dirty && (
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, padding: '12px 14px',
          background: 'var(--surface)', borderTop: '1px solid var(--border)',
          boxShadow: '0 -6px 18px rgba(28,28,24,0.08)',
        }}>
          <button
            onClick={onSave}
            disabled={saving}
            style={{
              width: '100%', background: 'var(--primary)', border: 'none', color: '#fff',
              borderRadius: 12, padding: '13px', fontSize: 15, fontWeight: 700,
              cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1,
              fontFamily: 'Epilogue, sans-serif',
            }}
          >
            {saving ? 'Enregistrement…' : '💾 Enregistrer les modifications'}
          </button>
        </div>
      )}

      {/* Bottom sheet employé */}
      {sheetEmp && (
        <div
          onClick={() => setSheetEmpId(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(28,28,24,0.45)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--surface)', borderTopLeftRadius: 20, borderTopRightRadius: 20,
              width: '100%', padding: '18px 16px 26px', maxHeight: '80vh', overflowY: 'auto',
              boxShadow: '0 -10px 30px rgba(28,28,24,0.2)',
            }}
          >
            {/* Header sheet */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 11, background: sheetEmp.color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 800, color: '#fff', flexShrink: 0,
              }}>{sheetEmp.initials}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--on-surface)', fontFamily: 'Epilogue, sans-serif' }}>{sheetEmp.name}</div>
                <div style={{ fontSize: 12, color: 'var(--on-surface-3)', textTransform: 'capitalize' }}>{dateLabel}</div>
              </div>
              <button onClick={() => setSheetEmpId(null)} style={{ background: 'none', border: 'none', color: 'var(--on-surface-3)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>

            {/* Section horaires */}
            <div style={{ marginBottom: 22 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                Horaires du jour
              </div>
              <div style={{ fontSize: 13, color: 'var(--on-surface-3)', marginBottom: 12 }}>
                Actuel : <strong style={{ color: 'var(--on-surface)' }}>
                  {sheetSchedule?.working ? `${sheetSchedule.startHour}h – ${sheetSchedule.endHour}h` : 'Repos / non planifié'}
                </strong>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <div style={{ flex: 1 }}>
                  <label style={selectLabel}>Début</label>
                  <select value={editStart} onChange={e => { const v = Number(e.target.value); setEditStart(v); if (editEnd <= v) setEditEnd(v + 1) }} style={selectStyle}>
                    {START_OPTIONS.map(h => <option key={h} value={h}>{h}h</option>)}
                  </select>
                </div>
                <span style={{ color: 'var(--on-surface-3)', marginTop: 18 }}>→</span>
                <div style={{ flex: 1 }}>
                  <label style={selectLabel}>Fin</label>
                  <select value={editEnd} onChange={e => setEditEnd(Number(e.target.value))} style={selectStyle}>
                    {END_OPTIONS.filter(h => h > editStart).map(h => <option key={h} value={h}>{h}h</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={applyHours} style={{
                  flex: 1, background: 'var(--primary)', border: 'none', color: '#fff',
                  borderRadius: 10, padding: '11px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}>
                  Appliquer {editStart}h – {Math.max(editEnd, editStart + 1)}h
                </button>
                {sheetSchedule?.working && (
                  <button onClick={clearHours} style={{
                    background: 'transparent', border: '1.5px solid var(--danger)', color: 'var(--danger)',
                    borderRadius: 10, padding: '11px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  }}>
                    Repos
                  </button>
                )}
              </div>
            </div>

            {/* Section événements */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                Absence / événement
              </div>

              {sheetEvents.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                  {sheetEvents.map(ev => {
                    const meta = EVENT_META[ev.type]
                    return (
                      <div key={ev.type} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        background: `${meta.color}12`, border: `1px solid ${meta.color}33`,
                        borderRadius: 10, padding: '9px 12px',
                      }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: meta.color }}>
                          {meta.emoji} {meta.label}{eventDetail(ev)}
                        </span>
                        <button
                          onClick={() => onRemoveDayEvent(selectedISO, sheetEmp.id, ev.type)}
                          style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}
                        >✕</button>
                      </div>
                    )
                  })}
                </div>
              )}

              <button
                onClick={() => { setEventEmpId(sheetEmp.id); setSheetEmpId(null) }}
                style={{
                  width: '100%', background: 'var(--surface-low)', border: '1px solid var(--border)',
                  color: 'var(--on-surface)', borderRadius: 10, padding: '11px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}
              >
                🤒 Ajouter une absence / un événement
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal événement (réutilisé du desktop) */}
      {eventEmp && (
        <EventModal
          emp={eventEmp}
          initialDateISO={selectedISO}
          weekEvents={weekEvents}
          userRole={userRole}
          onConfirm={(startISO, endISO, type, minutes, hours) => {
            onSetEventRange(startISO, endISO, eventEmp.id, type, minutes, hours)
            setEventEmpId(null)
          }}
          onRemove={(startISO, endISO) => {
            onRemoveEventRange(startISO, endISO, eventEmp.id)
            setEventEmpId(null)
          }}
          onReplace={async (startISO, endISO, type, minutes, hours) => {
            await onRemoveEventRange(startISO, endISO, eventEmp.id)
            onSetEventRange(startISO, endISO, eventEmp.id, type, minutes, hours)
            setEventEmpId(null)
          }}
          onClose={() => setEventEmpId(null)}
        />
      )}
    </div>
  )
}

const selectLabel: React.CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--on-surface-3)',
  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5,
}

const selectStyle: React.CSSProperties = {
  width: '100%', background: 'var(--surface-low)', border: '1px solid var(--border)',
  color: 'var(--on-surface)', borderRadius: 10, padding: '10px', fontSize: 15,
  fontWeight: 600, boxSizing: 'border-box', appearance: 'none', WebkitAppearance: 'none',
}
