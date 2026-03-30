import { useEffect, useState } from 'react'
import {
  Timestamp, addDoc, collection, deleteDoc, doc, getDocs, limit,
  onSnapshot, orderBy, query, updateDoc, where,
} from 'firebase/firestore'
import { db, auth } from '../../../firebase/config'
import { useToast } from '../../../hooks/useToast'

type Article = {
  id: string
  frigo: string
  nom: string
  quantite: string
  dlc: string
  createdAt: any
}

type LotCuisine = {
  id: string
  lotCode: string
  productName: string
  quantity: number
  producedAt: any
  dlcAt: any
}

const FRIGOS = ['Frigo 1', 'Frigo 2', 'Frigo 3', 'Grand Frigo', 'Chambre Froide'] as const
type Frigo = typeof FRIGOS[number]

function joursRestants(dlc: string): number | null {
  if (!dlc) return null
  const d = new Date(dlc)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - now.getTime()) / 86400000)
}

function DlcBadge({ dlc }: { dlc: string }) {
  const jours = joursRestants(dlc)
  if (jours === null) return null
  let className = 'chip-ok'
  let label = `J+${jours}`
  if (jours <= 0) {
    className = 'chip-danger'
    label = jours < 0 ? `DLC dépassée (${Math.abs(jours)}j)` : "DLC aujourd'hui"
  } else if (jours === 1) {
    className = 'chip-warn'
    label = 'J+1'
  }
  return <span className={className}>{label}</span>
}

