import { useState, useEffect } from 'react'
import { collection, query, orderBy, onSnapshot, doc, updateDoc, Timestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../auth/useAuth'

interface Demande {
  id: string
  uid: string
  nom: string
  email: string
  dateDebut: string
  dateFin: string
  motif: string
  statut: 'En attente' | 'Acceptée' | 'Refusée'
  commentaire?: string
  traitePar?: string
  traiteAt?: Timestamp
  createdAt: Timestamp
}

function fmtDate(iso: string) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}
function fmtTs(ts: Timestamp) {
  return ts.toDate().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}
function nbJours(debut: string, fin: string) {
  const d1 = new Date(debut + 'T12:00:00')
  const d2 = new Date(fin + 'T12:00:00')
  return Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1)
}

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  'En attente': { bg: 'rgba(180,83,9,0.1)',  color: 'var(--warning)', label: '⏳ En attente' },
  'Acceptée':   { bg: 'rgba(45,122,79,0.1)',  color: 'var(--success)', label: '✓ Acceptée' },
  'Refusée':    { bg: 'rgba(192,57,43,0.1)',  color: 'var(--danger)',  label: '✗ Refusée' },
}

export default function AdminConges() {
  const { user } = useAuth()
  const [demandes, setDemandes]   = useState<Demande[]>([])
  const [loading, setLoading]     = useState(true)
  const [tab, setTab]             = useState<'pending' | 'done'>('pending')
  const [modal, setModal]         = useState<Demande | null>(null)
  const [commentaire, setComment] = useState('')
  const [saving, setSaving]       = useState(false)

  useEffect(() => {
    const q = query(collection(db, 'conges_demandes'), orderBy('createdAt', 'desc'))
    return onSnapshot(q, snap => {
      setDemandes(snap.docs.map(d => ({ id: d.id, ...d.data() } as Demande)))
      setLoading(false)
    })
  }, [])

  const pending = demandes.filter(d => d.statut === 'En attente')
  const done    = demandes.filter(d => d.statut !== 'En attente')
  const shown   = tab === 'pending' ? pending : done

  function closeModal() { setModal(null); setComment('') }

  async function decide(statut: 'Acceptée' | 'Refusée') {
    if (!modal || !user) return
    setSaving(true)
    try {
      await updateDoc(doc(db, 'conges_demandes', modal.id), {
        statut,
        commentaire: commentaire.trim(),
        traitePar: user.displayName || user.email,
        traiteAt: Timestamp.now(),
      })
      closeModal()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page" style={{ paddingTop: 24 }}>
      <h1 style={{
        fontFamily: 'Epilogue, sans-serif', fontSize: 22, fontWeight: 800,
        color: 'var(--on-surface)', letterSpacing: '-0.03em', marginBottom: 20,
      }}>
        Demandes de congés
      </h1>

      {/* Tabs */}
      <div className="nav-tabs" style={{ marginBottom: 20 }}>
        <button
          className={`nav-tab${tab === 'pending' ? ' active' : ''}`}
          onClick={() => setTab('pending')}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          En attente
          {pending.length > 0 && (
            <span style={{
              background: '#c0392b', color: '#fff', borderRadius: 99,
              fontSize: 10, fontWeight: 700, padding: '1px 6px', lineHeight: 1.6,
            }}>{pending.length}</span>
          )}
        </button>
        <button
          className={`nav-tab${tab === 'done' ? ' active' : ''}`}
          onClick={() => setTab('done')}
        >
          Traitées {done.length > 0 ? `(${done.length})` : ''}
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <div className="spinner" />
        </div>
      ) : shown.length === 0 ? (
        <div className="card" style={{
          padding: 40, textAlign: 'center',
          color: 'var(--on-surface-2)', fontFamily: 'Manrope, sans-serif', fontSize: 14,
        }}>
          {tab === 'pending' ? '✓ Aucune demande en attente' : 'Aucune demande traitée'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shown.map(d => {
            const s = STATUS_STYLE[d.statut] ?? STATUS_STYLE['En attente']
            const jours = nbJours(d.dateDebut, d.dateFin)
            return (
              <button
                key={d.id}
                onClick={() => { setModal(d); setComment('') }}
                className="card"
                style={{
                  padding: '14px 16px', textAlign: 'left', width: '100%',
                  border: 'none', cursor: 'pointer',
                  borderLeft: `3px solid ${s.color}`,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-low)')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'Epilogue, sans-serif', fontWeight: 700, fontSize: 15, color: 'var(--on-surface)', marginBottom: 3 }}>
                      {d.nom}
                    </div>
                    <div style={{ fontFamily: 'Manrope, sans-serif', fontSize: 13, color: 'var(--on-surface-2)', marginBottom: 3 }}>
                      🗓 {fmtDate(d.dateDebut)} → {fmtDate(d.dateFin)}
                      <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--on-surface-3)' }}>({jours} j)</span>
                    </div>
                    {d.motif && (
                      <div style={{
                        fontFamily: 'Manrope, sans-serif', fontSize: 12, color: 'var(--on-surface-3)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{d.motif}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0 }}>
                    <span style={{
                      background: s.bg, color: s.color, borderRadius: 8,
                      fontSize: 11, fontWeight: 700, padding: '3px 8px', fontFamily: 'Manrope, sans-serif',
                    }}>{s.label}</span>
                    {d.createdAt && (
                      <span style={{ fontSize: 11, color: 'var(--on-surface-3)', fontFamily: 'Manrope, sans-serif' }}>
                        {fmtTs(d.createdAt)}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* ── Modal ── */}
      {modal && (
        <>
          <div
            onClick={() => !saving && closeModal()}
            style={{ position: 'fixed', inset: 0, background: 'rgba(28,28,24,0.5)', backdropFilter: 'blur(4px)', zIndex: 300 }}
          />
          <div className="animate-sheet-in" style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 301,
            background: '#fff', borderRadius: '20px 20px 0 0',
            padding: '12px 24px calc(28px + var(--safe-bottom))',
            boxShadow: 'var(--shadow-float)', maxHeight: '90vh', overflowY: 'auto',
          }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 20px' }} />

            <div style={{ fontFamily: 'Epilogue, sans-serif', fontWeight: 800, fontSize: 18, color: 'var(--on-surface)', marginBottom: 2 }}>
              🏖 {modal.nom}
            </div>
            <div style={{ fontFamily: 'Manrope, sans-serif', fontSize: 12, color: 'var(--on-surface-3)', marginBottom: 18 }}>
              {modal.email} — demande du {modal.createdAt ? fmtTs(modal.createdAt) : ''}
            </div>

            {/* Résumé */}
            <div style={{ background: 'var(--surface-low)', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                {[['Du', modal.dateDebut], ['Au', modal.dateFin]].map(([label, val]) => (
                  <div key={label}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--on-surface-3)', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'Manrope, sans-serif', marginBottom: 3 }}>{label}</div>
                    <div style={{ fontFamily: 'Epilogue, sans-serif', fontWeight: 700, fontSize: 15, color: 'var(--on-surface)' }}>{fmtDate(val)}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--on-surface-3)', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'Manrope, sans-serif', marginBottom: 4 }}>Motif</div>
              <div style={{ fontFamily: 'Manrope, sans-serif', fontSize: 13, color: 'var(--on-surface)', lineHeight: 1.6 }}>{modal.motif || '—'}</div>
              <div style={{ marginTop: 10, fontFamily: 'Manrope, sans-serif', fontSize: 12, color: 'var(--on-surface-3)' }}>
                Durée : {nbJours(modal.dateDebut, modal.dateFin)} jour(s)
              </div>
            </div>

            {modal.statut !== 'En attente' ? (
              // Déjà traitée — lecture seule
              <div style={{ background: STATUS_STYLE[modal.statut]?.bg, borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
                <div style={{ fontFamily: 'Manrope, sans-serif', fontWeight: 700, fontSize: 13, color: STATUS_STYLE[modal.statut]?.color, marginBottom: modal.commentaire ? 8 : 0 }}>
                  {STATUS_STYLE[modal.statut]?.label}
                  {modal.traitePar && ` — par ${modal.traitePar}`}
                </div>
                {modal.commentaire && (
                  <div style={{ fontFamily: 'Manrope, sans-serif', fontSize: 13, color: 'var(--on-surface)', fontStyle: 'italic', lineHeight: 1.5 }}>"{modal.commentaire}"</div>
                )}
              </div>
            ) : (
              // En attente — boutons d'action
              <>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-2)', textTransform: 'uppercase', letterSpacing: '0.04em', fontFamily: 'Manrope, sans-serif', display: 'block', marginBottom: 6 }}>
                    Commentaire pour l'employé (optionnel)
                  </label>
                  <textarea
                    className="input"
                    placeholder="Message joint à la réponse…"
                    value={commentaire}
                    onChange={e => setComment(e.target.value)}
                    style={{ minHeight: 72, resize: 'none', width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <button
                    onClick={() => decide('Refusée')}
                    disabled={saving}
                    className="btn-danger"
                    style={{ opacity: saving ? 0.5 : 1 }}
                  >
                    {saving ? '…' : '✗ Refuser'}
                  </button>
                  <button
                    onClick={() => decide('Acceptée')}
                    disabled={saving}
                    style={{
                      height: 44, borderRadius: 12, border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
                      background: 'var(--success)', color: '#fff',
                      fontFamily: 'Manrope, sans-serif', fontWeight: 700, fontSize: 14,
                      opacity: saving ? 0.5 : 1,
                    }}
                  >
                    {saving ? '…' : '✓ Accepter'}
                  </button>
                </div>
              </>
            )}

            <button
              onClick={() => !saving && closeModal()}
              style={{ width: '100%', height: 44, background: 'var(--surface-low)', border: 'none', borderRadius: 12, fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: 'var(--on-surface-2)', cursor: 'pointer' }}
            >
              Fermer
            </button>
          </div>
        </>
      )}
    </div>
  )
}
