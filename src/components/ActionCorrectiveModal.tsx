import { createPortal } from 'react-dom'
import { useState } from 'react'
import { Timestamp, addDoc, updateDoc, deleteDoc, collection, doc } from 'firebase/firestore'
import { db, auth } from '../firebase/config'

export type AcType = 'temperature_frigo' | 'temperature_reception'

export type AcPayload = {
  type: AcType
  date: string
  refId: string
  problem: string  // vide = saisie manuelle dans le modal
  fridgeId?: string
  fridgeName?: string
  session?: string
  tempC?: number
  alertMin?: number
  alertMax?: number
  productName?: string
  fournisseur?: string
  category?: string
  decision?: string
}

const SUGGESTIONS: Record<AcType, string[]> = {
  temperature_frigo: [
    'Vérification de la sonde de température',
    'Contrôle de la fermeture de porte',
    'Produits transférés dans un frigo de secours',
    'Appel du technicien de maintenance',
    'Relevé de contrôle supplémentaire effectué',
    'Descente en température obtenue — contrôle à suivre',
    'Alerte signalée au responsable',
  ],
  temperature_reception: [
    'Produit refusé et retourné au fournisseur',
    'Produit isolé en attente de décision responsable',
    'Fournisseur contacté — réclamation en cours',
    'Mesure contrôlée sur thermomètre alternatif',
    'Produit accepté sous réserve — responsable informé',
    'Produit détruit',
    'Bon de non-conformité émis',
  ],
}

type Props = {
  payload: AcPayload
  createdByName: string
  onClose: () => void
  onSaved: () => void
  // Mode édition
  editId?: string
  initialAction?: string
  // Suppression (réservé patron/manager)
  canDelete?: boolean
  onDeleted?: () => void
}

export default function ActionCorrectiveModal({
  payload, createdByName, onClose, onSaved,
  editId, initialAction, canDelete, onDeleted,
}: Props) {
  const [action, setAction]               = useState(initialAction || '')
  const [manualProblem, setManualProblem] = useState(payload.problem || '')
  const [saving, setSaving]               = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isManual    = !payload.problem && !editId
  const isEdit      = !!editId
  const suggestions = SUGGESTIONS[payload.type]

  async function save() {
    const trimAction  = action.trim()
    const trimProblem = isManual ? manualProblem.trim() : payload.problem
    if (!trimAction || !trimProblem) return
    setSaving(true)
    try {
      if (isEdit && editId) {
        await updateDoc(doc(db, 'actions_correctives', editId), {
          action: trimAction,
          updatedAt: Timestamp.now(),
          updatedBy: auth.currentUser?.uid || '',
        })
      } else {
        await addDoc(collection(db, 'actions_correctives'), {
          ...payload,
          problem: trimProblem,
          action: trimAction,
          createdAt: Timestamp.now(),
          createdBy: auth.currentUser?.uid || '',
          createdByName,
        })
      }
      onSaved()
      onClose()
    } catch { /* silencieux */ }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!editId) return
    setSaving(true)
    try {
      await deleteDoc(doc(db, 'actions_correctives', editId))
      onDeleted?.()
      onClose()
    } catch { }
    finally { setSaving(false) }
  }

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(28,28,24,0.45)',
        zIndex: 9999, display: 'flex', alignItems: 'flex-end',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxHeight: '88vh', overflowY: 'auto',
          background: 'var(--surface)', borderRadius: '20px 20px 0 0',
          padding: '20px 16px 32px', display: 'flex', flexDirection: 'column', gap: 14,
        }}
      >
        <div>
          <p style={{
            fontFamily: 'Epilogue, sans-serif', fontWeight: 800, fontSize: 17,
            color: 'var(--on-surface)', margin: '0 0 6px',
          }}>
            {isEdit ? '✏️ Modifier l\'action corrective' : '📝 Action corrective'}
          </p>

          {/* Problème — auto ou saisie manuelle */}
          {isManual ? (
            <div>
              <p style={{
                fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)',
                textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px',
              }}>
                Problème constaté *
              </p>
              <textarea
                value={manualProblem}
                onChange={e => setManualProblem(e.target.value)}
                placeholder="Décrivez le problème constaté…"
                rows={2}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 10,
                  border: '1px solid var(--border)', background: 'var(--surface-low)',
                  color: 'var(--on-surface)', fontSize: 13,
                  fontFamily: 'Manrope, sans-serif', resize: 'none',
                  boxSizing: 'border-box', outline: 'none',
                }}
              />
            </div>
          ) : (
            <div style={{
              padding: '10px 12px', borderRadius: 10,
              background: 'rgba(192,57,43,0.07)', border: '1px solid rgba(192,57,43,0.18)',
              fontSize: 12, color: 'var(--danger)', fontWeight: 600,
              fontFamily: 'Manrope, sans-serif',
            }}>
              {payload.problem}
            </div>
          )}
        </div>

        <div>
          <p style={{
            fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)',
            textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px',
          }}>
            Suggestions — cliquer pour ajouter
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {suggestions.map(s => (
              <button
                key={s}
                onClick={() => setAction(prev => prev ? `${prev}\n${s}` : s)}
                style={{
                  padding: '6px 12px', borderRadius: 20,
                  border: '1px solid var(--border)', background: 'var(--surface-low)',
                  color: 'var(--on-surface-2)', fontSize: 12,
                  fontFamily: 'Manrope, sans-serif', cursor: 'pointer', fontWeight: 500,
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p style={{
            fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)',
            textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px',
          }}>
            Action réalisée *
          </p>
          <textarea
            value={action}
            onChange={e => setAction(e.target.value)}
            placeholder="Décrivez l'action corrective réalisée…"
            rows={4}
            style={{
              width: '100%', padding: '12px', borderRadius: 12,
              border: '1px solid var(--border)', background: 'var(--surface-low)',
              color: 'var(--on-surface)', fontSize: 14,
              fontFamily: 'Manrope, sans-serif', resize: 'vertical',
              boxSizing: 'border-box', outline: 'none',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="btn-secondary" style={{ flex: 1 }}>Annuler</button>
          <button
            onClick={save}
            disabled={saving || !action.trim() || (isManual && !manualProblem.trim())}
            className="btn-primary"
            style={{ flex: 2 }}
          >
            {saving ? 'Enregistrement…' : isEdit ? 'Modifier' : 'Enregistrer l\'action'}
          </button>
        </div>

        {/* Suppression — réservé patron/manager */}
        {canDelete && editId && (
          <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 10 }}>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                style={{
                  width: '100%', padding: '8px', borderRadius: 10, border: 'none',
                  background: 'rgba(192,57,43,0.06)', color: 'var(--danger)',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  fontFamily: 'Manrope, sans-serif',
                }}
              >
                🗑 Supprimer cette action corrective
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="btn-secondary"
                  style={{ flex: 1, fontSize: 12 }}
                >
                  Annuler
                </button>
                <button
                  onClick={handleDelete}
                  disabled={saving}
                  style={{
                    flex: 2, padding: '8px', borderRadius: 10, border: 'none',
                    background: 'var(--danger)', color: '#fff',
                    fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  {saving ? '…' : 'Confirmer la suppression'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
