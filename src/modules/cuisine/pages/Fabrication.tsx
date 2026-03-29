import { useEffect, useMemo, useState } from 'react'
import { SkeletonList } from '../../../components/Skeleton'
import { EmptyState } from '../../../components/EmptyState'
import {
  Timestamp, collection, deleteDoc, doc, getDocs, getDocsFromServer,
  limit, orderBy, query, runTransaction, setDoc, updateDoc,
} from 'firebase/firestore'
import { db, auth } from '../../../firebase/config'
import { useToast } from '../../../hooks/useToast'
import type { HaccpCategory } from '../lib/haccpRules'

type Produit = {
  id: string
  name: string
  abrv?: string
  defaultCategory?: HaccpCategory
  dlcDays?: number
  active?: boolean
}

type Lot = {
  id: string
  lotCode: string
  productId: string
  productName: string
  quantity: number
  dlcDays?: number
  producedAt: any
  dlcAt: any
  archived?: boolean
  archivedAt?: any
}

function pad2(n: number) { return String(n).padStart(2, '0') }
function toYYYYMMDD(d: Date) { return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}` }
function toDDMMYYYY(d: Date) { return `${pad2(d.getDate())}${pad2(d.getMonth()+1)}${d.getFullYear()}` }
function nowLocalDateValue() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`
}

async function nextLotSequence(date: Date, abrv: string): Promise<number> {
  const key = `${toYYYYMMDD(date)}_${abrv}`
  const counterRef = doc(db, 'lot_counters', key)
  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef)
    const current = snap.exists() ? Number((snap.data() as any).seq ?? 0) : 0
    const next = current + 1
    tx.set(counterRef, { seq: next, updatedAt: Timestamp.now() }, { merge: true })
    return next
  })
}

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)',
  display: 'block', marginBottom: 6,
  textTransform: 'uppercase', letterSpacing: '0.06em',
}

