import { useEffect, useMemo, useState } from 'react'
import { Timestamp, addDoc, collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { db, auth } from '../../../firebase/config'
import { useToast } from '../../../hooks/useToast'
import { useAuth } from '../../../auth/useAuth'
import { usePermissions } from '../../../contexts/PermissionsContext'
import ActionCorrectiveModal, { type AcPayload } from '../../../components/ActionCorrectiveModal'

const ALERT_MAX = 4

const FRIDGES = [
  { id: 'FRIGO_3P',    name: 'Frigo 3P',     icon: '🧊' },
  { id: 'VITRINE_1',   name: 'Vitrine 1',     icon: '🍱' },
  { id: 'VITRINE_2',   name: 'Vitrine 2',     icon: '🍱' },
  { id: 'VITRINE_3',   name: 'Vitrine 3',     icon: '🍱' },
  { id: 'GRAND_FRIGO', name: 'Grand frigo',   icon: '❄️' },
]

const SESSIONS = ['matin', 'soir'] as const
type Session = typeof SESSIONS[number]
const DAY_SHORT = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

function pad(n: number) { return String(n).padStart(2, '0') }

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function computeStatus(t: number, min = -3): 'OK' | 'ALERTE' {
  return Number.isFinite(t) && t >= min && t <= ALERT_MAX ? 'OK' : 'ALERTE'
}

function docId(date: string, fridgeId: string, session: Session) {
  return `${date}_${fridgeId}_${session}`
}

function getWeekDates(offset: number): string[] {
  const now = new Date()
  const dow = now.getDay() === 0 ? 6 : now.getDay() - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - dow + offset * 7)
  monday.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })
}

function formatWeekLabel(dates: string[]): string {
  const fmt = (d: string) => {
    const [, m, day] = d.split('-')
    return `${parseInt(day)} ${['jan','fév','mar','avr','mai','juin','jul','aoû','sep','oct','nov','déc'][parseInt(m)-1]}`
  }
  return `${fmt(dates[0])} → ${fmt(dates[6])}`
}

type SlotState = { temp: string; savedTemp?: number; status?: 'OK' | 'ALERTE' }
type RowState  = Record<Session, SlotState>
type CellData  = { tempC: number | null; status: 'OK' | 'ALERTE' | null }
type WeekData  = Record<string, Record<string, Record<Session, CellData>>>

type AcItem = { id: string; problem: string; action: string; fridgeId?: string; session?: string; createdByName?: string; createdAt?: any }

