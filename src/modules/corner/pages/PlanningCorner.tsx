import React from 'react'
import { useAuth } from '../../../auth/useAuth'
import { useEmployees } from '../../planning/hooks/useEmployees'
import { usePlanning } from '../../planning/hooks/usePlanning'
import { prevMonday, nextMonday, weekLabel } from '../../planning/utils/dateUtils'
import type { WeekDraft } from '../../planning/types'

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

function getShift(draft: WeekDraft, dayIndex: number, empId: string): string {
  const day = (draft as any)[dayIndex]
  if (!day?.hours) return '—'
  const worked: number[] = []
  for (let h = 8; h <= 20; h++) {
    if (day.hours[String(h)]?.includes(empId)) worked.push(h)
  }
  if (!worked.length) return '—'
  return `${worked[0]}h–${worked[worked.length - 1] + 1}h`
}

function getDayDate(monday: Date, dayIndex: number): string {
  const d = new Date(monday)
  d.setDate(d.getDate() + dayIndex)
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}

function isToday(monday: Date, dayIndex: number): boolean {
  const d = new Date(monday)
  d.setDate(d.getDate() + dayIndex)
  const now = new Date()
  return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
}

export default function PlanningCorner() {
  const { user } = useAuth()
  const { employees } = useEmployees()
  const planning = usePlanning(user)

  const active = employees.filter(e => e.active !== false)

  return (
    <div className="page">

      {/* Header */}
      <div>
        <p className="section-label" style={{ marginBottom: 2 }}>Corner</p>
        <h1 style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 24, fontWeight: 800, color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0 }}>
          Planning équipe
        </h1>
        <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: '4px 0 0', fontFamily: 'Manrope, sans-serif' }}>
          Lecture seule — mis à jour par les managers
        </p>
      </div>

      {/* Navigation semaine */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={() => planning.goToWeek(prevMonday(planning.monday))}
          style={{
            background: 'var(--surface-low)', border: 'none', borderRadius: 10,
            padding: '8px 16px', color: 'var(--on-surface)', fontSize: 18, cursor: 'pointer',
          }}
        >‹</button>
        <span style={{
          flex: 1, textAlign: 'center', fontSize: 14, fontWeight: 700,
          color: 'var(--on-surface)', fontFamily: 'Epilogue, sans-serif',
          letterSpacing: '-0.01em',
        }}>
          {weekLabel(planning.monday)}
        </span>
        <button
          onClick={() => planning.goToWeek(nextMonday(planning.monday))}
          style={{
            background: 'var(--surface-low)', border: 'none', borderRadius: 10,
            padding: '8px 16px', color: 'var(--on-surface)', fontSize: 18, cursor: 'pointer',
          }}
        >›</button>
        <button
          onClick={() => planning.goToWeek(planning.monday)}
          style={{
            background: 'rgba(0,66,117,0.08)', border: 'none', borderRadius: 8,
            padding: '8px 12px', color: 'var(--primary)', fontSize: 12,
            fontWeight: 700, cursor: 'pointer', fontFamily: 'Manrope, sans-serif',
          }}
        >Aujourd'hui</button>
      </div>

      {/* Table */}
      {planning.loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="skeleton" style={{ height: 44, borderRadius: 10 }} />
          <div className="skeleton" style={{ height: 44, borderRadius: 10 }} />
          <div className="skeleton" style={{ height: 44, borderRadius: 10 }} />
        </div>
      ) : active.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: 13, color: 'var(--on-surface-3)', fontFamily: 'Manrope, sans-serif' }}>
            Aucun employé configuré
          </div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 14 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
            <thead>
              <tr>
                <th style={{
                  padding: '10px 12px', textAlign: 'left', fontFamily: 'Manrope, sans-serif',
                  fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)',
                  background: 'var(--surface-mid)', textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>
                  Employé
                </th>
                {DAYS.map((day, i) => {
                  const today = isToday(planning.monday, i)
                  return (
                    <th key={i} style={{
                      padding: '10px 8px', textAlign: 'center',
                      background: today ? 'rgba(0,66,117,0.10)' : 'var(--surface-mid)',
                      fontFamily: 'Manrope, sans-serif',
                    }}>
                      <div style={{
                        fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                        color: today ? 'var(--primary)' : 'var(--on-surface-3)',
                      }}>{day}</div>
                      <div style={{
                        fontSize: 11, fontWeight: today ? 700 : 400, marginTop: 1,
                        color: today ? 'var(--primary)' : 'var(--on-surface-2)',
                      }}>
                        {getDayDate(planning.monday, i)}
                      </div>
                      {today && (
                        <div style={{
                          width: 4, height: 4, borderRadius: '50%',
                          background: 'var(--primary)', margin: '3px auto 0',
                        }} />
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {active.map((emp, rowIdx) => (
                <tr key={emp.id} style={{
                  background: rowIdx % 2 === 0 ? 'var(--surface)' : 'var(--surface-low)',
                }}>
                  <td style={{ padding: '12px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: 8, background: emp.color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 800, color: '#fff', flexShrink: 0,
                      }}>
                        {emp.initials}
                      </div>
                      <span style={{
                        fontSize: 13, fontWeight: 600, color: 'var(--on-surface)',
                        fontFamily: 'Manrope, sans-serif', whiteSpace: 'nowrap',
                        overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 90,
                      }}>
                        {emp.name}
                      </span>
                    </div>
                  </td>
                  {DAYS.map((_, i) => {
                    const shift = getShift(planning.draft, i, emp.id)
                    const today = isToday(planning.monday, i)
                    const hasShift = shift !== '—'
                    return (
                      <td key={i} style={{
                        padding: '12px 8px', textAlign: 'center',
                        background: today ? 'rgba(0,66,117,0.05)' : 'transparent',
                        fontSize: 12, fontFamily: 'Manrope, sans-serif',
                        color: hasShift
                          ? (today ? 'var(--primary)' : 'var(--on-surface)')
                          : 'var(--on-surface-3)',
                        fontWeight: hasShift ? 700 : 400,
                      }}>
                        {shift}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
