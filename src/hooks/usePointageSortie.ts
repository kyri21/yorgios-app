import { useState, useEffect } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase/config'
import { useAuth } from '../auth/useAuth'

type Status = 'idle' | 'loading' | 'success' | 'error'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export function usePointageSortie() {
  const { user } = useAuth()
  const [canPointer, setCanPointer] = useState(false)  // arrivée ok, départ manquant
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Vérifie le statut de pointage du jour
  useEffect(() => {
    if (!user?.uid) return
    const isManager = ['manager', 'patron', 'administrateur'].includes(user.role)
    if (isManager) return  // managers ne pointent pas

    const q = query(
      collection(db, 'pointages'),
      where('userId', '==', user.uid),
      where('date', '==', todayStr()),
    )
    getDocs(q).then(snap => {
      const docs = snap.docs.map(d => d.data() as any)
      const hasArrivee = docs.some(d => d.typePointage === 'arrivée' && d.statut === 'validé')
      const hasDepart  = docs.some(d => d.typePointage === 'départ'  && d.statut === 'validé')
      setCanPointer(hasArrivee && !hasDepart)
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
            resolve('success')
          } catch (e: any) {
            setErrorMsg(e?.message || 'Erreur enregistrement.')
            setStatus('error')
            resolve('error')
          }
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            setErrorMsg('Permission GPS refusée. Activez-la dans les réglages.')
          } else {
            setErrorMsg('Impossible d\'obtenir votre position.')
          }
          setStatus('error')
          resolve('error')
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
      )
    })
  }

  return { canPointer, status, errorMsg, doPointageSortie, setStatus }
}