export default function Fabrication() {
  const { show } = useToast()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedOk, setSavedOk] = useState(false)

  const [produits, setProduits] = useState<Produit[]>([])
  const [produitsLoaded, setProduitsLoaded] = useState(false)

  // Formulaire
  const [producedDate, setProducedDate] = useState(nowLocalDateValue())
  const [productId, setProductId] = useState('')
  const [quantity, setQuantity] = useState('')

  // Liste lots
  const [lots, setLots] = useState<Lot[]>([])
  const [showArchived, setShowArchived] = useState(false)

  // Édition inline
  const [editId, setEditId] = useState<string | null>(null)
  const [editQty, setEditQty] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  // QR code
  const [qrLot, setQrLot] = useState<Lot | null>(null)

  const selectedProduit = useMemo(() => produits.find(p => p.id === productId) || null, [produits, productId])

  const computed = useMemo(() => {
    const q = Number(quantity)
    const okQty = Number.isFinite(q) && q > 0
    const d = producedDate ? new Date(`${producedDate}T00:00:00`) : null
    const dlcDays = Number(selectedProduit?.dlcDays ?? 0)
    const dlcAt = d && dlcDays > 0 ? new Date(d.getTime() + dlcDays * 24 * 3600 * 1000) : null
    return { okQty, dlcDays: dlcDays || null, dlcAt }
  }, [quantity, producedDate, selectedProduit])

  async function loadProduits() {
    const snap = await getDocsFromServer(collection(db, 'produits'))
    const list: Produit[] = snap.docs
      .map(d => ({ id: d.id, ...(d.data() as any) }))
      .filter(p => p.active !== false)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    setProduits(list)
  }

  async function loadLots() {
    const q = query(collection(db, 'lots_cuisine'), orderBy('createdAt', 'desc'), limit(50))
    const snap = await getDocs(q)
    setLots(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }) as Lot))
  }

  useEffect(() => {
    ;(async () => {
      try {
        await loadProduits()
        await loadLots()
      } catch (e: any) {
        setError(e?.message || 'Erreur de chargement')
      } finally {
        setProduitsLoaded(true)
      }
    })()
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSavedOk(false)
    const q = Number(quantity)
    if (!producedDate) return setError('Date de fabrication obligatoire.')
    if (!selectedProduit) return setError('Produit obligatoire.')
    if (!Number.isFinite(q) || q <= 0) return setError('Quantité invalide (doit être > 0).')

    const abrv = (selectedProduit.abrv || selectedProduit.name.slice(0, 3)).trim().toUpperCase()
    const dlcDays = Number(selectedProduit.dlcDays ?? 3)

    setLoading(true)
    try {
      const uid = auth.currentUser?.uid || ''
      const producedAtDate = new Date(`${producedDate}T00:00:00`)
      const seq = await nextLotSequence(producedAtDate, abrv)
      const lotCode = `${toDDMMYYYY(producedAtDate)}-${String(seq).padStart(2, '0')}-${abrv}`
      const dlcAtDate = new Date(producedAtDate.getTime() + dlcDays * 24 * 3600 * 1000)

      const lotRef = doc(collection(db, 'lots_cuisine'))
      await setDoc(lotRef, {
        producedAt: Timestamp.fromDate(producedAtDate),
        dlcAt: Timestamp.fromDate(dlcAtDate),
        productId: selectedProduit.id,
        productName: selectedProduit.name,
        abrv,
        category: selectedProduit.defaultCategory ?? 'AUTRE',
        quantity: q,
        dlcDays,
        lotCode,
        archived: false,
        createdAt: Timestamp.now(),
        createdBy: uid,
      })
      setQuantity('')
      setProductId('')
      setProducedDate(nowLocalDateValue())
      setSavedOk(true)
      show('Lot créé')
      setTimeout(() => setSavedOk(false), 3000)
      await loadLots()
    } catch (e: any) {
      setError(e?.message || 'Erreur lors de la création du lot.')
    } finally {
      setLoading(false)
    }
  }

  async function archiveLot(lotId: string) {
    try {
      await updateDoc(doc(db, 'lots_cuisine', lotId), {
        archived: true,
        archivedAt: Timestamp.now(),
      })
      await loadLots()
    } catch (e: any) {
      setError(e?.message)
    }
  }

  async function deleteLot(lot: Lot) {
    if (!confirm(`Supprimer le lot ${lot.lotCode} — ${lot.productName} ?\nCette action est irréversible.`)) return
    try {
      await deleteDoc(doc(db, 'lots_cuisine', lot.id))
      await loadLots()
    } catch (e: any) {
      setError(e?.message)
    }
  }

  async function saveEdit(lot: Lot) {
    setEditSaving(true)
    setError(null)
    try {
      const q = Number(editQty)
      if (!Number.isFinite(q) || q <= 0) { setError('Quantité invalide'); return }
      const producedAtDate = new Date(`${editDate}T00:00:00`)
      const dlcDays = Number(lot.dlcDays ?? 3)
      const dlcAtDate = new Date(producedAtDate.getTime() + dlcDays * 24 * 3600 * 1000)
      await updateDoc(doc(db, 'lots_cuisine', lot.id), {
        quantity: q,
        producedAt: Timestamp.fromDate(producedAtDate),
        dlcAt: Timestamp.fromDate(dlcAtDate),
        updatedAt: Timestamp.now(),
      })
      setEditId(null)
      await loadLots()
    } catch (e: any) {
      setError(e?.message)
    } finally {
      setEditSaving(false)
    }
  }

  function makeQrText(lot: Lot): string {
    const fmt = (ts: any) => ts?.toDate ? ts.toDate().toLocaleDateString('fr-FR') : '—'
    return [
      `LOT: ${lot.lotCode}`,
      `PRODUIT: ${lot.productName}`,
      `FAB: ${fmt(lot.producedAt)}`,
      `DLC: ${fmt(lot.dlcAt)}`,
      `QTE: ${lot.quantity}`,
    ].join('\n')
  }

  function makeQrImgUrl(lot: Lot): string {
    return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(makeQrText(lot))}`
  }

  function printLotLabel(lot: Lot) {
    const fmt = (ts: any) => ts?.toDate ? ts.toDate().toLocaleDateString('fr-FR') : '—'
    const qrUrl = makeQrImgUrl(lot)
    const win = window.open('', '_blank', 'width=420,height=560')
    if (!win) return
    win.document.write(`<!DOCTYPE html><html><head><title>${lot.lotCode}</title><style>
      body{font-family:Arial,sans-serif;text-align:center;padding:20px;margin:0}
      img{width:220px;height:220px;display:block;margin:0 auto 14px}
      .lot{font-size:17px;font-weight:bold;font-family:monospace;margin-bottom:8px}
      .row{font-size:14px;margin:5px 0;text-align:left;display:inline-block;width:220px}
      .lbl{color:#666;font-size:12px}
    </style></head><body>
      <img src="${qrUrl}" onload="window.print()" onerror="window.print()" />
      <div class="lot">${lot.lotCode}</div>
      <div class="row"><span class="lbl">Produit : </span><b>${lot.productName}</b></div>
      <div class="row"><span class="lbl">Fabrication : </span>${fmt(lot.producedAt)}</div>
      <div class="row"><span class="lbl">DLC : </span>${fmt(lot.dlcAt)}</div>
      <div class="row"><span class="lbl">Quantité : </span>${lot.quantity}</div>
    </body></html>`)
    win.document.close()
  }

  const visibleLots = lots.filter(l => showArchived ? l.archived === true : l.archived !== true)

  return (
    <div className="page">

      {/* Header */}
      <div>
        <p className="section-label" style={{ marginBottom: 2 }}>Cuisine · Production</p>
        <h1 style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 26, fontWeight: 800, color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0 }}>
          Fabrication
        </h1>
      </div>

      {/* Formulaire nouveau lot */}
      <div className="card" style={{ padding: 20 }}>
        <p className="section-label" style={{ margin: '0 0 14px' }}>Nouveau lot</p>

        <form onSubmit={onSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={labelStyle}>Date fabrication *</label>
              <input className="input" type="date" value={producedDate} onChange={e => setProducedDate(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Quantité *</label>
              <input className="input" type="number" step="1" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} />
            </div>
          </div>

          <label style={{ ...labelStyle, marginTop: 14 }}>Produit *</label>
          <select className="input" value={productId} onChange={e => setProductId(e.target.value)} disabled={!produitsLoaded}>
            <option value="">{produitsLoaded ? '— Sélectionner —' : 'Chargement…'}</option>
            {produits.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          {selectedProduit && (
            <div style={{
              fontSize: 12, color: 'var(--on-surface-2)', marginTop: 8,
              padding: '8px 12px', borderRadius: 10,
              background: 'var(--surface-mid)',
            }}>
              DLC : <b style={{ color: 'var(--on-surface)', fontWeight: 700 }}>{selectedProduit.dlcDays ?? '?'} j</b>
              {computed.dlcAt && (
                <> · Expire le <b style={{ color: 'var(--warning)', fontWeight: 700 }}>{computed.dlcAt.toLocaleDateString('fr-FR')}</b></>
              )}
            </div>
          )}

          {error && (
            <div style={{
              padding: '12px 14px', borderRadius: 12, fontSize: 13,
              background: 'rgba(136,0,20,0.06)',
              border: '1px solid rgba(136,0,20,0.15)',
              color: 'var(--tertiary)', marginTop: 12, fontWeight: 500,
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
            <button className="btn-primary" type="submit" disabled={loading || !computed.okQty || !productId} style={{ flex: 1 }}>
              {loading ? 'Création…' : 'Valider le lot'}
            </button>
            {savedOk && (
              <span style={{ fontSize: 13, color: 'var(--secondary)', fontWeight: 700, flexShrink: 0 }}>
                ✓ Lot créé
              </span>
            )}
          </div>
        </form>
      </div>

      {/* Header liste */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p className="section-label" style={{ margin: 0 }}>
            {showArchived ? 'Archives' : 'En cours'}
          </p>
          <h2 style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 18, fontWeight: 700, color: 'var(--on-surface)', margin: 0, letterSpacing: '-0.02em' }}>
            {showArchived ? 'Lots archivés' : 'Lots en cours'}
          </h2>
        </div>
        <button
          onClick={() => setShowArchived(v => !v)}
          className="btn-secondary"
          style={{ padding: '8px 14px', fontSize: 12, height: 'auto' }}
        >
          {showArchived ? '← Actifs' : '📦 Archives'}
        </button>
      </div>

      {/* Liste */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!produitsLoaded && <SkeletonList count={3} />}
        {produitsLoaded && visibleLots.length === 0 && (
          <EmptyState
            icon={showArchived ? '📦' : '🍳'}
            title={showArchived ? 'Aucun lot archivé' : 'Aucun lot en cours'}
            subtitle={showArchived ? undefined : 'Créez un lot via le formulaire ci-dessus'}
          />
        )}
        {visibleLots.map(lot => {
          const dlcDate = lot.dlcAt?.toDate ? lot.dlcAt.toDate() : null
          const prodDate = lot.producedAt?.toDate ? lot.producedAt.toDate() : null
          const isEditing = editId === lot.id
          const isExpired = dlcDate && dlcDate < new Date()

          return (
            <div key={lot.id} className="card" style={{
              padding: 0, overflow: 'hidden',
              border: isExpired
                ? '1.5px solid rgba(136,0,20,0.25)'
                : '1.5px solid transparent',
            }}>
              <div style={{ padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    {/* Code lot */}
                    <div style={{
                      fontWeight: 800, fontSize: 13, color: 'var(--primary)',
                      fontFamily: 'monospace', letterSpacing: '0.02em', marginBottom: 4,
                    }}>
                      {lot.lotCode}
                    </div>
                    {/* Produit + Quantité */}
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--on-surface)', marginBottom: 4 }}>
                      {lot.productName}
                    </div>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <span style={{ fontSize: 13, color: 'var(--on-surface-2)', fontWeight: 500 }}>
                        Qté : <b style={{ color: 'var(--on-surface)' }}>{lot.quantity}</b>
                      </span>
                      <span style={{
                        fontSize: 12,
                        color: isExpired ? 'var(--tertiary)' : 'var(--on-surface-3)',
                        fontWeight: isExpired ? 700 : 400,
                      }}>
                        DLC : {dlcDate ? dlcDate.toLocaleDateString('fr-FR') : '—'}
                        {isExpired && ' ⚠ expirée'}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  {!lot.archived ? (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      {/* Edit */}
                      <button
                        onClick={() => {
                          if (isEditing) { setEditId(null); return }
                          setEditId(lot.id)
                          setEditQty(String(lot.quantity))
                          setEditDate(prodDate
                            ? `${prodDate.getFullYear()}-${pad2(prodDate.getMonth()+1)}-${pad2(prodDate.getDate())}`
                            : nowLocalDateValue())
                        }}
                        title="Modifier"
                        style={{
                          width: 34, height: 34, borderRadius: 10,
                          border: '1.5px solid var(--border)',
                          background: isEditing ? 'rgba(0,66,117,0.10)' : 'var(--surface-low)',
                          color: isEditing ? 'var(--primary)' : 'var(--on-surface-2)',
                          cursor: 'pointer', fontSize: 15,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >✏️</button>
                      {/* Livré */}
                      <button
                        onClick={() => archiveLot(lot.id)}
                        title="Marquer livré"
                        style={{
                          height: 34, padding: '0 10px', borderRadius: 10,
                          border: '1.5px solid rgba(84,101,30,0.3)',
                          background: 'rgba(84,101,30,0.08)',
                          color: 'var(--secondary)',
                          cursor: 'pointer', fontSize: 11, fontWeight: 700,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          gap: 4, whiteSpace: 'nowrap',
                        }}
                      >✓ Livré</button>
                      {/* Supprimer */}
                      <button
                        onClick={() => deleteLot(lot)}
                        title="Supprimer"
                        style={{
                          width: 34, height: 34, borderRadius: 10,
                          border: '1.5px solid rgba(136,0,20,0.2)',
                          background: 'rgba(136,0,20,0.06)',
                          color: 'var(--tertiary)',
                          cursor: 'pointer', fontSize: 15,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >🗑</button>
                      {/* QR */}
                      <button
                        onClick={() => setQrLot(lot)}
                        title="QR Code / Étiquette"
                        style={{
                          width: 34, height: 34, borderRadius: 10,
                          border: '1.5px solid var(--border)',
                          background: 'var(--surface-low)',
                          color: 'var(--on-surface-3)',
                          cursor: 'pointer', fontSize: 15,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >⬛</button>
                    </div>
                  ) : (
                    <span className="chip-warn" style={{ flexShrink: 0 }}>Archivé</span>
                  )}
                </div>
              </div>

              {/* Formulaire édition inline */}
              {isEditing && (
                <div style={{
                  padding: '14px 16px',
                  borderTop: '1px solid var(--border-soft)',
                  background: 'var(--surface-low)',
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <div>
                      <label style={labelStyle}>Date fab.</label>
                      <input className="input" type="date" value={editDate} onChange={e => setEditDate(e.target.value)} />
                    </div>
                    <div>
                      <label style={labelStyle}>Quantité</label>
                      <input className="input" type="number" min="1" value={editQty} onChange={e => setEditQty(e.target.value)} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-primary" style={{ flex: 1, fontSize: 13 }} disabled={editSaving} onClick={() => saveEdit(lot)}>
                      {editSaving ? 'Sauvegarde…' : 'Enregistrer'}
                    </button>
                    <button
                      onClick={() => setEditId(null)}
                      className="btn-secondary"
                      style={{ fontSize: 13, padding: '0 16px', height: 44 }}
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ========== MODAL QR CODE ========== */}
      {qrLot && (() => {
        const fmt = (ts: any) => ts?.toDate ? ts.toDate().toLocaleDateString('fr-FR') : '—'
        return (
          <div
            onClick={() => setQrLot(null)}
            style={{
              position: 'fixed', inset: 0, zIndex: 200,
              background: 'rgba(28,28,24,0.5)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: 'var(--surface)',
                borderRadius: 20, padding: 24,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
                maxWidth: 340, width: '100%',
                boxShadow: '0 8px 32px rgba(28,28,24,0.10)',
              }}
            >
              <div style={{
                fontFamily: 'monospace',
                fontSize: 14, fontWeight: 800, color: 'var(--primary)',
                letterSpacing: '0.02em',
              }}>
                {qrLot.lotCode}
              </div>
              <img
                src={makeQrImgUrl(qrLot)}
                alt="QR Code"
                style={{ width: 200, height: 200, borderRadius: 12, background: 'var(--surface-high)', padding: 8 }}
              />
              <div style={{ fontSize: 13, color: 'var(--on-surface-2)', textAlign: 'left', width: '100%', lineHeight: 1.9 }}>
                <div>
                  <span style={{ color: 'var(--on-surface-3)' }}>Produit </span>
                  <b style={{ color: 'var(--on-surface)' }}>{qrLot.productName}</b>
                </div>
                <div>
                  <span style={{ color: 'var(--on-surface-3)' }}>Fabrication </span>
                  {fmt(qrLot.producedAt)}
                </div>
                <div>
                  <span style={{ color: 'var(--on-surface-3)' }}>DLC </span>
                  <b style={{ color: 'var(--warning)' }}>{fmt(qrLot.dlcAt)}</b>
                </div>
                <div>
                  <span style={{ color: 'var(--on-surface-3)' }}>Quantité </span>
                  {qrLot.quantity}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, width: '100%' }}>
                <button
                  onClick={() => printLotLabel(qrLot)}
                  className="btn-secondary"
                  style={{ flex: 1, fontSize: 13 }}
                >
                  🖨️ Imprimer
                </button>
                <button
                  onClick={() => setQrLot(null)}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 14, fontSize: 13, fontWeight: 600,
                    background: 'var(--surface-mid)', border: 'none',
                    color: 'var(--on-surface-2)', cursor: 'pointer',
                  }}
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        )
      })()}

    </div>
  )
}
