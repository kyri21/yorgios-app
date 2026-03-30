import { useEffect, useState } from 'react'
import { Timestamp, addDoc, collection, getDocs, query, updateDoc, doc, where, limit, orderBy } from 'firebase/firestore'
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
  const [mainTab, setMainTab] = useState<'stock' | 'historique'>('stock')
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

  // Mode lot cuisine
  const [lots, setLots]             = useState<LotCuisine[]>([])
  const [lotsLoading, setLotsLoading] = useState(false)
  const [selectedLot, setSelectedLot] = useState<LotCuisine | null>(null)

  const dlcAuto = addDays(dateFab, 3)

  async function load() {
    setLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'corner_stock'), where('active', '==', true), limit(300)))
      const loaded = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as StockItem[]
      loaded.sort((a, b) => {
        const ta = a.dlcAt?.toDate ? a.dlcAt.toDate().getTime() : 0
        const tb = b.dlcAt?.toDate ? b.dlcAt.toDate().getTime() : 0
        return ta - tb
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

  async function loadProduits() {
    setProduitsLoading(true)
    try {
      const snap = await getDocs(query(
        collection(db, 'produits'),
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
      const snap = await getDocs(query(
        collection(db, 'lots_cuisine'),
        where('archived', '==', true),
        orderBy('archivedAt', 'desc'),
        limit(30),
      ))
      setLots(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as LotCuisine[])
    } catch (e: any) { setError(e?.message) }
    finally { setLotsLoading(false) }
  }

  function openForm() {
    const next = !showForm
    setShowForm(next)
    setSelected(new Set()); setSearch(''); setSelectedLot(null)
    if (next) { loadProduits(); setFormMode('manuel') }
  }

  function switchMode(m: 'manuel' | 'lot') {
    setFormMode(m)
    setSelected(new Set()); setSearch(''); setSelectedLot(null)
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

  async function saveLotCuisine() {
    if (!selectedLot) return
    setSaving(true); setError(null)
    try {
      const uid = auth.currentUser?.uid || ''
      await addDoc(collection(db, 'corner_stock'), {
        productName: selectedLot.productName,
        fabricationAt: selectedLot.producedAt,
        dlcAt: selectedLot.dlcAt,
        dateAjout: Timestamp.now(),
        lotCode: selectedLot.lotCode,
        active: true, createdAt: Timestamp.now(), createdBy: uid,
      })
      setSelectedLot(null); setShowForm(false)
      show('Produit(s) ajouté(s) en vitrine')
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
                        Aucun lot livré en cuisine.<br />
                        Marquez des lots comme "Livré" dans Fabrication.
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
                        const sel = selectedLot?.id === lot.id
                        return (
                          <div
                            key={lot.id}
                            onClick={() => setSelectedLot(sel ? null : lot)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 10,
                              padding: '11px 12px', borderRadius: 12, cursor: 'pointer',
                              background: sel ? 'rgba(0,66,117,0.08)' : 'var(--surface-low)',
                              border: `1.5px solid ${sel ? 'rgba(0,66,117,0.3)' : 'var(--border-soft)'}`,
                              userSelect: 'none', WebkitTapHighlightColor: 'transparent',
                              transition: 'all 0.12s',
                            }}
                          >
                            {/* Checkbox custom */}
                            <div style={{
                              width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                              background: sel ? 'var(--primary)' : 'var(--surface)',
                              border: `2px solid ${sel ? 'var(--primary)' : 'var(--border)'}`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              transition: 'all 0.12s',
                            }}>
                              {sel && (
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
                                  stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12"/>
                                </svg>
                              )}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
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
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <button onClick={saveLotCuisine} disabled={saving || !selectedLot} className="btn-primary">
                    {saving ? 'Enregistrement…' : selectedLot ? `Ajouter "${selectedLot.productName}"` : 'Sélectionner un lot'}
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
                        display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px', gap: 4,
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
                            display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px',
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
                        display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px', gap: 4,
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
                            display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px',
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
                        background: 'none', border: 'none', color: 'var(--on-surface-3)',
                        cursor: 'pointer', fontSize: 16, padding: '0 2px', lineHeight: 1,
                        flexShrink: 0,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )
              })}
            </div>
          )}
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

    </div>
  )
}
