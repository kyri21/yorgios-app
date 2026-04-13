import { useEffect, useRef, useState, useCallback } from 'react'
import { Timestamp, addDoc, collection, doc, getDoc, getDocs, orderBy, query } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, auth, storage } from '../../../firebase/config'
import { useAuth } from '../../../auth/useAuth'

// ─── Types ────────────────────────────────────────────────────────
type StockRow = { id: number; produit: string; contenant: string; niveau: string }
type CmdRow   = { id: number; produit: string; quantite: string }
type PhotoSlot = { label: string; required: boolean; file: File | null; preview: string | null; url?: string }

const CONTENANTS = ['Sceau', 'Plaque inox', 'Plat inox', 'Plat en fer blanc et bleu', 'Grand sceau', 'Bac gastro', 'Bac blanc']
const NIVEAUX    = ['Plein', 'Trois-quarts', 'Moitié', 'Un quart']

const DEFAULT_STOCK_PRODUITS = [
  'Briam', 'Moussaka', 'Brochette poulet', 'Kefta',
  'Riz épinard', 'Orzo nature', 'Tzatziki', 'Houmous',
  'Tiropita épinard', 'Tiropita menthe',
]

const PHOTO_SLOTS_INIT: PhotoSlot[] = [
  { label: 'Vitrine gauche',  required: false, file: null, preview: null },
  { label: 'Vitrine centre',  required: false, file: null, preview: null },
  { label: 'Vitrine droite',  required: false, file: null, preview: null },
  { label: 'Frigo corner',    required: false, file: null, preview: null },
]

