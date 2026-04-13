import { useEffect, useState } from 'react'
import { Timestamp, doc, getDoc, getDocs, collection, query, where, setDoc } from 'firebase/firestore'
import { db, auth } from '../../../firebase/config'
import { useToast } from '../../../hooks/useToast'

type CheckType = 'quotidien' | 'hebdo' | 'mensuel' | 'historique' | 'historique'
type CheckItem = { id: string; label: string }
type SavedCheck = { items: Record<string, boolean>; createdAt: any; createdBy: string }

const ITEMS: Partial<Record<CheckType, CheckItem[]>> = {
  quotidien: [
    { id: 'plats_service',       label: 'Plats de service' },
    { id: 'int_vitrines',        label: 'Intérieur vitrines libre service' },
    { id: 'ustensiles',          label: 'Ustensiles' },
    { id: 'meuble_vente',        label: 'Meuble de vente' },
    { id: 'comptoir_balance',    label: 'Comptoir / balance' },
    { id: 'micro_ondes',         label: 'Micro-ondes' },
    { id: 'evier_papier',        label: 'Évier / Distributeur papier' },
    { id: 'etiquettes',          label: 'Étiquettes' },
    { id: 'plan_travail',        label: 'Plan de travail' },
    { id: 'ext_placards',        label: 'Extérieur placards rangement' },
    { id: 'ext_frigo',           label: 'Extérieur frigo' },
    { id: 'poubelle',            label: 'Poubelle' },
    { id: 'vitres',              label: 'Vitres' },
  ],
  hebdo: [
    { id: 'int_frigos',          label: 'Intérieur frigos' },
    { id: 'etageres_materiels',  label: 'Étagères porte matériels' },
    { id: 'support_papier',      label: 'Support rouleau papier' },
    { id: 'placard_hygiene',     label: 'Placard hygiène' },
    { id: 'machine_glacon',      label: 'Machine à Glaçons' },
  ],
  mensuel: [
    { id: 'placard_rangement',   label: 'Placard rangement' },
  ],
}

const TAB_CONFIG: Partial<Record<CheckType, { label: string; icon: string; desc: string }>> = {
  quotidien: { label: 'Quotidien',  icon: '📋', desc: '13 points à vérifier chaque jour' },
  hebdo:     { label: 'Hebdo',      icon: '📅', desc: '5 points à vérifier chaque semaine' },
  mensuel:   { label: 'Mensuel',    icon: '📆', desc: '1 point à vérifier chaque mois' },
}

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

function getWeekDates(offset: number): string[] {
  const now = new Date()
  const dow = now.getDay() === 0 ? 6 : now.getDay() - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - dow + offset * 7)
  monday.setHours(0, 0, 0, 0)
  const p = (n: number) => String(n).padStart(2, '0')
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  })
}

function getWeekLabel(offset: number): string {
  const dates = getWeekDates(offset)
  const [startY, startM, startD] = dates[0].split('-')
  const [, endM, endD] = dates[6].split('-')
  if (startM === endM) return `${parseInt(startD)}–${parseInt(endD)} ${new Date(dates[0] + 'T12:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`
  return `${parseInt(startD)} ${new Date(dates[0] + 'T12:00:00').toLocaleDateString('fr-FR', { month: 'short' })} – ${parseInt(endD)} ${new Date(dates[6] + 'T12:00:00').toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })}`
}

const QUOTIDIEN_IDS = ['plats_service','int_vitrines','ustensiles','meuble_vente','comptoir_balance','micro_ondes','evier_papier','etiquettes','plan_travail','ext_placards','ext_frigo','poubelle','vitres']
const HEBDO_IDS = ['int_frigos','etageres_materiels','support_papier','placard_hygiene','machine_glacon']
const MENSUEL_IDS = ['placard_rangement']

const DAY_SHORT = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

