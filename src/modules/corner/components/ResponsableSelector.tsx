import { useEffect, useState } from 'react'
import { auth } from '../../../firebase/config'
import type { HygieneKind } from '../utils/hygiene'
import {
  assignResponsable, loadCornerUsers, loadResponsable,
  type CornerUser, type HygieneResponsable,
} from '../firebase/hygieneResponsables'

type Props = {
  kind: HygieneKind
  /** Date de référence de la période affichée (suit le sélecteur de date). */
  date: Date
  /** patron / administrateur / manager */
  canEdit: boolean
  /** Nom affiché de l'utilisateur courant, pour tracer qui a désigné. */
  currentUserName: string
  onAssigned?: () => void
}

export default function ResponsableSelector({
  kind, date, canEdit, currentUserName, onAssigned,
}: Props) {
  const [resp, setResp]         = useState<HygieneResponsable | null>(null)
  const [users, setUsers]       = useState<CornerUser[]>([])
  const [choix, setChoix]       = useState('')
  const [editing, setEditing]   = useState(false)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  const dateKey = date.toISOString().slice(0, 10)

  useEffect(() => {
    let annule = false
    setLoading(true); setError(''); setEditing(false)
    loadResponsable(kind, date)
      .then(r => { if (!annule) { setResp(r); setChoix(r?.assigneeUid ?? '') } })
      .catch(e => { if (!annule) setError(e?.message || 'Chargement impossible') })
      .finally(() => { if (!annule) setLoading(false) })
    return () => { annule = true }
  }, [kind, dateKey])

  useEffect(() => {
    if (!canEdit) return
    let annule = false
    loadCornerUsers()
      .then(users => { if (!annule) setUsers(users) })
      .catch(e => { if (!annule) setError(e?.message || '') })
    return () => { annule = true }
  }, [canEdit])

  async function handleAssign() {
    const assignee = users.find(u => u.uid === choix)
    if (!assignee) { setError('Sélectionnez un salarié'); return }

    // Capturer la période intentionnée au moment du clic
    // pour détecter les changements d'onglet/date pendant l'opération
    const intentKind = kind
    const intentDateKey = dateKey

    setSaving(true); setError('')
    try {
      await assignResponsable({
        kind: intentKind, ref: date, assignee,
        assignedBy: auth.currentUser?.uid || '',
        assignedByName: currentUserName,
        current: resp,
      })
      // Vérifier que la période affichée n'a pas changé depuis le clic
      if (intentKind !== kind || intentDateKey !== dateKey) {
        return // Requête périmée, ne pas appliquer le résultat
      }
      const frais = await loadResponsable(intentKind, date)
      // Vérifier à nouveau après le 2e await
      if (intentKind !== kind || intentDateKey !== dateKey) {
        return // Requête périmée, ne pas appliquer le résultat
      }
      setResp(frais); setEditing(false)
      onAssigned?.()
    } catch (e: any) {
      // Jamais d'échec silencieux : le bandeau rouge est la seule preuve
      // visible qu'une écriture Firestore a été refusée.
      setError(e?.message || 'Enregistrement impossible')
    } finally {
      setSaving(false)
    }
  }

  const estMoi = resp?.assigneeUid && resp.assigneeUid === auth.currentUser?.uid

  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <p className="section-label" style={{ marginBottom: 8 }}>Responsable</p>

      {loading ? (
        <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: 0 }}>Chargement…</p>
      ) : resp && !editing ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--on-surface)', margin: 0 }}>
              {resp.assigneeName}
              {estMoi && (
                <span style={{
                  marginLeft: 8, fontSize: 11, fontWeight: 700, color: 'var(--primary)',
                  background: 'rgba(0,66,117,0.10)', padding: '2px 8px', borderRadius: 99,
                }}>toi</span>
              )}
            </p>
            <p style={{ fontSize: 11, color: 'var(--on-surface-3)', margin: '3px 0 0' }}>
              Désigné par {resp.assignedByName}
            </p>
          </div>
          {canEdit && (
            <button
              onClick={() => setEditing(true)}
              style={{
                minHeight: 44, padding: '0 14px', borderRadius: 10, border: 'none',
                background: 'var(--surface-mid)', color: 'var(--primary)',
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
                fontFamily: 'Manrope, sans-serif', whiteSpace: 'nowrap',
              }}
            >
              Changer
            </button>
          )}
        </div>
      ) : canEdit ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <select
            className="input-filled"
            value={choix}
            onChange={e => setChoix(e.target.value)}
            style={{ minHeight: 44 }}
          >
            <option value="">— Choisir un salarié —</option>
            {users.map(u => (
              <option key={u.uid} value={u.uid}>{u.displayName}</option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleAssign} disabled={saving || !choix} className="btn-primary" style={{ flex: 1 }}>
              {saving ? 'Enregistrement…' : 'Désigner'}
            </button>
            {resp && (
              <button
                onClick={() => { setEditing(false); setChoix(resp.assigneeUid) }}
                className="btn-secondary"
                style={{ minHeight: 44 }}
              >
                Annuler
              </button>
            )}
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: 0 }}>
          Aucun responsable désigné
        </p>
      )}

      {error && (
        <div style={{
          marginTop: 10, padding: '10px 12px', borderRadius: 10,
          background: 'rgba(192,57,43,0.08)', color: 'var(--danger)',
          fontSize: 12, fontWeight: 600,
        }}>
          ⚠️ {error}
        </div>
      )}
    </div>
  )
}