const CHANNEL = 'corner-cuisine'
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
function emptyCmd(): CmdRow     { return { id: nextId(), produit: '', quantite: '' } }

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

  const [produits, setProduits]   = useState<string[]>(DEFAULT_STOCK_PRODUITS)
  const [personne, setPersonne]   = useState(user?.displayName || user?.email?.split('@')[0] || '')
  const [stockChecks, setStockChecks] = useState<Record<string, boolean | null>>(
    () => Object.fromEntries(DEFAULT_STOCK_PRODUITS.map(p => [p, null]))
  )
  const [stock, setStock]         = useState<StockRow[]>([emptyStock()])
  const [ruptures, setRuptures]   = useState<CmdRow[]>([emptyCmd()])
  const [presqueRuptures, setPresqueRuptures] = useState<CmdRow[]>([emptyCmd()])
  const [photos, setPhotos]       = useState<PhotoSlot[]>(PHOTO_SLOTS_INIT)
  const [commentaire, setCommentaire] = useState('')
  const [sending, setSending]     = useState(false)
  const [sendingWa, setSendingWa] = useState(false)
  const [sent, setSent]           = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const photoRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]

  useEffect(() => {
    getDoc(doc(db, 'settings', 'ruptures'))
      .then(snap => {
        if (snap.exists()) {
          const list = (snap.data() as any).produits as string[]
          if (Array.isArray(list) && list.length > 0) {
            setProduits(list)
            setStockChecks(Object.fromEntries(list.map(p => [p, null])))
          }
        }
      })
      .catch(() => {})
  }, [])

  function buildText(senderName: string, photoUrls: string[] = []): string {
    const { date, time } = nowISO()

    const checkLines = produits
      .filter(p => stockChecks[p] !== null)
      .map(p => `  ${stockChecks[p] ? '✅' : '❌'} ${p}`)
      .join('\n') || '  Non renseigné'

    const stockLines = stock
      .filter(r => r.produit.trim())
      .map(r => `  ${r.produit} → ${r.contenant} — ${r.niveau}`)
      .join('\n') || '  Aucun article renseigné'
    const rupLines = ruptures.filter(r => r.produit).map(r => `  🔴 ${r.produit}${r.quantite ? ' → ' + r.quantite : ''}`).join('\n')
    const presqueLines = presqueRuptures.filter(r => r.produit).map(r => `  🟠 ${r.produit}${r.quantite ? ' → ' + r.quantite : ''}`).join('\n')
    const cmdSection = [rupLines, presqueLines].filter(Boolean).join('\n') || '  Aucune commande urgente'

    const parts: (string | null)[] = [
      '━━━━━━━━━━━━━━━━━━',
      'DEMANDE CORNER → CUISINE',
      `Date : ${date}  Heure : ${time}  Personne : ${senderName}`,
      '━━━━━━━━━━━━━━━━━━',
      '0️⃣ DISPONIBILITÉ PLATS',
      checkLines,
      '━━━━━━━━━━━━━━━━━━',
      '1️⃣ STOCK FRIGO ACTUEL',
      stockLines,
      '━━━━━━━━━━━━━━━━━━',
      '2️⃣ COMMANDES URGENTES',
      cmdSection,
      '━━━━━━━━━━━━━━━━━━',
      commentaire.trim() ? `4️⃣ COMMENTAIRE\n  ${commentaire.trim()}` : null,
      commentaire.trim() ? '━━━━━━━━━━━━━━━━━━' : null,
    ]

    if (photoUrls.length > 0) {
      parts.push('📷 PHOTOS VITRINE')
      photoUrls.forEach((url, i) => {
        const slot = photos.filter(p => p.file)[i]
        parts.push(`  ${slot?.label ?? `Photo ${i + 1}`} : ${url}`)
      })
      parts.push('━━━━━━━━━━━━━━━━━━')
    }

    return parts.filter(Boolean).join('\n')
  }

  useEffect(() => {
    getDocs(query(collection(db, 'produits'), orderBy('nom', 'asc')))
      .then(snap => {
        const noms = snap.docs
          .map(d => (d.data() as any).nom as string)
          .filter(Boolean)
        setProduits(noms)
      })
      .catch(() => setProduits([]))
  }, [])

  function setStockCheck(produit: string, val: boolean) {
    setStockChecks(prev => ({ ...prev, [produit]: val }))
    if (!val) {
      setRuptures(rows => {
        const alreadyIn = rows.some(r => r.produit.trim().toLowerCase() === produit.toLowerCase())
        if (alreadyIn) return rows
        const emptyIdx = rows.findIndex(r => !r.produit.trim())
        if (emptyIdx >= 0) {
          return rows.map((r, i) => i === emptyIdx ? { ...r, produit } : r)
        }
        return [...rows, { id: nextId(), produit, quantite: '' }]
      })
    } else {
      setRuptures(rows => rows.filter(r => r.produit !== produit || r.quantite.trim() !== ''))
    }
  }

  function updateStock(id: number, field: keyof StockRow, val: string) {
    setStock(rows => rows.map(r => r.id === id ? { ...r, [field]: val } : r))
  }
  function addStockRow() { setStock(rows => [...rows, emptyStock()]) }
  function removeStockRow(id: number) { setStock(rows => rows.filter(r => r.id !== id)) }

  function updateCmd(setter: typeof setRuptures, id: number, field: keyof CmdRow, val: string) {
    setter(rows => rows.map(r => r.id === id ? { ...r, [field]: val } : r))
  }
  function addCmd(setter: typeof setRuptures, rows: CmdRow[]) {
    if (rows.length >= 5) return
    setter(r => [...r, emptyCmd()])
  }
  function removeCmd(setter: typeof setRuptures, id: number) {
    setter(rows => rows.filter(r => r.id !== id))
  }

  function handlePhoto(index: number, file: File | null) {
    setPhotos(slots => slots.map((s, i) => {
      if (i !== index) return s
      if (!file) return { ...s, file: null, preview: null, url: undefined }
      const preview = URL.createObjectURL(file)
      return { ...s, file, preview, url: undefined }
    }))
  }

  async function uploadPhotos(): Promise<string[]> {
    const now = Date.now()
    const photosToSend = photos.filter(p => p.file)
    const urls = await Promise.all(photosToSend.map(async (slot, i) => {
      const path = `messages/${uid}_${now}_${i}_${slot.file!.name}`
      const storageRef = ref(storage, path)
      await uploadBytes(storageRef, slot.file!)
      return getDownloadURL(storageRef)
    }))
    return urls
  }

  async function handleSend() {
    setError(null)
    setSending(true)
    try {
      const now = Timestamp.now()
      const expiresAt = Timestamp.fromMillis(now.toMillis() + RETENTION_MS)
      const senderName = personne || user?.email || 'Corner'
      const senderRole = user?.role || 'corner'
      const text = buildText(senderName)

      await addDoc(collection(db, 'messages'), {
        channelId: CHANNEL, senderId: uid, senderName, senderRole,
        text, createdAt: now, expiresAt,
      })

      // Write structured rupture data for cuisine dashboard
      const ruptureItems = ruptures.filter(r => r.produit.trim()).map(r => r.produit.trim())
      const presqueItems = presqueRuptures.filter(r => r.produit.trim()).map(r => r.produit.trim())
      if (ruptureItems.length > 0 || presqueItems.length > 0) {
        await addDoc(collection(db, 'ruptures_actives'), {
          ruptures: ruptureItems,
          presqueRuptures: presqueItems,
          personne: senderName,
          createdAt: now,
          viewed: false,
        })
      }

      const photosToSend = photos.filter(p => p.file)
      await Promise.all(photosToSend.map(async (slot, i) => {
        const path = `messages/${uid}_${now.toMillis()}_${i}_${slot.file!.name}`
        const storageRef = ref(storage, path)
        await uploadBytes(storageRef, slot.file!)
        const photoUrl = await getDownloadURL(storageRef)
        await addDoc(collection(db, 'messages'), {
          channelId: CHANNEL, senderId: uid, senderName, senderRole,
          text: `📷 ${slot.label}`, photoUrl,
          createdAt: Timestamp.fromMillis(now.toMillis() + i + 1), expiresAt,
        })
      }))

      setStockChecks(Object.fromEntries(produits.map(p => [p, null])))
      setStock([emptyStock()])
      setRuptures([emptyCmd()])
      setPresqueRuptures([emptyCmd()])
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

  async function handleWhatsApp() {
    setError(null)
    setSendingWa(true)
    try {
      const senderName = personne || user?.email || 'Corner'
      let photoUrls: string[] = []
      const hasPhotos = photos.some(p => p.file)
      if (hasPhotos) { photoUrls = await uploadPhotos() }
      const text = buildText(senderName, photoUrls)
      const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`
      window.open(waUrl, '_blank', 'noopener,noreferrer')
    } catch (e: any) {
      setError('Erreur upload photos WhatsApp : ' + (e?.message || 'inconnue'))
    } finally {
      setSendingWa(false)
    }
  }

  const { date, time } = nowISO()
  const senderName = personne || user?.email || 'Corner'

  return (
    <div className="page">
      {/* Header */}
      <div>
        <p className="section-label" style={{ marginBottom: 2 }}>HACCP Editorial</p>
        <h1 style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 24, fontWeight: 800, color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0 }}>
          Ruptures &amp; Commandes
        </h1>
        <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: '4px 0 0', fontFamily: 'Manrope, sans-serif' }}>
          Complétez l'état des stocks et des besoins pour votre communication à la Cuisine.
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
              {['Jan','Fév','Mar','Apr','Mai','Juin','Juil','Aoû','Sep','Oct','Nov','Déc'][new Date().getMonth()]}
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

      {/* ── 0. Disponibilité plats ── */}
      <div className="card">
        <SectionTitle num="0" label="EST-CE QUE J'AI DU STOCK ?" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {produits.map(produit => {
            const val = stockChecks[produit]
            const rowBg = val === false
              ? 'rgba(136,0,20,0.06)'
              : val === true
              ? 'rgba(84,101,30,0.06)'
              : 'var(--surface-low)'
            return (
              <div key={produit} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: rowBg, borderRadius: 10, padding: '11px 12px',
              }}>
                <span style={{
                  fontSize: 14, fontWeight: 600,
                  color: val === false ? 'var(--danger)' : val === true ? 'var(--secondary)' : 'var(--on-surface)',
                  fontFamily: 'Manrope, sans-serif',
                }}>
                  {produit}
                </span>
                {/* Boutons OUI/NON iOS style Aegean */}
                <div style={{ display: 'flex', gap: 0, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <button
                    onClick={() => setStockCheck(produit, true)}
                    style={{
                      padding: '7px 16px', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer',
                      background: val === true ? 'var(--secondary)' : 'var(--surface)',
                      color: val === true ? '#fff' : 'var(--on-surface-3)',
                      borderRight: '1px solid var(--border)',
                      fontFamily: 'Manrope, sans-serif',
                      transition: 'all 0.1s',
                    }}
                  >OUI</button>
                  <button
                    onClick={() => setStockCheck(produit, false)}
                    style={{
                      padding: '7px 16px', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer',
                      background: val === false ? 'var(--tertiary)' : 'var(--surface)',
                      color: val === false ? '#fff' : 'var(--on-surface-3)',
                      fontFamily: 'Manrope, sans-serif',
                      transition: 'all 0.1s',
                    }}
                  >NON</button>
                </div>
              </div>
            )
          })}
        </div>
        {Object.values(stockChecks).some(v => v === false) && (
          <div style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 600, textAlign: 'center', padding: '8px 0 0', fontFamily: 'Manrope, sans-serif' }}>
            Les produits manquants ont été ajoutés aux commandes urgentes.
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
                  {produits.map(p => <option key={p} value={p} />)}
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

      {/* ── 2. Commandes urgentes ── */}
      <div className="card">
        <SectionTitle num="2" label="COMMANDES URGENTES" />

        {/* Ruptures */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--danger)', flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--danger)', fontFamily: 'Manrope, sans-serif', textTransform: 'uppercase', letterSpacing: '0.06em' }}>RUPTURE</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ruptures.map(row => (
              <CmdLine key={row.id} row={row} produits={produits}
                onChange={(field, val) => updateCmd(setRuptures, row.id, field, val)}
                onRemove={() => removeCmd(setRuptures, row.id)}
                accent="rgba(136,0,20,0.06)" accentBorder="rgba(136,0,20,0.15)" />
            ))}
          </div>
          {ruptures.length < 5 && (
            <AddCmdButton onClick={() => addCmd(setRuptures, ruptures)} color="var(--danger)" bg="rgba(136,0,20,0.06)" border="rgba(136,0,20,0.2)" />
          )}
        </div>

        <div className="divider" />

        {/* Presque ruptures */}
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--warning)', flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--warning)', fontFamily: 'Manrope, sans-serif', textTransform: 'uppercase', letterSpacing: '0.06em' }}>PRESQUE RUPTURE</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {presqueRuptures.map(row => (
              <CmdLine key={row.id} row={row} produits={produits}
                onChange={(field, val) => updateCmd(setPresqueRuptures, row.id, field, val)}
                onRemove={() => removeCmd(setPresqueRuptures, row.id)}
                accent="rgba(180,83,9,0.06)" accentBorder="rgba(180,83,9,0.15)" />
            ))}
          </div>
          {presqueRuptures.length < 5 && (
            <AddCmdButton onClick={() => addCmd(setPresqueRuptures, presqueRuptures)} color="var(--warning)" bg="rgba(180,83,9,0.06)" border="rgba(180,83,9,0.2)" />
          )}
        </div>
      </div>

      {/* ── 3. Photos vitrine ── */}
      <div className="card">
        <SectionTitle num="3" label="QUALITÉ &amp; FRAICHEUR (optionnel)" />
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

      {/* ── 4. Commentaire ── */}
      <div className="card">
        <SectionTitle num="4" label="COMMENTAIRE (optionnel)" />
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
        <div style={{ background: 'rgba(136,0,20,0.08)', borderRadius: 12, padding: '12px 16px', fontSize: 13, color: 'var(--danger)', fontWeight: 500, fontFamily: 'Manrope, sans-serif' }}>
          {error}
        </div>
      )}

      {/* ── Confirmation ── */}
      {sent && (
        <div style={{ background: 'rgba(84,101,30,0.08)', borderRadius: 12, padding: '12px 16px', fontSize: 14, color: 'var(--secondary)', fontWeight: 700, textAlign: 'center', fontFamily: 'Manrope, sans-serif' }}
          className="animate-slide-up">
          Demande envoyée à la cuisine !
        </div>
      )}

      {/* ── Partage externe ── */}
      <div style={{ display: 'flex', gap: 10 }}>
        <a
          href={`sms:?body=${encodeURIComponent(buildText(senderName))}`}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '12px', borderRadius: 12, fontSize: 13, fontWeight: 700,
            background: 'var(--surface-low)', color: 'var(--on-surface)',
            textDecoration: 'none', fontFamily: 'Manrope, sans-serif',
          }}
        >
          💬 SMS
        </a>
        <button
          onClick={handleWhatsApp}
          disabled={sendingWa}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '12px', borderRadius: 12, fontSize: 13, fontWeight: 700,
            background: 'var(--surface-low)',
            color: sendingWa ? 'rgba(37,211,102,0.5)' : '#25D366',
            border: 'none', cursor: sendingWa ? 'not-allowed' : 'pointer',
            fontFamily: 'Manrope, sans-serif',
          }}
        >
          {sendingWa ? <>Chargement…</> : 'WhatsApp'}
        </button>
      </div>

      {/* ── Bouton envoi messagerie ── */}
      <button onClick={handleSend} disabled={sending} className="btn-primary">
        {sending
          ? <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <div className="spinner" style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.3)' }} />
              Envoi en cours…
            </span>
          : 'Valider & Envoyer'}
      </button>

      <div style={{ height: 8 }} />
    </div>
  )
}

// ─── AutocompleteInput ────────────────────────────────────────────
function AutocompleteInput({ value, produits, onChange, placeholder }: {
  value: string
  produits: string[]
  onChange: (val: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value)
  const containerRef = useRef<HTMLDivElement>(null)

  const suggestions = query.trim().length === 0
    ? []
    : produits.filter(p => p.toLowerCase().includes(query.toLowerCase())).slice(0, 6)

  useEffect(() => { setQuery(value) }, [value])

  const handleSelect = useCallback((p: string) => {
    setQuery(p)
    onChange(p)
    setOpen(false)
  }, [onChange])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <input
        className="input"
        style={{ fontSize: 13, width: '100%' }}
        value={query}
        placeholder={placeholder ?? 'Produit…'}
        autoComplete="off"
        onChange={e => {
          setQuery(e.target.value)
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => { if (query.trim()) setOpen(true) }}
      />
      {open && suggestions.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          background: 'var(--surface)', borderRadius: 10, marginTop: 4, overflow: 'hidden',
          boxShadow: '0 8px 24px rgba(28,28,24,0.12)',
        }}>
          {suggestions.map(p => (
            <button
              key={p}
              type="button"
              onMouseDown={e => { e.preventDefault(); handleSelect(p) }}
              onTouchEnd={e => { e.preventDefault(); handleSelect(p) }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '11px 14px', fontSize: 13, color: 'var(--on-surface)',
                background: 'none', border: 'none', cursor: 'pointer',
                borderBottom: '1px solid var(--border-soft)',
                fontFamily: 'Manrope, sans-serif',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-low)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              {highlightMatch(p, query)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function highlightMatch(text: string, query: string) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1 || !query) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <span style={{ color: 'var(--primary)', fontWeight: 700 }}>{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  )
}

// ─── CmdLine ──────────────────────────────────────────────────────
function CmdLine({ row, produits, onChange, onRemove, accent, accentBorder }: {
  row: CmdRow; produits: string[]
  onChange: (field: keyof CmdRow, val: string) => void
  onRemove: () => void
  accent: string; accentBorder: string
}) {
  return (
    <div style={{ background: accent, borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <AutocompleteInput
          value={row.produit}
          produits={produits}
          onChange={val => onChange('produit', val)}
          placeholder="Produit…"
        />
        <button onClick={onRemove} style={{
          width: 40, height: 40, borderRadius: 8,
          border: 'none', background: 'var(--surface-low)',
          color: 'var(--on-surface-3)', fontSize: 15, cursor: 'pointer', flexShrink: 0,
        }}>✕</button>
      </div>
      <input
        className="input"
        style={{ fontSize: 13, width: '100%' }}
        placeholder="Quantité (ex : 2 kg, 1 bac…)"
        value={row.quantite}
        onChange={e => onChange('quantite', e.target.value)}
      />
    </div>
  )
}

// ─── AddCmdButton ─────────────────────────────────────────────────
function AddCmdButton({ onClick, color, bg, border }: { onClick: () => void; color: string; bg: string; border: string }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700,
      color, background: bg, border: `1.5px dashed ${border}`,
      borderRadius: 10, padding: '8px 14px', cursor: 'pointer', marginTop: 8,
      width: '100%', justifyContent: 'center', fontFamily: 'Manrope, sans-serif',
    }}>
      + Ajouter
    </button>
  )
}
