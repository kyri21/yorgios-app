import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, getDoc, doc, orderBy, query, where, limit } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { SkeletonList } from '../../../components/Skeleton'

const CORNER_FRIDGES = ['FRIGO_3P', 'VITRINE_1', 'VITRINE_2', 'VITRINE_3', 'GRAND_FRIGO']
const FRIDGE_NAMES: Record<string, string> = {
  FRIGO_3P:    'Frigo 3P',
  VITRINE_1:   'Vitrine 1',
  VITRINE_2:   'Vitrine 2',
  VITRINE_3:   'Vitrine 3',
  GRAND_FRIGO: 'Grand frigo',
}

function todayISO() {
  const d = new Date(); const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function endOfWeekISO() {
  const d = new Date()
  const dow = d.getDay() === 0 ? 6 : d.getDay() - 1
  d.setDate(d.getDate() + (6 - dow))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function getISOWeek(d: Date) {
  const date = new Date(d); date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7)
  const w1 = new Date(date.getFullYear(), 0, 4)
  return 1 + Math.round(((date.getTime() - w1.getTime()) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7)
}
function hygieneHebdoId(): string {
  const d = new Date(); const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-W${p(getISOWeek(d))}_hebdo`
}
function hygieneMensuelId(): string {
  const d = new Date(); const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}_mensuel`
}
function todayStart() { const d = new Date(); d.setHours(0,0,0,0); return d }
function tomorrowStart() { const d = todayStart(); d.setDate(d.getDate() + 1); return d }
function afterTomorrow() { const d = todayStart(); d.setDate(d.getDate() + 2); return d }

function dlcStatus(dlcAt: any): 'expire' | 'today' | 'tomorrow' | 'ok' {
  if (!dlcAt?.toDate) return 'ok'
  const d = dlcAt.toDate()
  if (d < todayStart()) return 'expire'
  if (d < tomorrowStart()) return 'today'
  if (d < afterTomorrow()) return 'tomorrow'
  return 'ok'
}

type TempStatus = { fridgeId: string; name: string; tempC: number | null; status: string | null }
type DlcItem = { id: string; productName: string; category: string; quantite: number; unite: string; dlcAt: any; fabricationAt: any; dlcStatus: 'expire' | 'today' | 'tomorrow' | 'ok' }
type Livraison = { id: string; productName?: string; departAt: any; receptionTempC: number | null }
type CommandeClient = { id: string; statut: string; dateLivraison: string; nom?: string; prenom?: string }

// ── Status colors (Aegean light mode) ──────────────────────────────
function dotColor(s: string): string {
  if (s === 'ok')   return 'var(--success)'
  if (s === 'ko')   return 'var(--danger)'
  if (s === 'warn') return 'var(--warning)'
  if (s === 'info') return 'var(--primary)'
  if (s === 'todo') return 'var(--warning)'
  return 'var(--on-surface-3)'
}

function statusLabel(s: string): string {
  if (s === 'ok')   return 'OK'
  if (s === 'ko')   return 'À faire'
  if (s === 'warn') return 'Attention'
  if (s === 'info') return 'Plus tard'
  if (s === 'todo') return 'À faire'
  return '—'
}

function tempCellStyle(status: string | null): React.CSSProperties {
  if (status === 'ALERTE') return { background: 'rgba(136,0,20,0.08)' }
  if (status === 'OK')     return { background: 'rgba(84,101,30,0.10)' }
  return { background: 'var(--surface-mid)' }
}

const TASK_KEYS = ['tgg', 'cartons', 'plats'] as const
type TaskKey = typeof TASK_KEYS[number]

function loadChecks(): Record<TaskKey, boolean> {
  try {
    const saved = localStorage.getItem('dashboard_checks')
    if (!saved) return { tgg: false, cartons: false, plats: false }
    const parsed = JSON.parse(saved)
    if (parsed.date !== todayISO()) return { tgg: false, cartons: false, plats: false }
    return parsed.checks
  } catch { return { tgg: false, cartons: false, plats: false } }
}

function saveChecks(checks: Record<TaskKey, boolean>) {
  localStorage.setItem('dashboard_checks', JSON.stringify({ date: todayISO(), checks }))
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [temps, setTemps] = useState<TempStatus[]>([])
  const [hygieneOk, setHygieneOk] = useState<boolean | null>(null)
  const [hygieneHebdoOk, setHygieneHebdoOk] = useState<boolean | null>(null)
  const [hygieneMensuelOk, setHygieneMensuelOk] = useState<boolean | null>(null)
  const [pendingLivraisons, setPendingLivraisons] = useState<Livraison[]>([])
  const [dlcItems, setDlcItems] = useState<DlcItem[]>([])
  const [commandesToday, setCommandesToday] = useState<CommandeClient[]>([])
  const [commandesWeek, setCommandesWeek] = useState<CommandeClient[]>([])
  const [matinSaisis, setMatinSaisis] = useState(false)
  const [soirSaisis, setSoirSaisis] = useState(false)
  const [loading, setLoading] = useState(true)
  const [checks, setChecks] = useState<Record<TaskKey, boolean>>(loadChecks)

  function toggleCheck(key: TaskKey) {
    const next = { ...checks, [key]: !checks[key] }
    setChecks(next)
    saveChecks(next)
  }

  useEffect(() => {
    async function loadAll() {
      const today = todayISO()
      const t0 = todayStart().getTime()
      const endWeek = endOfWeekISO()

      const [tempsData, tempsMatinData, tempsSoirData, hygieneSnap, hygieneHebdoSnap, hygieneMensuelSnap, livrSnap, stockSnap, cmdSnap] = await Promise.all([
        Promise.all(CORNER_FRIDGES.map(async id => {
          const snap = await getDoc(doc(db, 'temperatures', `${today}_${id}_matin`))
          if (!snap.exists()) return { fridgeId: id, name: FRIDGE_NAMES[id], tempC: null, status: null }
          const data = snap.data() as any
          return { fridgeId: id, name: FRIDGE_NAMES[id], tempC: data.tempC ?? null, status: data.status ?? null }
        })),
        Promise.all(CORNER_FRIDGES.map(async id => {
          const snap = await getDoc(doc(db, 'temperatures', `${today}_${id}_matin`))
          return snap.exists()
        })),
        Promise.all(CORNER_FRIDGES.map(async id => {
          const snap = await getDoc(doc(db, 'temperatures', `${today}_${id}_soir`))
          return snap.exists()
        })),
        getDoc(doc(db, 'hygiene_corner', `${today}_quotidien`)),
        getDoc(doc(db, 'hygiene_corner', hygieneHebdoId())),
        getDoc(doc(db, 'hygiene_corner', hygieneMensuelId())),
        getDocs(query(collection(db, 'livraisons'), orderBy('departAt', 'desc'), limit(100))),
        getDocs(query(collection(db, 'corner_stock'), where('active', '==', true), limit(200))),
        getDocs(query(collection(db, 'commandes_externes'),
          where('dateLivraison', '>=', today),
          where('dateLivraison', '<=', endWeek),
          orderBy('dateLivraison', 'asc'))),
      ])

      setTemps(tempsData)
      setMatinSaisis(tempsMatinData.some(Boolean))
      setSoirSaisis(tempsSoirData.some(Boolean))
      setHygieneOk(hygieneSnap.exists())
      setHygieneHebdoOk(hygieneHebdoSnap.exists())
      setHygieneMensuelOk(hygieneMensuelSnap.exists())

      const pending = livrSnap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .filter((l: any) => l.receptionTempC == null && l.departAt?.toDate && l.departAt.toDate().getTime() >= t0)
      setPendingLivraisons(pending)

      const items: DlcItem[] = stockSnap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) } as any))
        .map(item => ({ ...item, dlcStatus: dlcStatus(item.dlcAt) }))
        .filter(item => item.dlcStatus !== 'ok')
        .sort((a, b) => {
          const order: Record<string, number> = { expire: 0, today: 1, tomorrow: 2, ok: 3 }
          return order[a.dlcStatus] - order[b.dlcStatus]
        })
      setDlcItems(items)

      const allCmds: CommandeClient[] = cmdSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
      setCommandesToday(allCmds.filter(c => c.dateLivraison === today))
      setCommandesWeek(allCmds.filter(c => c.dateLivraison > today))

      setLoading(false)
    }
    loadAll().catch(e => { console.error(e); setLoading(false) })
  }, [])

  if (loading) return (
    <div className="page">
      <SkeletonList count={5} />
    </div>
  )

  const tempAlerts = temps.filter(t => t.status === 'ALERTE').length
  const tempsSet = temps.some(t => t.tempC !== null)
  const now = new Date()
  const heure = now.getHours()
  const totalMin = heure * 60 + now.getMinutes()
  const soirStatus = soirSaisis ? 'ok' : heure < 17 ? 'info' : 'ko'
  const dlcExpire = dlcItems.filter(i => i.dlcStatus === 'expire').length
  const dlcStatusVal = dlcItems.length === 0 ? 'ok' : dlcExpire > 0 ? 'ko' : 'warn'

  const taskItems = [
    { label: 'Hygiène quotidienne',   status: hygieneOk === null ? 'gray' : hygieneOk ? 'ok' : 'ko',   nav: 'hygiene',      checkKey: null as TaskKey | null },
    { label: 'Températures matin',    status: matinSaisis ? 'ok' : 'ko',                                nav: 'temperatures', checkKey: null as TaskKey | null },
    { label: 'Températures soir',     status: soirStatus,                                               nav: 'temperatures', checkKey: null as TaskKey | null },
    {
      label: dlcExpire > 0 ? `DLC vitrine (${dlcExpire} expirée(s))` : dlcItems.length > 0 ? `DLC vitrine (${dlcItems.length} à surveiller)` : 'DLC vitrine',
      status: dlcStatusVal, nav: 'vitrine', checkKey: null as TaskKey | null,
    },
    { label: '🥡 Préparer les paniers TooGoodToGo', status: checks.tgg     ? 'ok' : (totalMin >= 9*60     ? 'todo' : 'gray'), nav: '', checkKey: 'tgg'     as TaskKey },
    { label: '📦 Vider les cartons chambre froide',  status: checks.cartons ? 'ok' : (totalMin >= 9*60+30 ? 'todo' : 'gray'), nav: '', checkKey: 'cartons' as TaskKey },
    { label: '🍽️ Faire les plats du jour',            status: checks.plats   ? 'ok' : (totalMin >= 11*60  ? 'todo' : 'gray'), nav: '', checkKey: 'plats'   as TaskKey },
  ]

  const hasKo = taskItems.some(i => i.status === 'ko')

  return (
    <div className="page">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <p className="section-label" style={{ marginBottom: 2 }}>Corner</p>
          <h1 style={{
            fontFamily: 'Epilogue, sans-serif',
            fontSize: 26, fontWeight: 800,
            color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0,
          }}>
            Tableau de bord
          </h1>
        </div>
        <span style={{ fontSize: 12, color: 'var(--on-surface-3)', paddingBottom: 2, textAlign: 'right' }}>
          {now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </span>
      </div>

      {/* ── À faire aujourd'hui ─────────────────────────────────── */}
      <div
        className="card"
        style={{
          background: hasKo ? 'rgba(136,0,20,0.04)' : 'var(--surface-low)',
          cursor: 'default',
          borderLeft: hasKo ? '3px solid var(--danger)' : '3px solid transparent',
          borderRadius: 16,
          padding: '14px 16px',
        }}
      >
        <p className="section-label" style={{ marginBottom: 10 }}>
          {hasKo ? '⚠ Actions requises' : '✓ Statut du jour'}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {taskItems.map(item => (
            <div
              key={item.label}
              onClick={() => {
                if (item.checkKey) toggleCheck(item.checkKey)
                else if (item.nav) navigate(item.nav)
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 10px', borderRadius: 10,
                cursor: 'pointer',
                background: 'var(--surface)',
                opacity: item.status === 'gray' ? 0.45 : 1,
                transition: 'background 0.1s',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {/* Checkbox ou dot */}
              {item.checkKey ? (
                <div
                  className={item.status === 'ok' ? 'animate-check-pop' : ''}
                  style={{
                    width: 22, height: 22, borderRadius: 7, flexShrink: 0,
                    border: `2px solid ${item.status === 'ok' ? 'var(--primary)' : 'var(--border)'}`,
                    background: item.status === 'ok' ? 'var(--primary)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background 0.15s, border-color 0.15s',
                  }}>
                  {item.status === 'ok' && (
                    <svg width="11" height="8" viewBox="0 0 11 8" fill="none">
                      <path d="M1 4l3 3 6-6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
              ) : (
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: dotColor(item.status),
                }} />
              )}

              <span style={{
                flex: 1, fontSize: 13, fontWeight: 500,
                color: item.status === 'ok' && item.checkKey ? 'var(--on-surface-3)' : 'var(--on-surface)',
                textDecoration: item.status === 'ok' && item.checkKey ? 'line-through' : 'none',
              }}>
                {item.label}
              </span>

              {!item.checkKey && (
                <>
                  <span style={{ fontSize: 11, fontWeight: 700, color: dotColor(item.status) }}>
                    {statusLabel(item.status)}
                  </span>
                  {item.nav && (
                    <svg width="6" height="10" fill="none" viewBox="0 0 6 10">
                      <path d="M1 1l4 4-4 4" stroke="var(--on-surface-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Températures frigos ─────────────────────────────────── */}
      <div className="card" style={{ cursor: 'pointer' }} onClick={() => navigate('temperatures')}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <p className="section-label" style={{ marginBottom: 2 }}>Frigos</p>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--on-surface)', margin: 0, fontFamily: 'Epilogue, sans-serif' }}>
              Températures
            </h2>
          </div>
          {!tempsSet
            ? <span className="chip-warn">Non saisis</span>
            : tempAlerts > 0 ? <span className="chip-danger">{tempAlerts} alerte(s)</span>
            : <span className="chip-ok">Conforme</span>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
          {temps.map(t => (
            <div key={t.fridgeId} style={{
              borderRadius: 10, padding: '8px 4px', textAlign: 'center',
              ...tempCellStyle(t.status),
            }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--on-surface-2)', marginBottom: 3, lineHeight: 1.2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {t.name}
              </div>
              <div style={{
                fontSize: 16, fontWeight: 800,
                color: t.status === 'ALERTE' ? 'var(--danger)' : t.status === 'OK' ? 'var(--success)' : 'var(--on-surface-3)',
              }}>
                {t.tempC !== null ? `${t.tempC}°` : '—'}
              </div>
              {t.status && (
                <div style={{ fontSize: 9, fontWeight: 700, marginTop: 2, color: t.status === 'ALERTE' ? 'var(--danger)' : 'var(--success)' }}>
                  {t.status}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── DLC vitrine ─────────────────────────────────────────── */}
      <div className="card" style={{ cursor: 'pointer' }} onClick={() => navigate('vitrine')}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <p className="section-label" style={{ marginBottom: 2 }}>Vitrine</p>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--on-surface)', margin: 0, fontFamily: 'Epilogue, sans-serif' }}>
              DLC produits
            </h2>
          </div>
          {dlcItems.length === 0
            ? <span className="chip-ok">RAS</span>
            : <span className="chip-danger">{dlcItems.length} alerte(s)</span>}
        </div>

        {dlcItems.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: 0 }}>
            Aucun produit expirant aujourd'hui ou demain.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* DLC DÉPASSÉE */}
            {dlcItems.filter(i => i.dlcStatus === 'expire').length > 0 && (
              <div>
                <p className="section-label" style={{ color: 'var(--danger)', marginBottom: 5 }}>
                  DLC dépassée ({dlcItems.filter(i => i.dlcStatus === 'expire').length})
                </p>
                <div style={{ borderRadius: 10, overflow: 'hidden', background: 'rgba(136,0,20,0.05)' }}>
                  {dlcItems.filter(i => i.dlcStatus === 'expire').map((item, idx) => {
                    const dlcStr = item.dlcAt?.toDate ? item.dlcAt.toDate().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '—'
                    const fabStr = item.fabricationAt?.toDate ? item.fabricationAt.toDate().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '—'
                    return (
                      <div key={item.id} style={{
                        display: 'grid', gridTemplateColumns: '1fr auto auto',
                        gap: 6, padding: '7px 10px', fontSize: 12, alignItems: 'center',
                        background: idx % 2 === 0 ? 'rgba(136,0,20,0.06)' : 'rgba(136,0,20,0.03)',
                        borderBottom: idx < dlcItems.filter(i => i.dlcStatus === 'expire').length - 1 ? '1px solid rgba(136,0,20,0.08)' : 'none',
                      }}>
                        <span style={{ fontWeight: 600, color: 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.productName}</span>
                        <span style={{ fontSize: 10, color: 'var(--on-surface-3)', whiteSpace: 'nowrap' }}>Fab. {fabStr}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--danger)', whiteSpace: 'nowrap' }}>DLC {dlcStr}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            {/* DLC DU JOUR */}
            {dlcItems.filter(i => i.dlcStatus === 'today').length > 0 && (
              <div>
                <p className="section-label" style={{ color: 'var(--warning)', marginBottom: 5 }}>
                  DLC du jour ({dlcItems.filter(i => i.dlcStatus === 'today').length})
                </p>
                <div style={{ borderRadius: 10, overflow: 'hidden', background: 'rgba(180,83,9,0.05)' }}>
                  {dlcItems.filter(i => i.dlcStatus === 'today').map((item, idx) => {
                    const dlcStr = item.dlcAt?.toDate ? item.dlcAt.toDate().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '—'
                    const fabStr = item.fabricationAt?.toDate ? item.fabricationAt.toDate().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '—'
                    return (
                      <div key={item.id} style={{
                        display: 'grid', gridTemplateColumns: '1fr auto auto',
                        gap: 6, padding: '7px 10px', fontSize: 12, alignItems: 'center',
                        background: idx % 2 === 0 ? 'rgba(180,83,9,0.06)' : 'rgba(180,83,9,0.03)',
                        borderBottom: idx < dlcItems.filter(i => i.dlcStatus === 'today').length - 1 ? '1px solid rgba(180,83,9,0.08)' : 'none',
                      }}>
                        <span style={{ fontWeight: 600, color: 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.productName}</span>
                        <span style={{ fontSize: 10, color: 'var(--on-surface-3)', whiteSpace: 'nowrap' }}>Fab. {fabStr}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--warning)', whiteSpace: 'nowrap' }}>DLC {dlcStr}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            {dlcItems.filter(i => i.dlcStatus === 'tomorrow').length > 0 && (
              <p style={{ fontSize: 11, color: 'var(--on-surface-3)', margin: 0 }}>
                + {dlcItems.filter(i => i.dlcStatus === 'tomorrow').length} produit(s) expirent demain
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Livraisons en attente ────────────────────────────────── */}
      <div className="card" style={{ cursor: 'pointer' }} onClick={() => navigate('livraison')}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <p className="section-label" style={{ marginBottom: 2 }}>Cuisine → Corner</p>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--on-surface)', margin: 0, fontFamily: 'Epilogue, sans-serif' }}>
              Livraisons
            </h2>
          </div>
          {pendingLivraisons.length === 0
            ? <span className="chip-ok">Tout reçu</span>
            : <span className="chip-warn">{pendingLivraisons.length} en attente</span>}
        </div>
        {pendingLivraisons.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: 0 }}>
            Toutes les livraisons du jour ont été réceptionnées.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {pendingLivraisons.slice(0, 5).map(l => {
              const timeStr = l.departAt?.toDate
                ? l.departAt.toDate().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                : '—'
              return (
                <div key={l.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  borderRadius: 8, padding: '8px 12px',
                  background: 'rgba(0,66,117,0.06)',
                }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--on-surface)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8 }}>
                    {l.productName || 'Livraison'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--on-surface-2)', flexShrink: 0 }}>Départ {timeStr}</span>
                </div>
              )
            })}
            {pendingLivraisons.length > 5 && (
              <p style={{ fontSize: 12, color: 'var(--on-surface-3)', textAlign: 'center', margin: '4px 0 0' }}>
                +{pendingLivraisons.length - 5} autres
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Hygiène + Commandes (grille 2 col) ──────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="card" style={{ cursor: 'pointer' }} onClick={() => navigate('hygiene')}>
          <div style={{ fontSize: 22, marginBottom: 8 }}>🧼</div>
          <p className="section-label" style={{ marginBottom: 6 }}>Hygiène</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {[
              { label: 'Quotidien', ok: hygieneOk },
              { label: 'Hebdo',     ok: hygieneHebdoOk },
              { label: 'Mensuel',   ok: hygieneMensuelOk },
            ].map(({ label, ok }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--on-surface-2)' }}>{label}</span>
                {ok === null
                  ? <span style={{ fontSize: 10, color: 'var(--on-surface-3)' }}>—</span>
                  : ok
                    ? <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--success)' }}>✓ Fait</span>
                    : <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--danger)' }}>⚠ À faire</span>
                }
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ cursor: 'pointer' }} onClick={() => navigate('commandes')}>
          <div style={{ fontSize: 22, marginBottom: 8 }}>📬</div>
          <p className="section-label" style={{ marginBottom: 6 }}>Commandes</p>
          {commandesToday.length > 0 ? (
            <span className="chip-warn">{commandesToday.length} aujourd'hui</span>
          ) : commandesWeek.length > 0 ? (
            <span style={{ fontSize: 12, color: 'var(--warning)', fontWeight: 700 }}>
              {commandesWeek.length} cette semaine
            </span>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--on-surface-3)' }}>Aucune cette semaine</span>
          )}
        </div>
      </div>

      {/* ── TooGoodToGo ─────────────────────────────────────────── */}
      <button
        onClick={() => {
          window.location.href = 'toogoodtogo://fr-fr'
          const fallback = setTimeout(() => {
            if (!document.hidden) {
              window.open('https://www.toogoodtogo.com/fr-fr', '_blank')
            }
          }, 1500)
          const onHide = () => {
            clearTimeout(fallback)
            document.removeEventListener('visibilitychange', onHide)
          }
          document.addEventListener('visibilitychange', onHide)
        }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
          width: '100%', padding: '14px 16px',
          background: 'linear-gradient(135deg, #1DB954 0%, #158A3E 100%)',
          border: 'none', borderRadius: 16,
          cursor: 'pointer', transition: 'opacity 0.15s ease',
          WebkitTapHighlightColor: 'transparent',
        }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.88'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
      >
        <span style={{ fontSize: 22 }}>🥡</span>
        <div style={{ textAlign: 'left', flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', letterSpacing: '-0.01em' }}>TooGoodToGo</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>Ouvrir l'application</div>
        </div>
        <svg style={{ flexShrink: 0 }} width="16" height="16" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </button>
    </div>
  )
}
