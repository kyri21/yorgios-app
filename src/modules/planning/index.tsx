import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../../auth/useAuth'
import { useEmployees } from './hooks/useEmployees'
import { usePlanning } from './hooks/usePlanning'
import { PlanningGrid } from './components/Grid/PlanningGrid'
import { EmployeeManager } from './components/Employees/EmployeeManager'
import { MonthlyView } from './components/Monthly/MonthlyView'
import { EventModal } from './components/Events/EventModal'
import { ImportModal } from './components/Import/ImportModal'
import { canEdit } from './types'
import type { Employee, AbsenceType } from './types'
import { weekId } from './firebase/planning'
import { prevMonday, nextMonday, weekLabel, prevMonth, nextMonth, monthLabel } from './utils/dateUtils'
import { mondayOf, duplicateWeek } from './firebase/planning'
import { exportCSV, exportICS } from './utils/exports'
import { signOut } from './firebase/auth'
import { MobilePlanningView } from './components/Mobile/MobilePlanningView'

// ─── Carte employé ─────────────────────────────────────────────────────────
interface EmpCardProps {
  emp: Employee
  worked: number
  selected: boolean
  onSelect: () => void
}

function EmpCard({ emp, worked, selected, onSelect }: EmpCardProps) {
  const pct  = emp.weeklyCapHours > 0 ? worked / emp.weeklyCapHours : 0
  const dot  = pct < 0.9 ? 'var(--success)' : pct <= 1 ? 'var(--warning)' : 'var(--danger)'
  const bgCol = selected ? emp.color + 'cc' : 'var(--surface-low)'
  const border = `2px solid ${selected ? emp.color : emp.color + '44'}`

  return (
    <div
      onClick={onSelect}
      style={{
        flex: 1,
        background: bgCol,
        border,
        borderRadius: '10px',
        padding: '8px 6px',
        cursor: 'pointer',
        textAlign: 'center',
        transition: 'all 0.12s',
        boxShadow: selected ? `0 4px 16px ${emp.color}44` : 'none',
        minWidth: 0,
      }}
    >
      <div style={{
        width: '30px', height: '30px', borderRadius: '8px',
        background: selected ? 'rgba(255,255,255,0.25)' : emp.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 3px',
        fontSize: '12px', fontWeight: 800, color: '#fff',
      }}>
        {emp.initials}
      </div>
      <div style={{ fontSize: '11px', fontWeight: 600, color: selected ? '#fff' : 'var(--on-surface)', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'Manrope, sans-serif' }}>
        {emp.name}
      </div>
      <div style={{ marginTop: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px' }}>
        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: dot, flexShrink: 0 }} />
        <span style={{ fontSize: '10px', color: selected ? 'rgba(255,255,255,0.85)' : 'var(--on-surface-3)', fontVariantNumeric: 'tabular-nums' }}>
          {worked}h / {emp.weeklyCapHours}h
        </span>
      </div>
      <div style={{ marginTop: '3px', height: '3px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${Math.min(100, pct * 100)}%`,
          background: dot,
          borderRadius: '2px',
          transition: 'width 0.2s',
        }} />
      </div>
    </div>
  )
}

