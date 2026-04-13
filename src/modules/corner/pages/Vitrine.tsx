import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Timestamp, addDoc, collection, getDocs, getDocsFromServer, query, updateDoc, deleteDoc, doc, where, limit, orderBy } from 'firebase/firestore'
import { db, auth } from '../../../firebase/config'
import { useToast } from '../../../hooks/useToast'


type StockItem = {
  id: string; productName: string
  dlcAt: any; fabricationAt: any; dateAjout: any
  active: boolean; createdAt: any
  retireAt?: any; lotCode?: string
}

type LotCuisine = {
  id: string; lotCode: string; productName: string
  producedAt: any; dlcAt: any
}

function localISO(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return localISO(d)
}

function toTimestamp(iso: string) {
  return Timestamp.fromDate(new Date(iso + 'T23:59:00'))
}

function dlcStatus(dlcAt: any): 'expire' | 'today' | 'tomorrow' | 'ok' {
  if (!dlcAt?.toDate) return 'ok'
  const d = dlcAt.toDate(); const now = new Date(); now.setHours(0,0,0,0)
  const tom = new Date(now); tom.setDate(tom.getDate()+1)
  const dat = new Date(tom); dat.setDate(dat.getDate()+1)
  if (d < now) return 'expire'
  if (d < tom) return 'today'
  if (d < dat) return 'tomorrow'
  return 'ok'
}

