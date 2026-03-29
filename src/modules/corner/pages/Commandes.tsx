import { useEffect, useState } from 'react'
import {
  Timestamp, addDoc, collection, getDocs, orderBy, query, doc, updateDoc,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../auth/useAuth'

// ─── Types ────────────────────────────────────────────────────────
type ProduitLigne = { id: number; produit: string; quantite: string; unite: string }

type Commande = {
  docId: string; id: string; dateSaisie: any; saisiPar: string; statut: string
  nom: string; prenom: string; telephone: string; email: string
  entreprise: string; adresseLivraison: string; creneauHoraire: string
  dateLivraison: string; heureLivraison: string; mode: string
  produits: ProduitLigne[]; instructionsSpeciales: string
  prixEstime: string; notesCuisine: string; notesManager: string
  lienGcal: string
}

// ─── Constantes ───────────────────────────────────────────────────
const STATUTS    = ['En attente', 'Acceptée', 'En production', 'Livrée', 'Refusée']
const CRENEAUX   = ['Matin 8h-12h', 'Midi 12h-14h', 'Après-midi 14h-18h', 'Soir 18h-20h', 'À préciser']
const UNITES     = ['kg', 'pièces', 'portions', 'litres']
const MODES      = ['Livraison', 'Retrait sur place']
const TYPES_EVENEMENT = ['Anniversaire', 'Mariage', 'Repas d\'entreprise', 'Cocktail', 'Buffet', 'Autre']

// Couleurs statuts — palette Aegean light
const STATUT_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  'En attente':    { bg: 'rgba(180,83,9,0.10)',  color: 'var(--warning)',  border: 'rgba(180,83,9,0.25)' },
  'Acceptée':      { bg: 'rgba(84,101,30,0.10)',   color: 'var(--secondary)',  border: 'rgba(84,101,30,0.25)' },
  'En production': { bg: 'rgba(0,66,117,0.10)',  color: 'var(--primary)',  border: 'rgba(0,66,117,0.25)' },
  'Livrée':        { bg: 'rgba(28,28,24,0.05)', color: 'var(--on-surface-3)', border: 'rgba(28,28,24,0.12)' },
  'Refusée':       { bg: 'rgba(136,0,20,0.10)',   color: 'var(--danger)',  border: 'rgba(136,0,20,0.25)' },
}

let _id = 1
const nextId = () => _id++
const emptyProduit = (): ProduitLigne => ({ id: nextId(), produit: '', quantite: '', unite: 'pièces' })