// ─── Module principal ────────────────────────────────────────────────────────
export default function PlanningModule() {
  const { user, loading: authLoading } = useAuth()
  const { employees, byId } = useEmployees()
  const planning = usePlanning(user)

  const [selectedEmpId, setSelectedEmpId]   = useState<string | null>(null)
  const [showEmpManager, setShowEmpManager] = useState(false)
  const [showExports, setShowExports]       = useState(false)
  const [view, setView]                     = useState<'week' | 'month'>('week')
  const [eventModalDate, setEventModalDate] = useState<string | null>(null)
  const [showImport, setShowImport]         = useState(false)
  const [showHistory, setShowHistory]       = useState(false)
  const [currentMonth, setCurrentMonth]     = useState<Date>(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })

  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const [showDuplicate, setShowDuplicate]   = useState(false)
  const [duplicateTarget, setDuplicateTarget] = useState('')
  const [duplicating, setDuplicating]       = useState(false)
  const [duplicateMsg, setDuplicateMsg]     = useState('')

  useEffect(() => {
    if (user) planning.goToWeek(planning.monday)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  useEffect(() => {
    if (selectedEmpId && !byId[selectedEmpId]) setSelectedEmpId(null)
  }, [byId, selectedEmpId])

  const handleSelectEmp = useCallback((empId: string) => {
    setSelectedEmpId(prev => prev === empId ? null : empId)
  }, [])

  async function handleDuplicate() {
    if (!duplicateTarget || !user) return
    setDuplicating(true)
    setDuplicateMsg('')
    try {
      const dst = mondayOf(new Date(duplicateTarget + 'T12:00:00'))
      await duplicateWeek(planning.monday, dst, user.uid)
      setDuplicateMsg('Semaine copiée !')
      setTimeout(() => { setShowDuplicate(false); setDuplicateMsg('') }, 1500)
    } catch {
      setDuplicateMsg('Erreur lors de la copie.')
    } finally {
      setDuplicating(false)
    }
  }

  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" />
      </div>
    )
  }

  if (!user) return null

  const isEditor = canEdit(user.role)

  return (
    <div style={{
      background: 'var(--surface)',
      color: 'var(--on-surface)',
      height: 'calc(100dvh - var(--safe-top))',
      display: 'flex',
      flexDirection: 'column',
      padding: '10px',
      boxSizing: 'border-box',
      gap: '8px',
      fontFamily: 'Manrope, system-ui, sans-serif',
      overflow: 'hidden',
    }}>

      {/* ── En-tête ────────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', rowGap: '4px' }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--on-surface-2)', whiteSpace: 'nowrap', fontFamily: 'Epilogue, sans-serif' }}>
          Planning
        </span>

        <div style={{ display: 'flex', background: 'var(--surface-low)', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
          <button
            onClick={() => setView('week')}
            style={{ ...btnStyle, border: 'none', borderRadius: 0, background: view === 'week' ? 'var(--primary)' : 'transparent', color: view === 'week' ? '#fff' : 'var(--on-surface-2)' }}
          >
            Semaine
          </button>
          <button
            onClick={() => setView('month')}
            style={{ ...btnStyle, border: 'none', borderRadius: 0, background: view === 'month' ? 'var(--primary)' : 'transparent', color: view === 'month' ? '#fff' : 'var(--on-surface-2)' }}
          >
            Mois
          </button>
        </div>

        {view === 'week' && (
          <>
            <button onClick={() => planning.goToWeek(prevMonday(planning.monday))} style={btnStyle}>◀</button>
            <span style={{ fontSize: '12px', color: 'var(--on-surface)', fontWeight: 600, whiteSpace: 'nowrap', fontFamily: 'Manrope, sans-serif' }}>
              {weekLabel(planning.monday)}
            </span>
            <button onClick={() => planning.goToWeek(nextMonday(planning.monday))} style={btnStyle}>▶</button>
            <input type="date" className="input" style={{ padding: '3px 6px', cursor: 'text', fontSize: '12px' }}
              onChange={e => e.target.value && planning.goToWeek(mondayOf(new Date(e.target.value + 'T12:00:00')))} />
          </>
        )}

        {view === 'month' && (
          <>
            <button onClick={() => setCurrentMonth(prevMonth(currentMonth))} style={btnStyle}>◀</button>
            <span style={{ fontSize: '12px', color: 'var(--on-surface)', fontWeight: 600, whiteSpace: 'nowrap', fontFamily: 'Manrope, sans-serif' }}>
              {monthLabel(currentMonth)}
            </span>
            <button onClick={() => setCurrentMonth(nextMonth(currentMonth))} style={btnStyle}>▶</button>
          </>
        )}

        <div style={{ flex: 1 }} />

        {view === 'week' && selectedEmpId && (
          <span style={{ fontSize: '11px', color: 'var(--warning)', whiteSpace: 'nowrap' }}>
            ✏️ {byId[selectedEmpId]?.name}
          </span>
        )}

        {isEditor && view === 'week' && (
          <button
            onClick={planning.save}
            disabled={planning.saving || !planning.dirty}
            style={{
              background: planning.dirty ? 'var(--primary)' : 'var(--surface-low)',
              border: `1px solid ${planning.dirty ? 'var(--primary)' : 'var(--border)'}`,
              color: planning.dirty ? '#fff' : 'var(--on-surface-3)',
              borderRadius: '8px', padding: '5px 12px',
              cursor: planning.dirty ? 'pointer' : 'not-allowed',
              fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap',
              transition: 'all 0.15s',
            }}
          >
            {planning.saving ? '⏳ Sauvegarde…' : planning.dirty ? '💾 Sauvegarder ●' : '✅ Sauvegardé'}
          </button>
        )}

        {isEditor && view === 'week' && (
          <>
            <div style={{ position: 'relative' }}>
              <button onClick={() => { setShowDuplicate(v => !v); setDuplicateMsg('') }} style={btnStyle} title="Dupliquer la semaine">
                ⧉
              </button>
              {showDuplicate && (
                <div style={{
                  position: 'absolute', top: '110%', right: 0, zIndex: 100,
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: '12px', padding: '12px', minWidth: '220px',
                  boxShadow: 'var(--shadow-float)',
                }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--on-surface-2)', marginBottom: '8px', fontFamily: 'Manrope, sans-serif' }}>
                    Copier vers la semaine du…
                  </div>
                  <input
                    type="date"
                    value={duplicateTarget}
                    onChange={e => setDuplicateTarget(e.target.value)}
                    className="input"
                    style={{ width: '100%', marginBottom: '8px', boxSizing: 'border-box' }}
                  />
                  {duplicateMsg && (
                    <div style={{ fontSize: '11px', color: duplicateMsg.startsWith('Erreur') ? 'var(--danger)' : 'var(--success)', marginBottom: '6px' }}>
                      {duplicateMsg}
                    </div>
                  )}
                  <button
                    onClick={handleDuplicate}
                    disabled={duplicating || !duplicateTarget}
                    className="btn-primary"
                    style={{ width: '100%', fontSize: '12px', opacity: duplicating || !duplicateTarget ? 0.6 : 1 }}
                  >
                    {duplicating ? '⏳ Copie…' : 'Confirmer'}
                  </button>
                </div>
              )}
            </div>
            <button onClick={() => setShowEmpManager(true)} style={btnStyle}>👥</button>
            <button
              onClick={async () => {
                if (!confirm(`Supprimer tout le planning de la semaine ?\n${weekLabel(planning.monday)}\n\nCette action est irréversible.`)) return
                await planning.clearCurrentWeek()
              }}
              style={{ ...btnStyle, color: 'var(--danger)', border: '1px solid rgba(192,57,43,0.3)' }}
              title="Vider la semaine"
            >🗑</button>
          </>
        )}

        {isEditor && planning.history.length > 0 && (
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowHistory(v => !v)} style={{ ...btnStyle, color: 'var(--warning)' }} title="Historique des sauvegardes">↩</button>
            {showHistory && (
              <div style={{ position: 'absolute', top: '110%', right: 0, zIndex: 200, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '8px', minWidth: '260px', boxShadow: 'var(--shadow-float)' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--on-surface-2)', padding: '2px 6px 8px', fontFamily: 'Manrope, sans-serif' }}>Historique des sauvegardes</div>
                {planning.history.map((entry, i) => (
                  <button key={entry.id} onClick={() => { planning.undoTo(entry); setShowHistory(false) }} style={{ display: 'block', width: '100%', background: i === 0 ? 'rgba(0,66,117,0.06)' : 'none', border: 'none', borderRadius: '6px', padding: '6px 8px', cursor: 'pointer', textAlign: 'left' }}>
                    <div style={{ color: 'var(--on-surface)', fontSize: '11px', fontWeight: 600 }}>{entry.label}</div>
                    <div style={{ color: 'var(--on-surface-3)', fontSize: '10px' }}>Sem. {entry.monday.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {isEditor && (
          <button onClick={() => setShowImport(true)} style={btnStyle} title="Importer un planning (CSV/ICS)">📥</button>
        )}
        <button onClick={() => setShowExports(v => !v)} style={btnStyle}>📤</button>
        <button onClick={signOut} style={{ ...btnStyle, color: 'var(--danger)' }}>⏏</button>
      </div>

      {/* ── Cartes employés (vue semaine, desktop uniquement) ──────── */}
      {view === 'week' && !isMobile && (
        <div style={{ flexShrink: 0, display: 'flex', gap: '8px', alignItems: 'stretch' }}>
          {employees.map(emp => (
            <EmpCard
              key={emp.id}
              emp={emp}
              worked={planning.weeklyHours(emp.id)}
              selected={selectedEmpId === emp.id}
              onSelect={() => handleSelectEmp(emp.id)}
            />
          ))}
          {employees.length === 0 && (
            <div style={{ color: 'var(--on-surface-3)', fontSize: '12px', padding: '12px', fontFamily: 'Manrope, sans-serif' }}>
              Aucun employé — cliquez 👥 pour en ajouter
            </div>
          )}
        </div>
      )}

      {/* ── Vue principale ─────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, background: 'var(--surface-low)', borderRadius: '12px', padding: isMobile ? '0' : '8px', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid var(--border-soft)' }}>
        {view === 'week' ? (
          isMobile ? (
            <MobilePlanningView
              monday={planning.monday}
              draft={planning.draft}
              employees={employees}
              weekEvents={planning.weekEvents}
              loading={planning.loading}
              onPrevWeek={() => planning.goToWeek(prevMonday(planning.monday))}
              onNextWeek={() => planning.goToWeek(nextMonday(planning.monday))}
            />
          ) : planning.loading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--on-surface-3)', fontSize: '13px' }}>
              <div className="spinner" />
            </div>
          ) : (
            <PlanningGrid
              monday={planning.monday}
              draft={planning.draft}
              byId={byId}
              selectedEmpId={selectedEmpId}
              canEdit={isEditor}
              onPaintCell={planning.paintCell}
              weekEvents={planning.weekEvents}
              onCellContextMenu={dateISO => setEventModalDate(dateISO)}
            />
          )
        ) : (
          <MonthlyView month={currentMonth} employees={employees} canEdit={isEditor} uid={user?.uid ?? ''} />
        )}
      </div>

      {/* ── Panneau exports ─────────────────────────────────────────── */}
      {showExports && (
        <div style={{
          position: 'fixed', bottom: '60px', right: '10px',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: '14px', padding: '14px', zIndex: 100,
          display: 'flex', flexDirection: 'column', gap: '6px',
          minWidth: '180px', boxShadow: 'var(--shadow-float)',
        }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--on-surface-2)', marginBottom: '4px', fontFamily: 'Epilogue, sans-serif' }}>
            Exports
            <button onClick={() => setShowExports(false)} style={{ float: 'right', background: 'none', border: 'none', color: 'var(--on-surface-3)', cursor: 'pointer' }}>✕</button>
          </div>
          <button onClick={() => exportCSV(planning.monday, planning.draft, employees)} style={exportBtnStyle}>
            🧾 CSV semaine
          </button>
          <div style={{ fontSize: '10px', color: 'var(--on-surface-3)', marginTop: '4px', fontFamily: 'Manrope, sans-serif' }}>ICS par employé :</div>
          {employees.map(emp => (
            <button key={emp.id} onClick={() => exportICS(planning.monday, planning.draft, emp)} style={exportBtnStyle}>
              📅 {emp.name}
            </button>
          ))}
        </div>
      )}

      {/* ── Modal employés ──────────────────────────────────────────── */}
      {showEmpManager && (
        <EmployeeManager onClose={() => setShowEmpManager(false)} />
      )}

      {/* ── Modal import CSV/ICS ────────────────────────────────────── */}
      {showImport && user && (
        <ImportModal
          employees={employees}
          currentWeekId={weekId(planning.monday)}
          uid={user.uid}
          onImported={affectedWeekIds => {
            if (affectedWeekIds.includes(weekId(planning.monday))) {
              planning.goToWeek(planning.monday)
            }
            setShowImport(false)
          }}
          onClose={() => setShowImport(false)}
        />
      )}

      {/* ── Modal événement ─────────────────────────────────────────── */}
      {eventModalDate && selectedEmpId && byId[selectedEmpId] && (
        <EventModal
          emp={byId[selectedEmpId]}
          initialDateISO={eventModalDate}
          weekEvents={planning.weekEvents}
          onConfirm={(startISO, endISO, type, minutes) => {
            planning.setEventRange(startISO, endISO, selectedEmpId, type, minutes)
            setEventModalDate(null)
          }}
          onRemove={(startISO, endISO) => {
            planning.removeEventRange(startISO, endISO, selectedEmpId)
            setEventModalDate(null)
          }}
          onClose={() => setEventModalDate(null)}
        />
      )}
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  background: 'var(--surface-low)', border: '1px solid var(--border)',
  color: 'var(--on-surface-2)', borderRadius: '6px', padding: '4px 8px',
  cursor: 'pointer', fontSize: '12px',
}
const exportBtnStyle: React.CSSProperties = {
  background: 'var(--surface-low)', border: '1px solid var(--border)',
  color: 'var(--on-surface)', borderRadius: '8px', padding: '6px 10px',
  cursor: 'pointer', fontSize: '11px', textAlign: 'left',
  fontFamily: 'Manrope, sans-serif',
}
