import { useState, useEffect } from 'react'
import type { WeekDraft, Employee, WeekEvents, AbsenceType } from '../../types'
import { DAYS_LABELS } from '../../types'
import { weekLabel } from '../../utils/dateUtils'
import { addDays } from '../../firebase/planning'

interface Props {
  monday: Date
  draft: WeekDraft
  employees: Employee[]
  weekEvents: WeekEvents
  loading: boolean
  onPrevWeek: () => void
  onNextWeek: () => void
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

export function MobilePlanningView({ monday, draft, employees, weekEvents, loading, onPrevWeek, onNextWeek }: Props) {
  const todayISO = toLocalISO(new Date())

  function todayDayIndex() {
    for (let i = 0; i < 7; i++) {
      if (toLocalISO(addDays(monday, i)) === todayISO) return i
    }
    return 0
  }

  const [selectedDay, setSelectedDay] = useState(() => todayDayIndex())

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface)', overflow: 'hidden' }}>

      {/* Week navigator */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px 6px', flexShrink: 0,
        borderBottom: '1px solid var(--border-soft)',
      }}>
        <button
          onClick={onPrevWeek}
          className="btn-secondary"
          style={{ padding: '5px 14px', fontSize: 16, fontWeight: 700 }}
        >‹</button>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--on-surface)', letterSpacing: '-0.01em', fontFamily: 'Epilogue, sans-serif' }}>
          {weekLabel(monday)}
        </span>
        <button
          onClick={onNextWeek}
          className="btn-secondary"
          style={{ padding: '5px 14px', fontSize: 16, fontWeight: 700 }}
        >›</button>
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
                background: isSelected
                  ? 'var(--primary)'
                  : isToday
                    ? 'rgba(0,66,117,0.10)'
                    : 'transparent',
                WebkitTapHighlightColor: 'transparent',
                transition: 'all 0.12s',
              }}
            >
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                color: isSelected ? 'rgba(255,255,255,0.80)' : 'var(--on-surface-3)',
                marginBottom: 2,
              }}>{label}</span>
              <span style={{
                fontSize: 15, fontWeight: 800, lineHeight: 1,
                color: isSelected ? '#fff' : isToday ? 'var(--primary)' : 'var(--on-surface)',
              }}>{d.getDate()}</span>
              <span style={{
                width: 4, height: 4, borderRadius: '50%', marginTop: 4,
                background: hasWork
                  ? (isSelected ? 'rgba(255,255,255,0.7)' : 'var(--primary)')
                  : 'transparent',
              }} />
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px 80px' }}>

        <div style={{
          fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)',
          textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12, marginTop: 16,
          fontFamily: 'Manrope, sans-serif',
        }}>
          {dateLabel}
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="skeleton" style={{ height: 68, borderRadius: 14 }} />
            <div className="skeleton" style={{ height: 68, borderRadius: 14 }} />
            <div className="skeleton" style={{ height: 68, borderRadius: 14 }} />
          </div>
        ) : working.length === 0 && withEvent.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--on-surface-3)', fontSize: 14, fontFamily: 'Manrope, sans-serif' }}>
            Aucun employé ce jour
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

            {/* Employés qui travaillent */}
            {working.map(({ emp, startHour, endHour, events }) => {
              const ev = events[0]
              return (
                <div key={emp.id} style={{
                  background: 'var(--surface-low)', borderRadius: 14, padding: '13px 14px',
                  borderLeft: `4px solid ${emp.color}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 38, height: 38, borderRadius: 10, background: emp.color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 800, color: '#fff', flexShrink: 0,
                    }}>
                      {emp.initials}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--on-surface)', fontFamily: 'Manrope, sans-serif' }}>{emp.name}</div>
                      {ev && (
                        <div style={{ fontSize: 11, color: EVENT_META[ev.type].color, fontWeight: 600, marginTop: 2 }}>
                          {EVENT_META[ev.type].emoji} {EVENT_META[ev.type].label}
                          {ev.minutes ? ` · ${ev.minutes} min` : ''}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--on-surface)', fontVariantNumeric: 'tabular-nums', fontFamily: 'Epilogue, sans-serif' }}>
                      {startHour}h – {endHour}h
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 1 }}>
                      {endHour! - startHour!}h de travail
                    </div>
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
                <div key={emp.id} style={{
                  background: 'var(--surface-low)', borderRadius: 14, padding: '13px 14px',
                  borderLeft: `4px solid ${meta.color}`,
                  display: 'flex', alignItems: 'center', gap: 12, opacity: 0.8,
                }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: 10, background: emp.color + '22',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 800, color: emp.color, flexShrink: 0,
                  }}>
                    {emp.initials}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--on-surface-2)', fontFamily: 'Manrope, sans-serif' }}>{emp.name}</div>
                    <div style={{ fontSize: 11, color: meta.color, fontWeight: 600, marginTop: 2 }}>
                      {meta.emoji} {meta.label}
                      {ev.minutes ? ` · ${ev.minutes} min` : ''}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Repos */}
        {resting.length > 0 && working.length > 0 && (
          <div style={{
            marginTop: 18, padding: '10px 14px', background: 'var(--surface-low)',
            borderRadius: 10, fontSize: 12, color: 'var(--on-surface-3)', lineHeight: 1.5,
            fontFamily: 'Manrope, sans-serif',
          }}>
            En repos : {resting.map(s => s.emp.name).join(', ')}
          </div>
        )}

        {/* Stats du jour */}
        {working.length > 0 && (
          <div style={{
            marginTop: 14, display: 'flex', gap: 8,
          }}>
            <div style={{
              flex: 1, background: 'rgba(0,66,117,0.08)', borderRadius: 10,
              padding: '10px 12px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--primary)', fontFamily: 'Epilogue, sans-serif' }}>{working.length}</div>
              <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 2, fontFamily: 'Manrope, sans-serif' }}>
                employé{working.length > 1 ? 's' : ''}
              </div>
            </div>
            <div style={{
              flex: 1, background: 'var(--surface-low)', borderRadius: 10,
              padding: '10px 12px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--on-surface)', fontFamily: 'Epilogue, sans-serif' }}>
                {working.reduce((s, w) => s + (w.endHour! - w.startHour!), 0)}h
              </div>
              <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 2, fontFamily: 'Manrope, sans-serif' }}>total heures</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
