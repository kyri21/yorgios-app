import { useEffect, useRef, useState } from 'react'
import { Timestamp, addDoc, collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, auth, storage } from '../../../firebase/config'
import { useAuth } from '../../../auth/useAuth'

// ─── Types ────────────────────────────────────────────────────────
type StockRow    = { id: number; produit: string; contenant: string; niveau: string }
type PhotoSlot   = { label: string; required: boolean; file: File | null; preview: string | null; url?: string }
type CatalogueProduit = { id: string; name: string; defaultCategory: string }

const CONTENANTS = ['Sceau', 'Plaque inox', 'Plat inox', 'Plat en fer blanc et bleu', 'Grand sceau', 'Bac gastro', 'Bac blanc']
const NIVEAUX    = ['Plein', 'Trois-quarts', 'Moitié', 'Un quart']

// Best-sellers — tableau 1 (toujours visible en haut)
const BESTSELLERS = [
  'Briam', 'Moussaka', 'Brochette de poulet', 'Kefta',
  'Riz épinard', 'Orzo nature', 'Tzatziki', 'Houmous',
  'Tiropita épinard', 'Tiropita feta menthe',
]
const BESTSELLERS_LOWER = new Set(BESTSELLERS.map(b => b.toLowerCase()))

const PHOTO_SLOTS_INIT: PhotoSlot[] = [
  { label: 'Vitrine gauche', required: false, file: null, preview: null },
  { label: 'Vitrine centre', required: false, file: null, preview: null },
  { label: 'Vitrine droite', required: false, file: null, preview: null },
  { label: 'Frigo corner',   required: false, file: null, preview: null },
]

const CHANNEL      = 'corner-cuisine'
const RETENTION_MS = 7 * 86400_000

