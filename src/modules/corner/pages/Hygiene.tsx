import { useEffect, useState } from 'react'
import { Timestamp, doc, getDoc, setDoc } from 'firebase/firestore'
import { db, auth } from '../../../firebase/config'
import { useToast } from '../../../hooks/useToast'

type CheckType = 'quotidien' | 'hebdo' | 'mensuel'
type CheckItem = { id: string; label: string }
type SavedCheck = { items: Record<string, boolean>; createdAt: any; createdBy: string }

const ITEMS: Record<CheckType, CheckItem[]> = {
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

const TAB_CONFIG: Record<CheckType, { label: string; icon: string; desc: string }> = {
  quotidien: { label: 'Quotidien',  icon: '📋', desc: '13 points à vérifier chaque jour' },
  hebdo:     { label: 'Hebdo',      icon: '📅', desc: '5 points à vérifier chaque semaine' },
  mensuel:   { label: 'Mensuel',    icon: '📆', desc: '1 point à vérifier chaque mois' },
}

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

  useEffect(() => { loadTab(tab, selectedDate) }, [tab, selectedDate])

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

  const items = ITEMS[tab]
  const doneCount = items.filter(i => checked[i.id]).length
  const allDone = doneCount === items.length
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

      {/* ── Sélecteur de date ────────────────────────────────────── */}
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

      {/* ── Période ciblée ───────────────────────────────────────── */}
      <p style={{ fontSize: 12, color: 'var(--on-surface-3)', margin: 0 }}>
        {getDateLabel(tab, selectedDate)}
      </p>

      {/* ── Tabs ─────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 4, padding: 4,
        background: 'var(--surface-mid)', borderRadius: 14,
      }}>
        {(['quotidien', 'hebdo', 'mensuel'] as CheckType[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '9px 4px', borderRadius: 10, border: 'none',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
            fontFamily: 'Manrope, sans-serif',
            background: tab === t ? 'var(--surface)' : 'transparent',
            color: tab === t ? 'var(--primary)' : 'var(--on-surface-3)',
            boxShadow: tab === t ? '0 1px 6px rgba(28,28,24,0.08)' : 'none',
            transition: 'all 0.15s',
          }}>
            {TAB_CONFIG[t].label}
          </button>
        ))}
      </div>

      {loadingTab ? (
        <div style={{ padding: '48px 20px', textAlign: 'center' }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          <p style={{ color: 'var(--on-surface-3)', margin: 0, fontSize: 13 }}>Chargement…</p>
        </div>
      ) : (
        <>
          {/* ── Barre de progression ─────────────────────────────── */}
          <div className="card" style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface)', margin: 0 }}>
                  {doneCount}/{items.length} effectués
                </p>
                <p style={{ fontSize: 11, color: 'var(--on-surface-3)', margin: '2px 0 0' }}>
                  {TAB_CONFIG[tab].desc}
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
      )}
    </div>
  )
}
