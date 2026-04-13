import { useEffect, useRef, useState } from 'react'
import { collection, onSnapshot, orderBy, query, Timestamp, updateDoc, doc, where } from 'firebase/firestore'
import { db } from '../firebase/config'

type Delivery = {
  id: string
  trackingUrl: string | null
  rawMessage: string
  phoneNumber: string
  eta: string | null
  status: 'in_progress' | 'completed'
  createdAt: Timestamp
  updatedAt: Timestamp
}

function pad2(n: number) { return String(n).padStart(2, '0') }
function formatTime(ts: Timestamp): string {
  const d = ts.toDate()
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
function formatFull(ts: Timestamp): string {
  const d = ts.toDate()
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export default function Livraisons() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [loading, setLoading] = useState(true)
  const [completing, setCompleting] = useState<string | null>(null)
  const prevIdsRef = useRef<Set<string>>(new Set())
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    const q = query(
      collection(db, 'deliveries'),
      where('status', '==', 'in_progress'),
      orderBy('createdAt', 'desc'),
    )
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Delivery[]

      // Son pour les nouveaux docs
      const currentIds = new Set(list.map(d => d.id))
      const isFirstLoad = prevIdsRef.current.size === 0
      if (!isFirstLoad) {
        const hasNew = list.some(d => !prevIdsRef.current.has(d.id))
        if (hasNew) playDing()
      }
      prevIdsRef.current = currentIds

      setDeliveries(list)
      setLoading(false)
    })
    return () => unsub()
  }, [])

  // WakeLock pour l'iPad
  useEffect(() => {
    let lock: any = null
    if ('wakeLock' in navigator) {
      ;(navigator as any).wakeLock.request('screen')
        .then((l: any) => { lock = l })
        .catch(() => {})
    }
    return () => { lock?.release?.() }
  }, [])

  function playDing() {
    try {
      if (!audioRef.current) {
        audioRef.current = new Audio('/sounds/ding.mp3')
      }
      audioRef.current.currentTime = 0
      audioRef.current.play().catch(() => {})
    } catch {}
  }

  async function complete(id: string) {
    setCompleting(id)
    try {
      await updateDoc(doc(db, 'deliveries', id), {
        status: 'completed',
        updatedAt: Timestamp.now(),
      })
    } catch {
      // ignore
    } finally {
      setCompleting(null)
    }
  }

  return (
    <div className="page">
      {/* Header */}
      <div style={{ marginBottom: 4 }}>
        <p className="section-label" style={{ marginBottom: 4 }}>Suivi temps réel</p>
        <h1 style={{
          fontFamily: 'Epilogue, sans-serif',
          fontSize: 26, fontWeight: 800,
          color: 'var(--on-surface)',
          letterSpacing: '-0.03em',
          margin: '0 0 4px',
        }}>
          Livraisons
        </h1>
        <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: 0 }}>
          Coursier en route — mis à jour en temps réel
        </p>
      </div>

      {/* Contenu */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1, 2].map(i => (
            <div key={i} className="skeleton" style={{ height: 140, borderRadius: 16 }} />
          ))}
        </div>
      ) : deliveries.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 0',
          color: 'var(--on-surface-3)',
        }}>
          <p style={{ fontSize: 48, margin: '0 0 16px' }}>🚚</p>
          <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--on-surface)', margin: '0 0 6px', fontFamily: 'Epilogue, sans-serif' }}>
            Aucune livraison en cours
          </p>
          <p style={{ fontSize: 13, margin: 0 }}>
            Vous serez notifié dès qu'un coursier est en route.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {deliveries.map(d => (
            <div
              key={d.id}
              className="card"
              style={{
                padding: '18px 16px',
                outline: '2px solid rgba(0,66,117,0.12)',
              }}
            >
              {/* Badge + heure */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span className="chip-warn" style={{ fontSize: 12 }}>
                  🚚 En cours
                </span>
                <span style={{ fontSize: 12, color: 'var(--on-surface-3)' }}>
                  Reçu à {formatTime(d.createdAt)}
                </span>
              </div>

              {/* ETA proéminent */}
              {d.eta && (
                <div style={{ marginBottom: 12 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 2 }}>
                    Heure d'arrivée estimée
                  </span>
                  <span style={{
                    fontFamily: 'Epilogue, sans-serif',
                    fontSize: 40, fontWeight: 800,
                    color: 'var(--primary)', lineHeight: 1,
                  }}>
                    {d.eta}
                  </span>
                </div>
              )}

              {/* Infos secondaires */}
              <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginBottom: 14 }}>
                {d.phoneNumber && <span>{d.phoneNumber} · </span>}
                {formatFull(d.updatedAt) !== formatFull(d.createdAt) && (
                  <span>màj {formatFull(d.updatedAt)}</span>
                )}
              </div>

              {/* Boutons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {d.trackingUrl && (
                  <a
                    href={d.trackingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-primary"
                    style={{
                      textDecoration: 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      gap: 8, minHeight: 44, borderRadius: 12,
                      fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 700,
                    }}
                  >
                    🗺 Suivre le coursier →
                  </a>
                )}
                <button
                  onClick={() => complete(d.id)}
                  disabled={completing === d.id}
                  className="btn-secondary"
                  style={{ minHeight: 44, borderRadius: 12 }}
                >
                  {completing === d.id ? 'Mise à jour…' : '✓ Livraison terminée'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
