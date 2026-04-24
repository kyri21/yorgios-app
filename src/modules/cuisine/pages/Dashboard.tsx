import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, getDocsFromServer, getDoc, doc, query, where, orderBy, limit, onSnapshot, Timestamp } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { SkeletonList } from '../../../components/Skeleton'
import { EmptyState } from '../../../components/EmptyState'
import { DEFAULT_PRIORITY_LEVELS, type PriorityLevel } from '../../../pages/AdminSettings'

function endOfWeekISO() {
  const d = new Date()
  const dow = d.getDay() === 0 ? 6 : d.getDay() - 1
  d.setDate(d.getDate() + (6 - dow))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// ── Météo ────────────────────────────────────────────────────────
function wmoToEmoji(code: number): { emoji: string } {
  if (code === 0) return { emoji: '☀️' }
  if (code <= 2) return { emoji: '🌤️' }
  if (code === 3) return { emoji: '☁️' }
  if (code <= 48) return { emoji: '🌫️' }
  if (code <= 57) return { emoji: '🌦️' }
  if (code <= 67) return { emoji: '🌧️' }
  if (code <= 77) return { emoji: '🌨️' }
  if (code <= 82) return { emoji: '🌧️' }
  if (code <= 99) return { emoji: '⛈️' }
  return { emoji: '🌡️' }
}

type WeatherDay = { date: string; dayLabel: string; maxC: number; minC: number; code: number; isToday: boolean }
const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

function getWeekDays(): string[] {
  const today = new Date()
  const dow = today.getDay() === 0 ? 6 : today.getDay() - 1
  const monday = new Date(today)
  monday.setDate(today.getDate() - dow)
  const days: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const p = (n: number) => String(n).padStart(2, '0')
    days.push(`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`)
  }
  return days
}

const CUISINE_FRIDGES = [
  { id: 'CUI_FRIGO1_ENTREE',     name: 'Frigo 1' },
  { id: 'CUI_GRAND_FRIGO_INOX',  name: 'GF Inox' },
  { id: 'CUI_GRAND_FRIGO_VERRE', name: 'GF Verre' },
  { id: 'CUI_FRIGO2_MILIEU',     name: 'Frigo 2' },
  { id: 'CUI_FRIGO_FOUR',        name: 'Frigo four' },
]