export default function Vitrine() {
  const { show } = useToast()
  const [mainTab, setMainTab] = useState<'stock' | 'lots' | 'historique'>('stock')
  const [items, setItems]         = useState<StockItem[]>([])
  const [loading, setLoading]     = useState(false)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [showForm, setShowForm]   = useState(false)

  // --- Historique ---
  function thirtyDaysAgo() {
    const d = new Date(); d.setDate(d.getDate() - 30); return localISO(d)
  }
  const [histItems, setHistItems] = useState<StockItem[]>([])
  const [histLoading, setHistLoading] = useState(false)
  const [histSearch, setHistSearch] = useState('')
  const [histFrom, setHistFrom] = useState(thirtyDaysAgo)
  const [histTo, setHistTo] = useState(localISO())

  // Mode formulaire
  const [formMode, setFormMode]   = useState<'manuel' | 'lot'>('manuel')

  // Mode manuel — saisie lot
  const [produitsList, setProduitsList] = useState<string[]>([])
  const [produitsLoading, setProduitsLoading] = useState(false)
  const [dateAjout, setDateAjout]   = useState(localISO())
  const [dateFab, setDateFab]       = useState(localISO())
  const [selected, setSelected]     = useState<Set<string>>(new Set())
  const [search, setSearch]         = useState('')

  // Mode lot cuisine (formulaire)
  const [lots, setLots]             = useState<LotCuisine[]>([])
  const [lotsLoading, setLotsLoading] = useState(false)
  const [selectedLotIds, setSelectedLotIds] = useState<Set<string>>(new Set())

  // Onglet Lots — gestion lots reçus
  type LotRecu = { id: string; lotCode: string; productName: string; producedAt: any; dlcAt: any; sentToCornerAt: any }
  const [lotsRecus, setLotsRecus]         = useState<LotRecu[]>([])
  const [lotsRecusLoading, setLotsRecusLoading] = useState(false)
  const [lotsRecusSearch, setLotsRecusSearch]   = useState('')
  const [lotActionItem, setLotActionItem] = useState<LotRecu | null>(null)

  async function loadLotsRecus() {
    setLotsRecusLoading(true)
    try {
      const snap = await getDocs(query(
        collection(db, 'lots_cuisine'),
        where('sent', '==', true),
        limit(200),
      ))
      const docs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as LotRecu[]
      docs.sort((a, b) => (b.sentToCornerAt?.seconds ?? 0) - (a.sentToCornerAt?.seconds ?? 0))
      setLotsRecus(docs)
    } catch { /* silencieux */ }
    finally { setLotsRecusLoading(false) }
  }

  async function renvoyerLotCuisine(lot: LotRecu) {
    setLotActionItem(null)
    await updateDoc(doc(db, 'lots_cuisine', lot.id), { sent: false, sentToCornerAt: null })
    show(`"${lot.productName}" renvoyé en cuisine`)
    await loadLotsRecus()
  }

  async function supprimerLot(lot: LotRecu) {
    setLotActionItem(null)
    if (!confirm(`Supprimer définitivement le lot "${lot.lotCode}" (${lot.productName}) ?\nCette action est irréversible.`)) return
    await deleteDoc(doc(db, 'lots_cuisine', lot.id))
    show(`Lot "${lot.lotCode}" supprimé`)
    await loadLotsRecus()
  }

  const dlcAuto = addDays(dateFab, 3)

  async function load() {
    setLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'corner_stock'), where('active', '==', true), limit(300)))
      const loaded = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as StockItem[]
      const dlcOrder = { expire: 0, today: 1, tomorrow: 2, ok: 3 }
      loaded.sort((a, b) => {
        const sa = dlcOrder[dlcStatus(a.dlcAt)]
        const sb = dlcOrder[dlcStatus(b.dlcAt)]
        if (sa !== sb) return sa - sb
        return (a.productName || '').localeCompare(b.productName || '', 'fr', { sensitivity: 'base' })
      })
      setItems(loaded)
    } catch (e: any) { setError(e?.message) }
    finally { setLoading(false) }
  }

  async function loadHistorique() {
    setHistLoading(true)
    try {
      const [y1,m1,d1] = histFrom.split('-').map(Number)
      const [y2,m2,d2] = histTo.split('-').map(Number)
      const start = Timestamp.fromDate(new Date(y1,m1-1,d1,0,0,0))
      const end   = Timestamp.fromDate(new Date(y2,m2-1,d2,23,59,59))
      const snap = await getDocs(query(
        collection(db, 'corner_stock'),
        where('dateAjout', '>=', start),
        where('dateAjout', '<=', end),
        orderBy('dateAjout', 'desc'),
        limit(300),
      ))
      setHistItems(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as StockItem[])
    } catch (e: any) { setError(e?.message) }
    finally { setHistLoading(false) }
  }

  useEffect(() => { load() }, [])
  useEffect(() => { if (mainTab === 'historique') loadHistorique() }, [mainTab, histFrom, histTo])
  useEffect(() => { if (mainTab === 'lots') loadLotsRecus() }, [mainTab])

  async function loadProduits() {
    setProduitsLoading(true)
    try {
      const snap = await getDocs(query(
        collection(db, 'catalogue'),
        where('inVitrine', '==', true),
        where('active', '==', true),
      ))
      const names = snap.docs
        .map(d => (d.data() as any).name as string)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
      setProduitsList(names)
    } catch { /* silencieux */ }
    finally { setProduitsLoading(false) }
  }

  async function loadLots() {
    setLotsLoading(true)
    try {
      // getDocs (pas getDocsFromServer) pour compatibilité iPad WiFi + lots sans sentToCornerAt
      const [snap, vitrineSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'lots_cuisine'),
          where('sent', '==', true),
          limit(100),
        )),
        getDocs(query(collection(db, 'corner_stock'), limit(300))),
      ])

      const allRaw = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as (LotCuisine & { archived?: boolean; sentToCornerAt?: any })[]
      // Tri JS par sentToCornerAt desc (remplace l'orderBy Firestore supprimé)
      allRaw.sort((a, b) => (b.sentToCornerAt?.seconds ?? 0) - (a.sentToCornerAt?.seconds ?? 0))

      // Déduplication par lotCode (garde le plus récent vu le tri desc)
      const seenLotCodes = new Set<string>()
      const all = allRaw.filter(l => {
        if (!l.lotCode || seenLotCodes.has(l.lotCode)) return false
        seenLotCodes.add(l.lotCode)
        return true
      })

      // Tous les lots avec sent:true sont proposables — le filtre Firestore exclut déjà
      // les lots ajoutés en vitrine (sent: false) et les lots masqués (sent: false, archived: true).
      // On n'exige plus archived: true : en pratique la validation de réception peut ne pas
      // avoir été faite numériquement même si le produit est physiquement arrivé au corner.

      const vitrineData = vitrineSnap.docs.map(d => (d.data() as any))
      // LotCodes dans TOUS les docs corner_stock (actifs ou non) — si le lotCode a déjà été traité, ne pas re-proposer
      const allVitrineLosCodes = new Set(vitrineSnap.docs.map(d => (d.data() as any).lotCode).filter(Boolean))
      // ProductNames ACTIFS en vitrine — permet de re-stocker un produit déjà vendu
      const vitrineNamesLower = new Set(vitrineData.filter(d => d.active !== false).map(d => (d.productName as string)?.toLowerCase()?.trim()).filter(Boolean))

      // Auto-réparer les lots bloqués avec sent:true alors qu'ils sont déjà dans corner_stock
      const lotsOrphelins = all.filter(l => l.lotCode && allVitrineLosCodes.has(l.lotCode))
      if (lotsOrphelins.length > 0) {
        Promise.all(lotsOrphelins.map(l =>
          updateDoc(doc(db, 'lots_cuisine', l.id), { sent: false, archived: true })
        )).catch(() => {})
      }

      // Exclure : lotCode déjà dans corner_stock (tout statut) OU productName actif en vitrine
      setLots(all.filter(l => !allVitrineLosCodes.has(l.lotCode) && !vitrineNamesLower.has(l.productName?.toLowerCase()?.trim())))
    } catch (e: any) { setError(e?.message) }
    finally { setLotsLoading(false) }
  }

  function openForm() {
    const next = !showForm
    setShowForm(next)
    setSelected(new Set()); setSearch(''); setSelectedLotIds(new Set())
    if (next) { loadProduits(); setFormMode('manuel') }
  }

  function switchMode(m: 'manuel' | 'lot') {
    setFormMode(m)
    setSelected(new Set()); setSearch(''); setSelectedLotIds(new Set())
    if (m === 'lot') loadLots()
  }

  function toggleProduct(p: string) {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(p) ? n.delete(p) : n.add(p)
      return n
    })
  }

  async function saveLot() {
    if (selected.size === 0) return
    // Anti-doublon : même productName + même date fabrication déjà actif en vitrine
    const dups = Array.from(selected).filter(productName =>
      items.some(i =>
        i.productName === productName &&
        i.fabricationAt?.toDate &&
        localISO(i.fabricationAt.toDate()) === dateFab
      )
    )
    if (dups.length > 0) {
      show(`Doublon : "${dups.join(', ')}" du ${dateFab} est déjà en vitrine.`, 'error')
      return
    }
    setSaving(true); setError(null)
    try {
      const uid = auth.currentUser?.uid || ''
      const dlcTs = toTimestamp(dlcAuto)
      const fabTs = toTimestamp(dateFab)
      const ajoutTs = toTimestamp(dateAjout)
      for (const productName of selected) {
        await addDoc(collection(db, 'corner_stock'), {
          productName, dlcAt: dlcTs, fabricationAt: fabTs, dateAjout: ajoutTs,
          active: true, createdAt: Timestamp.now(), createdBy: uid,
        })
      }
      setSelected(new Set()); setShowForm(false); setSearch('')
      show('Produit(s) ajouté(s) en vitrine')
      await load()
    } catch (e: any) { setError(e?.message) }
    finally { setSaving(false) }
  }

  async function masquerLot(lot: LotCuisine) {
    await updateDoc(doc(db, 'lots_cuisine', lot.id), {
      archived: true, archivedAt: Timestamp.now(), sent: false,
    })
    setLots(prev => prev.filter(l => l.id !== lot.id))
    setSelectedLotIds(prev => { const n = new Set(prev); n.delete(lot.id); return n })
  }

  async function saveLotCuisine() {
    if (selectedLotIds.size === 0) return
    const toAdd = lots.filter(l => selectedLotIds.has(l.id))
    setSaving(true); setError(null)
    try {
      const uid = auth.currentUser?.uid || ''
      for (const lot of toAdd) {
        const fabDay = lot.producedAt?.toDate ? localISO(lot.producedAt.toDate()) : null
        if (fabDay) {
          const dup = items.find(i => i.productName === lot.productName && i.fabricationAt?.toDate && localISO(i.fabricationAt.toDate()) === fabDay)
          if (dup) {
            show(`"${lot.productName}" du ${fabDay} est déjà en vitrine — lot ignoré`, 'error')
            continue
          }
        }
        await addDoc(collection(db, 'corner_stock'), {
          productName: lot.productName, fabricationAt: lot.producedAt, dlcAt: lot.dlcAt,
          dateAjout: Timestamp.now(), lotCode: lot.lotCode,
          active: true, createdAt: Timestamp.now(), createdBy: uid,
        })
        // Archiver le lot dans lots_cuisine + sent: false → double protection (filtre serveur + filtre JS)
        await updateDoc(doc(db, 'lots_cuisine', lot.id), {
          archived: true, archivedAt: Timestamp.now(), sent: false,
        })
      }
      setSelectedLotIds(new Set()); setShowForm(false)
      show(`${toAdd.length} produit(s) ajouté(s) en vitrine`)
      await load()
    } catch (e: any) { setError(e?.message) }
    finally { setSaving(false) }
  }

  async function retirer(id: string, name: string) {
    if (!confirm(`Retirer "${name}" ?`)) return
    await updateDoc(doc(db, 'corner_stock', id), {
      active: false, retireAt: Timestamp.now(), retireBy: auth.currentUser?.uid || '',
    })
    await load()
  }

  async function renvoyerCuisine(item: StockItem) {
    await updateDoc(doc(db, 'corner_stock', item.id), {
      active: false,
      retireAt: Timestamp.now(),
      retireBy: auth.currentUser?.uid || '',
      retireReason: 'returned_to_kitchen',
    })
    // Si l'item vient d'un lot cuisine, remettre sent à false pour qu'il réapparaisse côté cuisine
    if (item.lotCode) {
      try {
        const snap = await getDocs(query(
          collection(db, 'lots_cuisine'),
          where('lotCode', '==', item.lotCode),
          limit(1),
        ))
        if (!snap.empty) {
          await updateDoc(snap.docs[0].ref, { sent: false, sentToCornerAt: null })
        }
      } catch { /* silencieux */ }
    }
    show(`"${item.productName}" renvoyé en cuisine`)
    await load()
  }

  async function supprimerItem(item: StockItem) {
    if (!confirm(`Supprimer définitivement "${item.productName}" ?\nCette action est irréversible.`)) return
    await deleteDoc(doc(db, 'corner_stock', item.id))
    show(`"${item.productName}" supprimé`)
    await load()
  }

  const urgents = items.filter(i => ['expire','today'].includes(dlcStatus(i.dlcAt)))
  const filtered = produitsList.filter(p => p.toLowerCase().includes(search.toLowerCase()))

  function dlcChip(st: 'expire' | 'today' | 'tomorrow' | 'ok') {
    if (st === 'expire') return <span className="chip-danger">Expiré</span>
    if (st === 'today') return <span className="chip-warn">Auj.</span>
    if (st === 'tomorrow') return <span className="chip-warn">Demain</span>
    return <span className="chip-ok">OK</span>
  }

  return (
    <div className="page">

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <p className="section-label" style={{ marginBottom: 2 }}>Corner · Stocks</p>
          <h1 style={{
            fontFamily: 'Epilogue, sans-serif', fontSize: 26, fontWeight: 800,
            color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0,
          }}>
            Vitrine
          </h1>
        </div>
        {mainTab === 'stock' && (
          <button
            onClick={openForm}
            className={showForm ? 'btn-secondary' : 'btn-primary'}
            style={{ width: 'auto', padding: '10px 18px', fontSize: 13, marginTop: 4 }}
          >
            {showForm ? 'Annuler' : '+ Ajouter'}
          </button>
        )}
      </div>

      {/* ── Onglets ── */}
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--surface-mid)', borderRadius: 14 }}>
        {([
          { key: 'stock', label: 'Vitrine' },
          { key: 'lots', label: 'Lots' },
          { key: 'historique', label: 'Historique' },
        ] as const).map(({ key, label }) => (
          <button key={key} onClick={() => setMainTab(key)} style={{
            flex: 1, padding: '9px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: mainTab === key ? 'var(--surface)' : 'transparent',
            color: mainTab === key ? 'var(--primary)' : 'var(--on-surface-3)',
            fontWeight: 700, fontFamily: 'Manrope, sans-serif', fontSize: 13,
            boxShadow: mainTab === key ? '0 1px 6px rgba(28,28,24,0.08)' : 'none',
            transition: 'all 0.15s',
          }}>
            {label}
          </button>
        ))}
      </div>

      {/* ════════════════ STOCK (VITRINE) ════════════════ */}
      {mainTab === 'stock' && (
        <>
          {/* Alerte DLC urgents */}
          {urgents.length > 0 && (
            <div style={{
              padding: '12px 16px',
              background: 'rgba(192,57,43,0.06)', border: '1px solid rgba(192,57,43,0.18)',
              borderRadius: 12, fontSize: 13, color: 'var(--danger)', fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span>⚠️</span>
              <span>{urgents.length} produit(s) expiré(s) ou expirant aujourd'hui</span>
            </div>
          )}

          {error && (
            <div style={{
              padding: '10px 14px', background: 'rgba(192,57,43,0.06)',
              color: 'var(--danger)', borderRadius: 10, fontSize: 13,
              border: '1px solid rgba(192,57,43,0.18)',
            }}>
              {error}
            </div>
          )}

          {/* ── Formulaire ajout ── */}
          {showForm && (
            <div className="card" style={{ border: '1.5px solid rgba(0,66,117,0.12)' }}>

              {/* Onglets mode saisie */}
              <div style={{
                display: 'flex', gap: 4, marginBottom: 16,
                background: 'var(--surface-mid)', borderRadius: 12, padding: 4,
              }}>
                {(['manuel', 'lot'] as const).map(m => (
                  <button key={m} onClick={() => switchMode(m)} style={{
                    flex: 1, padding: '8px 0', borderRadius: 9, fontSize: 12, fontWeight: 700,
                    border: 'none', cursor: 'pointer', fontFamily: 'Manrope, sans-serif',
                    background: formMode === m ? 'var(--surface)' : 'transparent',
                    color: formMode === m ? 'var(--primary)' : 'var(--on-surface-3)',
                    boxShadow: formMode === m ? '0 1px 6px rgba(28,28,24,0.08)' : 'none',
                    transition: 'all 0.15s',
                  }}>
                    {m === 'manuel' ? '✏️ Saisie manuelle' : '📦 Depuis lot cuisine'}
                  </button>
                ))}
              </div>

              {formMode === 'lot' ? (
                /* ── Mode lot cuisine ── */
                <div>
                  {lotsLoading ? (
                    <div style={{ textAlign: 'center', padding: '20px 0' }}>
                      <div className="spinner" style={{ margin: '0 auto' }} />
                    </div>
                  ) : lots.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '24px 0' }}>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>📦</div>
                      <p style={{
                        color: 'var(--on-surface-3)', fontSize: 13, margin: 0,
                        fontFamily: 'Manrope, sans-serif',
                      }}>
                        Aucun lot envoyé depuis la cuisine.<br />
                        Envoyez des lots depuis l'onglet Livraisons en cuisine.
                      </p>
                    </div>
                  ) : (
                    <div style={{
                      display: 'flex', flexDirection: 'column', gap: 6,
                      maxHeight: 360, overflowY: 'auto', marginBottom: 14,
                    }}>
                      {lots.map(lot => {
                        const prodAt = lot.producedAt?.toDate ? lot.producedAt.toDate() : null
                        const dlcAtD  = lot.dlcAt?.toDate ? lot.dlcAt.toDate() : null
                        const sel = selectedLotIds.has(lot.id)
                        return (
                          <div
                            key={lot.id}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 10,
                              padding: '11px 12px', borderRadius: 12,
                              background: sel ? 'rgba(0,66,117,0.08)' : 'var(--surface-low)',
                              border: `1.5px solid ${sel ? 'rgba(0,66,117,0.3)' : 'var(--border-soft)'}`,
                              transition: 'all 0.12s',
                            }}
                          >
                            {/* Checkbox custom */}
                            <div
                              onClick={() => setSelectedLotIds(prev => { const n = new Set(prev); sel ? n.delete(lot.id) : n.add(lot.id); return n })}
                              style={{
                                width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                                background: sel ? 'var(--primary)' : 'var(--surface)',
                                border: `2px solid ${sel ? 'var(--primary)' : 'var(--border)'}`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                cursor: 'pointer', transition: 'all 0.12s',
                              }}>
                              {sel && (
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
                                  stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12"/>
                                </svg>
                              )}
                            </div>
                            <div
                              onClick={() => setSelectedLotIds(prev => { const n = new Set(prev); sel ? n.delete(lot.id) : n.add(lot.id); return n })}
                              style={{ flex: 1, minWidth: 0, cursor: 'pointer', userSelect: 'none', WebkitTapHighlightColor: 'transparent' }}
                            >
                              <div style={{
                                fontSize: 13, fontWeight: 600, color: 'var(--on-surface)', marginBottom: 2,
                              }}>
                                {lot.productName}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--on-surface-3)' }}>
                                {lot.lotCode}
                                {prodAt && ` · Fab. ${prodAt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`}
                                {dlcAtD && ` · DLC ${dlcAtD.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`}
                              </div>
                            </div>
                            <button
                              onClick={e => { e.stopPropagation(); masquerLot(lot) }}
                              title="Déjà en vitrine — masquer"
                              style={{
                                flexShrink: 0, padding: '4px 8px', borderRadius: 8,
                                border: '1px solid var(--border)', background: 'var(--surface)',
                                color: 'var(--on-surface-3)', fontSize: 11, cursor: 'pointer',
                                fontFamily: 'Manrope, sans-serif', lineHeight: 1.2,
                              }}
                            >
                              ✓ déjà là
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <button onClick={saveLotCuisine} disabled={saving || selectedLotIds.size === 0} className="btn-primary">
                    {saving ? 'Enregistrement…' : selectedLotIds.size > 0 ? `Ajouter ${selectedLotIds.size} lot(s)` : 'Sélectionner des lots'}
                  </button>
                </div>
              ) : (
                /* ── Mode manuel ── */
                <div>
                  <p style={{
                    fontSize: 13, fontWeight: 600, color: 'var(--on-surface)',
                    margin: '0 0 16px', fontFamily: 'Manrope, sans-serif',
                  }}>
                    Saisie lot — même date de fabrication
                  </p>

                  {/* Dates */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div>
                      <p className="section-label" style={{ marginBottom: 5 }}>Date ajout</p>
                      <input type="date" className="input-filled" value={dateAjout}
                        onChange={e => setDateAjout(e.target.value)} />
                    </div>
                    <div>
                      <p className="section-label" style={{ marginBottom: 5 }}>Date fabrication</p>
                      <input type="date" className="input-filled" value={dateFab}
                        onChange={e => setDateFab(e.target.value)} />
                    </div>
                  </div>

                  {/* DLC auto */}
                  <div style={{ marginBottom: 14 }}>
                    <p className="section-label" style={{ marginBottom: 5 }}>DLC auto (J+3)</p>
                    <div style={{
                      height: 44, display: 'flex', alignItems: 'center', paddingLeft: 14,
                      background: 'rgba(84,101,30,0.10)', border: '1px solid rgba(84,101,30,0.25)',
                      borderRadius: 10, fontSize: 14, fontWeight: 700, color: 'var(--secondary)',
                    }}>
                      {new Date(dlcAuto + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                    </div>
                  </div>

                  {/* Recherche produit */}
                  <input
                    className="input-filled"
                    placeholder="Rechercher un produit…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ marginBottom: 10 }}
                  />

                  {/* Sélection tout / aucun */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <button onClick={() => setSelected(new Set(filtered))} style={{
                      background: 'none', border: 'none', color: 'var(--primary)', fontSize: 12,
                      fontWeight: 700, cursor: 'pointer', padding: 0, fontFamily: 'Manrope, sans-serif',
                    }}>
                      Tout sélectionner
                    </button>
                    <span style={{ color: 'var(--on-surface-3)', fontSize: 12 }}>·</span>
                    <button onClick={() => setSelected(new Set())} style={{
                      background: 'none', border: 'none', color: 'var(--on-surface-3)', fontSize: 12,
                      fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'Manrope, sans-serif',
                    }}>
                      Aucun
                    </button>
                    {selected.size > 0 && (
                      <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>
                        {selected.size} sélectionné(s)
                      </span>
                    )}
                  </div>

                  {/* Liste produits */}
                  <div style={{
                    maxHeight: 300, overflowY: 'auto',
                    display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14,
                  }}>
                    {filtered.map(p => {
                      const on = selected.has(p)
                      return (
                        <div
                          key={p}
                          onClick={() => toggleProduct(p)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                            background: on ? 'rgba(0,66,117,0.08)' : 'var(--surface-low)',
                            border: `1.5px solid ${on ? 'rgba(0,66,117,0.25)' : 'var(--border-soft)'}`,
                            transition: 'background 0.12s, border-color 0.12s',
                            userSelect: 'none', WebkitTapHighlightColor: 'transparent',
                          }}
                        >
                          {/* Checkbox custom */}
                          <div style={{
                            width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                            background: on ? 'var(--primary)' : 'var(--surface)',
                            border: `2px solid ${on ? 'var(--primary)' : 'var(--border)'}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'all 0.12s',
                          }}>
                            {on && (
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
                                stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                            )}
                          </div>
                          <span style={{
                            fontSize: 13, fontWeight: on ? 600 : 400,
                            color: on ? 'var(--primary)' : 'var(--on-surface-2)',
                            fontFamily: 'Manrope, sans-serif',
                          }}>
                            {p}
                          </span>
                        </div>
                      )
                    })}

                    {produitsLoading && (
                      <div style={{ textAlign: 'center', padding: '16px 0' }}>
                        <div className="spinner" style={{ margin: '0 auto' }} />
                      </div>
                    )}
                    {!produitsLoading && produitsList.length === 0 && (
                      <p style={{
                        textAlign: 'center', color: 'var(--on-surface-3)', fontSize: 13,
                        padding: '16px 0', margin: 0,
                      }}>
                        Aucun produit vitrine configuré — activez le flag dans Admin &gt; Produits.
                      </p>
                    )}
                    {!produitsLoading && filtered.length === 0 && produitsList.length > 0 && (
                      <p style={{
                        textAlign: 'center', color: 'var(--on-surface-3)', fontSize: 13,
                        padding: '16px 0', margin: 0,
                      }}>
                        Aucun produit trouvé
                      </p>
                    )}
                  </div>

                  <button onClick={saveLot} disabled={saving || selected.size === 0} className="btn-primary">
                    {saving ? 'Enregistrement…' : `Enregistrer ${selected.size > 0 ? selected.size + ' produit(s)' : ''}`}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Tables DLC alertes ── */}
          {!loading && (() => {
            const expired = items.filter(i => dlcStatus(i.dlcAt) === 'expire')
            const today   = items.filter(i => dlcStatus(i.dlcAt) === 'today')
            if (expired.length === 0 && today.length === 0) return null
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                {/* DLC DÉPASSÉE */}
                {expired.length > 0 && (
                  <div>
                    <p className="section-label" style={{ marginBottom: 8, color: 'var(--danger)' }}>
                      DLC dépassée — {expired.length} produit(s)
                    </p>
                    <div style={{
                      borderRadius: 12, overflow: 'hidden',
                      border: '1px solid rgba(192,57,43,0.2)',
                    }}>
                      <div style={{
                        display: 'grid', gridTemplateColumns: '1fr 52px 52px 44px', gap: 4,
                        padding: '6px 12px', background: 'rgba(192,57,43,0.08)',
                      }}>
                        {['Produit', 'Fabrication', 'DLC', ''].map(h => (
                          <span key={h} style={{
                            fontSize: 10, fontWeight: 700, color: 'var(--danger)',
                            textTransform: 'uppercase', letterSpacing: '0.06em',
                          }}>
                            {h}
                          </span>
                        ))}
                      </div>
                      {expired.map((item, idx) => {
                        const fabStr = item.fabricationAt?.toDate
                          ? item.fabricationAt.toDate().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
                          : '—'
                        const dlcStr = item.dlcAt?.toDate
                          ? item.dlcAt.toDate().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
                          : '—'
                        return (
                          <div key={item.id} style={{
                            display: 'grid', gridTemplateColumns: '1fr 52px 52px 44px',
                            gap: 4, alignItems: 'center', padding: '8px 12px', fontSize: 12,
                            background: idx % 2 === 0 ? 'rgba(192,57,43,0.04)' : 'transparent',
                            borderTop: '1px solid rgba(192,57,43,0.08)',
                          }}>
                            <span style={{
                              fontWeight: 600, color: 'var(--on-surface)',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {item.productName}
                            </span>
                            <span style={{ color: 'var(--on-surface-3)' }}>{fabStr}</span>
                            <span style={{ fontWeight: 700, color: 'var(--danger)' }}>{dlcStr}</span>
                            <button
                              onClick={e => { e.stopPropagation(); retirer(item.id, item.productName) }}
                              style={{
                                background: 'rgba(192,57,43,0.10)', border: '1px solid rgba(192,57,43,0.2)',
                                borderRadius: 8, color: 'var(--danger)', fontSize: 11, fontWeight: 700,
                                cursor: 'pointer', padding: '3px 8px', whiteSpace: 'nowrap',
                              }}
                            >
                              Retirer
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* DLC DU JOUR */}
                {today.length > 0 && (
                  <div>
                    <p className="section-label" style={{ marginBottom: 8, color: 'var(--warning)' }}>
                      DLC du jour — {today.length} produit(s)
                    </p>
                    <div style={{
                      borderRadius: 12, overflow: 'hidden',
                      border: '1px solid rgba(180,83,9,0.2)',
                    }}>
                      <div style={{
                        display: 'grid', gridTemplateColumns: '1fr 52px 52px 44px', gap: 4,
                        padding: '6px 12px', background: 'rgba(180,83,9,0.06)',
                      }}>
                        {['Produit', 'Fabrication', 'DLC', ''].map(h => (
                          <span key={h} style={{
                            fontSize: 10, fontWeight: 700, color: 'var(--warning)',
                            textTransform: 'uppercase', letterSpacing: '0.06em',
                          }}>
                            {h}
                          </span>
                        ))}
                      </div>
                      {today.map((item, idx) => {
                        const fabStr = item.fabricationAt?.toDate
                          ? item.fabricationAt.toDate().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
                          : '—'
                        const dlcStr = item.dlcAt?.toDate
                          ? item.dlcAt.toDate().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
                          : '—'
                        return (
                          <div key={item.id} style={{
                            display: 'grid', gridTemplateColumns: '1fr 52px 52px 44px',
                            gap: 4, alignItems: 'center', padding: '8px 12px', fontSize: 12,
                            background: idx % 2 === 0 ? 'rgba(180,83,9,0.03)' : 'transparent',
                            borderTop: '1px solid rgba(180,83,9,0.08)',
                          }}>
                            <span style={{
                              fontWeight: 600, color: 'var(--on-surface)',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {item.productName}
                            </span>
                            <span style={{ color: 'var(--on-surface-3)' }}>{fabStr}</span>
                            <span style={{ fontWeight: 700, color: 'var(--warning)' }}>{dlcStr}</span>
                            <button
                              onClick={e => { e.stopPropagation(); retirer(item.id, item.productName) }}
                              style={{
                                background: 'rgba(180,83,9,0.08)', border: '1px solid rgba(180,83,9,0.2)',
                                borderRadius: 8, color: 'var(--warning)', fontSize: 11, fontWeight: 700,
                                cursor: 'pointer', padding: '3px 8px',
                              }}
                            >
                              Retirer
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {/* ── Liste stock actif ── */}
          {loading ? (
            <div style={{ padding: '40px 20px', textAlign: 'center' }}>
              <div className="spinner" style={{ margin: '0 auto' }} />
            </div>
          ) : items.length === 0 ? (
            <div className="card" style={{ padding: '44px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🏪</div>
              <p style={{
                fontFamily: 'Epilogue, sans-serif', fontWeight: 700, fontSize: 16,
                color: 'var(--on-surface)', margin: '0 0 6px',
              }}>
                Vitrine vide
              </p>
              <p style={{ color: 'var(--on-surface-3)', fontSize: 13, margin: 0 }}>
                Ajoutez vos premiers produits avec le bouton ci-dessus
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map(item => {
                const st = dlcStatus(item.dlcAt)
                const dlcStr = item.dlcAt?.toDate
                  ? item.dlcAt.toDate().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
                  : '—'
                const fabStr = item.fabricationAt?.toDate
                  ? item.fabricationAt.toDate().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
                  : null
                const isExpired = st === 'expire'
                return (
                  <div key={item.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '11px 14px', borderRadius: 12,
                    background: isExpired ? 'rgba(192,57,43,0.04)' : 'var(--surface-low)',
                    border: `1px solid ${isExpired ? 'rgba(192,57,43,0.15)' : 'var(--border-soft)'}`,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, fontWeight: 600, color: 'var(--on-surface)',
                        marginBottom: 2, lineHeight: 1.3,
                      }}>
                        {item.productName}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--on-surface-3)' }}>
                        {fabStr && `Fab. ${fabStr} · `}DLC {dlcStr}
                      </div>
                    </div>
                    {dlcChip(st)}
                    <button
                      onClick={() => retirer(item.id, item.productName)}
                      style={{
                        background: 'rgba(192,57,43,0.07)', border: '1px solid rgba(192,57,43,0.2)',
                        borderRadius: 8, color: 'var(--danger)', fontSize: 11, fontWeight: 700,
                        cursor: 'pointer', padding: '4px 10px', flexShrink: 0,
                        fontFamily: 'Manrope, sans-serif', whiteSpace: 'nowrap',
                      }}
                    >
                      Retirer
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ════════════════ LOTS REÇUS ════════════════ */}
      {mainTab === 'lots' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              className="input-filled"
              placeholder="Rechercher un lot ou produit…"
              value={lotsRecusSearch}
              onChange={e => setLotsRecusSearch(e.target.value)}
              style={{ flex: 1 }}
            />
            <button onClick={loadLotsRecus} className="btn-secondary"
              style={{ width: 'auto', padding: '10px 14px', fontSize: 13, flexShrink: 0 }}>
              ↺
            </button>
          </div>

          {lotsRecusLoading && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div className="spinner" style={{ margin: '0 auto' }} />
            </div>
          )}

          {!lotsRecusLoading && (() => {
            const filtered = lotsRecus.filter(l =>
              !lotsRecusSearch ||
              l.productName?.toLowerCase().includes(lotsRecusSearch.toLowerCase()) ||
              l.lotCode?.toLowerCase().includes(lotsRecusSearch.toLowerCase())
            )
            if (filtered.length === 0) return (
              <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>📦</div>
                <p style={{
                  fontFamily: 'Epilogue, sans-serif', fontWeight: 700, fontSize: 15,
                  color: 'var(--on-surface)', margin: '0 0 6px',
                }}>
                  Aucun lot reçu de la cuisine
                </p>
                <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: 0 }}>
                  Les lots envoyés depuis la cuisine apparaissent ici
                </p>
              </div>
            )
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {filtered.map(lot => {
                  const prodAt = lot.producedAt?.toDate ? lot.producedAt.toDate() : null
                  const dlcAtD = lot.dlcAt?.toDate ? lot.dlcAt.toDate() : null
                  const sentAt = lot.sentToCornerAt?.toDate ? lot.sentToCornerAt.toDate() : null
                  const now = new Date(); now.setHours(0,0,0,0)
                  const dlcExpired = dlcAtD && dlcAtD < now
                  return (
                    <div key={lot.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '12px 14px', borderRadius: 12,
                      background: dlcExpired ? 'rgba(192,57,43,0.04)' : 'var(--surface-low)',
                      border: `1px solid ${dlcExpired ? 'rgba(192,57,43,0.18)' : 'var(--border-soft)'}`,
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 13, fontWeight: 700, color: 'var(--on-surface)',
                          marginBottom: 2, lineHeight: 1.3,
                        }}>
                          {lot.productName}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--on-surface-3)', fontFamily: 'monospace' }}>
                          {lot.lotCode}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 2 }}>
                          {prodAt && `Fab. ${prodAt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`}
                          {dlcAtD && ` · DLC ${dlcAtD.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`}
                          {sentAt && ` · Reçu ${sentAt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`}
                        </div>
                      </div>
                      {dlcExpired && <span className="chip-danger">Expiré</span>}
                      <button
                        onClick={() => setLotActionItem(lot)}
                        style={{
                          background: 'none', border: 'none', color: 'var(--on-surface-3)',
                          cursor: 'pointer', fontSize: 18, padding: '0 4px', lineHeight: 1,
                          flexShrink: 0,
                        }}
                      >
                        ⋯
                      </button>
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </>
      )}

      {/* ════════════════ HISTORIQUE ════════════════ */}
      {mainTab === 'historique' && (
        <>
          {/* Filtres date */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <p className="section-label" style={{ marginBottom: 5 }}>Du</p>
              <input type="date" className="input-filled" value={histFrom} max={histTo}
                onChange={e => setHistFrom(e.target.value)} />
            </div>
            <div>
              <p className="section-label" style={{ marginBottom: 5 }}>Au</p>
              <input type="date" className="input-filled" value={histTo} max={localISO()}
                onChange={e => setHistTo(e.target.value)} />
            </div>
          </div>

          {/* Recherche texte */}
          <input
            className="input-filled"
            placeholder="Filtrer par produit…"
            value={histSearch}
            onChange={e => setHistSearch(e.target.value)}
          />

          {histLoading && (
            <div style={{ textAlign: 'center', padding: '30px 0' }}>
              <div className="spinner" style={{ margin: '0 auto' }} />
            </div>
          )}

          {!histLoading && (() => {
            const filteredHist = histItems.filter(i =>
              !histSearch || i.productName.toLowerCase().includes(histSearch.toLowerCase())
            )
            if (filteredHist.length === 0) return (
              <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
                <p style={{
                  fontFamily: 'Epilogue, sans-serif', fontWeight: 700, fontSize: 15,
                  color: 'var(--on-surface)', margin: '0 0 6px',
                }}>
                  Aucun produit sur cette période
                </p>
                <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: 0 }}>
                  Modifiez la plage de dates ou la recherche
                </p>
              </div>
            )
            return (
              <div style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border)' }}>
                {/* En-tête tableau */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 64px 64px 64px 64px 56px',
                  gap: 4, padding: '7px 12px', background: 'var(--surface-mid)',
                }}>
                  {['Produit', 'Ajouté', 'Fab.', 'DLC', 'Retiré', 'Statut'].map(h => (
                    <span key={h} className="section-label" style={{ fontSize: 9 }}>{h}</span>
                  ))}
                </div>
                {filteredHist.map((item, idx) => {
                  const fmt = (ts: any) => ts?.toDate
                    ? ts.toDate().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
                    : '—'
                  const isRetired = !item.active
                  const stDlc = dlcStatus(item.dlcAt)
                  return (
                    <div key={item.id} style={{
                      display: 'grid', gridTemplateColumns: '1fr 64px 64px 64px 64px 56px',
                      gap: 4, alignItems: 'center', padding: '9px 12px', fontSize: 12,
                      background: idx % 2 === 0 ? 'var(--surface)' : 'var(--surface-low)',
                      borderTop: '1px solid var(--border-soft)',
                    }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{
                          fontWeight: 600, color: 'var(--on-surface)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {item.productName}
                        </div>
                        {item.lotCode && (
                          <div style={{
                            fontSize: 10, color: 'var(--on-surface-3)', fontFamily: 'monospace',
                          }}>
                            {item.lotCode}
                          </div>
                        )}
                      </div>
                      <span style={{ color: 'var(--on-surface-3)', fontSize: 11 }}>{fmt(item.dateAjout)}</span>
                      <span style={{ color: 'var(--on-surface-3)', fontSize: 11 }}>{fmt(item.fabricationAt)}</span>
                      <span style={{
                        fontWeight: 600, fontSize: 11,
                        color: stDlc === 'expire' ? 'var(--danger)'
                          : stDlc === 'today' ? 'var(--warning)'
                          : 'var(--on-surface-2)',
                      }}>
                        {fmt(item.dlcAt)}
                      </span>
                      <span style={{ color: isRetired ? 'var(--on-surface-3)' : 'transparent', fontSize: 11 }}>
                        {isRetired ? fmt(item.retireAt) : '—'}
                      </span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
                        textAlign: 'center',
                        background: isRetired ? 'var(--surface-mid)' : 'rgba(84,101,30,0.12)',
                        color: isRetired ? 'var(--on-surface-3)' : 'var(--secondary)',
                      }}>
                        {isRetired ? 'Retiré' : 'En vit.'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </>
      )}

      {/* ════════════════ MENU ACTION LOTS REÇUS ════════════════ */}
      {lotActionItem && createPortal(
        <div
          onClick={() => setLotActionItem(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(28,28,24,0.45)',
            zIndex: 9999, display: 'flex', alignItems: 'flex-end',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', background: 'var(--surface)', borderRadius: '20px 20px 0 0',
              padding: '20px 16px 32px', display: 'flex', flexDirection: 'column', gap: 10,
            }}
          >
            <div style={{ marginBottom: 4 }}>
              <p style={{
                fontFamily: 'Epilogue, sans-serif', fontWeight: 800, fontSize: 16,
                color: 'var(--on-surface)', margin: '0 0 2px',
              }}>
                {lotActionItem.productName}
              </p>
              <p style={{ fontSize: 11, color: 'var(--on-surface-3)', margin: 0, fontFamily: 'monospace' }}>
                {lotActionItem.lotCode}
              </p>
            </div>

            <button
              onClick={() => renvoyerLotCuisine(lotActionItem)}
              style={{
                width: '100%', padding: '14px 16px', borderRadius: 12,
                border: '1px solid rgba(0,66,117,0.2)',
                background: 'rgba(0,66,117,0.06)', color: 'var(--primary)', fontWeight: 600,
                fontSize: 14, cursor: 'pointer', textAlign: 'left', fontFamily: 'Manrope, sans-serif',
              }}
            >
              🔙 Renvoyer en cuisine
              <span style={{ fontSize: 11, fontWeight: 400, display: 'block', color: 'var(--on-surface-3)', marginTop: 2 }}>
                Le lot redevient disponible côté cuisine
              </span>
            </button>

            <button
              onClick={() => supprimerLot(lotActionItem)}
              style={{
                width: '100%', padding: '14px 16px', borderRadius: 12,
                border: '1px solid rgba(192,57,43,0.2)',
                background: 'rgba(192,57,43,0.06)', color: 'var(--danger)', fontWeight: 600,
                fontSize: 14, cursor: 'pointer', textAlign: 'left', fontFamily: 'Manrope, sans-serif',
              }}
            >
              🗑️ Supprimer définitivement
              <span style={{ fontSize: 11, fontWeight: 400, display: 'block', color: 'var(--on-surface-3)', marginTop: 2 }}>
                Pour les lots de test ou erreurs de saisie
              </span>
            </button>

            <button
              onClick={() => setLotActionItem(null)}
              className="btn-secondary"
              style={{ width: '100%', marginTop: 4 }}
            >
              Annuler
            </button>
          </div>
        </div>,
        document.body
      )}


    </div>
  )
}
