import { useEffect, useState } from 'react'
import { Timestamp, addDoc, collection, getDocs, getDoc, doc, deleteDoc, limit, onSnapshot, orderBy, query, updateDoc, where, type Unsubscribe } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, auth, storage } from '../../../firebase/config'
import { useAuth } from '../../../auth/useAuth'

type LivrDoc = {
  id: string; lotCode: string; productName: string; category: string
  departTempC: number | null | undefined; departAt: any; departPhotoUrl?: string | null
  receptionTempC?: number | null; receptionAt?: any; receptionPhotoUrl?: string | null; result: string
  isManual?: boolean; returned?: boolean
}

type GalleryItem = LivrDoc

type NcModalData = { l: LivrDoc; t: number }
type PhotoModal = { url: string; label: string }

type DeliveryDoc = {
  id: string
  trackingUrl: string | null
  rawMessage: string
  phoneNumber: string
  eta: string | null
  status: 'in_progress' | 'completed'
  createdAt: any
  updatedAt: any
}

function todayStart() { const d = new Date(); d.setHours(0,0,0,0); return d.getTime() }
function toLocalDateValue(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0')
  return `${y}-${m}-${dd}`
}

function playDing() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.15)
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.0)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 1.0)
  } catch {
    // AudioContext not supported — silent
  }
}

const NC_DECISIONS = ['Gardé au corner', 'Renvoyé en cuisine', 'Détruit'] as const

