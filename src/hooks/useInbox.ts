import { useState, useEffect } from 'react'
import { collection, getDocs, query, where, getDoc, doc } from 'firebase/firestore'
import { db } from '../firebase/config'
import type { UserProfile } from '../types'

export interface InboxItem {
  id: string
  title: string
  body: string
  link?: string
  type: 'commande' | 'rappel' | 'temperature'
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function dismissedKey() {
  return `inbox_dismissed_${todayStr()}`
}

function getDismissed(): string[] {
  try { return JSON.parse(localStorage.getItem(dismissedKey()) ?? '[]') } catch { return [] }
}

function saveDismissed(ids: string[]) {
  localStorage.setItem(dismissedKey(), JSON.stringify(ids))
}

export function useInbox(user: UserProfile | null) {
  const [items, setItems] = useState<InboxItem[]>([])
  const [dismissed, setDismissed] = useState<string[]>(getDismissed)

  function dismissItem(id: string) {
    const next = [...dismissed, id]
    setDismissed(next)
    saveDismissed(next)
  }

  useEffect(() => {
    if (!user) { setItems([]); return }

    async function load() {
      if (!user) return
      const now = new Date()
      const hour = now.getHours() + now.getMinutes() / 60
      const today = todayStr()
      const result: InboxItem[] = []

      /* ── 1. Commandes du jour ── */
      if (['patron', 'administrateur', 'manager', 'corner'].includes(user.role)) {
        try {
          const snap = await getDocs(query(
            collection(db, 'commandes_externes'),
            where('dateLivraison', '==', today),
            where('statut', 'in', ['En attente', 'Acceptée', 'En production']),
          ))
          snap.docs.forEach(d => {
            const cmd = d.data() as any
            result.push({
              id: `cmd_${d.id}`,
              title: `Commande — ${cmd.prenom} ${cmd.nom}`,
              body: `Livraison aujourd'hui à ${cmd.heureLivraison}`,
              link: '/corner/commandes',
              type: 'commande',
            })
          })
        } catch { /* silently ignore */ }
      }

      /* ── 2. Températures frigo non saisies (8h30+) ── */
      if (hour >= 8.5 && ['patron', 'administrateur', 'manager', 'corner'].includes(user!.role)) {
        try {
          const [f1, f2] = await Promise.all([
            getDoc(doc(db, 'temperatures', `${today}_FRIGO_3P`)),
            getDoc(doc(db, 'temperatures', `${today}_VITRINE_1`)),
          ])
          if (!f1.exists() && !f2.exists()) {
            result.push({
              id: 'temp_reminder',
              title: 'Températures frigo',
              body: "As-tu entré les températures des frigos ce matin ?",
              link: '/corner/temperatures',
              type: 'temperature',
            })
          }
        } catch { /* silently ignore */ }
      }

      /* ── Vérifier si l'utilisateur a pointé aujourd'hui ── */
      let pointedToday = false
      if (user!.role !== 'manager') {
        try {
          const snap = await getDocs(query(
            collection(db, 'pointages'),
            where('userId', '==', user!.uid),
            where('date', '==', today),
            where('statut', '==', 'validé'),
          ))
          pointedToday = !snap.empty
        } catch { /* silently ignore */ }
      }

      /* ── 3. TooGoodToGo (9h+ et a pointé) ── */
      if (hour >= 9 && pointedToday) {
        result.push({
          id: 'tgtg_9h',
          title: 'TooGoodToGo',
          body: "Il est l'heure de préparer les paniers TooGoodToGo !",
          type: 'rappel',
        })
      }

      /* ── 4. Plats du jour (11h+) ── */
      if (hour >= 11 && ['cuisine', 'corner', 'patron', 'administrateur', 'manager'].includes(user!.role)) {
        result.push({
          id: 'plats_11h',
          title: 'Plats du jour',
          body: "Il est l'heure de préparer les plats du jour.",
          type: 'rappel',
        })
      }

      /* ── 5. Urgences corner (15h+ et a pointé) ── */
      if (hour >= 15
        && (pointedToday || user!.role === 'manager' || user!.role === 'patron' || user!.role === 'administrateur')
        && ['corner', 'patron', 'administrateur', 'manager'].includes(user!.role)) {
        result.push({
          id: 'urgences_15h',
          title: 'Urgences — Ruptures & Commandes',
          body: "C'est l'heure d'informer la cuisine de vos urgences du soir.",
          link: '/corner/ruptures',
          type: 'rappel',
        })
      }

      setItems(result)
    }

    load()
    // Rafraîchir toutes les 10 minutes pour capter les changements d'heure
    const interval = setInterval(load, 10 * 60 * 1000)
    return () => clearInterval(interval)
  }, [user?.uid, user?.role])

  const visibleItems = items.filter(i => !dismissed.includes(i.id))

  return { items: visibleItems, count: visibleItems.length, dismissItem }
}
