import { useState } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { useAuth } from '../../../auth/useAuth'
import type { ContactPayload } from '../types'

function normalizePhone(raw: string): string | null {
  const c = raw.replace(/[\s\-\.\(\)]/g, '')
  if (/^06\d{8}$/.test(c)) return '+33' + c.slice(1)
  if (/^07\d{8}$/.test(c)) return '+33' + c.slice(1)
  if (/^\+336\d{8}$/.test(c)) return c
  if (/^\+337\d{8}$/.test(c)) return c
  return null
}

export function useCaptation() {
  const { user } = useAuth()
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit(
    prenom: string,
    telephone: string,
    whatsappOptIn: boolean,
    emailOptIn: boolean,
    nom?: string,
    email?: string,
    entreprise?: string,
  ): Promise<boolean> {
    if (!navigator.onLine) {
      setError('Pas de connexion réseau. Réessayez dans un instant.')
      setStatus('error')
      return false
    }
    const e164 = normalizePhone(telephone)
    if (!e164) {
      setError('Numéro invalide. Format accepté : 06XXXXXXXX ou +336XXXXXXXX')
      setStatus('error')
      return false
    }
    setStatus('loading')
    setError(null)
    try {
      const fns = getFunctions(undefined, 'europe-west1')
      const syncFn = httpsCallable(fns, 'syncContactToBrevo')
      const payload: ContactPayload = {
        prenom: prenom.trim(),
        ...(nom?.trim() && { nom: nom.trim() }),
        telephone: e164,
        ...(email?.trim() && { email: email.trim() }),
        ...(entreprise?.trim() && { entreprise: entreprise.trim() }),
        whatsappOptIn,
        emailOptIn,
        source: 'corner_matias',
        vendeurUid: user?.uid ?? '',
        capturedAt: new Date().toISOString(),
      }
      await syncFn(payload)
      setStatus('success')
      return true
    } catch (e: any) {
      setError(e?.message ?? 'Erreur lors de la synchronisation')
      setStatus('error')
      return false
    }
  }

  function reset() {
    setStatus('idle')
    setError(null)
  }

  return { submit, status, error, reset }
}
