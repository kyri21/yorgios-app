import { useEffect, useMemo, useRef, useState } from 'react'
import { SkeletonList } from '../../../components/Skeleton'
import { EmptyState } from '../../../components/EmptyState'
import {
  Timestamp, collection, deleteDoc, doc, getDoc, getDocs, getDocsFromServer,
  limit, orderBy, query, runTransaction, setDoc, updateDoc, where,
} from 'firebase/firestore'
import { db, auth } from '../../../firebase/config'
import { useAuth } from '../../../auth/useAuth'
import { usePermissions } from '../../../contexts/PermissionsContext'
import { useToast } from '../../../hooks/useToast'
import type { HaccpCategory } from '../lib/haccpRules'

type LivraisonHisto = {
  id: string
  lotCode: string
  productName: string
  category: string
  departTempC: number | null
  departAt: any
  receptionTempC: number | null
  receptionAt: any
  result: string | null
  isManual?: boolean
}

type ReceptionSource = {
  id: string
  productName: string
  fournisseur: string
  receivedAt: Timestamp
  category: string
  supplierLot: string | null
  decision: string
}

type Produit = {
  id: string
  name: string
  abrv?: string
  defaultCategory?: HaccpCategory
  gepCategory?: string
  dlcDays?: number
  active?: boolean
  inFabrication?: boolean
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
  sent?: boolean
  sentToCornerAt?: any
  createdBy?: string
  creatorName?: string
  // Traçabilité
  isTransformation?: boolean
  transformationType?: 'hachage' | 'decoupe' | 'marinade' | 'autre'
  receptionId?: string | null
  fournisseur?: string | null
  ingredientLotCodes?: string[]
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

const TRANSFO_DLC: Record<string, number> = { hachage: 2, decoupe: 3, marinade: 5, autre: 3 }
const TRANSFO_CATEGORY: Record<string, string> = { hachage: 'VIANDE_HACHEE', decoupe: 'VIANDE', marinade: 'VIANDE', autre: 'PLAT_CUISINE' }
const TRANSFO_LABEL: Record<string, string> = { hachage: 'Hachage', decoupe: 'Découpe', marinade: 'Marinade', autre: 'Autre transformation' }
const TRANSFO_ICON: Record<string, string> = { hachage: '🔪', decoupe: '✂️', marinade: '🌿', autre: '🔄' }
// Fallback DLC par catégorie GEP quand dlcDays absent du catalogue
const GEP_DLC: Record<string, number> = { VIANDE_HACHEE: 2, VIANDE: 3, POISSON: 2, LAIT: 4, PLAT_CUISINE: 3, PATISSERIE: 3, LEGUME: 8 }
function getProductDlcDays(p: Produit): number {
  if (p.dlcDays && p.dlcDays > 0) return p.dlcDays
  return GEP_DLC[p.gepCategory ?? ''] ?? 3
}

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)',
  display: 'block', marginBottom: 6,
  textTransform: 'uppercase', letterSpacing: '0.06em',
}

