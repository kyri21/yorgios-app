import { useState, useEffect } from 'react'
import {
  collection, addDoc, getDocs, query, orderBy, Timestamp,
  doc, updateDoc, deleteDoc, onSnapshot,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../auth/useAuth'

interface UserEntry {
  uid: string
  displayName: string
  email: string
  role: string
}

interface Annonce {
  id: string
  titre: string
  corps: string
  destIds: string[]
  destAll: boolean
  actif: boolean
  createdAt: any
  createdByName: string
  readBy: Record<string, any>
}

const ROLE_LABEL: Record<string, string> = {
  patron: 'Patron', administrateur: 'Admin', manager: 'Manager',
  cuisine: 'Cuisine', corner: 'Corner',
}

// Comptes système à exclure de la sélection
const SYSTEM_EMAILS = ['planning@yorgios.fr', 'ipad@yorgios.fr', 'ipad.cuisine@yorgios.fr']

export default function AdminAnnonces() {
  const { user } = useAuth()
  const [users, setUsers]           = useState<UserEntry[]>([])
  const [annonces, setAnnonces]     = useState<Annonce[]>([])
  const [loading, setLoading]       = useState(true)

  // Formulaire
  const [titre, setTitre]           = useState('')
  const [corps, setCorps]           = useState('')
  const [destAll, setDestAll]       = useState(true)
  const [selectedUids, setSelectedUids] = useState<Set<string>>(new Set())
  const [sending, setSending]       = useState(false)
  const [sent, setSent]             = useState(false)

  // Détail d'une annonce (qui a lu)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    getDocs(collection(db, 'users')).then(snap => {
      const list: UserEntry[] = snap.docs
        .map(d => ({ uid: d.id, ...(d.data() as any) }))
        .filter(u => !SYSTEM_EMAILS.includes(u.email))
        .sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email))
      setUsers(list)
    })
    const q = query(collection(db, 'annonces'), orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(q, snap => {
      setAnnonces(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Annonce)))
      setLoading(false)
    })
    return unsub
  }, [])

  function toggleUid(uid: string) {
    setSelectedUids(prev => {
      const next = new Set(prev)
      next.has(uid) ? next.delete(uid) : next.add(uid)
      return next
    })
  }

  async function handleSend() {
    if (!titre.trim() || !corps.trim()) return
    if (!destAll && selectedUids.size === 0) return
    setSending(true)
    const destIds = destAll ? ['*'] : Array.from(selectedUids)
    const destNames = destAll
      ? ['Tous']
      : users.filter(u => selectedUids.has(u.uid)).map(u => u.displayName || u.email)
    await addDoc(collection(db, 'annonces'), {
      titre: titre.trim(),
      corps: corps.trim(),
      destIds,
      destNames,
      destAll,
      actif: true,
      createdAt: Timestamp.now(),
      createdByName: user?.displayName || user?.email?.split('@')[0] || 'Admin',
      readBy: {},
    })
    setTitre('')
    setCorps('')
    setDestAll(true)
    setSelectedUids(new Set())
    setSending(false)
    setSent(true)
    setTimeout(() => setSent(false), 3000)
  }

  async function handleDeactivate(id: string, actif: boolean) {
    await updateDoc(doc(db, 'annonces', id), { actif: !actif })
  }

  async function handleDelete(id: string) {
    if (!confirm('Supprimer définitivement cette annonce ?')) return
    await deleteDoc(doc(db, 'annonces', id))
  }

  const canSend = titre.trim().length > 0 && corps.trim().length > 0 && (destAll || selectedUids.size > 0)

  return (
    <div className="page">
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 22, fontWeight: 800, color: 'var(--on-surface)', margin: 0 }}>
          📢 Annonces obligatoires
        </h1>
        <p style={{ fontSize: 12, color: 'var(--on-surface-3)', fontFamily: 'Manrope, sans-serif', marginTop: 4 }}>
          Les employés ciblés devront lire et confirmer le message avant d'accéder à l'application.
        </p>
      </div>

      {/* ── Formulaire nouvelle annonce ── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--on-surface)', marginBottom: 14 }}>
          Nouvelle annonce
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelSt}>Titre</label>
          <input
            className="input"
            placeholder="Ex : Nouveau protocole hygiène"
            value={titre}
            onChange={e => setTitre(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelSt}>Message</label>
          <textarea
            className="input"
            placeholder="Rédigez le message complet ici. Les employés devront scroller jusqu'en bas pour confirmer la lecture."
            value={corps}
            onChange={e => setCorps(e.target.value)}
            rows={6}
            style={{ width: '100%', resize: 'vertical', minHeight: 120 }}
          />
        </div>

        {/* Destinataires */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelSt}>Destinataires</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="radio" checked={destAll} onChange={() => setDestAll(true)} />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface)' }}>Tous les employés</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="radio" checked={!destAll} onChange={() => setDestAll(false)} />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface)' }}>Sélection personnalisée</span>
            </label>
          </div>

          {!destAll && (
            <div style={{
              marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8,
              background: 'var(--surface-low)', borderRadius: 10, padding: '12px',
            }}>
              {users.map(u => {
                const selected = selectedUids.has(u.uid)
                return (
                  <button
                    key={u.uid}
                    onClick={() => toggleUid(u.uid)}
                    style={{
                      padding: '5px 12px', borderRadius: 20, border: 'none', cursor: 'pointer',
                      fontSize: 12, fontWeight: 600, fontFamily: 'Manrope, sans-serif',
                      background: selected ? 'var(--primary)' : 'var(--surface-high)',
                      color: selected ? '#fff' : 'var(--on-surface-2)',
                      transition: 'background 0.15s, color 0.15s',
                    }}
                  >
                    {u.displayName || u.email.split('@')[0]}
                    {u.role && <span style={{ opacity: 0.7, marginLeft: 4 }}>({ROLE_LABEL[u.role] || u.role})</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <button
          onClick={handleSend}
          disabled={!canSend || sending}
          style={{
            background: sent ? '#2d7a4f' : canSend ? 'var(--primary)' : 'var(--surface-mid)',
            color: canSend || sent ? '#fff' : 'var(--on-surface-3)',
            border: 'none', borderRadius: 10, padding: '10px 20px',
            fontSize: 13, fontWeight: 700, cursor: canSend ? 'pointer' : 'not-allowed',
            fontFamily: 'Manrope, sans-serif',
          }}
        >
          {sending ? 'Envoi…' : sent ? '✓ Annonce envoyée' : '📢 Envoyer l\'annonce'}
        </button>
      </div>

      {/* ── Liste des annonces ── */}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--on-surface)', marginBottom: 12 }}>
        Annonces envoyées ({annonces.length})
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--on-surface-3)', fontSize: 13, padding: 24 }}>Chargement…</div>
      ) : annonces.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--on-surface-3)', fontSize: 13, padding: 24 }}>Aucune annonce envoyée</div>
      ) : (
        annonces.map(a => {
          const readCount = Object.keys(a.readBy || {}).length
          const destCount = a.destAll ? users.length : (a.destIds || []).length
          const pct = destCount > 0 ? Math.round((readCount / destCount) * 100) : 0
          const isExpanded = expandedId === a.id
          const dateStr = a.createdAt?.toDate
            ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                .format(a.createdAt.toDate())
            : ''

          return (
            <div key={a.id} className="card" style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                {/* Statut actif/inactif */}
                <div style={{
                  width: 10, height: 10, borderRadius: '50%', flexShrink: 0, marginTop: 4,
                  background: a.actif ? '#2d7a4f' : 'var(--on-surface-3)',
                  boxShadow: a.actif ? '0 0 0 3px rgba(45,122,79,0.2)' : 'none',
                }} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--on-surface)' }}>{a.titre}</span>
                    {!a.actif && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--on-surface-3)', background: 'var(--surface-mid)', borderRadius: 4, padding: '1px 6px' }}>
                        DÉSACTIVÉE
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--on-surface-3)', fontFamily: 'Manrope, sans-serif', marginTop: 2 }}>
                    {dateStr} · par {a.createdByName} · {a.destAll ? 'Tous' : `${destCount} personne${destCount > 1 ? 's' : ''}`}
                  </div>

                  {/* Barre de progression lecture */}
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 4, background: 'var(--surface-high)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', width: `${pct}%`,
                        background: pct === 100 ? '#2d7a4f' : '#004275',
                        transition: 'width 0.3s',
                      }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: pct === 100 ? '#2d7a4f' : 'var(--primary)', whiteSpace: 'nowrap' }}>
                      {readCount}/{destCount} lu{readCount > 1 ? 's' : ''}
                    </span>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : a.id)}
                      style={{ fontSize: 11, background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 7px', cursor: 'pointer', color: 'var(--on-surface-2)', whiteSpace: 'nowrap' }}
                    >
                      {isExpanded ? '▲ Masquer' : '▾ Détails'}
                    </button>
                  </div>

                  {/* Détails — qui a lu */}
                  {isExpanded && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Aperçu du message
                      </div>
                      <div style={{
                        fontSize: 12, color: 'var(--on-surface-2)', fontFamily: 'Manrope, sans-serif',
                        background: 'var(--surface-low)', borderRadius: 8, padding: '10px 12px',
                        maxHeight: 100, overflowY: 'auto', whiteSpace: 'pre-wrap', marginBottom: 10,
                        lineHeight: 1.6,
                      }}>
                        {a.corps}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Confirmations de lecture
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {users
                          .filter(u => a.destAll || (a.destIds || []).includes(u.uid))
                          .map(u => {
                            const hasRead = (a.readBy || {})[u.uid]
                            return (
                              <span key={u.uid} style={{
                                fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20,
                                background: hasRead ? 'rgba(45,122,79,0.1)' : 'rgba(192,57,43,0.08)',
                                color: hasRead ? '#2d7a4f' : '#c0392b',
                              }}>
                                {hasRead ? '✓' : '○'} {u.displayName || u.email.split('@')[0]}
                              </span>
                            )
                          })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => handleDeactivate(a.id, a.actif)}
                    title={a.actif ? 'Désactiver' : 'Réactiver'}
                    style={{
                      background: 'none', border: '1px solid var(--border)',
                      borderRadius: 7, padding: '4px 8px', cursor: 'pointer',
                      fontSize: 12, color: 'var(--on-surface-2)',
                    }}
                  >
                    {a.actif ? '⏸ Pause' : '▶ Activer'}
                  </button>
                  <button
                    onClick={() => handleDelete(a.id)}
                    title="Supprimer"
                    style={{
                      background: 'none', border: '1px solid rgba(192,57,43,0.3)',
                      borderRadius: 7, padding: '4px 8px', cursor: 'pointer',
                      fontSize: 12, color: '#c0392b',
                    }}
                  >
                    🗑
                  </button>
                </div>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

const labelSt: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--on-surface-3)', marginBottom: 5,
}