function localISO(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`
}

export default function StockageFrigo() {
  const { show } = useToast()
  const [articles, setArticles] = useState<Article[]>([])
  const [frigoActif, setFrigoActif] = useState<Frigo>('Frigo 1')
  const [form, setForm] = useState({ nom: '', quantite: '', dlc: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transferTarget, setTransferTarget] = useState<string | null>(null)
  const [transferDest, setTransferDest] = useState<Frigo>('Frigo 1')

  // Mode lot cuisine
  const [showLots, setShowLots] = useState(false)
  const [lots, setLots] = useState<LotCuisine[]>([])
  const [lotsLoading, setLotsLoading] = useState(false)

  useEffect(() => {
    const q = query(collection(db, 'stockage_frigo'), orderBy('createdAt', 'asc'))
    const unsub = onSnapshot(q, snap => {
      setArticles(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
    })
    return unsub
  }, [])

  async function loadLots() {
    setLotsLoading(true)
    try {
      const snap = await getDocs(query(
        collection(db, 'lots_cuisine'),
        where('archived', '==', true),
        orderBy('archivedAt', 'desc'),
        limit(30),
      ))
      setLots(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as LotCuisine[])
    } catch { /* silencieux */ }
    finally { setLotsLoading(false) }
  }

  function pickLot(lot: LotCuisine) {
    const dlcDate = lot.dlcAt?.toDate ? lot.dlcAt.toDate() : null
    setForm({
      nom: lot.productName,
      quantite: String(lot.quantity),
      dlc: dlcDate ? localISO(dlcDate) : '',
    })
    setShowLots(false)
  }

  async function handleAdd() {
    if (!form.nom.trim()) { setError('Nom du produit obligatoire'); return }
    setError(null)
    setLoading(true)
    try {
      await addDoc(collection(db, 'stockage_frigo'), {
        frigo: frigoActif,
        nom: form.nom.trim(),
        quantite: form.quantite.trim(),
        dlc: form.dlc,
        createdAt: Timestamp.now(),
        createdBy: auth.currentUser?.uid || '',
      })
      setForm({ nom: '', quantite: '', dlc: '' })
      show('Article ajouté au frigo')
    } catch (e: any) {
      setError(e?.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: string) {
    await deleteDoc(doc(db, 'stockage_frigo', id))
  }

  async function handleTransfer(id: string) {
    await updateDoc(doc(db, 'stockage_frigo', id), { frigo: transferDest })
    setTransferTarget(null)
  }

  const articlesDuFrigo = articles.filter(a => a.frigo === frigoActif)

  const alertes = FRIGOS.reduce((acc, f) => {
    const count = articles.filter(a => a.frigo === f && joursRestants(a.dlc) !== null && (joursRestants(a.dlc) as number) <= 1).length
    acc[f] = count
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="page">
      {/* Header */}
      <div>
        <p className="section-label" style={{ marginBottom: 2 }}>Corner</p>
        <h1 style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 24, fontWeight: 800, color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0 }}>
          Stockage Frigo
        </h1>
      </div>

      {/* Sélecteur frigo — tabs scrollables */}
      <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 2 }}>
        {FRIGOS.map(f => (
          <button
            key={f}
            onClick={() => setFrigoActif(f)}
            style={{
              whiteSpace: 'nowrap',
              padding: '9px 16px',
              borderRadius: 10,
              border: 'none',
              background: frigoActif === f ? 'var(--surface)' : 'transparent',
              color: frigoActif === f ? 'var(--primary)' : 'var(--on-surface-3)',
              fontWeight: 700,
              fontFamily: 'Manrope, sans-serif',
              fontSize: 13,
              cursor: 'pointer',
              position: 'relative',
              flexShrink: 0,
              boxShadow: frigoActif === f ? '0 1px 6px rgba(28,28,24,0.08)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            {f}
            {alertes[f] > 0 && (
              <span style={{
                position: 'absolute', top: 2, right: 2,
                background: 'var(--danger)', color: '#fff', borderRadius: 99,
                fontSize: 9, fontWeight: 700, minWidth: 14, height: 14,
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px',
              }}>{alertes[f]}</span>
            )}
          </button>
        ))}
      </div>

      {/* Formulaire ajout */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <p className="section-label" style={{ margin: 0 }}>Ajouter — {frigoActif}</p>
          <button
            onClick={() => { setShowLots(v => !v); if (!showLots) loadLots() }}
            style={{
              fontSize: 12,
              fontWeight: 700,
              padding: '6px 12px',
              borderRadius: 8,
              border: 'none',
              background: showLots ? 'rgba(0,66,117,0.10)' : 'var(--surface-mid)',
              color: showLots ? 'var(--primary)' : 'var(--on-surface-2)',
              cursor: 'pointer',
              fontFamily: 'Manrope, sans-serif',
            }}
          >
            📦 {showLots ? 'Fermer' : 'Depuis cuisine'}
          </button>
        </div>

        {/* Panel lots cuisine */}
        {showLots && (
          <div style={{ marginBottom: 14, background: 'var(--surface-low)', borderRadius: 10, padding: 12 }}>
            <p className="section-label" style={{ marginBottom: 8 }}>Lots livrés par la cuisine</p>
            {lotsLoading ? (
              <div style={{ textAlign: 'center', padding: 12 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
            ) : lots.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: 0, textAlign: 'center', padding: '8px 0' }}>
                Aucun lot livré disponible.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                {lots.map(lot => {
                  const dlcDate = lot.dlcAt?.toDate ? lot.dlcAt.toDate() : null
                  const prodDate = lot.producedAt?.toDate ? lot.producedAt.toDate() : null
                  return (
                    <button key={lot.id} onClick={() => pickLot(lot)} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                      background: 'var(--surface)', border: 'none',
                      boxShadow: '0 1px 4px rgba(28,28,24,0.06)',
                    }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--on-surface)', fontFamily: 'Manrope, sans-serif' }}>{lot.productName}</div>
                        <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 2 }}>
                          {lot.lotCode} · Qté {lot.quantity}
                          {prodDate && ` · Fab. ${prodDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`}
                          {dlcDate && ` · DLC ${dlcDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`}
                        </div>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', flexShrink: 0, marginLeft: 8 }}>Choisir</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {error && <div style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 8 }}>{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginBottom: 10 }}>
          <input className="input" placeholder="Nom du produit *" value={form.nom} onChange={e => setForm(f => ({ ...f, nom: e.target.value }))} />
          <input className="input" style={{ width: 76 }} placeholder="Qté" value={form.quantite} onChange={e => setForm(f => ({ ...f, quantite: e.target.value }))} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'flex-end' }}>
          <div>
            <label className="section-label" style={{ marginBottom: 4 }}>DLC (optionnel)</label>
            <input className="input" type="date" value={form.dlc} onChange={e => setForm(f => ({ ...f, dlc: e.target.value }))} />
          </div>
          <button onClick={handleAdd} disabled={loading} className="btn-primary" style={{ fontSize: 13, padding: '0 18px', height: 44 }}>
            {loading ? '…' : '+ Ajouter'}
          </button>
        </div>
      </div>

      {/* Liste articles */}
      {articlesDuFrigo.length === 0 ? (
        <div style={{
          background: 'var(--surface-low)', borderRadius: 16, padding: '36px 20px',
          textAlign: 'center', color: 'var(--on-surface-3)', fontSize: 14,
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🧊</div>
          <div style={{ fontFamily: 'Manrope, sans-serif', fontWeight: 600 }}>Aucun article dans ce frigo</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {articlesDuFrigo.map(a => {
            const jours = joursRestants(a.dlc)
            const isExpired = jours !== null && jours <= 0
            const isWarn = jours !== null && jours === 1
            const rowBg = isExpired
              ? 'rgba(136,0,20,0.06)'
              : isWarn
              ? 'rgba(180,83,9,0.06)'
              : 'var(--surface-low)'
            return (
              <div key={a.id} style={{ background: rowBg, borderRadius: 12, padding: '13px 14px' }}>
                {transferTarget === a.id ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--on-surface)', fontFamily: 'Manrope, sans-serif' }}>
                      Transférer <strong>{a.nom}</strong> vers :
                    </div>
                    <select className="input" value={transferDest} onChange={e => setTransferDest(e.target.value as Frigo)}>
                      {FRIGOS.filter(f => f !== frigoActif).map(f => <option key={f}>{f}</option>)}
                    </select>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => handleTransfer(a.id)} className="btn-primary" style={{ flex: 1, fontSize: 13 }}>Confirmer</button>
                      <button onClick={() => setTransferTarget(null)} className="btn-secondary" style={{ flex: 1, fontSize: 13 }}>Annuler</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--on-surface)', fontFamily: 'Manrope, sans-serif' }}>
                        {a.nom}
                        {a.quantite && <span style={{ fontWeight: 400, color: 'var(--on-surface-2)', fontSize: 13 }}> — {a.quantite}</span>}
                      </div>
                      {a.dlc && (
                        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <DlcBadge dlc={a.dlc} />
                          <span style={{ fontSize: 11, color: 'var(--on-surface-3)' }}>
                            {new Date(a.dlc).toLocaleDateString('fr-FR')}
                          </span>
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => { setTransferTarget(a.id); setTransferDest(FRIGOS.find(f => f !== frigoActif) || FRIGOS[0]) }}
                        style={{
                          fontSize: 11, fontWeight: 700, padding: '7px 12px', borderRadius: 8,
                          background: 'rgba(0,66,117,0.08)', color: 'var(--primary)',
                          border: 'none', cursor: 'pointer', fontFamily: 'Manrope, sans-serif',
                        }}
                      >
                        Transfert
                      </button>
                      <button
                        onClick={() => handleDelete(a.id)}
                        style={{
                          fontSize: 11, fontWeight: 700, padding: '7px 12px', borderRadius: 8,
                          background: 'rgba(136,0,20,0.08)', color: 'var(--danger)',
                          border: 'none', cursor: 'pointer', fontFamily: 'Manrope, sans-serif',
                        }}
                      >
                        Retirer
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