export default function Fabrication() {
  const { show } = useToast()
  const { user } = useAuth()
  const { can } = usePermissions()
  const isAdmin = user?.role === 'patron' || user?.role === 'administrateur'
  const canDeleteLot = can(user?.role, 'action_delete_lot')
  const canSeeCreator = can(user?.role, 'field_createur_lot')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedOk, setSavedOk] = useState(false)

  const [produits, setProduits] = useState<Produit[]>([])
  const [produitsLoaded, setProduitsLoaded] = useState(false)

  // Mode formulaire
  const [formMode, setFormMode] = useState<'catalogue' | 'manuel' | 'reception' | 'transformation'>('catalogue')

  // Mode "depuis réception"
  const [receptions, setReceptions] = useState<ReceptionSource[]>([])
  const [receptionsLoaded, setReceptionsLoaded] = useState(false)
  const [selectedReceptionId, setSelectedReceptionId] = useState('')
  const [showExpiredReceptions, setShowExpiredReceptions] = useState(false)

  // Mode "transformation"
  const [transfoType, setTransfoType] = useState<'hachage' | 'decoupe' | 'marinade' | 'autre'>('hachage')
  const [transfoReceptionId, setTransfoReceptionId] = useState('')
  const [transfoReceptions, setTransfoReceptions] = useState<ReceptionSource[]>([])
  const [transfoReceptionsLoaded, setTransfoReceptionsLoaded] = useState(false)
  const [transfoReceptionsError, setTransfoReceptionsError] = useState(false)

  // Sélecteur lots sources (ingrédients)
  const [transfoLots, setTransfoLots] = useState<Lot[]>([])
  const [transfoLotsLoaded, setTransfoLotsLoaded] = useState(false)
  const [transfoLotsError, setTransfoLotsError] = useState(false)
  const [selectedIngredientLotIds, setSelectedIngredientLotIds] = useState<string[]>([])
  const [showIngredientPicker, setShowIngredientPicker] = useState(false)

  // Modal traçabilité
  const [traceLot, setTraceLot] = useState<Lot | null>(null)
  const [traceData, setTraceData] = useState<{
    ingredientLots: Array<{ lot: Lot; reception: ReceptionSource | null }>
    directReception: ReceptionSource | null
  } | null>(null)
  const [traceLoading, setTraceLoading] = useState(false)

  // Formulaire
  const [producedDate, setProducedDate] = useState(nowLocalDateValue())
  const [productId, setProductId] = useState('')
  const [quantity, setQuantity] = useState('')

  // Mode manuel
  const [manualName, setManualName] = useState('')
  const [manualDlcDays, setManualDlcDays] = useState('3')
  const [manualCategory, setManualCategory] = useState('PLAT_CUISINE')

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

  // Onglets
  const [tab, setTab] = useState<'fabrication' | 'historique'>('fabrication')

  // Historique livraisons
  const [histoLoading, setHistoLoading] = useState(false)
  const [historique, setHistorique] = useState<LivraisonHisto[]>([])

  const selectedProduit = useMemo(() => produits.find(p => p.id === productId) || null, [produits, productId])

  const computed = useMemo(() => {
    const q = Number(quantity)
    const okQty = Number.isFinite(q) && q > 0
    const d = producedDate ? new Date(`${producedDate}T00:00:00`) : null
    const dlcDays = selectedProduit ? getProductDlcDays(selectedProduit) : 0
    const dlcAt = d && dlcDays > 0 ? new Date(d.getTime() + dlcDays * 24 * 3600 * 1000) : null
    return { okQty, dlcDays: dlcDays || null, dlcAt }
  }, [quantity, producedDate, selectedProduit])

  async function loadProduits() {
    const snap = await getDocsFromServer(collection(db, 'catalogue'))
    const list: Produit[] = snap.docs
      .map(d => ({ id: d.id, ...(d.data() as any) }))
      .filter(p => p.active !== false && p.inFabrication !== false)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    setProduits(list)
  }

  const VIANDE_CATS = ['VIANDE', 'VIANDE_HACHEE']

  async function loadReceptions() {
    setReceptionsLoaded(false)
    try {
      const snap = await getDocs(query(collection(db, 'receptions'), orderBy('receivedAt', 'desc'), limit(40)))
      const allRaw = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ReceptionSource[]
      const viande = allRaw.filter(r => {
        const cat = ((r.category ?? '') as string).toUpperCase().replace(/[\s_-]/g, '')
        return VIANDE_CATS.some(v => cat.includes(v.replace('_', '')))
      })
      setReceptions(viande)
    } catch {
      // silently ignore
    } finally {
      setReceptionsLoaded(true)
    }
  }

  async function loadTransfoReceptions() {
    setTransfoReceptionsLoaded(false)
    setTransfoReceptionsError(false)
    try {
      const snap = await getDocs(query(
        collection(db, 'receptions'),
        orderBy('receivedAt', 'desc'),
        limit(50),
      ))
      setTransfoReceptions(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ReceptionSource[])
    } catch (e) {
      console.error('[Fabrication] loadTransfoReceptions', e)
      setTransfoReceptionsError(true)
    }
    finally { setTransfoReceptionsLoaded(true) }
  }

  async function loadTransfoLots() {
    setTransfoLotsLoaded(false)
    setTransfoLotsError(false)
    try {
      const since = new Date()
      since.setDate(since.getDate() - 14)
      const snap = await getDocs(query(
        collection(db, 'lots_cuisine'),
        where('isTransformation', '==', true),
        where('createdAt', '>=', Timestamp.fromDate(since)),
        orderBy('createdAt', 'desc'),
      ))
      setTransfoLots(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }) as Lot))
    } catch (e) {
      console.error('[Fabrication] loadTransfoLots', e)
      setTransfoLotsError(true)
    }
    finally { setTransfoLotsLoaded(true) }
  }

  async function loadHistorique() {
    setHistoLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'livraisons'), orderBy('departAt', 'desc'), limit(50)))
      setHistorique(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }) as LivraisonHisto))
    } finally {
      setHistoLoading(false)
    }
  }

  async function loadLots() {
    const hlSnap = await getDoc(doc(db, 'settings', 'history_limits'))
    const jours = (hlSnap.data() as any)?.lotsJours ?? 30
    const since = new Date()
    since.setDate(since.getDate() - jours)
    const q = query(collection(db, 'lots_cuisine'), where('createdAt', '>=', Timestamp.fromDate(since)), orderBy('createdAt', 'desc'))
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

  const backfillDone = useRef(false)
  useEffect(() => {
    if (!isAdmin || backfillDone.current) return
    backfillDone.current = true
    ;(async () => {
      try {
        const toFix = lots.filter(l => l.createdBy && !l.creatorName)
        if (toFix.length === 0) return
        const uids = [...new Set(toFix.map(l => l.createdBy!))]
        const userSnaps = await Promise.all(uids.map(uid => getDoc(doc(db, 'users', uid))))
        const nameMap: Record<string, string> = {}
        userSnaps.forEach((snap, i) => {
          if (snap.exists()) {
            const d = snap.data()
            nameMap[uids[i]] = d.displayName || d.email || uids[i]
          }
        })
        await Promise.all(toFix.map(l => {
          const name = nameMap[l.createdBy!]
          if (!name) return Promise.resolve()
          return updateDoc(doc(db, 'lots_cuisine', l.id), { creatorName: name })
        }))
        setLots(prev => prev.map(l =>
          l.createdBy && !l.creatorName && nameMap[l.createdBy]
            ? { ...l, creatorName: nameMap[l.createdBy] }
            : l
        ))
      } catch { /* silently ignore */ }
    })()
  }, [isAdmin, lots.length])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSavedOk(false)
    const q = Number(quantity)
    if (!producedDate) return setError('Date de fabrication obligatoire.')
    if (!Number.isFinite(q) || q <= 0) return setError('Quantité invalide (doit être > 0).')

    const isManuel = formMode === 'manuel'
    const isReception = formMode === 'reception'
    const isTransformation = formMode === 'transformation'
    const selectedReception = receptions.find(r => r.id === selectedReceptionId) || null
    const selectedTransfoReception = transfoReceptions.find(r => r.id === transfoReceptionId) || null

    if (!isManuel && !selectedProduit) return setError('Produit obligatoire.')
    if (isManuel && !manualName.trim()) return setError('Nom du produit obligatoire.')
    if (isReception && !selectedReception) return setError('Sélectionner une réception source.')
    if (isTransformation && !transfoReceptionId) return setError('Sélectionner une réception source.')

    const productName = isManuel ? manualName.trim() : selectedProduit!.name
    const abrv = isManuel
      ? manualName.trim().slice(0, 4).toUpperCase().replace(/\s+/g, '')
      : (selectedProduit!.abrv || selectedProduit!.name.slice(0, 3)).trim().toUpperCase()
    const dlcDays = isManuel
      ? Number(manualDlcDays) || 3
      : getProductDlcDays(selectedProduit!)
    const category = isManuel
      ? manualCategory
      : isTransformation
        ? TRANSFO_CATEGORY[transfoType]
        : (selectedProduit!.gepCategory ?? selectedProduit!.defaultCategory ?? 'AUTRE')

    setLoading(true)
    try {
      const uid = auth.currentUser?.uid || ''
      const creatorName = user?.displayName || auth.currentUser?.email || uid
      const producedAtDate = new Date(`${producedDate}T00:00:00`)
      const seq = await nextLotSequence(producedAtDate, abrv)
      const lotCode = `${toDDMMYYYY(producedAtDate)}-${String(seq).padStart(2, '0')}-${abrv}`
      const dlcAtDate = new Date(producedAtDate.getTime() + dlcDays * 24 * 3600 * 1000)

      // Anti-doublon: vérifier que ce lotCode n'existe pas déjà
      const existingSnap = await getDocs(query(
        collection(db, 'lots_cuisine'),
        where('lotCode', '==', lotCode),
        limit(1)
      ))
      if (!existingSnap.empty) {
        setError(`Un lot avec le code ${lotCode} existe déjà. Veuillez vérifier.`)
        setLoading(false)
        return
      }

      const lotRef = doc(collection(db, 'lots_cuisine'))
      await setDoc(lotRef, {
        producedAt: Timestamp.fromDate(producedAtDate),
        dlcAt: Timestamp.fromDate(dlcAtDate),
        productId: isManuel ? null : selectedProduit!.id,
        productName,
        abrv,
        category,
        quantity: q,
        dlcDays,
        lotCode,
        archived: false,
        receptionId: isReception ? selectedReceptionId : isTransformation ? transfoReceptionId : null,
        fournisseur: isReception ? selectedReception!.fournisseur : isTransformation ? selectedTransfoReception!.fournisseur : null,
        isTransformation: isTransformation,
        transformationType: isTransformation ? transfoType : null,
        ingredientLotCodes: isTransformation ? [] : selectedIngredientLotIds,
        createdAt: Timestamp.now(),
        createdBy: uid,
        creatorName,
      })
      setQuantity('')
      setProductId('')
      setManualName('')
      setManualDlcDays('3')
      setSelectedReceptionId('')
      setTransfoReceptionId('')
      setTransfoType('hachage')
      setSelectedIngredientLotIds([])
      setShowIngredientPicker(false)
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

  async function loadTraceData(lot: Lot) {
    setTraceLoading(true)
    setTraceData(null)
    try {
      let directReception: ReceptionSource | null = null
      if (lot.receptionId) {
        const snap = await getDoc(doc(db, 'receptions', lot.receptionId))
        if (snap.exists()) directReception = { id: snap.id, ...(snap.data() as any) } as ReceptionSource
      }
      const ingredientLotCodes: string[] = lot.ingredientLotCodes ?? []
      let ingredientLots: Array<{ lot: Lot; reception: ReceptionSource | null }> = []
      if (ingredientLotCodes.length > 0) {
        const snaps = await Promise.all(ingredientLotCodes.map(id => getDoc(doc(db, 'lots_cuisine', id))))
        ingredientLots = (await Promise.all(snaps.map(async snap => {
          if (!snap.exists()) return null
          const ingLot = { id: snap.id, ...(snap.data() as any) } as Lot
          let reception: ReceptionSource | null = null
          if (ingLot.receptionId) {
            const rSnap = await getDoc(doc(db, 'receptions', ingLot.receptionId))
            if (rSnap.exists()) reception = { id: rSnap.id, ...(rSnap.data() as any) } as ReceptionSource
          }
          return { lot: ingLot, reception }
        }))).filter(Boolean) as Array<{ lot: Lot; reception: ReceptionSource | null }>
      }
      setTraceData({ ingredientLots, directReception })
    } catch (e) {
      console.error('[Fabrication] loadTrace', e)
    }
    finally { setTraceLoading(false) }
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

  const todayStr = toYYYYMMDD(new Date())
  const visibleLots = lots.filter(l => {
    if (showArchived) return l.archived === true
    if (l.archived === true) return false
    const lotDateStr = l.producedAt?.toDate ? toYYYYMMDD(l.producedAt.toDate()) : ''
    const isToday = lotDateStr === todayStr
    // Jours précédents : n'afficher que les lots pas encore envoyés au corner
    return isToday || !l.sent
  })

  return (
    <div className="page">

      {/* Header */}
      <div>
        <p className="section-label" style={{ marginBottom: 2 }}>Cuisine · Production</p>
        <h1 style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 26, fontWeight: 800, color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0 }}>
          Fabrication
        </h1>
      </div>

      {/* Onglets */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--surface-mid)', borderRadius: 12, padding: 4 }}>
        {(['fabrication', 'historique'] as const).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); if (t === 'historique' && historique.length === 0) loadHistorique() }}
            style={{
              flex: 1, padding: '9px 0', borderRadius: 9, fontSize: 13, fontWeight: 700,
              border: 'none', cursor: 'pointer', fontFamily: 'Manrope, sans-serif',
              background: tab === t ? 'var(--surface)' : 'transparent',
              color: tab === t ? 'var(--primary)' : 'var(--on-surface-3)',
              boxShadow: tab === t ? '0 1px 6px rgba(28,28,24,0.08)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            {t === 'fabrication' ? '🍳 Fabrication' : '📋 Historique'}
          </button>
        ))}
      </div>

      {tab === 'historique' && (
        <HistoriqueTab loading={histoLoading} livraisons={historique} onRefresh={loadHistorique} />
      )}

      {tab === 'fabrication' && (<>

      {/* Formulaire nouveau lot */}
      <div className="card" style={{ padding: 20 }}>
        <p className="section-label" style={{ margin: '0 0 14px' }}>Nouveau lot</p>

        {/* Mode toggle */}
        <div style={{
          display: 'flex', gap: 4, marginBottom: 16,
          background: 'var(--surface-mid)', borderRadius: 12, padding: 4,
        }}>
          {([
            { id: 'catalogue', label: '📋 Catalogue' },
            { id: 'reception', label: '📦 Réception' },
            { id: 'manuel', label: '✏️ Libre' },
            { id: 'transformation', label: '🔄 Transformation' },
          ] as const).map(m => (
            <button key={m.id} type="button" onClick={() => {
              setFormMode(m.id)
              setProductId('')
              setManualName('')
              setSelectedReceptionId('')
              setTransfoReceptionId('')
              setTransfoType('hachage')
              if (m.id === 'reception' && !receptionsLoaded) loadReceptions()
              if (m.id === 'transformation' && !transfoReceptionsLoaded) loadTransfoReceptions()
            }} style={{
              flex: 1, padding: '8px 0', borderRadius: 9, fontSize: 12, fontWeight: 700,
              border: 'none', cursor: 'pointer', fontFamily: 'Manrope, sans-serif',
              background: formMode === m.id ? 'var(--surface)' : 'transparent',
              color: formMode === m.id ? 'var(--primary)' : 'var(--on-surface-3)',
              boxShadow: formMode === m.id ? '0 1px 6px rgba(28,28,24,0.08)' : 'none',
              transition: 'all 0.15s',
            }}>
              {m.label}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'end' }}>
            <div>
              <label style={labelStyle}>Date fabrication *</label>
              <input className="input" type="date" value={producedDate} onChange={e => setProducedDate(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={labelStyle}>Quantité *</label>
              <input className="input" type="number" step="1" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
            </div>
          </div>

          {formMode === 'catalogue' && (
            <>
              <label style={{ ...labelStyle, marginTop: 14 }}>Produit *</label>
              <ProductPicker value={productId} onChange={setProductId} produits={produits} loaded={produitsLoaded} />
              {selectedProduit && (
                <div style={{
                  fontSize: 12, color: 'var(--on-surface-2)', marginTop: 8,
                  padding: '8px 12px', borderRadius: 10,
                  background: 'var(--surface-mid)',
                }}>
                  DLC : <b style={{ color: 'var(--on-surface)', fontWeight: 700 }}>{getProductDlcDays(selectedProduit)} j</b>
                  {computed.dlcAt && (
                    <> · Expire le <b style={{ color: 'var(--warning)', fontWeight: 700 }}>{computed.dlcAt.toLocaleDateString('fr-FR')}</b></>
                  )}
                </div>
              )}
            </>
          )}

          {formMode === 'manuel' && (
            <>
              <label style={{ ...labelStyle, marginTop: 14 }}>Nom du produit *</label>
              <input
                className="input"
                placeholder="ex : Moussaka maison, Tiramisu…"
                value={manualName}
                onChange={e => setManualName(e.target.value)}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
                <div>
                  <label style={labelStyle}>DLC (jours) *</label>
                  <input
                    className="input"
                    type="number" min="1" max="30"
                    value={manualDlcDays}
                    onChange={e => setManualDlcDays(e.target.value)}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Catégorie</label>
                  <select className="input" value={manualCategory} onChange={e => setManualCategory(e.target.value)}>
                    <option value="PLAT_CUISINE">Plat cuisiné</option>
                    <option value="PATISSERIE">Pâtisserie</option>
                    <option value="LAIT">Laitier</option>
                    <option value="LEGUME">Légume</option>
                    <option value="VIANDE">Viande</option>
                    <option value="VIANDE_HACHEE">Viande hachée</option>
                    <option value="AUTRE">Autre</option>
                  </select>
                </div>
              </div>
              {manualName.trim() && manualDlcDays && (
                <div style={{
                  fontSize: 12, color: 'var(--on-surface-2)', marginTop: 8,
                  padding: '8px 12px', borderRadius: 10, background: 'var(--surface-mid)',
                }}>
                  DLC : <b style={{ color: 'var(--on-surface)', fontWeight: 700 }}>{manualDlcDays} j</b>
                  {producedDate && (
                    <> · Expire le <b style={{ color: 'var(--warning)', fontWeight: 700 }}>
                      {new Date(new Date(`${producedDate}T00:00:00`).getTime() + Number(manualDlcDays) * 86400000).toLocaleDateString('fr-FR')}
                    </b></>
                  )}
                </div>
              )}
            </>
          )}

          {formMode === 'reception' && (
            <>
              <label style={{ ...labelStyle, marginTop: 14 }}>Produit fabriqué *</label>
              <ProductPicker value={productId} onChange={setProductId} produits={produits} loaded={produitsLoaded} />
              {selectedProduit && (
                <div style={{ fontSize: 12, color: 'var(--on-surface-2)', marginTop: 8, padding: '8px 12px', borderRadius: 10, background: 'var(--surface-mid)' }}>
                  DLC : <b style={{ color: 'var(--on-surface)', fontWeight: 700 }}>{getProductDlcDays(selectedProduit)} j</b>
                  {computed.dlcAt && (
                    <> · Expire le <b style={{ color: 'var(--warning)', fontWeight: 700 }}>{computed.dlcAt.toLocaleDateString('fr-FR')}</b></>
                  )}
                </div>
              )}

              <label style={{ ...labelStyle, marginTop: 14 }}>Réception source (traçabilité origine) *</label>
              {!receptionsLoaded ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 52, borderRadius: 10 }} />)}
                </div>
              ) : receptions.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--on-surface-3)' }}>Aucune réception enregistrée.</p>
              ) : (
                <>
                  <div style={{ maxHeight: 260, overflowY: 'auto', borderRadius: 10, background: 'var(--surface-mid)' }}>
                    {(() => {
                      const sevenDaysAgo = new Date()
                      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
                      const filtered = receptions.filter(r => {
                        const d = r.receivedAt?.toDate?.() ?? new Date()
                        return d >= sevenDaysAgo
                      })
                      if (filtered.length === 0) {
                        return (
                          <p style={{ fontSize: 13, color: 'var(--on-surface-3)', padding: '12px 14px', margin: 0 }}>
                            Aucune réception viande récente (moins de 7j).
                          </p>
                        )
                      }
                      return filtered.map(r => {
                        const _pad2 = (n: number) => String(n).padStart(2, '0')
                        const d = r.receivedAt?.toDate?.() ?? new Date()
                        const dateStr = `${_pad2(d.getDate())}/${_pad2(d.getMonth()+1)} ${_pad2(d.getHours())}:${_pad2(d.getMinutes())}`
                        const active = selectedReceptionId === r.id
                        return (
                          <div
                            key={r.id}
                            onClick={() => setSelectedReceptionId(active ? '' : r.id)}
                            style={{
                              padding: '10px 12px', cursor: 'pointer',
                              borderLeft: active ? '3px solid var(--primary)' : '3px solid transparent',
                              background: active ? 'rgba(0,66,117,0.07)' : 'transparent',
                              transition: 'background 0.12s',
                            }}
                          >
                            <div style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? 'var(--primary)' : 'var(--on-surface)' }}>
                              {r.productName}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 2 }}>
                              {r.fournisseur} · {dateStr}
                              {r.supplierLot ? ` · Lot ${r.supplierLot}` : ''}
                            </div>
                          </div>
                        )
                      })
                    })()}
                  </div>
                </>
              )}
              {selectedReceptionId && selectedProduit && (() => {
                const r = receptions.find(r => r.id === selectedReceptionId)
                if (!r) return null
                const d = r.receivedAt?.toDate?.() ?? new Date()
                return (
                  <div style={{ fontSize: 12, color: 'var(--on-surface-2)', marginTop: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(0,66,117,0.06)', border: '1px solid rgba(0,66,117,0.12)', lineHeight: 1.7 }}>
                    <div>🍽 <b style={{ color: 'var(--primary)' }}>{selectedProduit.name}</b></div>
                    <div style={{ marginTop: 2 }}>
                      📦 Origine : <b>{r.productName}</b> ({r.fournisseur}) reçu le {d.toLocaleDateString('fr-FR')}
                      {r.supplierLot ? <> · lot <b>{r.supplierLot}</b></> : ''}
                    </div>
                  </div>
                )
              })()}
            </>
          )}

          {formMode === 'transformation' && (
            <>
              <label style={{ ...labelStyle, marginTop: 14 }}>Produit fabriqué *</label>
              <ProductPicker value={productId} onChange={setProductId} produits={produits} loaded={produitsLoaded} />

              <label style={{ ...labelStyle, marginTop: 14 }}>Type de transformation *</label>
              <select
                className="input"
                value={transfoType}
                onChange={e => setTransfoType(e.target.value as typeof transfoType)}
              >
                <option value="hachage">🔪 Hachage (DLC J+2 · VIANDE_HACHÉE)</option>
                <option value="decoupe">🔪 Découpe (DLC J+3 · VIANDE)</option>
                <option value="marinade">🫙 Marinade (DLC J+5 · VIANDE)</option>
                <option value="autre">⚙️ Autre (DLC J+3)</option>
              </select>

              <label style={{ ...labelStyle, marginTop: 14 }}>Réception source *</label>
              {!transfoReceptionsLoaded ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 52, borderRadius: 10 }} />)}
                </div>
              ) : transfoReceptionsError ? (
                <p style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 600 }}>
                  ⚠️ Échec du chargement des réceptions.{' '}
                  <button type="button" onClick={() => loadTransfoReceptions()} style={{ background: 'none', border: 'none', color: 'var(--primary)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: 13 }}>Réessayer</button>
                </p>
              ) : transfoReceptions.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--on-surface-3)' }}>Aucune réception enregistrée.</p>
              ) : (
                <div style={{ maxHeight: 240, overflowY: 'auto', borderRadius: 10, background: 'var(--surface-mid)' }}>
                  {transfoReceptions.map(r => {
                    const _p = (n: number) => String(n).padStart(2, '0')
                    const d = r.receivedAt?.toDate?.() ?? new Date()
                    const dateStr = `${_p(d.getDate())}/${_p(d.getMonth()+1)} ${_p(d.getHours())}:${_p(d.getMinutes())}`
                    const active = transfoReceptionId === r.id
                    return (
                      <div key={r.id} onClick={() => setTransfoReceptionId(active ? '' : r.id)} style={{
                        padding: '10px 12px', cursor: 'pointer',
                        borderLeft: active ? '3px solid var(--primary)' : '3px solid transparent',
                        background: active ? 'rgba(0,66,117,0.07)' : 'transparent',
                        transition: 'background 0.12s',
                      }}>
                        <div style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? 'var(--primary)' : 'var(--on-surface)' }}>
                          {r.productName}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 2 }}>
                          {r.fournisseur} · {dateStr}{r.supplierLot ? ` · Lot ${r.supplierLot}` : ''}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              {transfoReceptionId && selectedProduit && (() => {
                const r = transfoReceptions.find(r => r.id === transfoReceptionId)
                if (!r) return null
                const d = r.receivedAt?.toDate?.() ?? new Date()
                return (
                  <div style={{ fontSize: 12, color: 'var(--on-surface-2)', marginTop: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(109,40,217,0.05)', border: '1px solid rgba(109,40,217,0.15)', lineHeight: 1.9 }}>
                    <div>🍽 <b style={{ color: 'var(--primary)' }}>{selectedProduit.name}</b></div>
                    <div>🔪 <b>{TRANSFO_LABEL[transfoType]}</b> · DLC J+{getProductDlcDays(selectedProduit)}</div>
                    <div>📦 Depuis réception : <b>{r.productName}</b> ({r.fournisseur}) · {d.toLocaleDateString('fr-FR')}{r.supplierLot ? ` · lot ${r.supplierLot}` : ''}</div>
                  </div>
                )
              })()}
            </>
          )}

          {(formMode === 'catalogue' || formMode === 'manuel') && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={labelStyle}>Lots sources (ingrédients) — optionnel</label>
                <button type="button" onClick={() => { setShowIngredientPicker(v => !v); if (!transfoLotsLoaded) loadTransfoLots() }} style={{
                  fontSize: 11, padding: '3px 10px', borderRadius: 7, border: '1px solid var(--border)',
                  background: showIngredientPicker ? 'rgba(109,40,217,0.08)' : 'var(--surface-mid)',
                  color: showIngredientPicker ? '#6d28d9' : 'var(--on-surface-3)',
                  cursor: 'pointer', fontWeight: 600, fontFamily: 'Manrope, sans-serif',
                }}>
                  {showIngredientPicker ? '▲ Masquer' : '+ Ajouter'}
                </button>
              </div>
              {selectedIngredientLotIds.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {selectedIngredientLotIds.map(id => {
                    const lot = transfoLots.find(l => l.id === id)
                    return (
                      <span key={id} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'rgba(109,40,217,0.10)', color: '#6d28d9', border: '1px solid rgba(109,40,217,0.20)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'Manrope, sans-serif', fontWeight: 600 }}>
                        {lot?.productName ?? id}
                        <button type="button" onClick={() => setSelectedIngredientLotIds(ids => ids.filter(i => i !== id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6d28d9', fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
                      </span>
                    )
                  })}
                </div>
              )}
              {showIngredientPicker && (
                <div style={{ maxHeight: 220, overflowY: 'auto', borderRadius: 10, background: 'var(--surface-mid)', border: '1px solid var(--border-soft)' }}>
                  {!transfoLotsLoaded ? (
                    <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--on-surface-3)' }}>Chargement…</div>
                  ) : transfoLotsError ? (
                    <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--danger)', fontWeight: 600 }}>
                      ⚠️ Échec du chargement des lots.{' '}
                      <button type="button" onClick={() => loadTransfoLots()} style={{ background: 'none', border: 'none', color: 'var(--primary)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: 13 }}>Réessayer</button>
                    </div>
                  ) : transfoLots.length === 0 ? (
                    <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--on-surface-3)' }}>Aucun lot de transformation disponible (14 derniers jours).</div>
                  ) : transfoLots.map(l => {
                    const isSelected = selectedIngredientLotIds.includes(l.id)
                    const dlcDate = l.dlcAt?.toDate ? l.dlcAt.toDate() : null
                    const prodDate = l.producedAt?.toDate ? l.producedAt.toDate() : null
                    return (
                      <div key={l.id} onClick={() => setSelectedIngredientLotIds(ids => isSelected ? ids.filter(i => i !== l.id) : [...ids, l.id])} style={{ padding: '10px 12px', cursor: 'pointer', borderLeft: isSelected ? '3px solid #6d28d9' : '3px solid transparent', background: isSelected ? 'rgba(109,40,217,0.07)' : 'transparent', transition: 'background 0.12s' }}>
                        <div style={{ fontSize: 13, fontWeight: isSelected ? 700 : 500, color: isSelected ? '#6d28d9' : 'var(--on-surface)' }}>{l.productName}</div>
                        <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 2 }}>
                          {l.lotCode} · {prodDate?.toLocaleDateString('fr-FR') ?? '—'}{dlcDate ? ` · DLC ${dlcDate.toLocaleDateString('fr-FR')}` : ''}
                        </div>
                      </div>
                    )
                  })}
                </div>
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
            <button className="btn-primary" type="submit"
              disabled={loading || !computed.okQty || (
                formMode === 'manuel' ? !manualName.trim() :
                formMode === 'reception' ? (!productId || !selectedReceptionId) :
                formMode === 'transformation' ? (!productId || !transfoReceptionId) :
                !productId
              )}
              style={{ flex: 1 }}>
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
                      {lot.sent && (
                        <span style={{
                          display: 'inline-block', fontSize: 9, fontWeight: 800,
                          letterSpacing: '0.08em', color: '#2d7a4f',
                          background: 'rgba(45,122,79,0.10)',
                          border: '1px solid rgba(45,122,79,0.25)',
                          borderRadius: 5, padding: '1px 6px', marginLeft: 6,
                          verticalAlign: 'middle', textTransform: 'uppercase',
                        }}>
                          ENVOYÉ
                        </span>
                      )}
                      {lot.isTransformation && (
                        <span style={{
                          display: 'inline-block', fontSize: 9, fontWeight: 800,
                          letterSpacing: '0.08em', color: '#6d28d9',
                          background: 'rgba(109,40,217,0.10)',
                          border: '1px solid rgba(109,40,217,0.20)',
                          borderRadius: 5, padding: '1px 6px', marginLeft: 6,
                          verticalAlign: 'middle', textTransform: 'uppercase',
                        }}>
                          TRANSFO
                        </span>
                      )}
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
                    {canSeeCreator && lot.creatorName && (
                      <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 4 }}>
                        Créé par <b style={{ color: 'var(--on-surface-2)' }}>{lot.creatorName}</b>
                      </div>
                    )}
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
                      {/* Supprimer */}
                      {canDeleteLot && (
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
                      )}
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
                      {/* Traçabilité */}
                      <button onClick={() => { setTraceLot(lot); loadTraceData(lot) }} title="Traçabilité" style={{ width: 34, height: 34, borderRadius: 10, border: '1.5px solid rgba(109,40,217,0.25)', background: 'rgba(109,40,217,0.06)', color: '#6d28d9', cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🔍</button>
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

      </> )} {/* fin tab fabrication */}

      {/* ========== MODAL TRAÇABILITÉ ========== */}
      {traceLot && (
        <div onClick={() => setTraceLot(null)} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(28,28,24,0.5)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 20, padding: 24, maxWidth: 420, width: '100%', boxShadow: '0 8px 32px rgba(28,28,24,0.12)', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 17, fontWeight: 800, color: 'var(--on-surface)', margin: 0 }}>🔍 Traçabilité</h2>
              <button onClick={() => setTraceLot(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--on-surface-3)' }}>×</button>
            </div>
            <TraceNode icon="🍽" label={traceLot.productName} sub={`${traceLot.lotCode} · FAB ${traceLot.producedAt?.toDate?.().toLocaleDateString('fr-FR') ?? '—'} · DLC ${traceLot.dlcAt?.toDate?.().toLocaleDateString('fr-FR') ?? '—'}`} color="var(--primary)" />
            {traceLoading && <div style={{ textAlign: 'center', padding: '20px 0' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>}
            {!traceLoading && traceData && (
              <>
                {traceData.directReception && (<>
                  <TraceArrow />
                  {traceLot.isTransformation && traceLot.transformationType && (<>
                    <TraceNode icon={TRANSFO_ICON[traceLot.transformationType] ?? '🔄'} label={TRANSFO_LABEL[traceLot.transformationType] ?? 'Transformation'} sub={`Étape transformation · ${traceLot.producedAt?.toDate?.().toLocaleDateString('fr-FR') ?? '—'}`} color="#6d28d9" badge={TRANSFO_LABEL[traceLot.transformationType]} />
                    <TraceArrow />
                  </>)}
                  <TraceNode icon="📦" label={traceData.directReception.productName} sub={`${traceData.directReception.fournisseur} · reçu le ${traceData.directReception.receivedAt?.toDate?.().toLocaleDateString('fr-FR') ?? '—'}${traceData.directReception.supplierLot ? ` · lot ${traceData.directReception.supplierLot}` : ''}`} color="var(--success)" />
                </>)}
                {traceData.ingredientLots.length > 0 && (<>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '16px 0 8px' }}>Ingrédients sources</div>
                  {traceData.ingredientLots.map(({ lot: ingLot, reception }) => (
                    <div key={ingLot.id} style={{ marginBottom: 12 }}>
                      <TraceArrow />
                      <TraceNode icon="🔄" label={ingLot.productName} sub={`${ingLot.lotCode} · ${ingLot.transformationType ? TRANSFO_LABEL[ingLot.transformationType] : 'Transformation'} le ${ingLot.producedAt?.toDate?.().toLocaleDateString('fr-FR') ?? '—'}`} color="#6d28d9" badge={ingLot.transformationType ? TRANSFO_LABEL[ingLot.transformationType] : undefined} />
                      {reception && (<>
                        <TraceArrow nested />
                        <TraceNode icon="📦" label={reception.productName} sub={`${reception.fournisseur} · reçu le ${reception.receivedAt?.toDate?.().toLocaleDateString('fr-FR') ?? '—'}${reception.supplierLot ? ` · lot ${reception.supplierLot}` : ''}`} color="var(--success)" nested />
                      </>)}
                    </div>
                  ))}
                </>)}
                {!traceData.directReception && traceData.ingredientLots.length === 0 && (
                  <div style={{ fontSize: 13, color: 'var(--on-surface-3)', textAlign: 'center', padding: '20px 0' }}>Aucune traçabilité enregistrée pour ce lot.</div>
                )}
              </>
            )}
          </div>
        </div>
      )}

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