export default function Livraison() {
  const { user } = useAuth()
  const [tab, setTab] = useState<'today' | 'historique' | 'galerie' | 'coursier'>('today')

  // --- Aujourd'hui ---
  const [livraisons, setLivraisons] = useState<LivrDoc[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [receptionTemps, setReceptionTemps] = useState<Record<string, string>>({})
  const [receptionPhotos, setReceptionPhotos] = useState<Record<string, File | null>>({})
  const [receptionChecked, setReceptionChecked] = useState<Record<string, boolean>>({})
  const [ncModal, setNcModal] = useState<NcModalData | null>(null)
  const [ncLoading, setNcLoading] = useState(false)
  const [ncSuccess, setNcSuccess] = useState(false)

  // --- Historique ---
  const [histDate, setHistDate] = useState(toLocalDateValue(new Date()))
  const [histLivraisons, setHistLivraisons] = useState<LivrDoc[]>([])
  const [histLoading, setHistLoading] = useState(false)
  const [histError, setHistError] = useState<string | null>(null)

  // --- Galerie photos ---
  function sevenDaysAgo() {
    const d = new Date(); d.setDate(d.getDate() - 7); return toLocalDateValue(d)
  }
  const [galFrom, setGalFrom] = useState(sevenDaysAgo)
  const [galTo, setGalTo] = useState(toLocalDateValue(new Date()))
  const [gallery, setGallery] = useState<GalleryItem[]>([])
  const [galLoading, setGalLoading] = useState(false)

  // --- Modal photo ---
  const [photoModal, setPhotoModal] = useState<PhotoModal | null>(null)

  // --- Coursier (Twilio) ---
  const [deliveries, setDeliveries] = useState<DeliveryDoc[]>([])
  const [deliveryLoading, setDeliveryLoading] = useState(false)
  const [prevDeliveryCount, setPrevDeliveryCount] = useState<number | null>(null)

  async function load() {
    setStatus('Chargement…')
    try {
      const q = query(collection(db, 'livraisons'), orderBy('departAt', 'desc'), limit(200))
      const snap = await getDocs(q)
      const all: LivrDoc[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
      const t0 = todayStart()
      const today = all.filter(x => {
        const dt = x.departAt?.toDate ? x.departAt.toDate() : null
        return dt && dt.getTime() >= t0
      })
      setLivraisons(today)
    } catch (e: any) { setError(e?.message) }
    finally { setStatus('') }
  }

  async function loadHistorique(dateStr: string) {
    setHistLoading(true)
    setHistError(null)
    try {
      const [y, m, d] = dateStr.split('-').map(Number)
      const start = new Date(y, m-1, d, 0, 0, 0)
      const end   = new Date(y, m-1, d, 23, 59, 59)
      const q = query(
        collection(db, 'livraisons'),
        where('departAt', '>=', Timestamp.fromDate(start)),
        where('departAt', '<=', Timestamp.fromDate(end)),
        orderBy('departAt', 'asc'),
      )
      const snap = await getDocs(q)
      setHistLivraisons(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
    } catch (e: any) { setHistError(e?.message) }
    finally { setHistLoading(false) }
  }

  async function loadGalerie() {
    setGalLoading(true)
    try {
      const [y1, m1, d1] = galFrom.split('-').map(Number)
      const [y2, m2, d2] = galTo.split('-').map(Number)
      const start = new Date(y1, m1-1, d1, 0, 0, 0)
      const end   = new Date(y2, m2-1, d2, 23, 59, 59)
      const q = query(
        collection(db, 'livraisons'),
        where('departAt', '>=', Timestamp.fromDate(start)),
        where('departAt', '<=', Timestamp.fromDate(end)),
        orderBy('departAt', 'desc'),
      )
      const snap = await getDocs(q)
      const all: GalleryItem[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
      setGallery(all.filter(l => l.departPhotoUrl || l.receptionPhotoUrl))
    } catch { /* silencieux */ }
    finally { setGalLoading(false) }
  }

  useEffect(() => { load() }, [])
  useEffect(() => { if (tab === 'historique') loadHistorique(histDate) }, [tab, histDate])
  useEffect(() => { if (tab === 'galerie') loadGalerie() }, [tab, galFrom, galTo])

  useEffect(() => {
    if (tab !== 'coursier') return
    setDeliveryLoading(true)
    const q = query(
      collection(db, 'deliveries'),
      where('status', '==', 'in_progress'),
      orderBy('createdAt', 'desc'),
    )
    const unsub: Unsubscribe = onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<DeliveryDoc, 'id'>) }))
      setDeliveries(docs)
      setDeliveryLoading(false)
      setPrevDeliveryCount(prev => {
        if (prev !== null && docs.length > prev) playDing()
        return docs.length
      })
    }, () => setDeliveryLoading(false))
    return () => {
      unsub()
      setPrevDeliveryCount(null)
    }
  }, [tab])

  useEffect(() => {
    if (tab !== 'coursier') return
    let lock: WakeLockSentinel | null = null
    navigator.wakeLock?.request('screen').then(l => { lock = l }).catch(() => {})
    return () => { lock?.release().catch(() => {}) }
  }, [tab])

  async function submitReception(l: LivrDoc) {
    setError(null)

    // Items sans temperature de départ → simple checkbox, pas de saisie temp
    if (l.departTempC == null) {
      if (!receptionChecked[l.id]) { setError('Cochez la case pour valider la réception'); return }
      setLoading(true)
      try {
        setStatus('Enregistrement…')
        const uid = auth.currentUser?.uid || ''
        await updateDoc(doc(db, 'livraisons', l.id), {
          receptionTempC: null, receptionAt: Timestamp.now(), receptionBy: uid,
          receptionPhotoUrl: null, result: 'ACCEPTE',
        })
        setReceptionChecked(p => { const n = { ...p }; delete n[l.id]; return n })
        await load()
      } catch (e: any) { setError(e?.message) }
      finally { setLoading(false); setStatus('') }
      return
    }

    const tempStr = receptionTemps[l.id] || ''
    const t = Number(String(tempStr).replace(',', '.'))
    if (!Number.isFinite(t)) { setError('Température invalide'); return }
    setLoading(true)
    try {
      setStatus('Enregistrement…')
      const uid = auth.currentUser?.uid || ''
      let photoUrl: string | null = null
      const photo = receptionPhotos[l.id]
      if (photo) {
        setStatus('Upload photo…')
        const r = ref(storage, `livraisons/${l.lotCode}/reception-corner-${Date.now()}-${photo.name}`)
        await uploadBytes(r, photo)
        photoUrl = await getDownloadURL(r)
      }
      const livRef = doc(db, 'livraisons', l.id)
      const livSnap = await getDoc(livRef)
      const data = livSnap.data() as any
      const maxTol = data?.ruleMaxTol ?? null
      const result = maxTol != null ? (t <= maxTol ? 'ACCEPTE' : 'REFUSE') : 'A_VERIFIER'
      await updateDoc(livRef, {
        receptionTempC: t, receptionAt: Timestamp.now(), receptionBy: uid,
        receptionPhotoUrl: photoUrl, result,
      })
      setReceptionTemps(p => { const n = { ...p }; delete n[l.id]; return n })
      setReceptionPhotos(p => { const n = { ...p }; delete n[l.id]; return n })
      await load()
      if (result === 'REFUSE') setNcModal({ l: { ...l, result }, t })
    } catch (e: any) { setError(e?.message) }
    finally { setLoading(false); setStatus('') }
  }

  async function retourCuisine(id: string) {
    try {
      await updateDoc(doc(db, 'livraisons', id), { returned: true, returnedAt: Timestamp.now() })
      await load()
    } catch (e: any) { setError(e?.message) }
  }

  async function supprimerLivraison(id: string) {
    try {
      await deleteDoc(doc(db, 'livraisons', id))
      await load()
    } catch (e: any) { setError(e?.message) }
  }

  async function markDeliveryDone(id: string) {
    try {
      await updateDoc(doc(db, 'deliveries', id), { status: 'completed', updatedAt: Timestamp.now() })
    } catch (e: any) {
      setError(e?.message ?? 'Erreur lors de la mise à jour')
    }
  }

  async function handleNonConformite(decision: string) {
    if (!ncModal) return
    setNcLoading(true)
    try {
      const uid = auth.currentUser?.uid || ''
      const now = Timestamp.now()
      const expiresAt = Timestamp.fromMillis(Date.now() + 7 * 24 * 3600 * 1000)
      await addDoc(collection(db, 'non_conformites'), {
        livraisonId: ncModal.l.id, productName: ncModal.l.productName,
        lotCode: ncModal.l.lotCode, tempC: ncModal.t, decision,
        createdAt: now, createdBy: uid,
      })
      const senderName = user?.displayName || user?.email?.split('@')[0] || 'Corner'
      const senderRole = user?.role || 'corner'
      await addDoc(collection(db, 'messages'), {
        senderId: uid, senderName, senderRole,
        text: `⚠️ Non-conformité : ${ncModal.l.productName} (lot ${ncModal.l.lotCode}) — ${ncModal.t}°C — Décision : ${decision}`,
        photoUrl: null, createdAt: now, expiresAt,
      })
      setNcSuccess(true)
      setTimeout(() => { setNcModal(null); setNcSuccess(false) }, 1800)
    } catch (e: any) { setError(e?.message) }
    finally { setNcLoading(false) }
  }

  const pending = livraisons
    .filter(l => l.receptionTempC == null && !l.receptionAt && !l.returned)
    .sort((a, b) => {
      const aHasTemp = a.departTempC != null ? 1 : 0
      const bHasTemp = b.departTempC != null ? 1 : 0
      return bHasTemp - aHasTemp
    })
  const done = livraisons.filter(l => (l.receptionTempC != null || l.receptionAt != null) && !l.returned)

  function resultChip(result: string) {
    if (result === 'ACCEPTE') return <span className="chip-ok">ACCEPTÉ</span>
    if (result === 'REFUSE') return <span className="chip-danger">REFUSÉ</span>
    return <span className="chip-warn">À VÉRIFIER</span>
  }

  return (
    <div className="page">

      {/* ── Header ── */}
      <div>
        <p className="section-label" style={{ marginBottom: 2 }}>Corner · Réception</p>
        <h1 style={{
          fontFamily: 'Epilogue, sans-serif', fontSize: 26, fontWeight: 800,
          color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0,
        }}>
          Réception livraisons
        </h1>
      </div>

      {/* ── Onglets ── */}
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--surface-mid)', borderRadius: 14 }}>
        {([
          { key: 'today', label: "Aujourd'hui" },
          { key: 'historique', label: 'Historique' },
          { key: 'galerie', label: 'Galerie' },
          { key: 'coursier', label: '🚚 Coursier' },
        ] as const).map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)} style={{
            flex: 1, padding: '9px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: tab === key ? 'var(--surface)' : 'transparent',
            color: tab === key ? 'var(--primary)' : 'var(--on-surface-3)',
            fontWeight: 700, fontFamily: 'Manrope, sans-serif', fontSize: 13,
            boxShadow: tab === key ? '0 1px 6px rgba(28,28,24,0.08)' : 'none',
            transition: 'all 0.15s',
          }}>
            {label}
          </button>
        ))}
      </div>

      {/* ════════════════ AUJOURD'HUI ════════════════ */}
      {tab === 'today' && (
        <>
          {status && (
            <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: 0 }}>{status}</p>
          )}
          {error && (
            <div style={{
              padding: '10px 14px',
              background: 'rgba(192,57,43,0.06)', border: '1px solid rgba(192,57,43,0.18)',
              borderRadius: 10, fontSize: 13, color: 'var(--danger)',
            }}>
              {error}
            </div>
          )}

          <p className="section-label" style={{ margin: 0 }}>
            À compléter ({pending.length})
          </p>

          {/* Empty state amélioré */}
          {pending.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: '44px 24px' }}>
              <div style={{ fontSize: 44, marginBottom: 14, lineHeight: 1 }}>🚚</div>
              <p style={{
                fontFamily: 'Epilogue, sans-serif', fontWeight: 700, fontSize: 17,
                color: 'var(--on-surface)', margin: '0 0 8px',
              }}>
                Aucune livraison en attente
              </p>
              <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: 0, lineHeight: 1.5 }}>
                La prochaine livraison cuisine apparaîtra ici dès qu'elle sera enregistrée.
              </p>
            </div>
          )}

          {/* Livraisons en attente */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {pending.map(l => {
              const depAt = l.departAt?.toDate
                ? l.departAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : ''
              const hasTemp = l.departTempC != null
              return (
                <div key={l.id} className="card" style={{ border: '1.5px solid rgba(0,66,117,0.15)' }}>
                  {/* Titre produit */}
                  <div style={{ marginBottom: 4 }}>
                    <span style={{
                      fontFamily: 'Epilogue, sans-serif', fontWeight: 700, fontSize: 15,
                      color: 'var(--on-surface)',
                    }}>
                      {l.productName}
                    </span>
                    {l.isManual && (
                      <span style={{
                        fontSize: 11, color: 'var(--on-surface-3)', fontWeight: 400, marginLeft: 6,
                      }}>(manuel)</span>
                    )}
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--on-surface-3)', marginBottom: 14, marginTop: 0 }}>
                    {hasTemp
                      ? `Lot ${l.lotCode} · Départ ${l.departTempC}°C à ${depAt} · Cat. ${l.category}`
                      : `Lot ${l.lotCode} · Cat. ${l.category} · Départ à ${depAt}`
                    }
                  </p>

                  {l.departPhotoUrl && (
                    <button
                      onClick={() => setPhotoModal({ url: l.departPhotoUrl!, label: 'Photo départ' })}
                      style={{
                        fontSize: 12, color: 'var(--primary)', background: 'none', border: 'none',
                        cursor: 'pointer', padding: 0, display: 'block', marginBottom: 12, fontWeight: 600,
                        fontFamily: 'Manrope, sans-serif',
                      }}
                    >
                      Voir photo départ →
                    </button>
                  )}

                  {hasTemp ? (
                    <>
                      {/* Température réception */}
                      <div style={{ marginBottom: 10 }}>
                        <p className="section-label" style={{ marginBottom: 6 }}>Température réception (°C) *</p>
                        <input
                          className="input-filled"
                          value={receptionTemps[l.id] || ''}
                          onChange={e => setReceptionTemps(p => ({ ...p, [l.id]: e.target.value }))}
                          placeholder="ex : 3,8"
                          inputMode="decimal"
                        />
                      </div>

                      {/* Photo optionnelle */}
                      <div style={{ marginBottom: 16 }}>
                        <p className="section-label" style={{ marginBottom: 6 }}>Photo (optionnelle)</p>
                        <input
                          type="file" accept="image/*" className="input-filled"
                          onChange={e => setReceptionPhotos(p => ({ ...p, [l.id]: e.target.files?.[0] || null }))}
                        />
                      </div>

                      <button
                        onClick={() => submitReception(l)}
                        disabled={loading || !receptionTemps[l.id]}
                        className="btn-primary"
                      >
                        {loading ? 'Enregistrement…' : 'Valider réception'}
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Checkbox pour livraisons sans température */}
                      <label style={{
                        display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                        padding: '12px 14px', borderRadius: 10,
                        background: receptionChecked[l.id] ? 'rgba(45,122,79,0.08)' : 'var(--surface-low)',
                        border: `1.5px solid ${receptionChecked[l.id] ? 'rgba(45,122,79,0.25)' : 'var(--border)'}`,
                        marginBottom: 12, transition: 'all 0.15s',
                      }}>
                        <input
                          type="checkbox"
                          checked={!!receptionChecked[l.id]}
                          onChange={e => setReceptionChecked(p => ({ ...p, [l.id]: e.target.checked }))}
                          style={{ width: 20, height: 20, accentColor: 'var(--success)', cursor: 'pointer' }}
                        />
                        <span style={{
                          fontSize: 14, fontWeight: 600,
                          color: receptionChecked[l.id] ? 'var(--success)' : 'var(--on-surface)',
                          fontFamily: 'Manrope, sans-serif',
                        }}>
                          Livraison reçue ✓
                        </span>
                      </label>

                      <button
                        onClick={() => submitReception(l)}
                        disabled={loading || !receptionChecked[l.id]}
                        className="btn-primary"
                        style={{ marginBottom: 0 }}
                      >
                        {loading ? 'Enregistrement…' : 'Valider réception'}
                      </button>
                    </>
                  )}

                  {/* Boutons actions secondaires */}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button
                      onClick={() => retourCuisine(l.id)}
                      style={{
                        fontSize: 12, padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                        background: 'rgba(0,66,117,0.08)', color: 'var(--primary)', fontWeight: 600,
                        fontFamily: 'Manrope, sans-serif',
                      }}
                    >
                      ↩ Retour cuisine
                    </button>
                    {['patron', 'administrateur', 'manager'].includes(user?.role ?? '') && (
                      <button
                        onClick={() => supprimerLivraison(l.id)}
                        style={{
                          fontSize: 12, padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                          background: 'rgba(192,57,43,0.08)', color: 'var(--danger)', fontWeight: 600,
                          fontFamily: 'Manrope, sans-serif',
                        }}
                      >
                        🗑 Supprimer
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Livraisons complétées */}
          {done.length > 0 && (
            <>
              <p className="section-label" style={{ margin: '8px 0 0' }}>
                Complétées aujourd'hui ({done.length})
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {done.map(l => {
                  const recAt = l.receptionAt?.toDate
                    ? l.receptionAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : ''
                  const isRefuse = l.result === 'REFUSE'
                  return (
                    <div key={l.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      background: isRefuse ? 'rgba(192,57,43,0.04)' : 'var(--surface-low)',
                      borderRadius: 12, padding: '12px 14px',
                      border: isRefuse ? '1px solid rgba(192,57,43,0.15)' : '1px solid var(--border)',
                    }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface)' }}>
                          {l.productName}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 2 }}>
                          {l.receptionTempC != null
                            ? `Réception ${l.receptionTempC}°C à ${recAt}`
                            : `Réceptionné à ${recAt}`}
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                          {l.departPhotoUrl && (
                            <button
                              onClick={() => setPhotoModal({ url: l.departPhotoUrl!, label: 'Photo départ' })}
                              style={{
                                fontSize: 11, color: 'var(--primary)', background: 'none', border: 'none',
                                cursor: 'pointer', padding: 0, fontWeight: 600, fontFamily: 'Manrope, sans-serif',
                              }}
                            >
                              Photo départ
                            </button>
                          )}
                          {l.receptionPhotoUrl && (
                            <button
                              onClick={() => setPhotoModal({ url: l.receptionPhotoUrl!, label: 'Photo réception' })}
                              style={{
                                fontSize: 11, color: 'var(--primary)', background: 'none', border: 'none',
                                cursor: 'pointer', padding: 0, fontWeight: 600, fontFamily: 'Manrope, sans-serif',
                              }}
                            >
                              Photo réception
                            </button>
                          )}
                        </div>
                      </div>
                      {resultChip(l.result)}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* ════════════════ HISTORIQUE ════════════════ */}
      {tab === 'historique' && (
        <>
          <div>
            <p className="section-label" style={{ marginBottom: 6 }}>Date</p>
            <input
              type="date"
              className="input-filled"
              value={histDate}
              max={toLocalDateValue(new Date())}
              onChange={e => setHistDate(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          {histLoading && (
            <div style={{ textAlign: 'center', padding: 24 }}>
              <div className="spinner" style={{ margin: '0 auto' }} />
            </div>
          )}
          {histError && (
            <div style={{
              padding: '10px 14px',
              background: 'rgba(192,57,43,0.06)', border: '1px solid rgba(192,57,43,0.18)',
              borderRadius: 10, fontSize: 13, color: 'var(--danger)',
            }}>
              {histError}
            </div>
          )}

          {!histLoading && !histError && histLivraisons.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
              <p style={{
                fontFamily: 'Epilogue, sans-serif', fontWeight: 700, fontSize: 15,
                color: 'var(--on-surface)', margin: '0 0 6px',
              }}>
                Aucune livraison ce jour-là
              </p>
              <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: 0 }}>
                Sélectionnez une autre date
              </p>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {histLivraisons.map(l => {
              const depAt = l.departAt?.toDate
                ? l.departAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '—'
              const recAt = l.receptionAt?.toDate
                ? l.receptionAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : null
              const isRefuse = l.result === 'REFUSE'
              return (
                <div key={l.id} className="card">
                  {/* En-tête livraison */}
                  <div style={{
                    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                    marginBottom: 12,
                  }}>
                    <div>
                      <div style={{
                        fontFamily: 'Epilogue, sans-serif', fontSize: 15, fontWeight: 700,
                        color: 'var(--on-surface)',
                      }}>
                        {l.productName}
                        {l.isManual && (
                          <span style={{
                            fontSize: 11, color: 'var(--on-surface-3)', fontWeight: 400, marginLeft: 6,
                          }}>(manuel)</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 2 }}>
                        Lot {l.lotCode} · {l.category}
                      </div>
                    </div>
                    {resultChip(l.result)}
                  </div>

                  {/* Températures côte à côte */}
                  <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                    <div style={{
                      flex: 1, background: 'var(--surface-mid)', borderRadius: 12, padding: '10px 12px',
                    }}>
                      <p className="section-label" style={{ marginBottom: 4 }}>Départ</p>
                      <div style={{
                        fontSize: 22, fontWeight: 800, color: 'var(--on-surface)',
                        fontFamily: 'Epilogue, sans-serif', lineHeight: 1,
                      }}>
                        {l.departTempC}°C
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 2 }}>{depAt}</div>
                    </div>
                    <div style={{
                      flex: 1,
                      background: isRefuse ? 'rgba(192,57,43,0.06)' : 'rgba(84,101,30,0.08)',
                      borderRadius: 12, padding: '10px 12px',
                    }}>
                      <p className="section-label" style={{ marginBottom: 4 }}>Réception</p>
                      {recAt ? (
                        <>
                          <div style={{
                            fontSize: 22, fontWeight: 800, fontFamily: 'Epilogue, sans-serif', lineHeight: 1,
                            color: isRefuse ? 'var(--danger)' : 'var(--secondary)',
                          }}>
                            {l.receptionTempC}°C
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 2 }}>{recAt}</div>
                        </>
                      ) : (
                        <div style={{ fontSize: 13, color: 'var(--on-surface-3)', paddingTop: 6 }}>—</div>
                      )}
                    </div>
                  </div>

                  {/* Miniatures photos */}
                  {(l.departPhotoUrl || l.receptionPhotoUrl) && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      {l.departPhotoUrl && (
                        <button
                          onClick={() => setPhotoModal({ url: l.departPhotoUrl!, label: 'Photo départ — ' + l.productName })}
                          style={{
                            flex: 1, borderRadius: 10, overflow: 'hidden',
                            border: '1px solid var(--border)', cursor: 'pointer',
                            background: 'none', padding: 0, position: 'relative',
                          }}
                        >
                          <img
                            src={l.departPhotoUrl} alt="départ"
                            style={{ width: '100%', height: 70, objectFit: 'cover', display: 'block' }}
                          />
                          <div style={{
                            position: 'absolute', bottom: 0, left: 0, right: 0,
                            background: 'rgba(28,28,24,0.55)', fontSize: 10, color: '#fff',
                            padding: '3px 6px', textAlign: 'center',
                            fontFamily: 'Manrope, sans-serif', fontWeight: 600,
                          }}>
                            Départ
                          </div>
                        </button>
                      )}
                      {l.receptionPhotoUrl && (
                        <button
                          onClick={() => setPhotoModal({ url: l.receptionPhotoUrl!, label: 'Photo réception — ' + l.productName })}
                          style={{
                            flex: 1, borderRadius: 10, overflow: 'hidden',
                            border: '1px solid var(--border)', cursor: 'pointer',
                            background: 'none', padding: 0, position: 'relative',
                          }}
                        >
                          <img
                            src={l.receptionPhotoUrl} alt="réception"
                            style={{ width: '100%', height: 70, objectFit: 'cover', display: 'block' }}
                          />
                          <div style={{
                            position: 'absolute', bottom: 0, left: 0, right: 0,
                            background: 'rgba(28,28,24,0.55)', fontSize: 10, color: '#fff',
                            padding: '3px 6px', textAlign: 'center',
                            fontFamily: 'Manrope, sans-serif', fontWeight: 600,
                          }}>
                            Réception
                          </div>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ════════════════ GALERIE PHOTOS ════════════════ */}
      {tab === 'galerie' && (
        <>
          {/* Sélecteur plage de dates */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <p className="section-label" style={{ marginBottom: 5 }}>Du</p>
              <input
                type="date" className="input-filled" value={galFrom} max={galTo}
                onChange={e => setGalFrom(e.target.value)}
              />
            </div>
            <div>
              <p className="section-label" style={{ marginBottom: 5 }}>Au</p>
              <input
                type="date" className="input-filled" value={galTo} max={toLocalDateValue(new Date())}
                onChange={e => setGalTo(e.target.value)}
              />
            </div>
          </div>

          {galLoading && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div className="spinner" style={{ margin: '0 auto' }} />
            </div>
          )}

          {!galLoading && gallery.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>📷</div>
              <p style={{
                fontFamily: 'Epilogue, sans-serif', fontWeight: 700, fontSize: 15,
                color: 'var(--on-surface)', margin: '0 0 6px',
              }}>
                Aucune photo sur cette période
              </p>
              <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: 0 }}>
                Les photos de livraison apparaîtront ici
              </p>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {gallery.map(l => {
              const depAt = l.departAt?.toDate ? l.departAt.toDate() : null
              const dateLabel = depAt
                ? depAt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
                : '—'
              const timeLabel = depAt
                ? depAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : ''
              return (
                <div key={l.id} className="card">
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: 10,
                  }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--on-surface)' }}>
                        {l.productName}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 2 }}>
                        {l.lotCode} · {dateLabel} {timeLabel}
                      </div>
                    </div>
                    {resultChip(l.result)}
                  </div>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: l.departPhotoUrl && l.receptionPhotoUrl ? '1fr 1fr' : '1fr',
                    gap: 8,
                  }}>
                    {l.departPhotoUrl && (
                      <button
                        onClick={() => setPhotoModal({
                          url: l.departPhotoUrl!,
                          label: `Départ — ${l.productName} — ${dateLabel}`,
                        })}
                        style={{
                          position: 'relative', borderRadius: 10, overflow: 'hidden',
                          border: '1px solid var(--border)', cursor: 'pointer',
                          background: 'none', padding: 0,
                        }}
                      >
                        <img
                          src={l.departPhotoUrl} alt="départ"
                          style={{ width: '100%', height: 110, objectFit: 'cover', display: 'block' }}
                        />
                        <div style={{
                          position: 'absolute', bottom: 0, left: 0, right: 0,
                          background: 'rgba(28,28,24,0.6)', fontSize: 11, color: '#fff',
                          padding: '4px 8px', textAlign: 'center',
                          fontWeight: 600, fontFamily: 'Manrope, sans-serif',
                        }}>
                          Départ {l.departTempC}°C
                        </div>
                      </button>
                    )}
                    {l.receptionPhotoUrl && (
                      <button
                        onClick={() => setPhotoModal({
                          url: l.receptionPhotoUrl!,
                          label: `Réception — ${l.productName} — ${dateLabel}`,
                        })}
                        style={{
                          position: 'relative', borderRadius: 10, overflow: 'hidden',
                          border: '1px solid var(--border)', cursor: 'pointer',
                          background: 'none', padding: 0,
                        }}
                      >
                        <img
                          src={l.receptionPhotoUrl} alt="réception"
                          style={{ width: '100%', height: 110, objectFit: 'cover', display: 'block' }}
                        />
                        <div style={{
                          position: 'absolute', bottom: 0, left: 0, right: 0,
                          background: 'rgba(28,28,24,0.6)', fontSize: 11, color: '#fff',
                          padding: '4px 8px', textAlign: 'center',
                          fontWeight: 600, fontFamily: 'Manrope, sans-serif',
                        }}>
                          Réception {l.receptionTempC ?? '—'}°C
                        </div>
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ════════════════ COURSIER ════════════════ */}
      {tab === 'coursier' && (
        <>
          {deliveryLoading && (
            <div style={{ textAlign: 'center', padding: 32 }}>
              <div className="spinner" style={{ margin: '0 auto' }} />
            </div>
          )}

          {!deliveryLoading && deliveries.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: '44px 24px' }}>
              <div style={{ fontSize: 44, marginBottom: 14, lineHeight: 1 }}>🛵</div>
              <p style={{
                fontFamily: 'Epilogue, sans-serif', fontWeight: 700, fontSize: 17,
                color: 'var(--on-surface)', margin: '0 0 8px',
              }}>
                Aucun coursier en route
              </p>
              <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: 0, lineHeight: 1.5 }}>
                Quand un SMS de suivi est reçu, il apparaît ici automatiquement.
              </p>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {deliveries.map(d => {
              const createdAt = d.createdAt?.toDate
                ? d.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '—'
              return (
                <div key={d.id} className="card" style={{ border: '1.5px solid rgba(0,66,117,0.15)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div>
                      <div style={{
                        fontFamily: 'Epilogue, sans-serif', fontWeight: 700, fontSize: 16,
                        color: 'var(--on-surface)',
                      }}>
                        Coursier en route
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 2 }}>
                        SMS reçu à {createdAt}
                      </div>
                    </div>
                    <span className="chip-warn">En cours</span>
                  </div>

                  {d.eta && (
                    <div style={{
                      background: 'rgba(0,66,117,0.05)', borderRadius: 10,
                      padding: '10px 14px', marginBottom: 14,
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <span style={{ fontSize: 18 }}>⏱</span>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--on-surface-3)', fontWeight: 600 }}>ETA estimée</div>
                        <div style={{
                          fontFamily: 'Epilogue, sans-serif', fontSize: 22, fontWeight: 800,
                          color: 'var(--primary)', letterSpacing: '-0.02em',
                        }}>
                          {d.eta}
                        </div>
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {d.trackingUrl && (
                      <a
                        href={d.trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-primary"
                        style={{ textAlign: 'center', textDecoration: 'none', display: 'block' }}
                      >
                        Suivre le coursier →
                      </a>
                    )}
                    <button
                      className="btn-secondary"
                      onClick={() => markDeliveryDone(d.id)}
                    >
                      Livraison terminée
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ════════════════ MODAL PHOTO (lightbox) ════════════════ */}
      {photoModal && (
        <div
          onClick={() => setPhotoModal(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(28,28,24,0.88)', backdropFilter: 'blur(4px)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: 16, cursor: 'pointer',
          }}
        >
          <div style={{
            fontSize: 13, color: 'rgba(252,249,243,0.7)', marginBottom: 12,
            textAlign: 'center', fontFamily: 'Manrope, sans-serif',
          }}>
            {photoModal.label}
          </div>
          <img
            src={photoModal.url} alt={photoModal.label}
            style={{
              maxWidth: '100%', maxHeight: '80vh', borderRadius: 12,
              objectFit: 'contain', boxShadow: '0 8px 40px rgba(28,28,24,0.4)',
            }}
            onClick={e => e.stopPropagation()}
          />
          <div style={{
            marginTop: 16, fontSize: 12, color: 'rgba(252,249,243,0.4)',
            fontFamily: 'Manrope, sans-serif',
          }}>
            Toucher en dehors pour fermer
          </div>
        </div>
      )}

      {/* ════════════════ MODAL NON-CONFORMITÉ ════════════════ */}
      {ncModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(28,28,24,0.4)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }}>
          <div
            style={{
              width: '100%', maxWidth: 520,
              background: 'var(--surface)',
              borderRadius: '20px 20px 0 0', padding: '24px 24px 36px',
              boxShadow: '0 -4px 32px rgba(28,28,24,0.12)',
            }}
            className="animate-sheet-in"
          >
            {ncSuccess ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: 40, marginBottom: 10 }}>✅</div>
                <div style={{
                  fontFamily: 'Epilogue, sans-serif', fontWeight: 700,
                  color: 'var(--secondary)', fontSize: 16,
                }}>
                  Non-conformité enregistrée
                </div>
                <div style={{ fontSize: 13, color: 'var(--on-surface-3)', marginTop: 6 }}>
                  Message envoyé à la messagerie
                </div>
              </div>
            ) : (
              <>
                {/* En-tête alerte */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 22 }}>⛔</span>
                  <h2 style={{
                    fontFamily: 'Epilogue, sans-serif', fontSize: 17, fontWeight: 800,
                    color: 'var(--danger)', margin: 0,
                  }}>
                    Livraison REFUSÉE
                  </h2>
                </div>
                <div style={{ fontSize: 13, color: 'var(--on-surface)', marginBottom: 4 }}>
                  <strong>{ncModal.l.productName}</strong> — lot {ncModal.l.lotCode}
                </div>
                <div style={{
                  fontSize: 15, color: 'var(--danger)', fontWeight: 700, marginBottom: 16,
                }}>
                  Température : {ncModal.t}°C
                </div>
                <p style={{ fontSize: 13, color: 'var(--on-surface-2)', marginBottom: 16 }}>
                  Que faire du produit non-conforme ?
                </p>

                {/* Options décision */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {NC_DECISIONS.map(d => (
                    <button
                      key={d}
                      onClick={() => handleNonConformite(d)}
                      disabled={ncLoading}
                      style={{
                        padding: '14px 16px', borderRadius: 14, fontSize: 14, fontWeight: 700,
                        border: '1px solid var(--border)',
                        background: 'var(--surface-low)',
                        color: 'var(--on-surface)', cursor: 'pointer', textAlign: 'left',
                        opacity: ncLoading ? 0.6 : 1, transition: 'background 0.15s',
                        fontFamily: 'Manrope, sans-serif',
                      }}
                    >
                      {d === 'Gardé au corner' ? '🏪' : d === 'Renvoyé en cuisine' ? '🔄' : '🗑️'} {d}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setNcModal(null)}
                  style={{
                    marginTop: 16, fontSize: 13, color: 'var(--on-surface-3)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    width: '100%', fontFamily: 'Manrope, sans-serif',
                  }}
                >
                  Fermer sans enregistrer
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
