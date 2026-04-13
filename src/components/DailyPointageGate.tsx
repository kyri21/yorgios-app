import { useState, useEffect } from 'react'
import { getDocs, query, where, collection } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { signOut } from 'firebase/auth'
import { db, functions, auth } from '../firebase/config'
import { useAuth } from '../auth/useAuth'
import { POINTAGE_ZONES } from '../config/pointageZones'

function gateKey(uid: string) { return `pointageGateDate_${uid}` }

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}
function formatTime(ts: any): string {
  if (!ts?.toDate) return '—'
  return ts.toDate().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function isInAnyZone(lat: number, lng: number, accuracy: number): boolean {
  return POINTAGE_ZONES.some(z => haversineMeters(lat, lng, z.lat, z.lng) - accuracy <= z.radiusMeters)
}

/** Vérifie si la gate doit s'afficher aujourd'hui */
export function shouldShowGate(role: string, uid: string): boolean {
  // patron, administrateur, chef → jamais de gate (pas de géoloc requise)
  if (role === 'patron' || role === 'administrateur' || role === 'chef') return false
  return localStorage.getItem(gateKey(uid)) !== todayStr()
}

export function dismissGate(uid: string) {
  localStorage.setItem(gateKey(uid), todayStr())
}

interface Props { onDismiss: () => void }

export default function DailyPointageGate({ onDismiss }: Props) {
  const { user } = useAuth()
  const [status, setStatus] = useState<'checking' | 'idle' | 'loading' | 'success' | 'error' | 'already' | 'verifying'>('checking')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [arriveeTime, setArriveeTime] = useState<string | null>(null)

  // corner et cuisine doivent re-vérifier la géoloc même s'ils ont déjà pointé
  const needsGeoCheck = user?.role === 'corner' || user?.role === 'cuisine'

  useEffect(() => {
    if (!user?.uid) return
    const q = query(
      collection(db, 'pointages'),
      where('userId', '==', user.uid),
      where('date', '==', todayStr()),
      where('typePointage', '==', 'arrivée'),
      where('statut', '==', 'validé'),
    )
    // Timeout de sécurité : si Firestore met plus de 6s, on passe en idle
    const timeout = setTimeout(() => setStatus('idle'), 6000)
    getDocs(q).then(snap => {
      clearTimeout(timeout)
      if (!snap.empty) {
        setArriveeTime(formatTime(snap.docs[0].data().timestamp))
        setStatus('already')
      } else {
        setStatus('idle')
      }
    }).catch(() => { clearTimeout(timeout); setStatus('idle') })
  }, [user?.uid])

  function dismiss() { dismissGate(user!.uid); onDismiss() }

  // Re-vérification géoloc pour corner/cuisine déjà pointés
  function verifyLocation() {
    setStatus('verifying')
    setErrorMsg(null)
    if (!navigator.geolocation) {
      setErrorMsg('Géolocalisation non disponible sur cet appareil.')
      setStatus('already')
      return
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (isInAnyZone(coords.latitude, coords.longitude, coords.accuracy)) {
          dismiss()
        } else {
          setErrorMsg("Vous devez être sur le lieu de travail pour accéder à l'application.")
          setStatus('already')
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setErrorMsg("Localisation refusée. Activez-la dans Réglages → Safari → Localisation.")
        } else {
          setErrorMsg("Impossible d'obtenir votre position. Vérifiez que la localisation est activée.")
        }
        setStatus('already')
      },
      { enableHighAccuracy: false, timeout: 30000, maximumAge: 60000 },
    )
  }

  async function handlePointage() {
    setStatus('loading')
    setErrorMsg(null)

    if (!navigator.geolocation) {
      setErrorMsg('Géolocalisation non disponible sur cet appareil.')
      setStatus('error')
      return
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude, accuracy } = position.coords
        try {
          const createPointageFn = httpsCallable(functions, 'createPointage')
          await createPointageFn({ latitude, longitude, accuracy, typePointage: 'arrivée' })
          setStatus('success')
          setTimeout(() => dismiss(), 2200)
        } catch (e: any) {
          const msg: string = e?.message || "Accès refusé : vous devez être sur site pour accéder à l'application."
          setErrorMsg(msg)
          setStatus('error')
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setErrorMsg("Localisation refusée. Activez-la dans Réglages → Safari → Localisation, puis réessayez.")
        } else if (err.code === err.TIMEOUT) {
          setErrorMsg("Délai dépassé. Vérifiez que la localisation est activée dans les Réglages iOS.")
        } else {
          setErrorMsg("Position indisponible. Vérifiez que la localisation est activée dans Réglages → Confidentialité → Service de localisation.")
        }
        setStatus('error')
      },
      { enableHighAccuracy: false, timeout: 30000, maximumAge: 60000 },
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

        {(status === 'already' || status === 'verifying') && (
          <>
            <div style={{ fontSize: 44, marginBottom: 10 }}>✅</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--on-surface)', marginBottom: 6, fontFamily: 'Epilogue, sans-serif' }}>
              Arrivée déjà pointée
            </div>
            <div style={{ fontSize: 14, color: 'var(--on-surface-3)', marginBottom: 20, fontFamily: 'Manrope, sans-serif' }}>
              Aujourd'hui à {arriveeTime}
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
            {status === 'verifying' ? (
              <>
                <div className="spinner" style={{ margin: '0 auto 10px' }} />
                <div style={{ fontSize: 13, color: 'var(--on-surface-3)', fontFamily: 'Manrope, sans-serif' }}>Vérification de la position…</div>
              </>
            ) : needsGeoCheck ? (
              <button className="btn-primary" onClick={verifyLocation} style={{ fontSize: 15, padding: '14px 0' }}>
                Confirmer ma présence
              </button>
            ) : (
              <button className="btn-primary" onClick={dismiss}>Accéder à l'app</button>
            )}
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

            {/* Manager : peut bypasser la gate (pas de zone imposée) */}
            {user?.role === 'manager' && (
              <button
                onClick={dismiss}
                style={{
                  marginTop: 8, fontSize: 13, color: 'var(--on-surface-3)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  width: '100%', textAlign: 'center', padding: '8px 0',
                  fontFamily: 'Manrope, sans-serif',
                }}
              >
                Je ne suis pas sur zone
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

      {/* Bouton de déconnexion en bas */}
      <button
        onClick={() => signOut(auth)}
        style={{
          marginTop: 24, background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 13, color: 'var(--on-surface-3)', fontFamily: 'Manrope, sans-serif',
          textDecoration: 'underline', padding: 8, minHeight: 44,
        }}
      >
        Se déconnecter
      </button>
    </div>
  )
}