// ─── Composants Traçabilité ──────────────────────────────────────
function TraceArrow({ nested }: { nested?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', paddingLeft: nested ? 24 : 0, margin: '4px 0' }}>
      <div style={{ width: 1, height: 16, background: 'var(--border)', marginLeft: 10 }} />
      <span style={{ fontSize: 10, color: 'var(--on-surface-3)', marginLeft: 4 }}>↓</span>
    </div>
  )
}

function TraceNode({ icon, label, sub, color, badge, nested }: {
  icon: string; label: string; sub: string; color: string; badge?: string; nested?: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'var(--surface-low)', border: `1px solid ${color}22`, marginLeft: nested ? 20 : 0 }}>
      <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.3 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--on-surface)' }}>{label}</span>
          {badge && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color, background: `${color}18`, border: `1px solid ${color}30`, borderRadius: 5, padding: '1px 6px', textTransform: 'uppercase' }}>{badge}</span>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 2 }}>{sub}</div>
      </div>
    </div>
  )
}

// ─── ProductPicker — autocomplete filtrant ────────────────────────
function ProductPicker({
  value, onChange, produits, loaded,
}: {
  value: string; onChange: (id: string) => void;
  produits: Produit[]; loaded: boolean;
}) {
  const [inputValue, setInputValue] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = produits.find(p => p.id === value) ?? null

  useEffect(() => {
    if (!value) setInputValue('')
    else if (selected) setInputValue(selected.name)
  }, [value, selected?.name])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setInputValue(selected?.name ?? '')
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [selected])

  const showAll = !inputValue || selected?.name === inputValue
  const filtered = showAll
    ? produits
    : produits.filter(p => p.name.toLowerCase().includes(inputValue.toLowerCase()))

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputValue(e.target.value)
    setOpen(true)
    if (value) onChange('')
  }

  function handleFocus() {
    setOpen(true)
    if (selected) setInputValue('')
  }

  function handleSelect(p: Produit) {
    onChange(p.id)
    setInputValue(p.name)
    setOpen(false)
  }

  if (!loaded) {
    return <div className="input" style={{ color: 'var(--on-surface-3)', pointerEvents: 'none' }}>Chargement…</div>
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        className="input"
        value={inputValue}
        onChange={handleChange}
        onFocus={handleFocus}
        placeholder="Rechercher un produit…"
        autoComplete="off"
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 60,
          background: 'var(--surface)', borderRadius: 12,
          border: '1.5px solid var(--border)',
          boxShadow: '0 4px 24px rgba(28,28,24,0.13)',
          maxHeight: 240, overflowY: 'auto',
        }}>
          {filtered.length === 0
            ? <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--on-surface-3)' }}>Aucun résultat</div>
            : filtered.map(p => (
              <div
                key={p.id}
                onMouseDown={e => { e.preventDefault(); handleSelect(p) }}
                style={{
                  padding: '10px 14px', cursor: 'pointer', fontSize: 13,
                  color: p.id === value ? 'var(--primary)' : 'var(--on-surface)',
                  fontWeight: p.id === value ? 700 : 400,
                  background: p.id === value ? 'rgba(0,66,117,0.06)' : 'transparent',
                }}
                onMouseEnter={e => { if (p.id !== value) (e.currentTarget as HTMLDivElement).style.background = 'var(--surface-mid)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = p.id === value ? 'rgba(0,66,117,0.06)' : 'transparent' }}
              >
                {p.name}
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

// ─── Onglet Historique ────────────────────────────────────────────
function HistoriqueTab({ loading, livraisons, onRefresh }: { loading: boolean; livraisons: LivraisonHisto[]; onRefresh: () => void }) {
  function fmt(ts: any) {
    if (!ts?.toDate) return '—'
    return ts.toDate().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  if (loading) return <SkeletonList count={4} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p className="section-label" style={{ margin: 0 }}>50 dernières livraisons</p>
        <button onClick={onRefresh} className="btn-secondary" style={{ padding: '6px 12px', fontSize: 12, height: 'auto' }}>↺ Actualiser</button>
      </div>

      {livraisons.length === 0 && (
        <EmptyState icon="📋" title="Aucune livraison" subtitle="Les lots envoyés au corner apparaîtront ici" />
      )}

      {livraisons.map(l => {
        const hasReception = l.receptionTempC !== null && l.receptionTempC !== undefined
        const result = l.result
        const resultColor = result === 'ACCEPTE' ? 'var(--success)' : result === 'REFUSE' ? 'var(--danger)' : 'var(--on-surface-3)'
        const resultBg   = result === 'ACCEPTE' ? 'rgba(45,122,79,0.10)' : result === 'REFUSE' ? 'rgba(192,57,43,0.10)' : 'var(--surface-mid)'
        const resultLabel = result === 'ACCEPTE' ? '✓ Accepté' : result === 'REFUSE' ? '✕ Refusé' : '…'

        return (
          <div key={l.id} className="card" style={{ padding: '12px 14px' }}>
            {/* Ligne 1 : produit + lot */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--on-surface)', marginBottom: 2 }}>
                  {l.productName}{l.isManual ? <span style={{ fontSize: 10, color: 'var(--on-surface-3)', marginLeft: 4 }}>manuel</span> : null}
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: 'var(--primary)', letterSpacing: '0.02em' }}>
                  {l.lotCode}
                </div>
              </div>
              {hasReception ? (
                <span style={{ fontSize: 11, fontWeight: 700, color: resultColor, background: resultBg, borderRadius: 8, padding: '3px 9px', flexShrink: 0 }}>
                  {resultLabel}
                </span>
              ) : (
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--warning)', background: 'rgba(180,83,9,0.08)', borderRadius: 8, padding: '3px 9px', flexShrink: 0 }}>
                  Réception en attente
                </span>
              )}
            </div>

            {/* Ligne 2 : températures */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--on-surface-3)' }}>Départ</span>
                <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--primary)', fontFamily: 'Epilogue, sans-serif' }}>
                  {l.departTempC !== null && l.departTempC !== undefined ? `${l.departTempC}°C` : '—'}
                </span>
              </div>
              <span style={{ color: 'var(--border)', fontSize: 14 }}>→</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--on-surface-3)' }}>Réception</span>
                <span style={{ fontSize: 15, fontWeight: 800, fontFamily: 'Epilogue, sans-serif', color: hasReception ? (result === 'REFUSE' ? 'var(--danger)' : 'var(--success)') : 'var(--on-surface-3)' }}>
                  {hasReception ? `${l.receptionTempC}°C` : '—'}
                </span>
              </div>
            </div>

            {/* Ligne 3 : date */}
            <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 6 }}>
              {fmt(l.departAt)}{hasReception && l.receptionAt ? ` · Réception ${fmt(l.receptionAt)}` : ''}
            </div>
          </div>
        )
      })}
    </div>
  )
}
