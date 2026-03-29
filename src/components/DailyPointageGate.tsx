import { useState, useEffect } from 'react'
import { Timestamp, addDoc, collection, getDocs, query, where } from 'firebase/firestore'
import { db, auth } from '../firebase/config'
import { useAuth } from '../auth/useAuth'
import { haversineDistance } from '../utils/geo'
import { POINTAGE_ZONES, GPS_ACCURACY_LIMIT } from '../config/pointageZones'

const GATE_KEY = 'pointageGateDate'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}
function formatTime(ts: any): string {
  if (!ts?.toDate) return '—'
  return ts.toDate().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

/** Vérifie si la gate doit s'afficher aujourd'hui */
export function shouldShowGate(role: string): boolean {
  if (role === 'manager') return false
  return localStorage.getItem(GATE_KEY) !== todayStr()
}

export function dismissGate() {
  localStorage.setItem(GATE_KEY, todayStr())
}

interface Props { onDismiss: () => void }

export default function DailyPointageGate({ onDismiss }: Props) {
  const { user } = useAuth()
  const [status, setStatus] = useState<'checking' | 'idle' | 'loading' | 'success' | 'error' | 'already'>('checking')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [arriveeTime, setArriveeTime] = useState<string | null>(null)
  const [showSkip, setShowSkip] = useState(false)

  useEffect(() => {
    if (!user?.uid) return
    const q = query(
      collection(db, 'pointages'),
      where('userId', '==', user.uid),
      where('date', '==', todayStr()),
      where('typePointage', '==', 'arrivée'),
      where('statut', '==', 'validé'),
    )
    getDocs(q).then(snap => {
      if (!snap.empty) {
        setArriveeTime(formatTime(snap.docs[0].data().timestamp))
        setStatus('already')
      } else {
        setStatus('idle')
        setTimeout(() => setShowSkip(true), 10000)
      }
    })
  }, [user?.uid])

  function dismiss() { dismissGate(); onDismiss() }

  async function handlePointage() {
    setStatus('loading')
    setErrorMsg(null)
    if (!navigator.geolocation) {
      setErrorMsg('Géolocalisation non disponible sur cet appareil.')
      setStatus('error'); setShowSkip(true); return
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude, accuracy } = pos.coords
        if (accuracy > GPS_ACCURACY_LIMIT) {
          setErrorMsg(`Signal GPS trop imprécis (±${Math.round(accuracy)} m). Approchez-vous d'une fenêtre.`)
          setStatus('error'); setShowSkip(true); return
        }
        let detectedZone = null
        let minDistance = Infinity
        for (const zone of POINTAGE_ZONES) {
          const dist = Math.round(haversineDistance(latitude, longitude, zone.lat, zone.lng))
          if (dist < minDistance) minDistance = dist
          if (dist <= zone.radiusMeters) { detectedZone = { zone, dist }; break }
        }
        const statut: 'validé' | 'refusé' = detectedZone ? 'validé' : 'refusé'
        await addDoc(collection(db, 'pointages'), {
          userId: auth.currentUser?.uid ?? '',
          userName: user?.displayName || user?.email?.split('@')[0] || 'Inconnu',
          date: todayStr(),
          typePointage: 'arrivée',
          zoneId: detectedZone?.zone.id ?? 'hors_zone',
          zoneLabel: detectedZone?.zone.label ?? 'Hors zone',
          timestamp: Timestamp.now(),
          latitude, longitude,
          accuracy: Math.round(accuracy),
          distanceToZone: detectedZone?.dist ?? minDistance,
          statut,
          deviceInfo: navigator.userAgent,
        })
        if (statut === 'validé') {
          setStatus('success')
          setTimeout(() => dismiss(), 2200)
        } else {
          const info = POINTAGE_ZONES.map(z =>
            `${z.label} (${Math.round(haversineDistance(latitude, longitude, z.lat, z.lng))} m)`
          ).join(' — ')
          setErrorMsg(`Hors zone autorisée. ${info}.`)
          setStatus('error'); setShowSkip(true)
        }
      },
      (err) => {
        setErrorMsg(err.code === err.PERMISSION_DENIED
          ? 'Permission refusée. Activez la géolocalisation dans les réglages.'
          : "Impossible d'obtenir votre position. Réessayez.")
        setStatus('error'); setShowSkip(true)
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    )
  }

  const initials = (user?.displayName || user?.email || '?')
    .split(/[\s@]/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('')
  const prenom = user?.displayName?.split(' ')[0] ?? user?.email?.split('@')[0] ?? ''

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'var(--surface-low)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '24px 20px',
    }}>
      {/* Logo top */}
      <div style={{ marginBottom: 48, textAlign: 'center' }}>
        <div style={{
          width: 56, height: 56, borderRadius: 16,
          background: 'var(--primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, fontWeight: 800, color: '#fff', margin: '0 auto 10px',
        }}>Y</div>
        <div style={{
          fontSize: 18, fontWeight: 700, color: 'var(--on-surface)',
          letterSpacing: '-0.02em', fontFamily: 'Epilogue, sans-serif',
        }}>Matias</div>
      </div>

      {/* Card */}
      <div style={{
        width: '100%', maxWidth: 340,
        background: 'var(--surface)', borderRadius: 20,
        padding: 28, textAlign: 'center',
        boxShadow: '0 8px 40px rgba(0,0,0,0.10)',
      }}>

        {status === 'checking' && (
          <div className="spinner" style={{ margin: '24px auto' }} />
        )}

        {status === 'already' && (
          <>
            <div style={{ fontSize: 44, marginBottom: 10 }}>✅</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--on-surface)', marginBottom: 6, fontFamily: 'Epilogue, sans-serif' }}>
              Arrivée déjà pointée
            </div>
            <div style={{ fontSize: 14, color: 'var(--on-surface-3)', marginBottom: 28, fontFamily: 'Manrope, sans-serif' }}>
              Aujourd'hui à {arriveeTime}
            </div>
            <button className="btn-primary" onClick={dismiss}>Accéder à l'app</button>
          </>
        )}

        {(status === 'idle' || status === 'error') && (
          <>
            <div style={{
              width: 52, height: 52, borderRadius: 14, background: 'var(--primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, fontWeight: 800, color: '#fff', margin: '0 auto 14px',
            }}>{initials}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--on-surface)', marginBottom: 4, fontFamily: 'Epilogue, sans-serif' }}>
              Bonjour {prenom} !
            </div>
            <div style={{ fontSize: 13, color: 'var(--on-surface-3)', marginBottom: 28, fontFamily: 'Manrope, sans-serif' }}>
              {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>

            {errorMsg && (
              <div style={{
                background: 'rgba(136,0,20,0.08)', border: '1px solid rgba(136,0,20,0.2)',
                borderRadius: 12, padding: '11px 14px',
                fontSize: 13, color: 'var(--danger)', textAlign: 'left', marginBottom: 16,
                fontFamily: 'Manrope, sans-serif',
              }}>
                {errorMsg}
              </div>
            )}

            <button className="btn-primary" onClick={handlePointage}
              style={{ fontSize: 15, padding: '14px 0' }}>
              Pointer mon arrivée
            </button>

            {showSkip && (
              <button onClick={dismiss} style={{
                marginTop: 16, background: 'none', border: 'none',
                color: 'var(--on-surface-3)', fontSize: 13,
                cursor: 'pointer', textDecoration: 'underline',
                fontFamily: 'Manrope, sans-serif',
              }}>
                Passer (je ne suis pas sur site)
              </button>
            )}
          </>
        )}

        {status === 'loading' && (
          <>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />
            <div style={{ fontSize: 14, color: 'var(--on-surface-3)', fontFamily: 'Manrope, sans-serif' }}>
              Localisation en cours…
            </div>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{ fontSize: 44, marginBottom: 10 }}>✅</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--success)', marginBottom: 6, fontFamily: 'Epilogue, sans-serif' }}>
              Arrivée validée !
            </div>
            <div style={{ fontSize: 14, color: 'var(--on-surface-3)', fontFamily: 'Manrope, sans-serif' }}>Bonne journée !</div>
          </>
        )}
      </div>
    </div>
  )
}