function genCommandeId(): string {
  const d = new Date()
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`
  const rand = String(Math.floor(Math.random() * 9000) + 1000)
  return `CMD-${ymd}-${rand}`
}

function todayPlusOne(): string {
  const d = new Date(); d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

function formatDate(iso: string): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function thisWeekRange(): [Date, Date] {
  const now = new Date()
  const mon = new Date(now); mon.setDate(now.getDate() - now.getDay() + 1); mon.setHours(0,0,0,0)
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23,59,59,999)
  return [mon, sun]
}

const rePhone = /^[\d\s\+\-\(\)\.]{7,20}$/
const reEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validateForm(f: typeof INIT_FORM, prods: ProduitLigne[]): Record<string, string> {
  const e: Record<string, string> = {}
  if (!f.nom.trim())           e.nom = 'Champ obligatoire'
  if (!f.prenom.trim())        e.prenom = 'Champ obligatoire'
  if (!f.telephone.trim())     e.telephone = 'Champ obligatoire'
  else if (!rePhone.test(f.telephone)) e.telephone = 'Numéro invalide'
  if (!f.email.trim())         e.email = 'Champ obligatoire'
  else if (!reEmail.test(f.email)) e.email = 'Email invalide'
  if (!f.adresseLivraison.trim()) e.adresseLivraison = 'Champ obligatoire'
  if (!f.dateLivraison)        e.dateLivraison = 'Champ obligatoire'
  if (!f.heureLivraison)       e.heureLivraison = 'Champ obligatoire'
  if (!prods.some(p => p.produit.trim())) e.produits = 'Au moins un produit requis'
  return e
}

const INIT_FORM = {
  nom: '', prenom: '', telephone: '', email: '', entreprise: '',
  adresseLivraison: '', creneauHoraire: CRENEAUX[0],
  dateLivraison: todayPlusOne(), heureLivraison: '12:00', mode: 'Livraison',
  dateEvenement: '', typeEvenement: '', nombreConvives: '',
  instructionsSpeciales: '', prixEstime: '', notesCuisine: '', notesManager: '',
  saisiPar: '',
}

// ─── Composant principal ──────────────────────────────────────────
export default function Commandes() {
  const { user } = useAuth()
  const [tab, setTab] = useState<'form' | 'gestion'>('form')

  return (
    <div className="page">
      {/* Header */}
      <div>
        <p className="section-label" style={{ marginBottom: 2 }}>Corner</p>
        <h1 style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 24, fontWeight: 800, color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0 }}>
          Commandes clients
        </h1>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--surface-mid)', borderRadius: 14 }}>
        {([['form', 'Nouvelle'], ['gestion', 'Gestion']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            flex: 1, padding: '9px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: tab === key ? 'var(--surface)' : 'transparent',
            color: tab === key ? 'var(--primary)' : 'var(--on-surface-3)',
            fontWeight: 700, fontFamily: 'Manrope, sans-serif', fontSize: 13,
            boxShadow: tab === key ? '0 1px 6px rgba(28,28,24,0.08)' : 'none',
            transition: 'all 0.15s',
          }}>{label}</button>
        ))}
      </div>

      {tab === 'form'    && <NouvelleCommande user={user} />}
      {tab === 'gestion' && <GestionCommandes user={user} />}
    </div>
  )
}

// ─── Onglet 1 : Nouvelle commande ────────────────────────────────
function NouvelleCommande({ user }: { user: any }) {
  const [form, setForm]       = useState({ ...INIT_FORM, saisiPar: user?.displayName || user?.email?.split('@')[0] || '' })
  const [produits, setProduits] = useState<ProduitLigne[]>([emptyProduit()])
  const [errors, setErrors]   = useState<Record<string, string>>({})
  const [saving, setSaving]   = useState(false)
  const [success, setSuccess] = useState<string | null>(null)

  // Code promo fidélité
  const [promoCode, setPromoCode]       = useState('')
  const [promoDiscount, setPromoDiscount] = useState(0)
  const [promoChecked, setPromoChecked] = useState(false)
  const [promoChecking, setPromoChecking] = useState(false)
  const [promoError, setPromoError]     = useState('')

  async function verifyPromoCode() {
    if (!promoCode.trim() || !form.telephone.trim()) {
      setPromoError('Renseignez le téléphone du client avant de vérifier le code.')
      return
    }
    setPromoChecking(true)
    setPromoError('')
    setPromoChecked(false)
    setPromoDiscount(0)
    try {
      const fns = getFunctions(undefined, 'europe-west1')
      const validateFn = httpsCallable<{ clientPhone: string; code: string }, { valid: boolean; discountPercent?: number; error?: string }>(fns, 'validatePromoCode')
      const result = await validateFn({ clientPhone: form.telephone.trim(), code: promoCode.trim() })
      const data = result.data
      if (data.valid && data.discountPercent) {
        setPromoChecked(true)
        setPromoDiscount(data.discountPercent)
      } else {
        setPromoError(data.error ?? 'Code invalide')
      }
    } catch (e: any) {
      setPromoError(e?.message ?? 'Erreur de vérification')
    } finally {
      setPromoChecking(false)
    }
  }

  const set = (field: string, val: string) => {
    setForm(f => ({ ...f, [field]: val }))
    setErrors(e => { const c = { ...e }; delete c[field]; return c })
  }

  function addProduit() { setProduits(p => [...p, emptyProduit()]) }
  function removeProduit(id: number) { setProduits(p => p.filter(r => r.id !== id)) }
  function updateProduit(id: number, field: keyof ProduitLigne, val: string) {
    setProduits(p => p.map(r => r.id === id ? { ...r, [field]: val } : r))
  }

  async function handleSubmit() {
    const errs = validateForm(form, produits)
    if (Object.keys(errs).length) { setErrors(errs); return }

    setSaving(true)
    try {
      const cmdId = genCommandeId()
      const now = Timestamp.now()
      const prodsClean = produits
        .filter(p => p.produit.trim())
        .map(({ produit, quantite, unite }) => ({ produit, quantite, unite }))

      await addDoc(collection(db, 'commandes_externes'), {
        id: cmdId, dateSaisie: now, saisiPar: form.saisiPar,
        statut: 'En attente',
        nom: form.nom.trim(), prenom: form.prenom.trim(),
        telephone: form.telephone.trim(), email: form.email.trim(),
        entreprise: form.entreprise.trim(),
        adresseLivraison: form.adresseLivraison.trim(),
        creneauHoraire: form.creneauHoraire,
        dateLivraison: form.dateLivraison,
        heureLivraison: form.heureLivraison,
        mode: form.mode,
        dateEvenement: form.dateEvenement,
        typeEvenement: form.typeEvenement,
        nombreConvives: form.nombreConvives ? parseInt(form.nombreConvives) : null,
        produits: prodsClean,
        instructionsSpeciales: form.instructionsSpeciales.trim(),
        prixEstime: form.prixEstime ? parseFloat(form.prixEstime) : null,
        notesCuisine: form.notesCuisine.trim(),
        notesManager: form.notesManager.trim(),
        lienGcal: '',
        ...(promoChecked && promoCode.trim() ? {
          promoCode: promoCode.trim(),
          discountPercent: promoDiscount,
          totalBeforeDiscount: form.prixEstime ? parseFloat(form.prixEstime) : null,
        } : {}),
      })

      setSuccess(cmdId)
      setForm({ ...INIT_FORM, saisiPar: user?.displayName || user?.email?.split('@')[0] || '' })
      setProduits([emptyProduit()])
      setErrors({})
      setPromoCode('')
      setPromoDiscount(0)
      setPromoChecked(false)
      setPromoError('')
    } catch (e: any) {
      setErrors({ _global: e?.message || 'Erreur lors de la sauvegarde' })
    } finally {
      setSaving(false)
    }
  }

  const publicUrl = `${window.location.origin}/commande`

  return (
    <>
      {/* Lien public */}
      <div style={{ background: 'rgba(0,66,117,0.07)', border: '1px solid rgba(0,66,117,0.18)', borderRadius: 14, padding: '12px 16px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', marginBottom: 8 }}>🔗 Lien formulaire client (partageable)</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <code style={{ flex: 1, fontSize: 12, background: 'var(--surface-mid)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', wordBreak: 'break-all', color: 'var(--primary)' }}>{publicUrl}</code>
          <button onClick={() => { navigator.clipboard.writeText(publicUrl) }} className="btn-primary" style={{ flexShrink: 0, padding: '6px 12px', fontSize: 12, width: 'auto' }}>Copier</button>
        </div>
      </div>

      {success && (
        <div style={{ background: 'rgba(84,101,30,0.12)', border: '1px solid rgba(84,101,30,0.3)', borderRadius: 14, padding: '14px 16px', textAlign: 'center' }} className="animate-slide-up">
          <div style={{ fontSize: 18, marginBottom: 6 }}>✅</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--success)' }}>Commande enregistrée</div>
          <div style={{ fontSize: 12, color: 'rgba(84,101,30,0.7)', marginTop: 4 }}>Référence : <strong>{success}</strong></div>
        </div>
      )}

      <CommandeFormBody
        form={form} set={set} produits={produits}
        addProduit={addProduit} removeProduit={removeProduit} updateProduit={updateProduit}
        errors={errors} mode="interne"
      />

      {/* Code fidélité */}
      <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 16, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>🎁 Code fidélité (optionnel)</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            style={{ flex: 1, fontSize: 13, textTransform: 'uppercase' }}
            placeholder="YRG-FIDELITE-XXXX"
            value={promoCode}
            onChange={e => { setPromoCode(e.target.value.toUpperCase()); setPromoChecked(false); setPromoDiscount(0); setPromoError('') }}
          />
          <button
            type="button"
            onClick={verifyPromoCode}
            disabled={promoChecking || !promoCode.trim()}
            className="btn-primary"
            style={{ flexShrink: 0, padding: '0 14px', fontSize: 13, width: 'auto', opacity: promoChecking || !promoCode.trim() ? 0.5 : 1 }}
          >
            {promoChecking ? '…' : 'Vérifier'}
          </button>
        </div>
        {promoChecked && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--success)' }}>
            <span>✅</span>
            <span>Code valide — <strong>{promoDiscount}% de réduction</strong></span>
            {form.prixEstime && (
              <span style={{ color: 'rgba(84,101,30,0.7)' }}>
                ({(parseFloat(form.prixEstime) * (1 - promoDiscount / 100)).toFixed(2)} € après remise)
              </span>
            )}
          </div>
        )}
        {promoError && (
          <div style={{ fontSize: 13, color: 'var(--danger)' }}>⚠️ {promoError}</div>
        )}
      </div>

      {errors._global && (
        <div style={{ background: 'rgba(136,0,20,0.12)', border: '1px solid rgba(136,0,20,0.25)', borderRadius: 12, padding: '10px 16px', fontSize: 13, color: 'var(--danger)' }}>
          ⚠️ {errors._global}
        </div>
      )}

      <button onClick={handleSubmit} disabled={saving} className="btn-primary">
        {saving ? 'Enregistrement…' : '💾 Enregistrer la commande'}
      </button>
    </>
  )
}

// ─── Onglet 2 : Gestion ───────────────────────────────────────────
function GestionCommandes({ user }: { user: any }) {
  const [commandes, setCommandes] = useState<Commande[]>([])
  const [loading, setLoading]     = useState(true)
  const [filtreStatuts, setFiltreStatuts] = useState<string[]>([])
  const [filtreDateFrom, setFiltreDateFrom] = useState('')
  const [filtreDateTo, setFiltreDateTo]     = useState('')
  const [expanded, setExpanded]   = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const snap = await getDocs(query(collection(db, 'commandes_externes'), orderBy('dateSaisie', 'desc')))
    setCommandes(snap.docs.map(d => ({ docId: d.id, ...(d.data() as any) })))
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const [mon, sun] = thisWeekRange()

  const filtered = commandes.filter(c => {
    if (filtreStatuts.length && !filtreStatuts.includes(c.statut)) return false
    if (filtreDateFrom && c.dateLivraison < filtreDateFrom) return false
    if (filtreDateTo   && c.dateLivraison > filtreDateTo)   return false
    return true
  })

  const kpi = {
    total:     commandes.length,
    attente:   commandes.filter(c => c.statut === 'En attente').length,
    semaine:   commandes.filter(c => { const d = new Date(c.dateLivraison); return d >= mon && d <= sun }).length,
    acceptees: commandes.filter(c => c.statut === 'Acceptée').length,
  }

  return (
    <>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {([
          ['Total', kpi.total, 'var(--primary)', 'rgba(0,66,117,0.08)'],
          ['En attente', kpi.attente, 'var(--warning)', 'rgba(180,83,9,0.08)'],
          ['Semaine', kpi.semaine, 'var(--primary)', 'rgba(0,66,117,0.08)'],
          ['Acceptées', kpi.acceptees, 'var(--secondary)', 'rgba(84,101,30,0.08)'],
        ] as const).map(([label, val, color, bg]) => (
          <div key={label} style={{
            textAlign: 'center', padding: '12px 6px', borderRadius: 12,
            background: bg, border: `1px solid ${color}30`,
          }}>
            <div style={{ fontSize: 22, fontWeight: 800, color }}>{val}</div>
            <div style={{ fontSize: 10, fontWeight: 600, color, marginTop: 3, lineHeight: 1.2, opacity: 0.8 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Filtres */}
      <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 14, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Filtres</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUTS.map(s => {
            const active = filtreStatuts.includes(s)
            const st = STATUT_STYLE[s]
            return (
              <button key={s} onClick={() => setFiltreStatuts(prev => active ? prev.filter(x => x !== s) : [...prev, s])}
                style={{
                  padding: '4px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  background: active ? st.bg : 'var(--surface-mid)',
                  color: active ? st.color : 'var(--on-surface-3)',
                  border: `1px solid ${active ? st.border : 'var(--border)'}`,
                }}>
                {s}
              </button>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="date" className="input" style={{ flex: 1 }} value={filtreDateFrom} onChange={e => setFiltreDateFrom(e.target.value)} />
          <span style={{ color: 'var(--on-surface-3)', fontSize: 13 }}>→</span>
          <input type="date" className="input" style={{ flex: 1 }} value={filtreDateTo} onChange={e => setFiltreDateTo(e.target.value)} />
          {(filtreDateFrom || filtreDateTo) && (
            <button onClick={() => { setFiltreDateFrom(''); setFiltreDateTo('') }} style={{ fontSize: 12, color: 'var(--on-surface-3)', background: 'none', border: 'none', cursor: 'pointer' }}>Reset</button>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--on-surface-3)' }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          Chargement…
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ background: 'var(--surface)', borderRadius: 14, padding: '32px 20px', textAlign: 'center', fontSize: 13, color: 'var(--on-surface-3)', border: '1px solid var(--border)' }}>
          Aucune commande
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(c => (
            <CommandeCard key={c.docId} commande={c} expanded={expanded === c.docId}
              onToggle={() => setExpanded(expanded === c.docId ? null : c.docId)}
              onUpdated={load} isPatron={user?.role === 'patron' || user?.role === 'manager' || user?.role === 'administrateur'} />
          ))}
        </div>
      )}
    </>
  )
}

// ─── Card commande ────────────────────────────────────────────────
function CommandeCard({ commande: c, expanded, onToggle, onUpdated, isPatron }: {
  commande: Commande; expanded: boolean
  onToggle: () => void; onUpdated: () => void; isPatron: boolean
}) {
  const [statut, setStatut]           = useState(c.statut)
  const [notesCuisine, setNotesCuisine] = useState(c.notesCuisine || '')
  const [notesManager, setNotesManager] = useState(c.notesManager || '')
  const [prixEstime, setPrixEstime]   = useState(c.prixEstime || '')
  const [saving, setSaving]           = useState(false)
  const [saved, setSaved]             = useState(false)
  const [commandePreteSending, setCommandePreteSending] = useState(false)
  const [commandePreteOk, setCommandePreteOk] = useState(false)

  const st = STATUT_STYLE[statut] || STATUT_STYLE['En attente']

  async function handleCommandePrete() {
    setCommandePreteSending(true)
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'onCommandePrete')
      await fn({ commandeId: c.docId })
      setCommandePreteOk(true)
      setTimeout(() => setCommandePreteOk(false), 3000)
    } catch (e) {
      console.error(e)
    } finally {
      setCommandePreteSending(false)
    }
  }

  async function handleUpdate() {
    setSaving(true)
    try {
      await updateDoc(doc(db, 'commandes_externes', c.docId), {
        statut, notesCuisine, notesManager,
        prixEstime: prixEstime ? parseFloat(prixEstime) : null,
        updatedAt: Timestamp.now(),
      })
      setSaved(true)
      setTimeout(() => { setSaved(false); onUpdated() }, 1500)
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }

  const produits = Array.isArray(c.produits) ? c.produits : []

  return (
    <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>
      {/* Header */}
      <button onClick={onToggle} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', gap: 8,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', marginBottom: 3 }}>{c.id}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.prenom} {c.nom} · {formatDate(c.dateLivraison)} {c.heureLivraison}
          </div>
          {c.entreprise && <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 2 }}>{c.entreprise}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>{statut}</span>
          <span style={{ fontSize: 14, color: 'var(--on-surface-3)', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
        </div>
      </button>

      {expanded && (
        <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--border)' }} className="animate-fade-in">
          {/* Infos client */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12, marginBottom: 10 }}>
            <InfoRow label="Téléphone" value={c.telephone} />
            <InfoRow label="Email" value={c.email} />
            <InfoRow label="Créneau" value={c.creneauHoraire} />
            <InfoRow label="Mode" value={c.mode} />
          </div>
          <InfoRow label="Adresse" value={c.adresseLivraison} />

          {/* Produits */}
          {produits.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Produits</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {produits.map((p, i) => (
                  <div key={i} style={{ fontSize: 13, background: 'var(--surface-mid)', borderRadius: 8, padding: '6px 10px', color: 'var(--on-surface)' }}>
                    {p.produit} — <strong>{p.quantite}</strong> {p.unite}
                  </div>
                ))}
              </div>
            </div>
          )}

          {c.instructionsSpeciales && (
            <div style={{ marginTop: 10, padding: '8px 10px', background: 'rgba(180,83,9,0.10)', border: '1px solid rgba(180,83,9,0.25)', borderRadius: 8, fontSize: 12, color: 'var(--warning)' }}>
              ⚠️ {c.instructionsSpeciales}
            </div>
          )}

          {c.lienGcal && (
            <a href={c.lienGcal} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 10, fontSize: 12, color: 'var(--primary)', fontWeight: 600 }}>
              📅 Voir sur Google Calendar
            </a>
          )}

          {/* Actions client */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            {c.telephone && (
              <a
                href={`sms:${c.telephone}?body=Bonjour ${c.prenom}, concernant votre commande ${c.id} du ${formatDate(c.dateLivraison)}.`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700,
                  background: 'rgba(84,101,30,0.12)', color: 'var(--success)', border: '1px solid rgba(84,101,30,0.3)',
                  textDecoration: 'none',
                }}
              >
                💬 SMS
              </a>
            )}
            {c.email && (
              <a
                href={`mailto:${c.email}?subject=Votre commande ${c.id} — Matias&body=Bonjour ${c.prenom},%0D%0A%0D%0AConcernant votre commande ${c.id} prévue le ${formatDate(c.dateLivraison)} à ${c.heureLivraison}.%0D%0A%0D%0ACordialement,%0D%0AMatias`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700,
                  background: 'rgba(0,66,117,0.10)', color: 'var(--primary)', border: '1px solid rgba(0,66,117,0.25)',
                  textDecoration: 'none',
                }}
              >
                ✉️ Email
              </a>
            )}
            {isPatron && (
              <button
                onClick={handleCommandePrete}
                disabled={commandePreteSending || commandePreteOk}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700,
                  background: commandePreteOk ? 'rgba(84,101,30,0.10)' : 'rgba(0,66,117,0.08)',
                  color: commandePreteOk ? 'var(--secondary)' : 'var(--primary)',
                  border: `1px solid ${commandePreteOk ? 'rgba(84,101,30,0.25)' : 'rgba(0,66,117,0.20)'}`,
                  cursor: commandePreteSending ? 'not-allowed' : 'pointer',
                  opacity: commandePreteSending ? 0.7 : 1,
                }}
              >
                {commandePreteOk ? '✅ Notifié !' : commandePreteSending ? 'Envoi…' : '📦 Commande prête'}
              </button>
            )}
          </div>

          {/* Édition patron/manager */}
          {isPatron && (
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Statut</label>
                <select className="input" style={{ fontSize: 13 }} value={statut} onChange={e => setStatut(e.target.value)}>
                  {STATUTS.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Prix estimé (€)</label>
                <input type="number" className="input" style={{ fontSize: 13 }} value={prixEstime} onChange={e => setPrixEstime(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Notes cuisine</label>
                <textarea className="input" rows={2} style={{ resize: 'none', fontSize: 13 }} value={notesCuisine} onChange={e => setNotesCuisine(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Notes manager</label>
                <textarea className="input" rows={2} style={{ resize: 'none', fontSize: 13 }} value={notesManager} onChange={e => setNotesManager(e.target.value)} />
              </div>
              <button onClick={handleUpdate} disabled={saving} className="btn-primary" style={{ fontSize: 13 }}>
                {saved ? '✅ Sauvegardé !' : saving ? 'Sauvegarde…' : '💾 Mettre à jour'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--on-surface-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--on-surface)', marginTop: 2 }}>{value}</div>
    </div>
  )
}

// ─── Formulaire partagé (interne + public) ────────────────────────
export function CommandeFormBody({ form, set, produits, addProduit, removeProduit, updateProduit, errors, mode }: {
  form: typeof INIT_FORM
  set: (field: string, val: string) => void
  produits: ProduitLigne[]
  addProduit: () => void
  removeProduit: (id: number) => void
  updateProduit: (id: number, field: keyof ProduitLigne, val: string) => void
  errors: Record<string, string>
  mode: 'interne' | 'public'
}) {
  return (
    <>
      {/* Section client */}
      <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 16, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>👤 Informations client</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Nom *" error={errors.nom}>
            <input className="input" value={form.nom} onChange={e => set('nom', e.target.value)} placeholder="Dupont" />
          </Field>
          <Field label="Prénom *" error={errors.prenom}>
            <input className="input" value={form.prenom} onChange={e => set('prenom', e.target.value)} placeholder="Jean" />
          </Field>
        </div>
        <Field label="Téléphone *" error={errors.telephone}>
          <input className="input" type="tel" value={form.telephone} onChange={e => set('telephone', e.target.value)} placeholder="+33 6 12 34 56 78" />
        </Field>
        <Field label="Email *" error={errors.email}>
          <input className="input" type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="jean@example.com" />
        </Field>
        <Field label="Entreprise / Société">
          <input className="input" value={form.entreprise} onChange={e => set('entreprise', e.target.value)} placeholder="Optionnel" />
        </Field>
        <Field label="Adresse de livraison *" error={errors.adresseLivraison}>
          <textarea className="input" rows={2} style={{ resize: 'none' }} value={form.adresseLivraison} onChange={e => set('adresseLivraison', e.target.value)} placeholder="123 rue de la Paix, 75001 Paris" />
        </Field>
        <Field label="Créneau horaire préféré">
          <select className="input" value={form.creneauHoraire} onChange={e => set('creneauHoraire', e.target.value)}>
            {CRENEAUX.map(c => <option key={c}>{c}</option>)}
          </select>
        </Field>
      </div>

      {/* Section commande */}
      <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 16, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>🛒 Produits commandés</div>
        {errors.produits && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{errors.produits}</div>}
        {produits.map(p => (
          <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 8, alignItems: 'start' }}>
            <input className="input" style={{ fontSize: 13 }} value={p.produit} onChange={e => updateProduit(p.id, 'produit', e.target.value)} placeholder="Produit…" />
            <input className="input" type="number" min="0" style={{ fontSize: 13, width: 70 }} value={p.quantite} onChange={e => updateProduit(p.id, 'quantite', e.target.value)} placeholder="Qté" />
            <select className="input" style={{ fontSize: 13, width: 90 }} value={p.unite} onChange={e => updateProduit(p.id, 'unite', e.target.value)}>
              {UNITES.map(u => <option key={u}>{u}</option>)}
            </select>
            <button onClick={() => removeProduit(p.id)} style={{ width: 40, height: 40, borderRadius: 8, border: '1px solid rgba(136,0,20,0.3)', background: 'rgba(136,0,20,0.12)', color: 'var(--danger)', cursor: 'pointer', fontSize: 16, flexShrink: 0 }}>✕</button>
          </div>
        ))}
        <button onClick={addProduit} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          fontSize: 13, fontWeight: 600, color: 'var(--primary)',
          background: 'rgba(0,66,117,0.08)', border: '1px dashed rgba(0,66,117,0.35)',
          borderRadius: 10, padding: '8px 14px', cursor: 'pointer', width: '100%',
        }}>
          ➕ Ajouter un produit
        </button>
        <Field label="Instructions spéciales / Allergènes">
          <textarea className="input" rows={2} style={{ resize: 'none' }} value={form.instructionsSpeciales} onChange={e => set('instructionsSpeciales', e.target.value)} placeholder="Optionnel" />
        </Field>
      </div>

      {/* Section événement */}
      <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 16, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>🎉 Événement</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Date de l'événement">
            <input className="input" type="date" value={form.dateEvenement} onChange={e => set('dateEvenement', e.target.value)} />
          </Field>
          <Field label="Nombre de convives">
            <input className="input" type="number" min="1" value={form.nombreConvives} onChange={e => set('nombreConvives', e.target.value)} placeholder="Ex : 50" />
          </Field>
        </div>
        <Field label="Type d'événement">
          <select className="input" value={form.typeEvenement} onChange={e => set('typeEvenement', e.target.value)}>
            <option value="">— Sélectionner —</option>
            {TYPES_EVENEMENT.map(t => <option key={t}>{t}</option>)}
          </select>
        </Field>
      </div>

      {/* Section livraison */}
      <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 16, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>🚚 Livraison</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Date de livraison *" error={errors.dateLivraison}>
            <input className="input" type="date" min={todayPlusOne()} value={form.dateLivraison} onChange={e => set('dateLivraison', e.target.value)} />
          </Field>
          <Field label="Heure *" error={errors.heureLivraison}>
            <input className="input" type="time" value={form.heureLivraison} onChange={e => set('heureLivraison', e.target.value)} />
          </Field>
        </div>
        <Field label="Mode">
          <div style={{ display: 'flex', gap: 8 }}>
            {MODES.map(m => (
              <button key={m} onClick={() => set('mode', m)} style={{
                flex: 1, padding: '10px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: form.mode === m ? 'var(--primary)' : 'var(--surface-mid)',
                color: form.mode === m ? '#fff' : 'var(--on-surface-3)',
                border: `1px solid ${form.mode === m ? 'var(--primary)' : 'var(--border)'}`,
              }}>{m}</button>
            ))}
          </div>
        </Field>
      </div>

      {/* Section interne */}
      {mode === 'interne' && (
        <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 16, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>🔒 Informations internes</div>
          <Field label="Prix estimé (€)">
            <input className="input" type="number" min="0" step="0.01" value={form.prixEstime} onChange={e => set('prixEstime', e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Notes pour la cuisine">
            <textarea className="input" rows={2} style={{ resize: 'none' }} value={form.notesCuisine} onChange={e => set('notesCuisine', e.target.value)} placeholder="Optionnel" />
          </Field>
          <Field label="Saisi par">
            <input className="input" value={form.saisiPar} onChange={e => set('saisiPar', e.target.value)} />
          </Field>
        </div>
      )}
    </>
  )
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 700, color: error ? 'var(--danger)' : 'var(--on-surface-3)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
      {children}
      {error && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 3 }}>{error}</div>}
    </div>
  )
}