export default function Temperatures() {
  const { show } = useToast()
  const { user } = useAuth()
  const [tab, setTab]           = useState<'saisie' | 'semaine' | 'actions'>('saisie')
  const [acModal, setAcModal]   = useState<AcPayload | null>(null)
  const [documented, setDocumented] = useState<Set<string>>(new Set())
  const [acList, setAcList]     = useState<AcItem[]>([])
  const [acLoading, setAcLoading] = useState(false)
  const [editAc, setEditAc]     = useState<AcItem | null>(null)
  const isManager = ['patron', 'administrateur', 'manager'].includes(user?.role ?? '')
  const { can } = usePermissions()
  const canDeleteAc = can(user?.role, 'action_delete_ac')
  const [alertMin, setAlertMin] = useState(-3)

  const [date, setDate]         = useState(todayISO())
  const [rows, setRows]         = useState<Record<string, RowState>>({})
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [savedOk, setSavedOk]   = useState(false)

  const [weekOffset, setWeekOffset] = useState(0)
  const [weekDates, setWeekDates]   = useState<string[]>(() => getWeekDates(0))
  const [weekData, setWeekData]     = useState<WeekData>({})
  const [weekLoading, setWeekLoading] = useState(false)

  const anyAlert = useMemo(() =>
    FRIDGES.some(f => SESSIONS.some(s => rows[f.id]?.[s]?.status === 'ALERTE')), [rows])

  function emptyRows(): Record<string, RowState> {
    const r: Record<string, RowState> = {}
    for (const f of FRIDGES) r[f.id] = { matin: { temp: '' }, soir: { temp: '' } }
    return r
  }

  async function loadForDate(d: string) {
    const next = emptyRows()
    for (const f of FRIDGES) {
      for (const s of SESSIONS) {
        const snap = await getDoc(doc(db, 'temperatures', docId(d, f.id, s)))
        if (snap.exists()) {
          const t = Number((snap.data() as any).tempC)
          next[f.id][s] = {
            temp: Number.isFinite(t) ? String(t) : '',
            savedTemp: Number.isFinite(t) ? t : undefined,
            status: Number.isFinite(t) ? computeStatus(t, alertMin) : undefined,
          }
        }
      }
    }
    setRows(next)
  }

  async function loadAcForDate(d: string) {
    setAcLoading(true)
    try {
      const snap = await getDocs(query(
        collection(db, 'actions_correctives'),
        where('type', '==', 'temperature_frigo'),
        where('date', '==', d),
      ))
      const items = snap.docs.map(s => ({ id: s.id, ...(s.data() as any) })) as AcItem[]
      setAcList(items)
      const keys = new Set(items.map(i => `${i.fridgeId}_${i.session}`).filter(Boolean))
      setDocumented(keys)
    } finally { setAcLoading(false) }
  }

  useEffect(() => {
    getDoc(doc(db, 'settings', 'temperatures'))
      .then(snap => { if (snap.exists()) { const v = (snap.data() as any).alertMinC; if (typeof v === 'number') setAlertMin(v) } })
      .catch(() => {})
    loadForDate(date).catch(e => setError(e?.message))
    loadAcForDate(date)
  }, [])

  function setTemp(fridgeId: string, session: Session, value: string) {
    setSavedOk(false)
    setRows(p => ({ ...p, [fridgeId]: { ...p[fridgeId], [session]: { ...p[fridgeId]?.[session], temp: value } } }))
  }

  async function saveAll() {
    setError(null); setSaving(true); setSavedOk(false)
    const uid = auth.currentUser?.uid || ''
    try {
      for (const f of FRIDGES) {
        for (const s of SESSIONS) {
          const raw = rows[f.id]?.[s]?.temp ?? ''
          if (!raw) continue
          const t = Number(String(raw).replace(',', '.'))
          if (!Number.isFinite(t)) { setError(`Valeur invalide : ${f.name} ${s}`); setSaving(false); return }
          const st = computeStatus(t, alertMin)
          await setDoc(doc(db, 'temperatures', docId(date, f.id, s)), {
            date, fridgeId: f.id, fridgeName: f.name, session: s, tempC: t, status: st,
            createdAt: Timestamp.now(), createdBy: uid, alertMin, alertMax: ALERT_MAX,
          })
          setRows(p => ({ ...p, [f.id]: { ...p[f.id], [s]: { temp: String(t), savedTemp: t, status: st } } }))
        }
      }
      setSavedOk(true)
      show('Températures enregistrées')
    } catch (e: any) { setError(e?.message) }
    finally { setSaving(false) }
  }

  async function loadWeek(dates: string[]) {
    setWeekLoading(true)
    try {
      const snap = await getDocs(
        query(collection(db, 'temperatures'),
          where('date', '>=', dates[0]),
          where('date', '<=', dates[6]))
      )
      const data: WeekData = {}
      for (const d of dates) {
        data[d] = {}
        for (const f of FRIDGES) data[d][f.id] = { matin: { tempC: null, status: null }, soir: { tempC: null, status: null } }
      }
      for (const docSnap of snap.docs) {
        const { date: d, fridgeId, session, tempC, status } = docSnap.data() as any
        if (data[d]?.[fridgeId]?.[session as Session] !== undefined) {
          data[d][fridgeId][session as Session] = {
            tempC: Number.isFinite(Number(tempC)) ? Number(tempC) : null,
            status: status ?? null,
          }
        }
      }
      setWeekData(data)
    } finally { setWeekLoading(false) }
  }

  useEffect(() => {
    if (tab === 'semaine') loadWeek(weekDates)
  }, [tab, weekDates])

  function changeWeek(delta: number) {
    const newOffset = weekOffset + delta
    const newDates = getWeekDates(newOffset)
    setWeekOffset(newOffset)
    setWeekDates(newDates)
  }

  // ── Heatmap cell (light mode) ────────────────────────────────────
  function cellBg(cell: CellData): string {
    if (cell.tempC === null) return 'var(--surface-mid)'
    return cell.status === 'ALERTE' ? 'rgba(136,0,20,0.12)' : 'rgba(84,101,30,0.12)'
  }
  function cellColor(cell: CellData): string {
    if (cell.tempC === null) return 'var(--on-surface-3)'
    return cell.status === 'ALERTE' ? 'var(--danger)' : 'var(--success)'
  }

  return (
    <div className="page">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div>
        <p className="section-label" style={{ marginBottom: 2 }}>Relevé journalier</p>
        <h1 style={{
          fontFamily: 'Epilogue, sans-serif',
          fontSize: 24, fontWeight: 800,
          color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0,
        }}>
          Températures
        </h1>
        <p style={{ fontSize: 13, color: 'var(--on-surface-2)', marginTop: 4 }}>
          Seuil acceptable : {alertMin}°C — {ALERT_MAX}°C
        </p>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 4, padding: 4,
        background: 'var(--surface-mid)', borderRadius: 14,
      }}>
        {(['saisie', 'semaine', 'actions'] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); if (t === 'actions') loadAcForDate(date) }} style={{
            flex: 1, padding: '9px 0', borderRadius: 10, border: 'none',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
            fontFamily: 'Manrope, sans-serif',
            background: tab === t ? 'var(--surface)' : 'transparent',
            color: tab === t ? 'var(--primary)' : 'var(--on-surface-3)',
            boxShadow: tab === t ? '0 1px 6px rgba(28,28,24,0.08)' : 'none',
            transition: 'all 0.15s',
          }}>
            {t === 'saisie' ? '✏️ Saisie' : t === 'semaine' ? '📊 Semaine' : '📋 Actions'}
          </button>
        ))}
      </div>

      {/* ── ONGLET SAISIE ─────────────────────────────────────── */}
      {tab === 'saisie' && (
        <>
          {/* Date + alerte */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="date"
              value={date}
              onChange={e => {
                setDate(e.target.value); setSavedOk(false)
                loadForDate(e.target.value).catch(ex => setError(ex?.message))
              }}
              className="input-filled"
              style={{ flex: 1 }}
            />
            {anyAlert && <span className="chip-danger">Alerte !</span>}
          </div>

          {error && (
            <div style={{
              padding: '10px 14px',
              background: 'rgba(136,0,20,0.06)',
              color: 'var(--danger)',
              borderRadius: 10, fontSize: 13, fontWeight: 600,
            }}>
              {error}
            </div>
          )}

          {/* Cartes par frigo — style Aegean Precision */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {FRIDGES.map(f => {
              const row = rows[f.id] || { matin: { temp: '' }, soir: { temp: '' } }
              const hasAlert = SESSIONS.some(s => row[s]?.status === 'ALERTE')
              const isActive = SESSIONS.some(s => row[s]?.temp !== '')

              return (
                <div
                  key={f.id}
                  className="card"
                  style={{
                    background: hasAlert ? 'rgba(136,0,20,0.04)' : 'var(--surface-low)',
                    outline: isActive && !hasAlert ? '2px solid rgba(0,66,117,0.15)' : hasAlert ? '2px solid rgba(136,0,20,0.25)' : 'none',
                    outlineOffset: '-2px',
                    cursor: 'default',
                    padding: '14px 16px',
                  }}
                >
                  {/* Fridge header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 20 }}>{f.icon}</span>
                      <div>
                        <h3 style={{
                          fontFamily: 'Epilogue, sans-serif',
                          fontSize: 16, fontWeight: 700,
                          color: hasAlert ? 'var(--danger)' : 'var(--on-surface)',
                          margin: 0, letterSpacing: '-0.01em',
                        }}>
                          {f.name}
                        </h3>
                        <p style={{ fontSize: 10, color: 'var(--on-surface-3)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          {f.id.replace('_', ' ')}
                        </p>
                      </div>
                    </div>
                    {hasAlert && <span className="chip-danger">Hors seuil</span>}
                    {!hasAlert && row.matin.savedTemp != null && <span className="chip-ok">Conforme</span>}
                  </div>

                  {/* Matin + Soir côte à côte */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {SESSIONS.map(s => {
                      const slot = row[s] || { temp: '' }
                      const live = Number(String(slot.temp).replace(',', '.'))
                      const liveStatus = Number.isFinite(live) && slot.temp !== '' ? computeStatus(live, alertMin) : undefined
                      const status = slot.status ?? liveStatus
                      const inputBorder = status === 'ALERTE' ? 'var(--danger)' : status === 'OK' ? 'var(--success)' : 'var(--border)'

                      return (
                        <div key={s} style={{
                          background: 'var(--surface)',
                          borderRadius: 12,
                          padding: '10px 12px',
                          minWidth: 0,
                        }}>
                          <p style={{
                            fontSize: 10, fontWeight: 700, color: 'var(--on-surface-3)',
                            textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 6px',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {s === 'matin' ? '☀ Matin (08:00)' : '🌙 Soir (20:00)'}
                          </p>

                          {/* Grand affichage si valeur enregistrée */}
                          {slot.savedTemp != null ? (
                            <div style={{ marginBottom: 6 }}>
                              <span className="temp-display" style={{
                                color: status === 'ALERTE' ? 'var(--danger)' : status === 'OK' ? 'var(--success)' : 'var(--on-surface)',
                              }}>
                                {slot.savedTemp}
                              </span>
                              <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--on-surface-2)' }}>°C</span>
                            </div>
                          ) : (
                            <div style={{ marginBottom: 6, height: 56, display: 'flex', alignItems: 'center' }}>
                              <span style={{ fontSize: 28, color: 'var(--on-surface-3)', fontFamily: 'Epilogue, sans-serif', fontWeight: 700 }}>—</span>
                            </div>
                          )}

                          <div style={{ display: 'flex', gap: 4, alignItems: 'stretch', minWidth: 0 }}>
                            <button
                              type="button"
                              onClick={() => {
                                const current = rows[f.id][s].temp
                                const toggled = current.startsWith('-') ? current.slice(1) : current ? '-' + current : '-'
                                setTemp(f.id, s, toggled)
                              }}
                              style={{
                                width: 32, height: 40, borderRadius: '8px 8px 0 0',
                                border: 'none',
                                borderBottom: `2px solid ${inputBorder}`,
                                background: 'var(--surface-mid)',
                                fontSize: 15, fontWeight: 700,
                                color: 'var(--on-surface-2)',
                                cursor: 'pointer', flexShrink: 0,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                lineHeight: 1,
                                transition: 'border-color 0.15s',
                              }}
                            >±</button>
                            <input
                              value={slot.temp}
                              onChange={e => setTemp(f.id, s, e.target.value)}
                              placeholder="°C"
                              inputMode="decimal"
                              style={{
                                flex: 1, minWidth: 0, height: 40, textAlign: 'center',
                                background: 'var(--surface-low)',
                                border: 'none',
                                borderBottom: `2px solid ${inputBorder}`,
                                borderRadius: '8px 8px 0 0',
                                color: 'var(--on-surface)',
                                fontSize: 16, fontWeight: 700,
                                outline: 'none',
                                fontFamily: 'Epilogue, sans-serif',
                                transition: 'border-color 0.15s',
                              }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          <button onClick={saveAll} disabled={saving} className="btn-primary">
            {saving ? 'Enregistrement…' : 'Enregistrer tous les relevés'}
          </button>

          {savedOk && (
            <p style={{ textAlign: 'center', color: 'var(--success)', fontSize: 13, fontWeight: 700, margin: 0 }}>
              ✓ Relevés enregistrés avec succès
            </p>
          )}

          {/* Actions correctives requises après sauvegarde */}
          {savedOk && anyAlert && (() => {
            const alerts = FRIDGES.flatMap(f =>
              SESSIONS.filter(s => rows[f.id]?.[s]?.status === 'ALERTE').map(s => ({ f, s, tempC: rows[f.id][s].savedTemp ?? 0 }))
            )
            return alerts.length === 0 ? null : (
              <div style={{
                padding: '14px 16px', borderRadius: 12,
                background: 'rgba(192,57,43,0.06)', border: '1px solid rgba(192,57,43,0.2)',
              }}>
                <p style={{ fontWeight: 700, color: 'var(--danger)', fontSize: 13, margin: '0 0 10px', fontFamily: 'Epilogue, sans-serif' }}>
                  ⚠️ Actions correctives à documenter
                </p>
                {alerts.map(({ f, s, tempC }) => {
                  const key = `${f.id}_${s}`
                  const done = documented.has(key)
                  const problem = `Température hors norme — ${f.name} (${s}) : ${tempC}°C (seuil : ${alertMin}°C — ${ALERT_MAX}°C)`
                  return (
                    <div key={key} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 10, padding: '8px 0',
                      borderTop: '1px solid rgba(192,57,43,0.1)',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface)' }}>{f.name} — {s}</div>
                        <div style={{ fontSize: 11, color: 'var(--danger)' }}>{tempC}°C</div>
                      </div>
                      {done ? (
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20,
                          background: 'rgba(45,122,79,0.1)', color: 'var(--success)',
                        }}>✓ Documenté</span>
                      ) : (
                        <button
                          onClick={() => setAcModal({
                            type: 'temperature_frigo', date,
                            refId: `${date}_${f.id}_${s}`,
                            fridgeId: f.id, fridgeName: f.name, session: s,
                            tempC, alertMin, alertMax: ALERT_MAX,
                            problem,
                          })}
                          style={{
                            padding: '6px 12px', borderRadius: 10, fontSize: 12, fontWeight: 700,
                            border: '1px solid rgba(192,57,43,0.3)', background: 'rgba(192,57,43,0.08)',
                            color: 'var(--danger)', cursor: 'pointer', whiteSpace: 'nowrap',
                            fontFamily: 'Manrope, sans-serif',
                          }}
                        >
                          Documenter
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </>
      )}

      {/* ── ONGLET ACTIONS CORRECTIVES ─────────────────────────── */}
      {tab === 'actions' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="date" value={date} onChange={e => { setDate(e.target.value); loadAcForDate(e.target.value) }}
              className="input-filled" style={{ flex: 1 }} />
            <button
              onClick={() => setAcModal({ type: 'temperature_frigo', date, refId: `manual_${Date.now()}`, problem: '' })}
              style={{
                padding: '8px 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: 'var(--primary)', color: '#fff', fontSize: 12, fontWeight: 700,
                fontFamily: 'Manrope, sans-serif', whiteSpace: 'nowrap',
              }}
            >➕ Ajouter</button>
          </div>
          {acLoading ? (
            <div style={{ textAlign: 'center', padding: '30px 0' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
          ) : acList.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📋</div>
              <p style={{ fontFamily: 'Epilogue, sans-serif', fontWeight: 700, fontSize: 15, color: 'var(--on-surface)', margin: '0 0 4px' }}>
                Aucune action corrective
              </p>
              <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: 0 }}>
                pour cette date
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {acList.map(ac => (
                <div key={ac.id} className="card" style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--danger)', marginBottom: 2 }}>{ac.problem}</div>
                      <div style={{ fontSize: 11, color: 'var(--on-surface-3)' }}>
                        par {ac.createdByName || '—'} · {ac.createdAt?.toDate ? ac.createdAt.toDate().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 99, background: 'rgba(45,122,79,0.1)', color: 'var(--success)', whiteSpace: 'nowrap' }}>✓ Documenté</span>
                      {isManager && (
                        <button onClick={() => setEditAc(ac)} style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-low)', cursor: 'pointer', fontSize: 12 }}>✏️</button>
                      )}
                    </div>
                  </div>
                  <div style={{
                    padding: '10px 12px', borderRadius: 10,
                    background: 'var(--surface-low)', fontSize: 13, color: 'var(--on-surface)',
                    fontFamily: 'Manrope, sans-serif', lineHeight: 1.5, whiteSpace: 'pre-wrap',
                  }}>
                    {ac.action}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── ONGLET SEMAINE ──────────────────────────────────────── */}
      {tab === 'semaine' && (
        <>
          {/* Navigation semaine */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => changeWeek(-1)} className="btn-icon" style={{
              background: 'var(--surface-low)', borderRadius: 12,
              width: 40, height: 40, flexShrink: 0, fontSize: 18,
            }}>‹</button>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--on-surface)', fontFamily: 'Epilogue, sans-serif' }}>
                {weekOffset === 0 ? 'Cette semaine' : weekOffset === -1 ? 'Semaine précédente' : weekOffset < 0 ? `Il y a ${-weekOffset} semaines` : `Dans ${weekOffset} semaine(s)`}
              </div>
              <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 2 }}>
                {formatWeekLabel(weekDates)}
              </div>
            </div>
            <button onClick={() => changeWeek(1)} className="btn-icon" style={{
              background: 'var(--surface-low)', borderRadius: 12,
              width: 40, height: 40, flexShrink: 0, fontSize: 18,
            }}>›</button>
          </div>

          {weekLoading ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--on-surface-3)' }}>
              <div className="spinner" style={{ margin: '0 auto 12px' }} />
              Chargement…
            </div>
          ) : (
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <div style={{ minWidth: 420 }}>

                {/* Légende */}
                <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginBottom: 10 }}>
                  {[
                    { bg: 'rgba(84,101,30,0.2)', label: 'OK' },
                    { bg: 'rgba(136,0,20,0.2)',  label: 'Alerte' },
                    { bg: 'var(--surface-mid)',  label: 'Manquant' },
                  ].map(({ bg, label }) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--on-surface-3)' }}>
                      <div style={{ width: 12, height: 12, borderRadius: 3, background: bg }} />
                      {label}
                    </div>
                  ))}
                </div>

                {/* Table */}
                <div style={{ background: 'var(--surface-low)', borderRadius: 16, overflow: 'hidden' }}>
                  {/* En-tête */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: '72px 28px repeat(7, 1fr)',
                    background: 'var(--surface-mid)',
                    borderBottom: '1px solid var(--border-soft)',
                  }}>
                    <div style={{ padding: '8px 10px', fontSize: 10, fontWeight: 700, color: 'var(--on-surface-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Frigo</div>
                    <div />
                    {weekDates.map((d, i) => {
                      const isToday = d === todayISO()
                      const [, mo, da] = d.split('-')
                      return (
                        <div key={d} style={{ padding: '6px 2px', textAlign: 'center' }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: isToday ? 'var(--primary)' : 'var(--on-surface-3)', textTransform: 'uppercase' }}>
                            {DAY_SHORT[i]}
                          </div>
                          <div style={{ fontSize: 10, color: isToday ? 'var(--primary)' : 'var(--on-surface-3)', marginTop: 1, fontWeight: isToday ? 700 : 400 }}>
                            {parseInt(da)}/{parseInt(mo)}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Lignes frigos */}
                  {FRIDGES.map((f, fi) => (
                    <div key={f.id}>
                      {/* Matin */}
                      <div style={{
                        display: 'grid', gridTemplateColumns: '72px 28px repeat(7, 1fr)',
                        background: fi % 2 === 0 ? 'rgba(28,28,24,0.015)' : 'transparent',
                        borderBottom: '1px solid var(--border-soft)',
                      }}>
                        <div style={{ padding: '7px 10px', fontSize: 11, fontWeight: 600, color: 'var(--on-surface)', display: 'flex', alignItems: 'center' }}>
                          {f.name}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>☀️</div>
                        {weekDates.map(d => {
                          const cell = weekData[d]?.[f.id]?.matin ?? { tempC: null, status: null }
                          return (
                            <div key={d} style={{
                              padding: '6px 2px', background: cellBg(cell),
                              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
                            }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: cellColor(cell) }}>
                                {cell.tempC !== null ? `${cell.tempC}°` : '—'}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                      {/* Soir */}
                      <div style={{
                        display: 'grid', gridTemplateColumns: '72px 28px repeat(7, 1fr)',
                        background: fi % 2 === 0 ? 'rgba(28,28,24,0.015)' : 'transparent',
                        borderBottom: fi < FRIDGES.length - 1 ? '1px solid var(--border-soft)' : 'none',
                      }}>
                        <div style={{ padding: '7px 10px' }} />
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>🌙</div>
                        {weekDates.map(d => {
                          const cell = weekData[d]?.[f.id]?.soir ?? { tempC: null, status: null }
                          return (
                            <div key={d} style={{
                              padding: '6px 2px', background: cellBg(cell),
                              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
                            }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: cellColor(cell) }}>
                                {cell.tempC !== null ? `${cell.tempC}°` : '—'}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Stats semaine */}
                <WeekStats weekData={weekData} weekDates={weekDates} />
              </div>
            </div>
          )}
        </>
      )}

      {acModal && (
        <ActionCorrectiveModal
          payload={acModal}
          createdByName={user?.displayName || user?.email?.split('@')[0] || ''}
          onClose={() => setAcModal(null)}
          onSaved={() => {
            setDocumented(prev => new Set([...prev, `${acModal.fridgeId}_${acModal.session}`]))
            loadAcForDate(date)
          }}
        />
      )}
      {editAc && (
        <ActionCorrectiveModal
          payload={{ type: 'temperature_frigo', date, refId: editAc.id, problem: editAc.problem }}
          createdByName={user?.displayName || user?.email?.split('@')[0] || ''}
          onClose={() => setEditAc(null)}
          onSaved={() => { setEditAc(null); loadAcForDate(date) }}
          editId={editAc.id}
          initialAction={editAc.action}
          canDelete={canDeleteAc}
          onDeleted={() => { setEditAc(null); loadAcForDate(date) }}
        />
      )}
    </div>
  )
}

function WeekStats({ weekData, weekDates }: { weekData: WeekData; weekDates: string[] }) {
  let total = 0, filled = 0, alerts = 0
  for (const d of weekDates) {
    for (const f of [
      { id: 'FRIGO_3P' }, { id: 'VITRINE_1' }, { id: 'VITRINE_2' }, { id: 'VITRINE_3' }, { id: 'GRAND_FRIGO' },
    ]) {
      for (const s of SESSIONS) {
        total++
        const cell = weekData[d]?.[f.id]?.[s]
        if (cell?.tempC !== null && cell?.tempC !== undefined) {
          filled++
          if (cell.status === 'ALERTE') alerts++
        }
      }
    }
  }
  const missing = total - filled
  const pct = Math.round((filled / total) * 100)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 12 }}>
      {[
        { label: 'Complétés', value: `${pct}%`, sub: `${filled}/${total} relevés`, danger: pct < 70 },
        { label: 'Manquants', value: String(missing), sub: 'relevés absents',      danger: missing > 0 },
        { label: 'Alertes',   value: String(alerts),  sub: 'hors seuil',            danger: alerts > 0 },
      ].map(stat => (
        <div key={stat.label} className="card" style={{ textAlign: 'center', padding: '12px 8px' }}>
          <div style={{
            fontFamily: 'Epilogue, sans-serif', fontSize: 22, fontWeight: 800,
            color: stat.danger ? 'var(--danger)' : 'var(--success)',
          }}>
            {stat.value}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface)', marginTop: 1 }}>{stat.label}</div>
          <div style={{ fontSize: 10, color: 'var(--on-surface-3)', marginTop: 2 }}>{stat.sub}</div>
        </div>
      ))}
    </div>
  )
}