function todayISO() {
  const d = new Date(); const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function firstDayOfMonthISO() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-01`
}

function lastDayOfMonthISO() {
  const d = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function timeAgo(ts: any): string {
  if (!ts?.toDate) return ''
  const diff = Math.floor((Date.now() - ts.toDate().getTime()) / 60000)
  if (diff < 1) return 'à l\'instant'
  if (diff < 60) return `il y a ${diff} min`
  const h = Math.floor(diff / 60); return `il y a ${h}h`
}

type TempInfo = { id: string; name: string; tempC: number | null; status: string | null }
type LotInfo  = { id: string; productName: string; quantite: number; unite: string; fabricatedAt: any; lotCode?: string }
type ReceptionInfo = { id: string; productName: string; fournisseur: string; createdAt: any; tempC?: number }
type RuptureActive = { id: string; ruptures: string[]; presqueRuptures: string[]; personne: string; createdAt: any; viewed: boolean }
type CommandeClient = { id: string; statut: string; dateLivraison: string; nom?: string; prenom?: string }

function dotColor(s: string): string {
  if (s === 'ok')   return 'var(--success)'
  if (s === 'ko')   return 'var(--danger)'
  if (s === 'warn') return 'var(--warning)'
  if (s === 'info') return 'var(--primary)'
  return 'var(--on-surface-3)'
}

function statusLabel(s: string): string {
  if (s === 'ok')   return 'OK'
  if (s === 'ko')   return 'À faire'
  if (s === 'warn') return 'Attention'
  if (s === 'info') return 'Plus tard'
  return '—'
}

export default function CuisineDashboard() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [temps, setTemps] = useState<TempInfo[]>([])
  const [lotsEnCours, setLotsEnCours] = useState<LotInfo[]>([])
  const [derniereReception, setDerniereReception] = useState<ReceptionInfo | null>(null)
  const [livraisonsEnAttente, setLivraisonsEnAttente] = useState(0)
  const [matinSaisis, setMatinSaisis] = useState(false)
  const [rupturesActives, setRupturesActives] = useState<RuptureActive[]>([])
  const [commandesToday, setCommandesToday] = useState<CommandeClient[]>([])
  const [commandesWeek, setCommandesWeek] = useState<CommandeClient[]>([])
  const [commandesMois, setCommandesMois] = useState<CommandeClient[]>([])
  const [weather, setWeather] = useState<WeatherDay[]>([])
  const [cataloguePriorityMap, setCataloguePriorityMap] = useState<Record<string, number>>({})
  const [priorityLevels, setPriorityLevels] = useState<PriorityLevel[]>(DEFAULT_PRIORITY_LEVELS)

  useEffect(() => {
    async function load() {
      const today = todayISO()
      const endWeek = endOfWeekISO()
      try {
        const [tempsData, lotsSnap, recepSnap, livrSnap] = await Promise.all([
          Promise.all(CUISINE_FRIDGES.map(async f => {
            const snap = await getDoc(doc(db, 'temperatures', `${today}_${f.id}_matin`))
            if (!snap.exists()) return { id: f.id, name: f.name, tempC: null, status: null }
            const d = snap.data() as any
            return { id: f.id, name: f.name, tempC: d.tempC ?? null, status: d.status ?? null }
          })),
          getDocs(query(
            collection(db, 'lots_cuisine'),
            where('archived', '==', false),
            orderBy('fabricatedAt', 'desc'),
            limit(10),
          )),
          getDocs(query(
            collection(db, 'receptions'),
            orderBy('createdAt', 'desc'),
            limit(1),
          )),
          getDocs(query(
            collection(db, 'livraisons'),
            where('receptionTempC', '==', null),
            orderBy('departAt', 'desc'),
            limit(20),
          )),
        ])

        setTemps(tempsData)
        setMatinSaisis(tempsData.some(t => t.tempC !== null))
        setLotsEnCours(lotsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
        setDerniereReception(recepSnap.empty ? null : { id: recepSnap.docs[0].id, ...(recepSnap.docs[0].data() as any) })

        // Livraisons d'aujourd'hui sans réception
        const todayStart = new Date(); todayStart.setHours(0,0,0,0)
        const pending = livrSnap.docs.filter(d => {
          const dep = (d.data() as any).departAt?.toDate?.()
          return dep && dep >= todayStart
        })
        setLivraisonsEnAttente(pending.length)
      } catch (e) {
        console.error(e)
      }

      // Commandes clients
      try {
        const [cmdSnap, moisSnap] = await Promise.all([
          getDocs(query(
            collection(db, 'commandes_externes'),
            where('dateLivraison', '>=', today),
            where('dateLivraison', '<=', endWeek),
            orderBy('dateLivraison', 'asc'),
          )),
          getDocs(query(
            collection(db, 'commandes_externes'),
            where('dateLivraison', '>=', firstDayOfMonthISO()),
            where('dateLivraison', '<=', lastDayOfMonthISO()),
            orderBy('dateLivraison', 'asc'),
          )),
        ])
        const STATUTS_ACTIFS = ['en cours', 'devis envoyé', 'accepté']
        const allCmds: CommandeClient[] = cmdSnap.docs
          .map(d => ({ id: d.id, ...(d.data() as any) }))
          .filter(c => STATUTS_ACTIFS.includes((c.statut ?? '').toLowerCase()))
        setCommandesToday(allCmds.filter(c => c.dateLivraison === today))
        setCommandesWeek(allCmds.filter(c => c.dateLivraison > today))
        setCommandesMois(moisSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
      } catch (e) {
        console.error('[dashboard cuisine] commandes:', e)
      }

      // Catalogue priorities + priority levels — chargés au mount, avant l'arrivée des ruptures
      try {
        const [catSnap, plSnap] = await Promise.all([
          getDocsFromServer(collection(db, 'catalogue')),
          getDoc(doc(db, 'settings', 'priority_levels')),
        ])
        const map: Record<string, number> = {}
        catSnap.docs.forEach(d => {
          const data = d.data() as any
          if (data.name && data.priority != null) {
            map[(data.name as string).toLowerCase().trim()] = Number(data.priority)
          }
        })
        setCataloguePriorityMap(map)
        if (plSnap.exists()) {
          const lvls = (plSnap.data() as any).levels
          if (Array.isArray(lvls) && lvls.length > 0) setPriorityLevels(lvls)
        }
      } catch (e) {
        console.error('[dashboard] loadPriorities:', e)
      }

      setLoading(false)
    }
    load()
  }, [])

  // Ruptures actives corner — temps réel
  // Fenêtre : reset à midi chaque jour. Lundi avant midi → depuis samedi 13h (week-end entier cumulé)
  useEffect(() => {
    const now2 = new Date()
    const dow  = now2.getDay() // 0=dim, 1=lun
    const hour = now2.getHours()
    const cutoffStart = new Date(now2)
    if (dow === 1 && hour < 12) {
      // Lundi avant midi → depuis samedi 13h (accumule tout le week-end)
      cutoffStart.setDate(now2.getDate() - 2)
      cutoffStart.setHours(13, 0, 0, 0)
    } else {
      // Autres jours : depuis le dernier midi (reset à 12h)
      cutoffStart.setHours(12, 0, 0, 0)
      if (now2 < cutoffStart) cutoffStart.setDate(cutoffStart.getDate() - 1)
    }
    const q = query(
      collection(db, 'ruptures_actives'),
      where('createdAt', '>=', Timestamp.fromDate(cutoffStart)),
      orderBy('createdAt', 'desc'),
      limit(20)
    )
    return onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as RuptureActive[]
      docs.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
      setRupturesActives(docs)
    }, err => console.error('[ruptures_actives]', err))
  }, [])

  // Météo semaine — Open-Meteo (gratuit, sans clé API)
  useEffect(() => {
    const weekDays = getWeekDays()
    const todayStr = todayISO()
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=48.857&longitude=2.347&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=Europe%2FParis&start_date=${weekDays[0]}&end_date=${weekDays[6]}`)
      .then(r => r.json())
      .then(data => {
        const dates: string[] = data.daily?.time ?? []
        const maxT: number[]  = data.daily?.temperature_2m_max ?? []
        const minT: number[]  = data.daily?.temperature_2m_min ?? []
        const codes: number[] = data.daily?.weathercode ?? []
        setWeather(dates.map((date, i) => ({
          date, dayLabel: DAY_LABELS[i] ?? date,
          maxC: Math.round(maxT[i] ?? 0), minC: Math.round(minT[i] ?? 0),
          code: codes[i] ?? 0, isToday: date === todayStr,
        })))
      })
      .catch(() => {})
  }, [])

  if (loading) return (
    <div className="page">
      <SkeletonList count={4} />
    </div>
  )

  const tempAlerts = temps.filter(t => t.status === 'ALERTE').length
  const now = new Date()
  const todayLabel = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  const heure = now.getHours()

  // Task items for "To Do Now" section
  const taskItems = [
    {
      label: 'Températures du matin',
      status: matinSaisis ? 'ok' : heure >= 6 ? 'ko' : 'info',
      nav: 'temperatures',
    },
    {
      label: tempAlerts > 0
        ? `Frigos en alerte (${tempAlerts})`
        : 'Contrôle températures frigos',
      status: tempAlerts > 0 ? 'ko' : matinSaisis ? 'ok' : 'info',
      nav: 'temperatures',
    },
    {
      label: lotsEnCours.length > 0
        ? `${lotsEnCours.length} lot(s) en fabrication`
        : 'Aucun lot en cours',
      status: lotsEnCours.length > 0 ? 'info' : 'ok',
      nav: 'fabrication',
    },
    {
      label: livraisonsEnAttente > 0
        ? `${livraisonsEnAttente} livraison(s) en attente`
        : 'Livraisons corner à jour',
      status: livraisonsEnAttente > 0 ? 'warn' : 'ok',
      nav: 'livraisons',
    },
  ]

  const hasKo = taskItems.some(i => i.status === 'ko')

  // Score: how many tasks are OK
  const okCount = taskItems.filter(i => i.status === 'ok').length
  const scorePercent = Math.round((okCount / taskItems.length) * 100)

  return (
    <div className="page">

      {/* ── Header — editorial cockpit style ─────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 4 }}>
        <div>
          <p className="section-label" style={{ marginBottom: 2 }}>Tableau de bord</p>
          <h1 style={{
            fontFamily: 'Epilogue, sans-serif',
            fontSize: 26, fontWeight: 800,
            color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0,
          }}>
            Cuisine
          </h1>
        </div>
        <span style={{ fontSize: 12, color: 'var(--on-surface-3)', paddingBottom: 2, textAlign: 'right' }}>
          {todayLabel}
        </span>
      </div>

      {/* ── Ruptures à commander (triées par priorité) ────────────── */}
      {rupturesActives.length > 0 && (() => {
        const dedup = (names: string[]) => {
          const seen = new Map<string, string>()
          for (const n of names) { const k = n.toLowerCase().trim(); if (!seen.has(k)) seen.set(k, n) }
          return [...seen.values()]
        }
        const allRuptures = dedup(rupturesActives.flatMap(r => r.ruptures ?? []))
        const allPresque  = dedup(rupturesActives.flatMap(r => r.presqueRuptures ?? []).filter(p => !allRuptures.some(r => r.toLowerCase().trim() === p.toLowerCase().trim())))
        if (allRuptures.length === 0 && allPresque.length === 0) return null
        const personnes  = [...new Set(rupturesActives.map(r => r.personne))].join(', ')
        const latestTime = rupturesActives[0]?.createdAt?.toDate
          ? rupturesActives[0].createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
        type RItem = { name: string; type: 'rupture' | 'presque'; priority: number | null }
        const items: RItem[] = [
          ...allRuptures.map(name => ({ name, type: 'rupture' as const, priority: cataloguePriorityMap[name.toLowerCase().trim()] ?? null })),
          ...allPresque.map(name =>  ({ name, type: 'presque' as const, priority: cataloguePriorityMap[name.toLowerCase().trim()] ?? null })),
        ]
        items.sort((a, b) => {
          if (a.priority === b.priority) return a.name.localeCompare(b.name, 'fr')
          if (a.priority === null) return 1
          if (b.priority === null) return -1
          return a.priority - b.priority
        })
        const grouped = new Map<number | null, RItem[]>()
        for (const item of items) {
          const key = item.priority
          if (!grouped.has(key)) grouped.set(key, [])
          grouped.get(key)!.push(item)
        }
        const sortedKeys = [...grouped.keys()].sort((a, b) => {
          if (a === null) return 1
          if (b === null) return -1
          return a - b
        })
        return (
          <div style={{ background: 'rgba(192,57,43,0.08)', border: '2px solid rgba(192,57,43,0.30)', borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>🔴</span>
                <div>
                  <p className="section-label" style={{ marginBottom: 1, color: 'var(--danger)' }}>
                    CORNER — {rupturesActives.length > 1 ? `${rupturesActives.length} DEMANDES` : 'RUPTURE SIGNALÉE'}
                  </p>
                  <h2 style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 14, fontWeight: 800, color: 'var(--danger)', margin: 0, letterSpacing: '-0.02em' }}>
                    À commander — par priorité
                  </h2>
                </div>
              </div>
              <span style={{ fontSize: 11, color: 'var(--on-surface-3)', textAlign: 'right' }}>{personnes}{latestTime ? `\n· ${latestTime}` : ''}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sortedKeys.map(key => {
                const lvl = key != null ? priorityLevels.find(l => l.level === key) : null
                const color = lvl?.color ?? 'var(--on-surface-3)'
                const levelName = lvl?.name ?? (key != null ? `Priorité ${key}` : 'Sans priorité')
                return (
                  <div key={String(key)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
                      <span style={{ fontSize: 10, fontWeight: 800, color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {levelName}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3, paddingLeft: 12 }}>
                      {grouped.get(key)!.map(item => (
                        <span key={item.name} style={{
                          fontSize: 11, fontWeight: 600, lineHeight: 1.3,
                          padding: '3px 7px', borderRadius: 6,
                          color: item.priority === null ? '#ca8a04' : item.type === 'rupture' ? 'var(--danger)' : 'var(--warning)',
                          background: item.priority === null ? 'rgba(202,138,4,0.10)' : item.type === 'rupture' ? 'rgba(192,57,43,0.10)' : 'rgba(180,83,9,0.10)',
                          border: `1px solid ${item.priority === null ? 'rgba(202,138,4,0.25)' : item.type === 'rupture' ? 'rgba(192,57,43,0.20)' : 'rgba(180,83,9,0.20)'}`,
                          wordBreak: 'break-word',
                        }}>{item.name}</span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* ── Météo de la semaine ─────────────────────────────────── */}
      {weather.length > 0 && (
        <div className="card" style={{ padding: '12px 14px' }}>
          <p className="section-label" style={{ marginBottom: 10 }}>Météo Paris — semaine</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {weather.map(day => {
              const { emoji } = wmoToEmoji(day.code)
              return (
                <div key={day.date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '8px 2px', borderRadius: 10, background: day.isToday ? 'rgba(0,66,117,0.08)' : 'var(--surface-low)', border: day.isToday ? '1.5px solid rgba(0,66,117,0.22)' : '1.5px solid transparent' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: day.isToday ? 'var(--primary)' : 'var(--on-surface-3)', textTransform: 'uppercase' }}>{day.dayLabel}</span>
                  <span style={{ fontSize: 18, lineHeight: 1.2 }}>{emoji}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface)' }}>{day.maxC}°</span>
                  <span style={{ fontSize: 10, color: 'var(--on-surface-3)' }}>{day.minC}°</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Score cockpit + statut global ───────────────────────────── */}
      <div
        className="card"
        style={{
          background: hasKo
            ? 'linear-gradient(135deg, rgba(136,0,20,0.06) 0%, var(--surface-low) 100%)'
            : 'linear-gradient(135deg, rgba(45,122,79,0.06) 0%, var(--surface-low) 100%)',
          display: 'flex', alignItems: 'center', gap: 18,
        }}
      >
        {/* Circular gauge */}
        <div style={{ position: 'relative', width: 72, height: 72, flexShrink: 0 }}>
          <svg width="72" height="72" viewBox="0 0 72 72">
            <circle
              cx="36" cy="36" r="28"
              fill="none"
              stroke="var(--surface-mid)"
              strokeWidth="6"
            />
            <circle
              cx="36" cy="36" r="28"
              fill="none"
              stroke={hasKo ? 'var(--danger)' : scorePercent === 100 ? 'var(--success)' : 'var(--warning)'}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 28}`}
              strokeDashoffset={`${2 * Math.PI * 28 * (1 - scorePercent / 100)}`}
              transform="rotate(-90 36 36)"
              style={{ transition: 'stroke-dashoffset 0.5s ease' }}
            />
          </svg>
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column',
          }}>
            <span style={{
              fontFamily: 'Epilogue, sans-serif',
              fontSize: 17, fontWeight: 800,
              color: hasKo ? 'var(--danger)' : 'var(--on-surface)',
              lineHeight: 1,
            }}>
              {scorePercent}%
            </span>
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <p style={{
            fontFamily: 'Epilogue, sans-serif',
            fontSize: 16, fontWeight: 700,
            color: 'var(--on-surface)', margin: '0 0 4px',
            letterSpacing: '-0.02em',
          }}>
            {hasKo ? 'Actions requises' : scorePercent === 100 ? 'Tout est bon' : 'En cours'}
          </p>
          <p style={{ fontSize: 12, color: 'var(--on-surface-2)', margin: 0 }}>
            {okCount}/{taskItems.length} points de contrôle validés
          </p>
          {hasKo && (
            <p style={{ fontSize: 11, color: 'var(--danger)', margin: '4px 0 0', fontWeight: 600 }}>
              {taskItems.filter(i => i.status === 'ko').length} point(s) requièrent une action
            </p>
          )}
        </div>
      </div>

      {/* ── À faire maintenant ──────────────────────────────────────── */}
      <div
        className="card"
        style={{
          background: hasKo ? 'rgba(136,0,20,0.04)' : 'var(--surface-low)',
          cursor: 'default',
          borderRadius: 16,
          padding: '14px 16px',
        }}
      >
        <p className="section-label" style={{ marginBottom: 10 }}>
          {hasKo ? '⚠ À faire maintenant' : '✓ Statut du jour'}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {taskItems.map(item => (
            <div
              key={item.label}
              onClick={() => item.nav && navigate(item.nav)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 10px', borderRadius: 10,
                cursor: item.nav ? 'pointer' : 'default',
                background: 'var(--surface)',
                transition: 'background 0.1s',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <div style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: dotColor(item.status),
              }} />
              <span style={{
                flex: 1, fontSize: 13, fontWeight: 500,
                color: 'var(--on-surface)',
              }}>
                {item.label}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: dotColor(item.status) }}>
                {statusLabel(item.status)}
              </span>
              {item.nav && (
                <svg width="6" height="10" fill="none" viewBox="0 0 6 10">
                  <path d="M1 1l4 4-4 4" stroke="var(--on-surface-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Lots en cours ────────────────────────────────────────────── */}
      <div className="card" style={{ cursor: 'pointer' }} onClick={() => navigate('fabrication')}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <p className="section-label" style={{ marginBottom: 2 }}>Fabrication</p>
            <h2 style={{
              fontFamily: 'Epilogue, sans-serif',
              fontSize: 15, fontWeight: 700,
              color: 'var(--on-surface)', margin: 0, letterSpacing: '-0.02em',
            }}>
              Lots en cours
            </h2>
          </div>
          <span style={{
            fontFamily: 'Epilogue, sans-serif',
            fontSize: 24, fontWeight: 800,
            color: lotsEnCours.length > 0 ? 'var(--primary)' : 'var(--on-surface-3)',
          }}>
            {lotsEnCours.length}
          </span>
        </div>
        {lotsEnCours.length === 0 ? (
          <EmptyState icon="📭" title="Aucun lot en cours" subtitle="Créez un lot dans Fabrication" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {lotsEnCours.slice(0, 5).map(lot => (
              <div key={lot.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                borderRadius: 10, padding: '10px 12px',
                background: 'var(--surface-low)',
              }}>
                <span style={{
                  fontSize: 13, fontWeight: 600, color: 'var(--on-surface)',
                  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8,
                }}>
                  {lot.productName}
                </span>
                <span style={{ fontSize: 12, color: 'var(--on-surface-3)', flexShrink: 0, fontWeight: 500 }}>
                  {lot.quantite} {lot.unite}
                </span>
              </div>
            ))}
            {lotsEnCours.length > 5 && (
              <p style={{ fontSize: 12, color: 'var(--on-surface-3)', textAlign: 'center', margin: '2px 0 0' }}>
                +{lotsEnCours.length - 5} autres lots
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Grille : Dernière réception + Livraisons ─────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

        <div className="card" style={{ cursor: 'pointer' }} onClick={() => navigate('reception')}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'rgba(0,66,117,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, marginBottom: 10,
          }}>🚚</div>
          <p className="section-label" style={{ margin: '0 0 4px' }}>Dernière</p>
          <div style={{
            fontSize: 14, fontWeight: 700, color: 'var(--on-surface)',
            marginBottom: 4, letterSpacing: '-0.01em',
          }}>
            Réception
          </div>
          {derniereReception ? (
            <>
              <div style={{
                fontSize: 12, fontWeight: 500, color: 'var(--on-surface-2)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {derniereReception.productName}
              </div>
              <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 3 }}>
                {timeAgo(derniereReception.createdAt)}
              </div>
            </>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--on-surface-3)' }}>Aucune aujourd'hui</span>
          )}
        </div>

        <div
          className="card"
          style={{ cursor: 'pointer' }}
          onClick={() => navigate('livraisons')}
        >
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: livraisonsEnAttente > 0 ? 'rgba(180,83,9,0.08)' : 'rgba(45,122,79,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, marginBottom: 10,
          }}>📤</div>
          <p className="section-label" style={{ margin: '0 0 4px' }}>Livraisons</p>
          <div style={{
            fontSize: 14, fontWeight: 700, color: 'var(--on-surface)',
            marginBottom: 6, letterSpacing: '-0.01em',
          }}>
            Corner
          </div>
          {livraisonsEnAttente > 0 ? (
            <span className="chip-warn">{livraisonsEnAttente} en attente</span>
          ) : (
            <span className="chip-ok">Tout réceptionné</span>
          )}
        </div>

      </div>

      {/* ── Commandes clients ──────────────────────────────────────── */}
      <div className="card" style={{ cursor: 'pointer' }} onClick={() => navigate('/corner/commandes')}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div>
            <p className="section-label" style={{ marginBottom: 2 }}>Commandes</p>
            <h2 style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 15, fontWeight: 700, color: 'var(--on-surface)', margin: 0, letterSpacing: '-0.02em' }}>
              Semaine &amp; mois
            </h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
            {commandesToday.length > 0
              ? <span className="chip-warn">{commandesToday.length} aujourd'hui</span>
              : commandesWeek.length > 0
                ? <span style={{ fontSize: 12, color: 'var(--warning)', fontWeight: 700 }}>{commandesWeek.length} à venir</span>
                : <span className="chip-ok">RAS</span>
            }
            {commandesMois.length > 0 && (
              <span style={{ fontSize: 11, color: 'var(--on-surface-3)' }}>{commandesMois.length} ce mois</span>
            )}
          </div>
        </div>
        {commandesToday.length === 0 && commandesWeek.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--on-surface-3)', margin: 0 }}>Aucune commande cette semaine.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[...commandesToday, ...commandesWeek].slice(0, 4).map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 8, padding: '6px 10px', fontSize: 12, background: commandesToday.find(x => x.id === c.id) ? 'rgba(180,83,9,0.06)' : 'var(--surface-low)' }}>
                <span style={{ fontWeight: 600, color: 'var(--on-surface)' }}>{c.prenom || ''} {c.nom || 'Client'}</span>
                <span style={{ color: 'var(--on-surface-3)' }}>
                  {c.dateLivraison ? new Date(c.dateLivraison + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) : '—'}
                </span>
              </div>
            ))}
            {commandesToday.length + commandesWeek.length > 4 && (
              <p style={{ fontSize: 11, color: 'var(--on-surface-3)', textAlign: 'center', margin: '2px 0 0' }}>
                +{commandesToday.length + commandesWeek.length - 4} autres
              </p>
            )}
          </div>
        )}
      </div>


    </div>
  )
}
