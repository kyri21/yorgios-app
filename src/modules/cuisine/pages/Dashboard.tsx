import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, getDoc, doc, query, where, orderBy, limit } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { SkeletonList } from '../../../components/Skeleton'
import { EmptyState } from '../../../components/EmptyState'

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

  useEffect(() => {
    async function load() {
      const today = todayISO()
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
      } finally {
        setLoading(false)
      }
    }
    load()
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

      {/* ── Températures frigos ─────────────────────────────────────── */}
      <div className="card" style={{ cursor: 'pointer' }} onClick={() => navigate('temperatures')}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <p className="section-label" style={{ marginBottom: 2 }}>Frigos</p>
            <h2 style={{
              fontFamily: 'Epilogue, sans-serif',
              fontSize: 15, fontWeight: 700,
              color: 'var(--on-surface)', margin: 0, letterSpacing: '-0.02em',
            }}>
              Températures
            </h2>
          </div>
          {!matinSaisis
            ? <span className="chip-warn">Non saisis</span>
            : tempAlerts > 0
              ? <span className="chip-danger">{tempAlerts} alerte{tempAlerts > 1 ? 's' : ''}</span>
              : <span className="chip-ok">Conforme</span>
          }
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
          {temps.map(t => {
            const isAlert = t.status === 'ALERTE'
            const isOk    = t.status === 'OK'
            return (
              <div key={t.id} style={{
                borderRadius: 10,
                padding: '8px 4px',
                textAlign: 'center',
                background: isAlert
                  ? 'rgba(136,0,20,0.08)'
                  : isOk
                    ? 'rgba(84,101,30,0.08)'
                    : 'var(--surface-mid)',
              }}>
                <div style={{
                  fontSize: 9, fontWeight: 700, color: 'var(--on-surface-3)',
                  marginBottom: 3, lineHeight: 1.2,
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>
                  {t.name}
                </div>
                <div style={{
                  fontSize: 16, fontWeight: 800, fontFamily: 'Epilogue, sans-serif',
                  color: isAlert ? 'var(--danger)' : isOk ? 'var(--success)' : 'var(--on-surface-2)',
                }}>
                  {t.tempC !== null ? `${t.tempC}°` : '—'}
                </div>
                {t.status && (
                  <div style={{
                    fontSize: 8, fontWeight: 700, marginTop: 2,
                    color: isAlert ? 'var(--danger)' : 'var(--success)',
                    textTransform: 'uppercase',
                  }}>
                    {t.status}
                  </div>
                )}
              </div>
            )
          })}
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
    </div>
  )
}