function nowISO() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}`,
  }
}

let _nextId = 1
const nextId = () => _nextId++
function emptyStock(): StockRow { return { id: nextId(), produit: '', contenant: CONTENANTS[0], niveau: NIVEAUX[0] } }

// ─── SectionTitle ────────────────────────────────────────────────
function SectionTitle({ num, label }: { num: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 14px' }}>
      <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--primary)', fontFamily: 'Epilogue, sans-serif' }}>{num}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--on-surface)', fontFamily: 'Manrope, sans-serif', flex: 1 }}>{label}</span>
      <div style={{ height: 1, flex: 1, background: 'var(--border)' }} />
    </div>
  )
}

// ─── Composant principal ──────────────────────────────────────────
export default function Ruptures() {
  const { user } = useAuth()
  const uid = auth.currentUser?.uid || ''

  const [catalogueProduits, setCatalogueProduits] = useState<CatalogueProduit[]>([])
  const [stockProduits, setStockProduits]         = useState<string[]>(BESTSELLERS)
  const [personne, setPersonne]                   = useState(user?.displayName || user?.email?.split('@')[0] || '')
  // null = j'ai du stock  |  'urgent' = rupture signalée
  const [stockChecks, setStockChecks]             = useState<Record<string, 'urgent' | null>>({})
  const [catalogueSearch, setCatalogueSearch]     = useState('')
  const [stock, setStock]                         = useState<StockRow[]>([emptyStock()])
  const [photos, setPhotos]                       = useState<PhotoSlot[]>(PHOTO_SLOTS_INIT)
  const [commentaire, setCommentaire]             = useState('')
  const [sending, setSending]                     = useState(false)
  const [sent, setSent]                           = useState(false)
  const [error, setError]                         = useState<string | null>(null)
  const photoRefs = [
    useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null),
  ]

  useEffect(() => {
    // Datalist stock frigo depuis settings
    getDoc(doc(db, 'settings', 'ruptures'))
      .then(snap => {
        if (snap.exists()) {
          const list = (snap.data() as any).produits as string[]
          if (Array.isArray(list) && list.length > 0) setStockProduits(list)
        }
      })
      .catch(() => {})

    // Catalogue complet
    getDocs(query(collection(db, 'produits'), where('active', '==', true)))
      .then(snap => {
        const items: CatalogueProduit[] = snap.docs
          .map(d => ({
            id: d.id,
            name: (d.data() as any).name as string,
            defaultCategory: ((d.data() as any).defaultCategory as string) || 'Autre',
          }))
          .filter(p => p.name)
        items.sort((a, b) => {
          const c = a.defaultCategory.localeCompare(b.defaultCategory, 'fr')
          return c !== 0 ? c : a.name.localeCompare(b.name, 'fr')
        })
        setCatalogueProduits(items)
      })
      .catch(() => {})
  }, [])

  // ── Helpers ──────────────────────────────────────────────────────
  function toggleCheck(name: string) {
    setStockChecks(prev => ({ ...prev, [name]: prev[name] === 'urgent' ? null : 'urgent' }))
  }

  function updateStock(id: number, field: keyof StockRow, val: string) {
    setStock(rows => rows.map(r => r.id === id ? { ...r, [field]: val } : r))
  }
  function addStockRow()          { setStock(rows => [...rows, emptyStock()]) }
  function removeStockRow(id: number) { setStock(rows => rows.filter(r => r.id !== id)) }

  function handlePhoto(index: number, file: File | null) {
    setPhotos(slots => slots.map((s, i) => {
      if (i !== index) return s
      if (!file) return { ...s, file: null, preview: null, url: undefined }
      return { ...s, file, preview: URL.createObjectURL(file), url: undefined }
    }))
  }

  function buildText(senderName: string): string {
    const { date, time } = nowISO()

    const urgentItems = Object.entries(stockChecks)
      .filter(([, v]) => v === 'urgent')
      .map(([name]) => `  🔴 ${name}`)
      .join('\n') || '  Aucune rupture signalée'

    const stockLines = stock
      .filter(r => r.produit.trim())
      .map(r => `  ${r.produit} → ${r.contenant} — ${r.niveau}`)
      .join('\n') || '  Aucun article renseigné'

    const parts: (string | null)[] = [
      '━━━━━━━━━━━━━━━━━━',
      'DEMANDE CORNER → CUISINE',
      `Date : ${date}  Heure : ${time}  Personne : ${senderName}`,
      '━━━━━━━━━━━━━━━━━━',
      '0️⃣ RUPTURES / MANQUES',
      urgentItems,
      '━━━━━━━━━━━━━━━━━━',
      '1️⃣ STOCK FRIGO ACTUEL',
      stockLines,
      '━━━━━━━━━━━━━━━━━━',
      commentaire.trim() ? `2️⃣ COMMENTAIRE\n  ${commentaire.trim()}` : null,
      commentaire.trim() ? '━━━━━━━━━━━━━━━━━━' : null,
    ]
    return parts.filter(Boolean).join('\n')
  }

  async function handleSend() {
    setError(null)
    setSending(true)
    try {
      const now        = Timestamp.now()
      const expiresAt  = Timestamp.fromMillis(now.toMillis() + RETENTION_MS)
      const senderName = personne || user?.email || 'Corner'
      const senderRole = user?.role || 'corner'
      const text       = buildText(senderName)

      await addDoc(collection(db, 'messages'), {
        channelId: CHANNEL, senderId: uid, senderName, senderRole,
        text, createdAt: now, expiresAt,
      })

      // ruptures_actives pour Dashboard cuisine
      const urgentItems = Object.entries(stockChecks)
        .filter(([, v]) => v === 'urgent')
        .map(([name]) => name)
      if (urgentItems.length > 0) {
        await addDoc(collection(db, 'ruptures_actives'), {
          ruptures: urgentItems,
          presqueRuptures: [],
          personne: senderName,
          createdAt: now,
          viewed: false,
        })
      }

      // Photos → messages séparés
      const photosToSend = photos.filter(p => p.file)
      await Promise.all(photosToSend.map(async (slot, i) => {
        const path       = `messages/${uid}_${now.toMillis()}_${i}_${slot.file!.name}`
        const storageRef = ref(storage, path)
        await uploadBytes(storageRef, slot.file!)
        const photoUrl   = await getDownloadURL(storageRef)
        await addDoc(collection(db, 'messages'), {
          channelId: CHANNEL, senderId: uid, senderName, senderRole,
          text: `📷 ${slot.label}`, photoUrl,
          createdAt: Timestamp.fromMillis(now.toMillis() + i + 1), expiresAt,
        })
      }))

      setStockChecks({})
      setStock([emptyStock()])
      setPhotos(PHOTO_SLOTS_INIT)
      setCommentaire('')
      setSent(true)
      setTimeout(() => setSent(false), 4000)
    } catch (e: any) {
      setError(e?.message || "Erreur lors de l'envoi")
    } finally {
      setSending(false)
    }
  }

  // ── Dérivations pour l'affichage ─────────────────────────────────

  // Tous les articles signalés en rupture (des deux tableaux)
  const selectedNames = Object.entries(stockChecks)
    .filter(([, v]) => v === 'urgent')
    .map(([name]) => name)

  // Tableau 2 : catalogue hors best-sellers, hors déjà sélectionnés
  const catalogueAutres = catalogueProduits.filter(p =>
    !BESTSELLERS_LOWER.has(p.name.toLowerCase()) && stockChecks[p.name] !== 'urgent'
  )
  const catalogueFiltered = catalogueSearch.trim()
    ? catalogueAutres.filter(p => p.name.toLowerCase().includes(catalogueSearch.toLowerCase()))
    : catalogueAutres

  // Grouper par catégorie (seulement si pas de recherche, sinon liste plate)
  const searchActive = catalogueSearch.trim().length > 0
  const catalogueByCategory: Record<string, CatalogueProduit[]> = {}
  if (!searchActive) {
    for (const p of catalogueFiltered) {
      if (!catalogueByCategory[p.defaultCategory]) catalogueByCategory[p.defaultCategory] = []
      catalogueByCategory[p.defaultCategory].push(p)
    }
  }

  const { date, time } = nowISO()

  return (
    <div className="page">

      {/* ── Header ── */}
      <div>
        <p className="section-label" style={{ marginBottom: 2 }}>HACCP Editorial</p>
        <h1 style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 24, fontWeight: 800, color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0 }}>
          Ruptures &amp; Commandes
        </h1>
        <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: '4px 0 0', fontFamily: 'Manrope, sans-serif' }}>
          Signalez les manques à la Cuisine.
        </p>
      </div>

      {/* ── En-tête date/heure/personne ── */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{
            flex: '0 0 auto', background: 'rgba(0,66,117,0.08)', borderRadius: 'var(--radius-sm)',
            padding: '8px 12px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--primary)', fontFamily: 'Epilogue, sans-serif', lineHeight: 1 }}>{date.split('/')[0]}</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--on-surface-3)', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'Manrope, sans-serif', marginTop: 1 }}>
              {['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Aoû','Sep','Oct','Nov','Déc'][new Date().getMonth()]}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--on-surface)', fontFamily: 'Epilogue, sans-serif' }}>{date}</div>
            <div style={{ fontSize: 13, color: 'var(--on-surface-3)', fontFamily: 'Manrope, sans-serif', marginTop: 1 }}>{time}</div>
          </div>
        </div>
        <div>
          <label className="section-label" style={{ marginBottom: 4 }}>NOM</label>
          <input className="input" value={personne} onChange={e => setPersonne(e.target.value)} placeholder="Votre prénom" />
        </div>
      </div>

      {/* ── 0. EST-CE QUE J'AI DU STOCK ── */}
      <div className="card">
        <SectionTitle num="0" label="EST-CE QUE J'AI DU STOCK ?" />

        {/* Panel ruptures signalées */}
        {selectedNames.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <p className="section-label" style={{ margin: '0 0 8px', color: 'var(--danger)' }}>RUPTURES SIGNALÉES</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {selectedNames.map(name => (
                <div key={name} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: 'rgba(192,57,43,0.08)', borderRadius: 10, padding: '9px 12px',
                  border: '1px solid rgba(192,57,43,0.18)',
                }}>
                  <span style={{ fontSize: 15 }}>🔴</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--danger)', fontFamily: 'Manrope, sans-serif' }}>{name}</span>
                  <button
                    onClick={() => setStockChecks(prev => ({ ...prev, [name]: null }))}
                    style={{
                      width: 32, height: 32, borderRadius: 8, border: 'none',
                      background: 'rgba(28,28,24,0.06)', color: 'var(--on-surface-2)',
                      fontSize: 14, cursor: 'pointer', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                    aria-label="Retirer"
                  >✕</button>
                </div>
              ))}
            </div>
            <div className="divider" style={{ margin: '12px 0 16px' }} />
          </div>
        )}

        {/* Tableau 1 — Best-sellers */}
        <p className="section-label" style={{ margin: '0 0 8px' }}>PLATS PRINCIPAUX</p>
        <p style={{ fontSize: 11, color: 'var(--on-surface-3)', margin: '0 0 10px', fontFamily: 'Manrope, sans-serif' }}>
          Appuyez si vous n'avez plus de stock → signalement rupture urgente
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
          {BESTSELLERS.map(name => {
            const isSelected = stockChecks[name] === 'urgent'
            if (isSelected) return null // affiché dans le panel ci-dessus
            return (
              <button
                key={name}
                onClick={() => toggleCheck(name)}
                style={{
                  background: 'var(--surface-low)',
                  borderRadius: 10, padding: '11px 10px',
                  border: '1.5px solid var(--border-soft)',
                  cursor: 'pointer', textAlign: 'left', minHeight: 44,
                  display: 'flex', alignItems: 'center',
                  transition: 'background 0.12s, border-color 0.12s',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface)', fontFamily: 'Manrope, sans-serif', lineHeight: 1.3 }}>
                  {name}
                </span>
              </button>
            )
          })}
        </div>

        {/* Tableau 2 — Autres articles du catalogue */}
        <div className="divider" style={{ margin: '0 0 14px' }} />
        <p className="section-label" style={{ margin: '0 0 8px' }}>AUTRES ARTICLES</p>

        {/* Recherche */}
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <input
            className="input-filled"
            placeholder="Rechercher un produit…"
            value={catalogueSearch}
            onChange={e => setCatalogueSearch(e.target.value)}
            style={{ paddingLeft: 36 }}
          />
          <span style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            fontSize: 14, color: 'var(--on-surface-3)', pointerEvents: 'none',
          }}>🔍</span>
          {catalogueSearch && (
            <button
              onClick={() => setCatalogueSearch('')}
              style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--on-surface-3)', fontSize: 16, padding: 4,
              }}
            >✕</button>
          )}
        </div>

        {catalogueProduits.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--on-surface-3)', fontFamily: 'Manrope, sans-serif', textAlign: 'center', padding: '12px 0' }}>
            Chargement du catalogue…
          </p>
        ) : searchActive ? (
          /* Liste plate quand recherche active */
          catalogueFiltered.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--on-surface-3)', fontFamily: 'Manrope, sans-serif', textAlign: 'center', padding: '12px 0' }}>
              Aucun résultat pour « {catalogueSearch} »
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {catalogueFiltered.map(p => (
                <button
                  key={p.id}
                  onClick={() => { toggleCheck(p.name); setCatalogueSearch('') }}
                  style={{
                    background: 'var(--surface-low)', borderRadius: 10, padding: '11px 10px',
                    border: '1.5px solid var(--border-soft)', cursor: 'pointer',
                    textAlign: 'left', minHeight: 44, display: 'flex', alignItems: 'center',
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface)', fontFamily: 'Manrope, sans-serif', lineHeight: 1.3 }}>
                    {highlightMatch(p.name, catalogueSearch)}
                  </span>
                </button>
              ))}
            </div>
          )
        ) : (
          /* Groupé par catégorie quand pas de recherche */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {Object.entries(catalogueByCategory).map(([cat, items]) => (
              <div key={cat}>
                <p className="section-label" style={{ margin: '0 0 6px' }}>{cat.toUpperCase()}</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {items.map(p => (
                    <button
                      key={p.id}
                      onClick={() => toggleCheck(p.name)}
                      style={{
                        background: 'var(--surface-low)', borderRadius: 10, padding: '11px 10px',
                        border: '1.5px solid var(--border-soft)', cursor: 'pointer',
                        textAlign: 'left', minHeight: 44, display: 'flex', alignItems: 'center',
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface)', fontFamily: 'Manrope, sans-serif', lineHeight: 1.3 }}>
                        {p.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {Object.keys(catalogueByCategory).length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--on-surface-3)', fontFamily: 'Manrope, sans-serif', textAlign: 'center', padding: '8px 0' }}>
                Tous les articles sont déjà signalés ✓
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── 1. Stock frigo ── */}
      <div className="card">
        <SectionTitle num="1" label="STOCK FRIGO ACTUEL (optionnel)" />
        {stock.map((row) => (
          <div key={row.id} style={{ background: 'var(--surface-low)', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <input
                  className="input"
                  style={{ fontSize: 13 }}
                  list={`produits-stock-${row.id}`}
                  value={row.produit}
                  onChange={e => updateStock(row.id, 'produit', e.target.value)}
                  placeholder="Produit…"
                />
                <datalist id={`produits-stock-${row.id}`}>
                  {stockProduits.map(p => <option key={p} value={p} />)}
                </datalist>
              </div>
              <button onClick={() => removeStockRow(row.id)} style={{
                width: 40, height: 40, borderRadius: 8,
                border: 'none', background: 'rgba(136,0,20,0.08)',
                color: 'var(--danger)', fontSize: 15, cursor: 'pointer', flexShrink: 0,
              }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <select className="input" style={{ fontSize: 13 }} value={row.contenant} onChange={e => updateStock(row.id, 'contenant', e.target.value)}>
                {CONTENANTS.map(c => <option key={c}>{c}</option>)}
              </select>
              <select className="input" style={{ fontSize: 13 }} value={row.niveau} onChange={e => updateStock(row.id, 'niveau', e.target.value)}>
                {NIVEAUX.map(n => <option key={n}>{n}</option>)}
              </select>
            </div>
          </div>
        ))}
        <button onClick={addStockRow} style={{
          display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700,
          color: 'var(--primary)', background: 'rgba(0,66,117,0.06)',
          border: '1.5px dashed rgba(0,66,117,0.25)',
          borderRadius: 10, padding: '9px 14px', cursor: 'pointer', width: '100%', justifyContent: 'center',
          fontFamily: 'Manrope, sans-serif',
        }}>
          + Ajouter un article
        </button>
      </div>

      {/* ── 2. Photos vitrine ── */}
      <div className="card">
        <SectionTitle num="2" label="QUALITÉ &amp; FRAICHEUR (optionnel)" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {photos.map((slot, i) => (
            <div key={i}>
              <label className="section-label" style={{ marginBottom: 6 }}>
                {slot.label}{slot.required && <span style={{ color: 'var(--danger)' }}> *</span>}
              </label>
              <button
                onClick={() => photoRefs[i].current?.click()}
                style={{
                  width: '100%', aspectRatio: '4/3', borderRadius: 12,
                  border: `2px dashed ${slot.file ? 'var(--primary)' : 'var(--border)'}`,
                  background: slot.preview ? 'transparent' : 'var(--surface-low)',
                  cursor: 'pointer', overflow: 'hidden', position: 'relative', padding: 0,
                }}
              >
                {slot.preview
                  ? <img src={slot.preview} alt={slot.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 4 }}>
                      <span style={{ fontSize: 24 }}>📷</span>
                      <span style={{ fontSize: 11, color: 'var(--on-surface-3)', fontWeight: 600, fontFamily: 'Manrope, sans-serif' }}>Prendre photo</span>
                    </div>
                }
              </button>
              <input
                ref={photoRefs[i]}
                type="file" accept="image/*" capture="environment" hidden
                onChange={e => handlePhoto(i, e.target.files?.[0] || null)}
              />
              {slot.preview && (
                <button onClick={() => handlePhoto(i, null)} style={{
                  marginTop: 4, fontSize: 11, color: 'var(--on-surface-3)', background: 'none',
                  border: 'none', cursor: 'pointer', width: '100%', textAlign: 'center',
                  fontFamily: 'Manrope, sans-serif',
                }}>
                  Retirer
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── 3. Commentaire ── */}
      <div className="card">
        <SectionTitle num="3" label="COMMENTAIRE (optionnel)" />
        <textarea
          className="input"
          rows={3}
          style={{ resize: 'none' }}
          placeholder="Informations complémentaires…"
          value={commentaire}
          onChange={e => setCommentaire(e.target.value)}
        />
      </div>

      {/* ── Erreur ── */}
      {error && (
        <div style={{
          background: 'rgba(136,0,20,0.08)', borderRadius: 12, padding: '12px 16px',
          fontSize: 13, color: 'var(--danger)', fontWeight: 500, fontFamily: 'Manrope, sans-serif',
        }}>
          {error}
        </div>
      )}

      {/* ── Confirmation ── */}
      {sent && (
        <div style={{
          background: 'rgba(45,122,79,0.08)', borderRadius: 12, padding: '12px 16px',
          fontSize: 14, color: 'var(--success)', fontWeight: 700, textAlign: 'center',
          fontFamily: 'Manrope, sans-serif',
        }}>
          Demande envoyée à la cuisine ✓
        </div>
      )}

      {/* ── Bouton envoi messagerie interne ── */}
      <button onClick={handleSend} disabled={sending} className="btn-primary">
        {sending
          ? <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <div className="spinner" style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.3)' }} />
              Envoi en cours…
            </span>
          : '📨 Envoyer à la cuisine'}
      </button>

      <div style={{ height: 8 }} />
    </div>
  )
}

// ─── Highlight match dans résultats recherche ─────────────────────
function highlightMatch(text: string, query: string) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1 || !query) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <span style={{ color: 'var(--primary)', fontWeight: 800 }}>{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  )
}
