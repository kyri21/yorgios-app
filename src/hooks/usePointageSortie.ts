import { useState, useEffect } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase/config'
import { useAuth } from '../auth/useAuth'

type Status = 'idle' | 'loading' | 'success' | 'error'

function todayStr() {
  return new Date().toLocaleDateString('fr-CA')
}

export function usePointageSortie() {
  const { user } = useAuth()
  const [canPointer, setCanPointer] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [blockedUntil, setBlockedUntil] = useState<Date | null>(null)  // null = pas bloqué

  useEffect(() => {
    if (!user?.uid) return
    const isManager = ['manager', 'patron', 'administrateur'].includes(user.role)
    if (isManager) return

    const q = query(
      collection(db, 'pointages'),
      where('userId', '==', user.uid),
      where('date', '==', todayStr()),
    )
    getDocs(q).then(snap => {
      const docs = snap.docs.map(d => d.data() as any)
      const arrivee = docs.find(d => d.typePointage === 'arrivée' && d.statut === 'validé')
      const hasDepart = docs.some(d => d.typePointage === 'départ' && d.statut === 'validé' && d.autoCheckout !== true)

      if (arrivee && !hasDepart) {
        setCanPointer(true)
        // Calculer le blocage 1h
        const arriveeMs = arrivee.timestamp?.toMillis?.() ?? (arrivee.timestamp?.seconds != null ? arrivee.timestamp.seconds * 1000 : 0)
        if (arriveeMs) {
          const unlockMs = arriveeMs + 60 * 60000
          if (Date.now() < unlockMs) {
            setBlockedUntil(new Date(unlockMs))
            // Rafraîchir quand le blocage expire
            const timeout = setTimeout(() => setBlockedUntil(null), unlockMs - Date.now())
            return () => clearTimeout(timeout)
          }
        }
      } else {
        setCanPointer(false)
      }
    }).catch(() => {})
  }, [user?.uid, user?.role])

  async function doPointageSortie(): Promise<'success' | 'error'> {
    setStatus('loading')
    setErrorMsg(null)

    if (!navigator.geolocation) {
      setErrorMsg('Géolocalisation non disponible.')
      setStatus('error')
      return 'error'
    }

    return new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude, accuracy } = position.coords
          try {
            const createPointage = httpsCallable(functions, 'createPointage')
            await createPointage({ latitude, longitude, accuracy, typePointage: 'départ' })
            setStatus('success')
            setCanPointer(false)
            setBlockedUntil(null)
            resolve('success')
          } catch (e: any) {
            const msg: string = e?.message || 'Erreur enregistrement.'
            // Extraire l'heure de déblocage si message BLOCKED_1H
            if (msg.includes('BLOCKED_1H:')) {
              const parts = msg.split(':')
              const timeStr = parts[1] + ':' + parts[2]  // ex: "09:30"
              setErrorMsg(`Sortie disponible à ${timeStr}`)
            } else {
              setErrorMsg(msg)
            }
            setStatus('error')
            resolve('error')
          }
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            setErrorMsg('Permission GPS refusée. Activez-la dans les réglages.')
          } else {
            setErrorMsg("Impossible d'obtenir votre position.")
          }
          setStatus('error')
          resolve('error')
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
      )
    })
  }

  return { canPointer, status, errorMsg, doPointageSortie, setStatus, blockedUntil }
}