function todayISO() {
  const d = new Date(); const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function getISOWeek(d: Date) {
  const date = new Date(d); date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7)
  const w1 = new Date(date.getFullYear(), 0, 4)
  return 1 + Math.round(((date.getTime() - w1.getTime()) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7)
}

function getDocId(type: CheckType, dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const p = (n: number) => String(n).padStart(2, '0')
  if (type === 'quotidien') return `${dateStr}_quotidien`
  if (type === 'hebdo') return `${d.getFullYear()}-W${p(getISOWeek(d))}_hebdo`
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}_mensuel`
}

function getDateLabel(type: CheckType, dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  if (type === 'quotidien') {
    const [y, m, day] = dateStr.split('-')
    return `Checklist du ${day}/${m}/${y}`
  }
  if (type === 'hebdo') {
    const week = getISOWeek(d)
    return `Semaine ${week} — ${d.getFullYear()}`
  }
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

export default function Hygiene() {
  const { show } = useToast()
  const today = todayISO()
  const [tab, setTab]                   = useState<CheckType>('quotidien')
  const [selectedDate, setSelectedDate] = useState(today)
  const [saved, setSaved]               = useState<SavedCheck | null>(null)
  const [checked, setChecked]           = useState<Record<string, boolean>>({})
  const [saving, setSaving]             = useState(false)
  const [loadingTab, setLoadingTab]     = useState(false)

  // Historique state
  const [weekOffset, setWeekOffset]     = useState(0)
  const [histLoading, setHistLoading]   = useState(false)
  const [histDays, setHistDays]         = useState<Record<string, { total: number; done: number } | null>>({})
  const [histHebdo, setHistHebdo]       = useState<{ total: number; done: number } | null>(null)
  const [histMensuel, setHistMensuel]   = useState<{ total: number; done: number } | null>(null)

  async function loadTab(type: CheckType, dateStr: string) {
    setLoadingTab(true); setSaved(null); setChecked({})
    try {
      const snap = await getDoc(doc(db, 'hygiene_corner', getDocId(type, dateStr)))
      if (snap.exists()) {
        const data = snap.data() as SavedCheck
        setSaved(data); setChecked(data.items || {})
      }
    } finally { setLoadingTab(false) }
  }

  useEffect(() => { if (tab !== 'historique') loadTab(tab, selectedDate) }, [tab, selectedDate])

  async function loadHistorique(offset: number) {
    setHistLoading(true)
    setHistDays({}); setHistHebdo(null); setHistMensuel(null)
    try {
      const dates = getWeekDates(offset)

      // Load 7 daily docs
      const dayResults: Record<string, { total: number; done: number } | null> = {}
      await Promise.all(dates.map(async (dateStr) => {
        const snap = await getDoc(doc(db, 'hygiene_corner', `${dateStr}_quotidien`))
        if (snap.exists()) {
          const data = snap.data() as SavedCheck
          const items = data.items || {}
          const total = QUOTIDIEN_IDS.length
          const done = QUOTIDIEN_IDS.filter(id => items[id]).length
          dayResults[dateStr] = { total, done }
        } else {
          dayResults[dateStr] = null
        }
      }))
      setHistDays(dayResults)

      // Load hebdo for this week
      const weekDocId = getDocId('hebdo', dates[0])
      const hebdoSnap = await getDoc(doc(db, 'hygiene_corner', weekDocId))
      if (hebdoSnap.exists()) {
        const data = hebdoSnap.data() as SavedCheck
        const items = data.items || {}
        setHistHebdo({ total: HEBDO_IDS.length, done: HEBDO_IDS.filter(id => items[id]).length })
      } else {
        setHistHebdo(null)
      }

      // Load mensuel for the month of Monday
      const mensuelDocId = getDocId('mensuel', dates[0])
      const mensuelSnap = await getDoc(doc(db, 'hygiene_corner', mensuelDocId))
      if (mensuelSnap.exists()) {
        const data = mensuelSnap.data() as SavedCheck
        const items = data.items || {}
        setHistMensuel({ total: MENSUEL_IDS.length, done: MENSUEL_IDS.filter(id => items[id]).length })
      } else {
        setHistMensuel(null)
      }
    } finally {
      setHistLoading(false)
    }
  }

  useEffect(() => { if (tab === 'historique') loadHistorique(weekOffset) }, [tab, weekOffset])

  function toggle(id: string) { setChecked(p => ({ ...p, [id]: !p[id] })) }

  async function saveCheck() {
    setSaving(true)
    try {
      const uid = auth.currentUser?.uid || ''
      const data: SavedCheck = { items: checked, createdAt: Timestamp.now(), createdBy: uid }
      await setDoc(doc(db, 'hygiene_corner', getDocId(tab, selectedDate)), data)
      setSaved(data)
      show('Checklist sauvegardée')
    } catch (e: any) { alert(e?.message) }
    finally { setSaving(false) }
  }

  const histWeekDates = getWeekDates(weekOffset)
  const items = tab !== 'historique' ? (ITEMS[tab as Exclude<CheckType, 'historique'>] ?? []) : []
  const doneCount = items.filter(i => checked[i.id]).length
  const allDone = items.length > 0 && doneCount === items.length
  const pct = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0

  return (
    <div className="page">

      {/* ── Header ───────────────────────────────────────────────── */}
      <div>
        <p className="section-label" style={{ marginBottom: 2 }}>HACCP Ledger</p>
        <h1 style={{
          fontFamily: 'Epilogue, sans-serif',
          fontSize: 24, fontWeight: 800,
          color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0,
        }}>
          Check-list hygiène
        </h1>
      </div>

      {/* ── Sélecteur de date (masqué en mode Historique) ─────────── */}
      {tab !== 'historique' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="date"
            className="input-filled"
            style={{ flex: 1 }}
            value={selectedDate}
            max={today}
            onChange={e => setSelectedDate(e.target.value)}
          />
          {selectedDate !== today && (
            <button
              onClick={() => setSelectedDate(today)}
              style={{
                fontSize: 12, color: 'var(--primary)', background: 'rgba(0,66,117,0.08)',
                border: 'none', borderRadius: 8, cursor: 'pointer',
                fontWeight: 700, whiteSpace: 'nowrap', padding: '8px 12px',
                fontFamily: 'Manrope, sans-serif',
              }}
            >
              Aujourd'hui
            </button>
          )}
        </div>
      )}

      {/* ── Période ciblée ───────────────────────────────────────── */}
      {tab !== 'historique' && (
        <p style={{ fontSize: 12, color: 'var(--on-surface-3)', margin: 0 }}>
          {getDateLabel(tab, selectedDate)}
        </p>
      )}

      {/* ── Tabs ─────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 4, padding: 4,
        background: 'var(--surface-mid)', borderRadius: 14,
      }}>
        {(['quotidien', 'hebdo', 'mensuel', 'historique'] as CheckType[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '9px 4px', borderRadius: 10, border: 'none',
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
            fontFamily: 'Manrope, sans-serif',
            background: tab === t ? 'var(--surface)' : 'transparent',
            color: tab === t ? 'var(--primary)' : 'var(--on-surface-3)',
            boxShadow: tab === t ? '0 1px 6px rgba(28,28,24,0.08)' : 'none',
            transition: 'all 0.15s',
          }}>
            {t === 'quotidien' ? 'Quotidien' : t === 'hebdo' ? 'Hebdo' : t === 'mensuel' ? 'Mensuel' : 'Historique'}
          </button>
        ))}
      </div>

      {/* ── Historique ──────────────────────────────────────────── */}
      {tab === 'historique' && (
        histLoading ? (
          <div style={{ padding: '48px 20px', textAlign: 'center' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />
          </div>
        ) : (
          <>
            {/* Navigation semaine */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button onClick={() => setWeekOffset(w => w - 1)} style={{ background: 'var(--surface-low)', border: 'none', borderRadius: 10, padding: '8px 16px', fontSize: 18, cursor: 'pointer', color: 'var(--on-surface)' }}>←</button>
              <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--on-surface)', fontFamily: 'Manrope, sans-serif' }}>
                {histWeekDates.length > 0 ? (() => {
                  const [, m1, d1] = histWeekDates[0].split('-')
                  const [, m2, d2] = histWeekDates[6].split('-')
                  const months = ['jan','fév','mar','avr','mai','juin','jul','aoû','sep','oct','nov','déc']
                  return `${parseInt(d1)} ${months[parseInt(m1)-1]} – ${parseInt(d2)} ${months[parseInt(m2)-1]}`
                })() : ''}
              </span>
              <button onClick={() => setWeekOffset(w => Math.min(w + 1, 0))} disabled={weekOffset >= 0} style={{ background: weekOffset >= 0 ? 'var(--surface-mid)' : 'var(--surface-low)', border: 'none', borderRadius: 10, padding: '8px 16px', fontSize: 18, cursor: weekOffset >= 0 ? 'default' : 'pointer', color: weekOffset >= 0 ? 'var(--on-surface-3)' : 'var(--on-surface)' }}>→</button>
            </div>
            {/* Grille 7 jours */}
            <div className="card" style={{ padding: '12px 14px' }}>
              <p className="section-label" style={{ marginBottom: 10 }}>Quotidien — Semaine</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                {histWeekDates.map((dateStr, i) => {
                  const data = histDays[dateStr]
                  const isFuture = dateStr > today
                  const isToday = dateStr === today
                  const isDone = data && data.done === data.total
                  const isPartial = data && data.done > 0 && data.done < data.total
                  const [, , dd] = dateStr.split('-')
                  return (
                    <div key={dateStr} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '8px 2px', borderRadius: 10, background: isToday ? 'rgba(0,66,117,0.08)' : 'var(--surface-low)', border: isToday ? '1.5px solid rgba(0,66,117,0.22)' : '1.5px solid transparent' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: isToday ? 'var(--primary)' : 'var(--on-surface-3)', textTransform: 'uppercase' }}>{DAY_SHORT[i]}</span>
                      <span style={{ fontSize: 11, color: 'var(--on-surface-3)' }}>{parseInt(dd)}</span>
                      <span style={{ fontSize: 16 }}>
                        {isFuture ? '·' : isDone ? '✅' : isPartial ? '🟡' : data === null ? '❌' : '·'}
                      </span>
                      {!isFuture && data && (
                        <span style={{ fontSize: 9, color: isDone ? 'var(--success)' : isPartial ? 'var(--warning)' : 'var(--on-surface-3)' }}>{data.done}/{data.total}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            {/* Hebdo + Mensuel */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="card" style={{ padding: '14px 16px', textAlign: 'center' }}>
                <p className="section-label" style={{ marginBottom: 8 }}>Hebdo</p>
                {histHebdo ? (
                  <>
                    <div style={{ fontSize: 22 }}>{histHebdo.done === histHebdo.total ? '✅' : histHebdo.done > 0 ? '🟡' : '❌'}</div>
                    <div style={{ fontSize: 12, color: 'var(--on-surface-2)', marginTop: 4 }}>{histHebdo.done}/{histHebdo.total}</div>
                  </>
                ) : <div style={{ fontSize: 22 }}>❌</div>}
              </div>
              <div className="card" style={{ padding: '14px 16px', textAlign: 'center' }}>
                <p className="section-label" style={{ marginBottom: 8 }}>Mensuel</p>
                {histMensuel ? (
                  <>
                    <div style={{ fontSize: 22 }}>{histMensuel.done === histMensuel.total ? '✅' : histMensuel.done > 0 ? '🟡' : '❌'}</div>
                    <div style={{ fontSize: 12, color: 'var(--on-surface-2)', marginTop: 4 }}>{histMensuel.done}/{histMensuel.total}</div>
                  </>
                ) : <div style={{ fontSize: 22 }}>❌</div>}
              </div>
            </div>
          </>
        )
      )}

      {loadingTab ? (
        <div style={{ padding: '48px 20px', textAlign: 'center' }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          <p style={{ color: 'var(--on-surface-3)', margin: 0, fontSize: 13 }}>Chargement…</p>
        </div>
      ) : tab !== 'historique' ? (
        <>
          {/* ── Barre de progression ─────────────────────────────── */}
          <div className="card" style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface)', margin: 0 }}>
                  {doneCount}/{items.length} effectués
                </p>
                <p style={{ fontSize: 11, color: 'var(--on-surface-3)', margin: '2px 0 0' }}>
                  {(TAB_CONFIG as any)[tab]?.desc ?? ''}
                </p>
              </div>
              {saved
                ? <span className="chip-ok">Sauvegardé</span>
                : allDone
                  ? <span className="chip-warn">Non sauvegardé</span>
                  : null
              }
            </div>

            {/* Progress bar */}
            <div style={{
              height: 6, background: 'var(--surface-mid)', borderRadius: 99, overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', borderRadius: 99,
                background: allDone ? 'var(--success)' : 'var(--primary)',
                width: `${pct}%`,
                transition: 'width 0.3s ease, background 0.3s ease',
              }} />
            </div>
          </div>

          {/* ── Liste des items ───────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.map((item, idx) => {
              const isChecked = !!checked[item.id]
              return (
                <div
                  key={item.id}
                  onClick={() => toggle(item.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '13px 14px', borderRadius: 12, cursor: 'pointer',
                    background: isChecked ? 'var(--haccp-ok-bg)' : 'var(--surface-low)',
                    transition: 'background 0.15s',
                    userSelect: 'none',
                    WebkitTapHighlightColor: 'transparent',
                    animationDelay: `${idx * 0.02}s`,
                  }}
                >
                  {/* Checkbox HACCP style */}
                  <div style={{
                    width: 24, height: 24, borderRadius: 7, flexShrink: 0,
                    background: isChecked ? 'var(--secondary)' : 'var(--surface)',
                    border: `2px solid ${isChecked ? 'var(--secondary)' : 'var(--border)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background 0.15s, border-color 0.15s',
                  }}>
                    {isChecked && (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>

                  <span style={{
                    flex: 1, fontSize: 14, fontWeight: isChecked ? 500 : 600,
                    color: isChecked ? 'var(--haccp-ok-text)' : 'var(--on-surface)',
                    textDecoration: isChecked ? 'line-through' : 'none',
                    transition: 'color 0.15s',
                  }}>
                    {item.label}
                  </span>

                  {isChecked && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--secondary)" strokeWidth="2.5">
                      <path d="M20 6L9 17l-5-5"/>
                    </svg>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Bouton sauvegarde ─────────────────────────────────── */}
          <button onClick={saveCheck} disabled={saving} className="btn-primary">
            {saving ? 'Sauvegarde…' : 'Sauvegarder la check-list'}
          </button>

          {saved?.createdAt && (
            <p style={{ textAlign: 'center', color: 'var(--on-surface-3)', fontSize: 12, margin: 0 }}>
              Sauvegardé le {saved.createdAt?.toDate?.().toLocaleString?.() || '—'}
            </p>
          )}
        </>
      ) : null}
    </div>
  )
}
