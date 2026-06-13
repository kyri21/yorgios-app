import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Timestamp, addDoc, collection, getDocs, orderBy, query, doc, updateDoc,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../auth/useAuth'
import { usePermissions } from '../../../contexts/PermissionsContext'

// ─── Types ────────────────────────────────────────────────────────
type ProduitLigne = { id: number; produit: string; quantite: string; unite: string }

type Commande = {
  docId: string; id: string; dateSaisie: any; saisiPar: string; statut: string
  nom: string; prenom: string; telephone: string; email: string
  entreprise: string; adresseLivraison: string; creneauHoraire: string
  dateLivraison: string; heureLivraison: string; mode: string
  produits: ProduitLigne[]; instructionsSpeciales: string
  prixEstime: string; notesCuisine: string; notesManager: string
  lienGcal: string; nombreConvives?: number | null
}

type CatalogueProduit = { id: string; name: string; prix?: number }

// ─── Constantes ───────────────────────────────────────────────────
const STATUTS    = ['En cours', 'Devis envoyé', 'Accepté', 'Refusé', 'Annulé']
const CRENEAUX   = ['Matin 8h-12h', 'Midi 12h-14h', 'Après-midi 14h-18h', 'Soir 18h-20h', 'À préciser']
const UNITES     = ['kg', 'pièces', 'portions', 'litres']
const MODES      = ['Livraison', 'Retrait sur place']
const TYPES_EVENEMENT = ['Anniversaire', 'Mariage', 'Repas d\'entreprise', 'Cocktail', 'Buffet', 'Autre']

// Couleurs statuts — palette Aegean light
const STATUT_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  'En cours':      { bg: 'rgba(180,83,9,0.10)',   color: 'var(--warning)',       border: 'rgba(180,83,9,0.25)' },
  'Devis envoyé':  { bg: 'rgba(0,66,117,0.10)',   color: 'var(--primary)',       border: 'rgba(0,66,117,0.25)' },
  'Accepté':       { bg: 'rgba(45,122,79,0.10)',  color: 'var(--success)',       border: 'rgba(45,122,79,0.25)' },
  'Refusé':        { bg: 'rgba(136,0,20,0.10)',   color: 'var(--danger)',        border: 'rgba(136,0,20,0.25)' },
  'Annulé':        { bg: 'rgba(28,28,24,0.05)',   color: 'var(--on-surface-3)', border: 'rgba(28,28,24,0.12)' },
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

function getMonthRange(): { start: string; end: string } {
  const d = new Date()
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0')
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return { start: `${y}-${m}-01`, end: `${y}-${m}-${String(lastDay).padStart(2, '0')}` }
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
  if (f.email.trim() && !reEmail.test(f.email)) e.email = 'Email invalide'
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
        <p className="section-label" style={{ marginBottom: 2 }}>Commandes</p>
        <h1 style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 24, fontWeight: 800, color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0 }}>
          Commandes clients
        </h1>
      </div>

      {/* Tabs — "Nouvelle" masqué pour la cuisine */}
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--surface-mid)', borderRadius: 14 }}>
        {([['form', 'Nouvelle'], ['gestion', 'Gestion']] as const)
          .map(([key, label]) => (
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
  const { can } = usePermissions()
  const canCreate = can(user?.role, 'action_create_commande')
  const canPrixEstime = can(user?.role, 'field_prix_estime')
  const canNotesCuisine = can(user?.role, 'field_notes_cuisine')
  const [form, setForm]       = useState({ ...INIT_FORM, saisiPar: user?.displayName || user?.email?.split('@')[0] || '' })
  const [produits, setProduits] = useState<ProduitLigne[]>([emptyProduit()])
  const [errors, setErrors]   = useState<Record<string, string>>({})
  const [saving, setSaving]   = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [confirmCmdId, setConfirmCmdId] = useState<string | null>(null)

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
        statut: 'En cours',
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

      setConfirmCmdId(cmdId)
      setSuccess(cmdId)
    } catch (e: any) {
      setErrors({ _global: e?.message || 'Erreur lors de la sauvegarde' })
    } finally {
      setSaving(false)
    }
  }

  function handleDismissModal() {
    setConfirmCmdId(null)
    setForm({ ...INIT_FORM, saisiPar: user?.displayName || user?.email?.split('@')[0] || '' })
    setProduits([emptyProduit()])
    setErrors({})
    setPromoCode('')
    setPromoDiscount(0)
    setPromoChecked(false)
    setPromoError('')
  }

  const publicUrl = `${window.location.origin}/commande`

  return (
    <>
      {/* Modal confirmation post-enregistrement */}
      {confirmCmdId && createPortal(
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(28,28,24,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20,
        }}>
          <div style={{
            background: 'var(--surface)', borderRadius: 20, padding: '28px 24px',
            maxWidth: 360, width: '100%',
            boxShadow: '0 12px 48px rgba(28,28,24,0.22)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 40, marginBottom: 14 }}>📋</div>
            <h2 style={{
              fontFamily: 'Epilogue, sans-serif', fontSize: 18, fontWeight: 800,
              color: 'var(--on-surface)', marginBottom: 16, lineHeight: 1.3,
            }}>
              Commande enregistrée
            </h2>
            <div style={{
              background: 'var(--surface-low)', border: '1px solid var(--border)',
              borderRadius: 14, padding: '14px 16px', marginBottom: 16,
              fontSize: 14, color: 'var(--on-surface)', fontFamily: 'Manrope, sans-serif',
              lineHeight: 1.65, textAlign: 'left',
            }}>
              Ceci n'est pas une commande validée, un manager prendra contact avec le client au plus vite.
              <br /><br />
              <strong style={{ color: 'var(--primary)' }}>Merci Malaka</strong>
            </div>
            <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginBottom: 20, fontFamily: 'Manrope, sans-serif' }}>
              Référence : <strong style={{ color: 'var(--on-surface-2)' }}>{confirmCmdId}</strong>
            </div>
            <button onClick={handleDismissModal} className="btn-primary" style={{ width: '100%', fontSize: 15 }}>
              ✅ Lu et approuvé
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Lien public */}
      <div style={{ background: 'rgba(0,66,117,0.07)', border: '1px solid rgba(0,66,117,0.18)', borderRadius: 14, padding: '12px 16px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', marginBottom: 8 }}>🔗 Lien formulaire client (partageable)</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <code style={{ flex: 1, fontSize: 12, background: 'var(--surface-mid)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', wordBreak: 'break-all', color: 'var(--primary)' }}>{publicUrl}</code>
          <button onClick={() => { navigator.clipboard.writeText(publicUrl) }} className="btn-primary" style={{ flexShrink: 0, padding: '6px 12px', fontSize: 12, width: 'auto' }}>Copier</button>
        </div>
      </div>


      <CommandeFormBody
        form={form} set={set} produits={produits}
        addProduit={addProduit} removeProduit={removeProduit} updateProduit={updateProduit}
        errors={errors} mode="interne"
        canPrixEstime={canPrixEstime} canNotesCuisine={canNotesCuisine}
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

      {canCreate ? (
        <button onClick={handleSubmit} disabled={saving} className="btn-primary">
          {saving ? 'Enregistrement…' : '💾 Enregistrer la commande'}
        </button>
      ) : (
        <div style={{ background: 'var(--surface-mid)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px', fontSize: 13, color: 'var(--on-surface-2)', textAlign: 'center' }}>
          🔒 Votre rôle ne permet pas d'enregistrer une commande
        </div>
      )}
    </>
  )
}

// ─── Onglet 2 : Gestion ───────────────────────────────────────────
function GestionCommandes({ user }: { user: any }) {
  const { can } = usePermissions()
  const canManageCommandes = can(user?.role, 'action_update_statut_commande')
  const [commandes, setCommandes] = useState<Commande[]>([])
  const [loading, setLoading]     = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filtreStatuts, setFiltreStatuts] = useState<string[]>([])
  const [filtreDateFrom, setFiltreDateFrom] = useState('')
  const [filtreDateTo, setFiltreDateTo]     = useState('')
  const [expanded, setExpanded]   = useState<string | null>(null)
  const [dateFilter, setDateFilter] = useState<'semaine' | 'mois'>('semaine')

  async function load() {
    setLoading(true)
    setLoadError(null)
    try {
      const snap = await getDocs(query(collection(db, 'commandes_externes'), orderBy('dateSaisie', 'desc')))
      setCommandes(snap.docs.map(d => ({ docId: d.id, ...(d.data() as any) })))
    } catch (e: any) {
      setLoadError(e?.message || 'Chargement impossible')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const [mon, sun] = thisWeekRange()

  // Plage rapide semaine/mois (appliquée uniquement si pas de filtre date manuel)
  const quickRange = dateFilter === 'semaine'
    ? { start: mon.toISOString().slice(0, 10), end: sun.toISOString().slice(0, 10) }
    : getMonthRange()

  const filtered = commandes.filter(c => {
    if (filtreStatuts.length && !filtreStatuts.includes(c.statut)) return false
    if (filtreDateFrom && c.dateLivraison < filtreDateFrom) return false
    if (filtreDateTo   && c.dateLivraison > filtreDateTo)   return false
    // filtre rapide semaine/mois (ignoré si filtre date manuel actif)
    if (!filtreDateFrom && !filtreDateTo) {
      if (c.dateLivraison < quickRange.start || c.dateLivraison > quickRange.end) return false
    }
    return true
  })

  const kpi = {
    total:     commandes.length,
    encours:   commandes.filter(c => c.statut === 'En cours').length,
    semaine:   commandes.filter(c => { const d = new Date(c.dateLivraison); return d >= mon && d <= sun }).length,
    acceptees: commandes.filter(c => c.statut === 'Accepté').length,
  }

  return (
    <>
      {/* Récap compact — outil terrain, l'actionnable (« en cours ») mis en avant */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        padding: '11px 16px', background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
          <strong style={{ fontSize: 21, fontWeight: 800, color: 'var(--warning)', fontFamily: 'Epilogue, sans-serif', lineHeight: 1 }}>{kpi.encours}</strong>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface)', fontFamily: 'Manrope, sans-serif' }}>en cours</span>
        </span>
        <span style={{ width: 1, height: 18, background: 'var(--border)' }} />
        <span style={{ fontSize: 13, color: 'var(--on-surface-2)', fontFamily: 'Manrope, sans-serif' }}>{kpi.semaine} cette semaine</span>
        <span style={{ fontSize: 13, color: 'var(--on-surface-2)', fontFamily: 'Manrope, sans-serif' }}>{kpi.acceptees} acceptées</span>
        <span style={{ fontSize: 13, color: 'var(--on-surface-3)', fontFamily: 'Manrope, sans-serif', marginLeft: 'auto' }}>{kpi.total} au total</span>
      </div>

      {/* Filtre rapide semaine / mois */}
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--surface-mid)', borderRadius: 12, marginBottom: 0 }}>
        {(['semaine', 'mois'] as const).map(f => (
          <button
            key={f}
            onClick={() => setDateFilter(f)}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 9, border: 'none', cursor: 'pointer',
              background: dateFilter === f ? 'var(--surface)' : 'transparent',
              color: dateFilter === f ? 'var(--primary)' : 'var(--on-surface-3)',
              fontWeight: 700, fontSize: 13, fontFamily: 'Manrope, sans-serif',
              boxShadow: dateFilter === f ? '0 1px 6px rgba(28,28,24,0.08)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            {f === 'semaine' ? 'Cette semaine' : 'Ce mois'}
          </button>
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
      ) : loadError ? (
        <div style={{ background: 'var(--surface)', borderRadius: 14, padding: '32px 20px', textAlign: 'center', border: '1px solid var(--border)', fontFamily: 'Manrope, sans-serif' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
          <div style={{ color: 'var(--on-surface)', fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Chargement impossible</div>
          <div style={{ color: 'var(--on-surface-2)', fontSize: 13, marginBottom: 16 }}>Vérifie ta connexion, puis réessaie.</div>
          <button className="btn-primary" onClick={load} style={{ width: 'auto', padding: '0 20px' }}>Réessayer</button>
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
              onUpdated={load} isPatron={canManageCommandes} role={user?.role} />
          ))}
        </div>
      )}
    </>
  )
}

// ─── Card commande ────────────────────────────────────────────────
function CommandeCard({ commande: c, expanded, onToggle, onUpdated, isPatron, role }: {
  commande: Commande; expanded: boolean
  onToggle: () => void; onUpdated: () => void; isPatron: boolean; role?: string
}) {
  const { can } = usePermissions()
  const canPrixEstime = can(role, 'field_prix_estime')
  const canNotesCuisine = can(role, 'field_notes_cuisine')
  const canNotesManager = can(role, 'field_notes_manager')
  const [statut, setStatut]           = useState(c.statut)
  const [notesCuisine, setNotesCuisine] = useState(c.notesCuisine || '')
  const [notesManager, setNotesManager] = useState(c.notesManager || '')
  const [prixEstime, setPrixEstime]   = useState(c.prixEstime || '')
  const [saving, setSaving]           = useState(false)
  const [saved, setSaved]             = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [commandePreteSending, setCommandePreteSending] = useState(false)
  const [commandePreteOk, setCommandePreteOk] = useState(false)

  // Edition complète
  const [isEditing, setIsEditing]               = useState(false)
  const [editNom, setEditNom]                   = useState('')
  const [editPrenom, setEditPrenom]             = useState('')
  const [editTelephone, setEditTelephone]       = useState('')
  const [editEmail, setEditEmail]               = useState('')
  const [editEntreprise, setEditEntreprise]     = useState('')
  const [editAdresse, setEditAdresse]           = useState('')
  const [editDateLivraison, setEditDateLivraison] = useState('')
  const [editHeureLivraison, setEditHeureLivraison] = useState('')
  const [editMode, setEditMode]                 = useState('')
  const [editCreneauHoraire, setEditCreneauHoraire] = useState('')
  const [editNombreConvives, setEditNombreConvives] = useState('')
  const [editInstructions, setEditInstructions] = useState('')
  const [editProduits, setEditProduits]         = useState<ProduitLigne[]>([emptyProduit()])

  function startEditing() {
    setEditNom(c.nom || '')
    setEditPrenom(c.prenom || '')
    setEditTelephone(c.telephone || '')
    setEditEmail(c.email || '')
    setEditEntreprise(c.entreprise || '')
    setEditAdresse(c.adresseLivraison || '')
    setEditDateLivraison(c.dateLivraison || '')
    setEditHeureLivraison(c.heureLivraison || '')
    setEditMode(c.mode || 'Livraison')
    setEditCreneauHoraire(c.creneauHoraire || CRENEAUX[0])
    setEditNombreConvives(c.nombreConvives != null ? String(c.nombreConvives) : '')
    setEditInstructions(c.instructionsSpeciales || '')
    const prods = Array.isArray(c.produits) && c.produits.length > 0
      ? c.produits.map(p => ({ id: nextId(), produit: p.produit || '', quantite: p.quantite || '', unite: p.unite || 'pièces' }))
      : [emptyProduit()]
    setEditProduits(prods)
    setIsEditing(true)
  }

  function addEditProduit() { setEditProduits(p => [...p, emptyProduit()]) }
  function removeEditProduit(id: number) { setEditProduits(p => p.filter(r => r.id !== id)) }
  function updateEditProduit(id: number, field: keyof ProduitLigne, val: string) {
    setEditProduits(p => p.map(r => r.id === id ? { ...r, [field]: val } : r))
  }

  const st = STATUT_STYLE[statut] || STATUT_STYLE['En cours']

  async function handleCommandePrete() {
    setCommandePreteSending(true)
    setActionError(null)
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'onCommandePrete')
      await fn({ commandeId: c.docId })
      setCommandePreteOk(true)
      setTimeout(() => setCommandePreteOk(false), 3000)
    } catch (e: any) {
      setActionError(e?.message || 'Échec de l\'envoi de la notification')
    } finally {
      setCommandePreteSending(false)
    }
  }

  async function handleUpdate() {
    setSaving(true)
    setActionError(null)
    try {
      await updateDoc(doc(db, 'commandes_externes', c.docId), {
        statut, notesCuisine, notesManager,
        prixEstime: prixEstime ? parseFloat(prixEstime) : null,
        updatedAt: Timestamp.now(),
      })
      setSaved(true)
      setTimeout(() => { setSaved(false); onUpdated() }, 1500)
    } catch (e: any) { setActionError(e?.message || 'Échec de l\'enregistrement') }
    finally { setSaving(false) }
  }

  async function handleSaveFullEdit() {
    setSaving(true)
    setActionError(null)
    try {
      const prodsClean = editProduits
        .filter(p => p.produit.trim())
        .map(({ produit, quantite, unite }) => ({ produit, quantite, unite }))
      await updateDoc(doc(db, 'commandes_externes', c.docId), {
        nom: editNom.trim(),
        prenom: editPrenom.trim(),
        telephone: editTelephone.trim(),
        email: editEmail.trim(),
        entreprise: editEntreprise.trim(),
        adresseLivraison: editAdresse.trim(),
        dateLivraison: editDateLivraison,
        heureLivraison: editHeureLivraison,
        mode: editMode,
        creneauHoraire: editCreneauHoraire,
        nombreConvives: editNombreConvives ? parseInt(editNombreConvives) : null,
        instructionsSpeciales: editInstructions.trim(),
        produits: prodsClean,
        statut,
        notesCuisine,
        notesManager,
        prixEstime: prixEstime ? parseFloat(prixEstime) : null,
        updatedAt: Timestamp.now(),
      })
      setSaved(true)
      setIsEditing(false)
      setTimeout(() => { setSaved(false); onUpdated() }, 1500)
    } catch (e: any) { setActionError(e?.message || 'Échec de l\'enregistrement') }
    finally { setSaving(false) }
  }

  const produits = Array.isArray(c.produits) ? c.produits : []

  return (
    <div style={{
      background: 'var(--surface)',
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--border)',
      overflow: 'hidden',
      boxShadow: expanded ? 'var(--shadow-float)' : 'none',
      transition: 'box-shadow 0.2s',
    }}>
      {/* Header row */}
      <button onClick={onToggle} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', gap: 10,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--primary)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'Manrope, sans-serif' }}>{c.id}</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'Epilogue, sans-serif' }}>
            {c.prenom} {c.nom}
          </div>
          <div style={{ fontSize: 12, color: 'var(--on-surface-2)', marginTop: 2, fontFamily: 'Manrope, sans-serif' }}>
            {formatDate(c.dateLivraison)}{c.heureLivraison ? ` · ${c.heureLivraison}` : ''}
            {c.entreprise ? ` · ${c.entreprise}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {c.prixEstime && (
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--primary)', fontFamily: 'Epilogue, sans-serif' }}>
              {parseFloat(String(c.prixEstime)).toFixed(0)} €
            </span>
          )}
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 99,
            background: st.bg, color: st.color, border: `1px solid ${st.border}`,
            fontFamily: 'Manrope, sans-serif', whiteSpace: 'nowrap',
          }}>{statut}</span>
          <span style={{ fontSize: 14, color: 'var(--on-surface-3)', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
        </div>
      </button>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)' }} className="animate-fade-in">

          {actionError && (
            <div style={{
              margin: '12px 16px 0', padding: '10px 14px',
              background: 'rgba(136,0,20,0.10)', border: '1px solid rgba(136,0,20,0.25)',
              borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--danger)',
              display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'Manrope, sans-serif',
            }}>
              <span>⚠️</span><span>{actionError}</span>
            </div>
          )}

          {/* Mode édition complète */}
          {isEditing ? (
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="section-label">Modifier la commande</div>
                <button onClick={() => setIsEditing(false)} style={{ fontSize: 12, color: 'var(--on-surface-3)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Manrope, sans-serif' }}>Annuler</button>
              </div>

              {/* Infos client */}
              <div style={{ background: 'var(--surface-low)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Informations client</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <EditField label="Nom">
                    <input className="input" style={{ fontSize: 13 }} value={editNom} onChange={e => setEditNom(e.target.value)} />
                  </EditField>
                  <EditField label="Prénom">
                    <input className="input" style={{ fontSize: 13 }} value={editPrenom} onChange={e => setEditPrenom(e.target.value)} />
                  </EditField>
                </div>
                <EditField label="Téléphone">
                  <input className="input" type="tel" style={{ fontSize: 13 }} value={editTelephone} onChange={e => setEditTelephone(e.target.value)} />
                </EditField>
                <EditField label="Email">
                  <input className="input" type="email" style={{ fontSize: 13 }} value={editEmail} onChange={e => setEditEmail(e.target.value)} />
                </EditField>
                <EditField label="Entreprise">
                  <input className="input" style={{ fontSize: 13 }} value={editEntreprise} onChange={e => setEditEntreprise(e.target.value)} />
                </EditField>
                <EditField label="Adresse de livraison">
                  <textarea className="input" rows={2} style={{ resize: 'none', fontSize: 13 }} value={editAdresse} onChange={e => setEditAdresse(e.target.value)} />
                </EditField>
                <EditField label="Instructions spéciales">
                  <textarea className="input" rows={2} style={{ resize: 'none', fontSize: 13 }} value={editInstructions} onChange={e => setEditInstructions(e.target.value)} />
                </EditField>
              </div>

              {/* Livraison */}
              <div style={{ background: 'var(--surface-low)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Livraison</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <EditField label="Date">
                    <input className="input" type="date" style={{ fontSize: 13 }} value={editDateLivraison} onChange={e => setEditDateLivraison(e.target.value)} />
                  </EditField>
                  <EditField label="Heure">
                    <input className="input" type="time" style={{ fontSize: 13 }} value={editHeureLivraison} onChange={e => setEditHeureLivraison(e.target.value)} />
                  </EditField>
                </div>
                <EditField label="Mode">
                  <div style={{ display: 'flex', gap: 8 }}>
                    {MODES.map(m => (
                      <button key={m} onClick={() => setEditMode(m)} style={{
                        flex: 1, padding: '8px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        background: editMode === m ? 'var(--primary)' : 'var(--surface-mid)',
                        color: editMode === m ? '#fff' : 'var(--on-surface-3)',
                        border: `1px solid ${editMode === m ? 'var(--primary)' : 'var(--border)'}`,
                      }}>{m}</button>
                    ))}
                  </div>
                </EditField>
                <EditField label="Créneau horaire">
                  <select className="input" style={{ fontSize: 13 }} value={editCreneauHoraire} onChange={e => setEditCreneauHoraire(e.target.value)}>
                    {CRENEAUX.map(cr => <option key={cr}>{cr}</option>)}
                  </select>
                </EditField>
                <EditField label="Nombre de convives">
                  <input className="input" type="number" min="1" style={{ fontSize: 13 }} value={editNombreConvives} onChange={e => setEditNombreConvives(e.target.value)} />
                </EditField>
              </div>

              {/* Produits éditables */}
              <div style={{ background: 'var(--surface-low)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Produits commandés</div>
                {editProduits.map(p => (
                  <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 6, alignItems: 'start' }}>
                    <input className="input" style={{ fontSize: 13 }} value={p.produit} onChange={e => updateEditProduit(p.id, 'produit', e.target.value)} placeholder="Produit…" />
                    <input className="input" type="number" min="0" style={{ fontSize: 13, width: 64 }} value={p.quantite} onChange={e => updateEditProduit(p.id, 'quantite', e.target.value)} placeholder="Qté" />
                    <select className="input" style={{ fontSize: 12, width: 84 }} value={p.unite} onChange={e => updateEditProduit(p.id, 'unite', e.target.value)}>
                      {UNITES.map(u => <option key={u}>{u}</option>)}
                    </select>
                    <button onClick={() => removeEditProduit(p.id)} style={{ width: 36, height: 36, borderRadius: 8, border: '1px solid rgba(136,0,20,0.3)', background: 'rgba(136,0,20,0.10)', color: 'var(--danger)', cursor: 'pointer', fontSize: 14 }}>✕</button>
                  </div>
                ))}
                <button onClick={addEditProduit} style={{
                  fontSize: 12, fontWeight: 600, color: 'var(--primary)',
                  background: 'rgba(0,66,117,0.07)', border: '1px dashed rgba(0,66,117,0.30)',
                  borderRadius: 8, padding: '7px 12px', cursor: 'pointer', width: '100%',
                }}>+ Ajouter un produit</button>
              </div>

              {/* Gestion interne */}
              <div style={{ background: 'var(--surface-low)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Informations internes</div>
                <EditField label="Statut">
                  <select className="input" style={{ fontSize: 13 }} value={statut} onChange={e => setStatut(e.target.value)}>
                    {STATUTS.map(s => <option key={s}>{s}</option>)}
                  </select>
                </EditField>
                {canPrixEstime && (
                  <EditField label="Prix estimé (€)">
                    <input type="number" className="input" style={{ fontSize: 13 }} value={prixEstime} onChange={e => setPrixEstime(e.target.value)} placeholder="0.00" />
                  </EditField>
                )}
                {canNotesCuisine && (
                  <EditField label="Notes cuisine">
                    <textarea className="input" rows={2} style={{ resize: 'none', fontSize: 13 }} value={notesCuisine} onChange={e => setNotesCuisine(e.target.value)} />
                  </EditField>
                )}
                {canNotesManager && (
                  <EditField label="Notes manager">
                    <textarea className="input" rows={2} style={{ resize: 'none', fontSize: 13 }} value={notesManager} onChange={e => setNotesManager(e.target.value)} />
                  </EditField>
                )}
              </div>

              <button onClick={handleSaveFullEdit} disabled={saving} className="btn-primary" style={{ fontSize: 14 }}>
                {saved ? '✅ Sauvegardé !' : saving ? 'Sauvegarde…' : '💾 Enregistrer les modifications'}
              </button>
            </div>
          ) : (
            <>
              {/* Vue normale */}
              {/* Articles de la commande */}
              {produits.length > 0 && (
                <div style={{ padding: '14px 16px', background: 'var(--surface-low)' }}>
                  <div className="section-label" style={{ marginBottom: 10 }}>Articles de la commande</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {produits.map((p, i) => (
                      <div key={i} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '9px 0',
                        borderBottom: i < produits.length - 1 ? '1px solid var(--border)' : 'none',
                      }}>
                        <span style={{ fontSize: 14, color: 'var(--on-surface)', fontFamily: 'Manrope, sans-serif', fontWeight: 500 }}>{p.produit}</span>
                        <span style={{ fontSize: 13, color: 'var(--on-surface-2)', fontWeight: 600, fontFamily: 'Manrope, sans-serif' }}>
                          {p.quantite} {p.unite}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Prix estimé prominent */}
                {(c.prixEstime || isPatron) && (
                  <div style={{
                    background: 'rgba(0,66,117,0.06)', borderRadius: 'var(--radius-md)',
                    padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <div>
                      <div className="section-label" style={{ marginBottom: 4 }}>Prix estimé</div>
                      {c.prixEstime
                        ? <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--primary)', fontFamily: 'Epilogue, sans-serif', lineHeight: 1 }}>
                            {parseFloat(String(c.prixEstime)).toFixed(2)} €
                          </div>
                        : <div style={{ fontSize: 13, color: 'var(--on-surface-3)', fontFamily: 'Manrope, sans-serif' }}>Non renseigné</div>
                      }
                      {(c as any).discountPercent > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--success)', marginTop: 3, fontFamily: 'Manrope, sans-serif' }}>
                          -{(c as any).discountPercent}% fidélité appliqué
                        </div>
                      )}
                    </div>
                    {(c as any).promoCode && (
                      <div style={{
                        background: 'var(--surface)', border: '1.5px solid var(--primary)',
                        borderRadius: 8, padding: '6px 12px',
                        fontSize: 13, fontWeight: 700, color: 'var(--primary)', fontFamily: 'Manrope, sans-serif',
                        letterSpacing: '0.04em',
                      }}>
                        {(c as any).promoCode}
                      </div>
                    )}
                  </div>
                )}

                {/* Saisi par */}
                {c.saisiPar && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%',
                      background: 'var(--primary)', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 700, flexShrink: 0, fontFamily: 'Epilogue, sans-serif',
                    }}>
                      {c.saisiPar.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="section-label" style={{ marginBottom: 1 }}>Saisi par</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--on-surface)', fontFamily: 'Epilogue, sans-serif' }}>{c.saisiPar}</div>
                    </div>
                  </div>
                )}

                {/* Infos client */}
                <div className="divider" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <InfoRow label="Téléphone" value={c.telephone} />
                  <InfoRow label="Email" value={c.email} />
                  <InfoRow label="Créneau" value={c.creneauHoraire} />
                  <InfoRow label="Mode" value={c.mode} />
                </div>
                <InfoRow label="Adresse" value={c.adresseLivraison} />

                {/* Instructions spéciales */}
                {c.instructionsSpeciales && (
                  <div style={{
                    padding: '10px 12px', background: 'rgba(180,83,9,0.08)',
                    border: '1px solid rgba(180,83,9,0.22)', borderRadius: 'var(--radius-sm)',
                    fontSize: 12, color: 'var(--warning)', fontFamily: 'Manrope, sans-serif',
                  }}>
                    ⚠️ {c.instructionsSpeciales}
                  </div>
                )}

                {/* Notes cuisine */}
                {c.notesCuisine && (
                  <div style={{ padding: '10px 12px', background: 'var(--surface-low)', borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--on-surface-2)', fontFamily: 'Manrope, sans-serif', fontStyle: 'italic' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--on-surface-3)', display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em', fontStyle: 'normal' }}>Notes cuisine</span>
                    {c.notesCuisine}
                  </div>
                )}

                {c.lienGcal && (
                  <a href={c.lienGcal} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--primary)', fontWeight: 600, fontFamily: 'Manrope, sans-serif' }}>
                    📅 Voir sur Google Calendar
                  </a>
                )}

                {/* Actions client */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {c.telephone && (
                    <a
                      href={`sms:${c.telephone}?body=Bonjour ${c.prenom}, concernant votre commande ${c.id} du ${formatDate(c.dateLivraison)}.`}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '9px 16px', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 700,
                        background: 'rgba(84,101,30,0.10)', color: 'var(--success)', border: '1px solid rgba(84,101,30,0.25)',
                        textDecoration: 'none', fontFamily: 'Manrope, sans-serif',
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
                        padding: '9px 16px', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 700,
                        background: 'rgba(0,66,117,0.08)', color: 'var(--primary)', border: '1px solid rgba(0,66,117,0.22)',
                        textDecoration: 'none', fontFamily: 'Manrope, sans-serif',
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
                        padding: '9px 16px', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 700,
                        background: commandePreteOk ? 'rgba(84,101,30,0.10)' : 'rgba(0,66,117,0.07)',
                        color: commandePreteOk ? 'var(--success)' : 'var(--primary)',
                        border: `1px solid ${commandePreteOk ? 'rgba(84,101,30,0.25)' : 'rgba(0,66,117,0.20)'}`,
                        cursor: commandePreteSending ? 'not-allowed' : 'pointer',
                        opacity: commandePreteSending ? 0.6 : 1,
                        fontFamily: 'Manrope, sans-serif',
                      }}
                    >
                      {commandePreteOk ? '✅ Notifié !' : commandePreteSending ? 'Envoi…' : '📦 Commande prête'}
                    </button>
                  )}
                  {isPatron && (
                    <button
                      onClick={startEditing}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '9px 16px', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 700,
                        background: 'rgba(180,83,9,0.08)', color: 'var(--warning)', border: '1px solid rgba(180,83,9,0.22)',
                        cursor: 'pointer', fontFamily: 'Manrope, sans-serif',
                      }}
                    >
                      ✏️ Modifier
                    </button>
                  )}
                </div>

                {/* Édition rapide patron/manager */}
                {isPatron && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 2 }}>
                    <div className="section-label">Édition rapide</div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Statut</label>
                      <select className="input" style={{ fontSize: 13 }} value={statut} onChange={e => setStatut(e.target.value)}>
                        {STATUTS.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </div>
                    {canPrixEstime && (
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Prix estimé (€)</label>
                        <input type="number" className="input" style={{ fontSize: 13 }} value={prixEstime} onChange={e => setPrixEstime(e.target.value)} placeholder="0.00" />
                      </div>
                    )}
                    {canNotesCuisine && (
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Notes cuisine</label>
                        <textarea className="input" rows={2} style={{ resize: 'none', fontSize: 13 }} value={notesCuisine} onChange={e => setNotesCuisine(e.target.value)} placeholder="Instructions spéciales pour la brigade…" />
                      </div>
                    )}
                    {canNotesManager && (
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Notes manager</label>
                        <textarea className="input" rows={2} style={{ resize: 'none', fontSize: 13 }} value={notesManager} onChange={e => setNotesManager(e.target.value)} />
                      </div>
                    )}
                    <button onClick={handleUpdate} disabled={saving} className="btn-primary" style={{ fontSize: 14 }}>
                      {saved ? '✅ Sauvegardé !' : saving ? 'Sauvegarde…' : 'Enregistrer'}
                    </button>
                    {!saved && !saving && statut !== 'En cours' && (
                      <button onClick={() => { setStatut('En cours'); handleUpdate() }} style={{
                        background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
                        padding: '12px', fontSize: 13, fontWeight: 600, color: 'var(--on-surface-2)',
                        cursor: 'pointer', fontFamily: 'Manrope, sans-serif',
                      }}>
                        Remettre En cours
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--on-surface-3)', display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em', fontFamily: 'Manrope, sans-serif' }}>{label}</label>
      {children}
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

// ─── Autocomplete produit ─────────────────────────────────────────
function AutocompleteProduit({ value, onChange, catalogue }: {
  value: string
  onChange: (name: string, prix?: number) => void
  catalogue: CatalogueProduit[]
}) {
  const [open, setOpen]     = useState(false)
  const [query2, setQuery]  = useState(value)
  const containerRef        = useRef<HTMLDivElement>(null)

  // Sync query when value changes from outside (e.g. reset)
  useEffect(() => { setQuery(value) }, [value])

  const suggestions = query2.trim().length >= 1
    ? catalogue.filter(p => p.name.toLowerCase().includes(query2.toLowerCase())).slice(0, 8)
    : []

  function select(p: CatalogueProduit) {
    setQuery(p.name)
    setOpen(false)
    onChange(p.name, p.prix)
  }

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={containerRef} style={{ position: 'relative', flex: 1 }}>
      <input
        className="input"
        style={{ fontSize: 13, width: '100%' }}
        value={query2}
        placeholder="Produit…"
        onChange={e => { setQuery(e.target.value); onChange(e.target.value, undefined); setOpen(true) }}
        onFocus={() => setOpen(true)}
      />
      {open && suggestions.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 4px 20px rgba(28,28,24,0.12)',
          marginTop: 2, overflow: 'hidden',
        }}>
          {suggestions.map(p => (
            <button
              key={p.id}
              onMouseDown={e => { e.preventDefault(); select(p) }}
              style={{
                width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '9px 12px', background: 'none', border: 'none', cursor: 'pointer',
                textAlign: 'left', borderBottom: '1px solid var(--border-soft)',
                fontFamily: 'Manrope, sans-serif',
              }}
            >
              <span style={{ fontSize: 13, color: 'var(--on-surface)', fontWeight: 500 }}>{p.name}</span>
              {p.prix != null && (
                <span style={{ fontSize: 12, color: 'var(--on-surface-3)', fontWeight: 600 }}>{p.prix.toFixed(2)} €</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Formulaire partagé (interne + public) ────────────────────────
export function CommandeFormBody({ form, set, produits, addProduit, removeProduit, updateProduit, errors, mode, canPrixEstime = true, canNotesCuisine = true }: {
  form: typeof INIT_FORM
  set: (field: string, val: string) => void
  produits: ProduitLigne[]
  addProduit: () => void
  removeProduit: (id: number) => void
  updateProduit: (id: number, field: keyof ProduitLigne, val: string) => void
  errors: Record<string, string>
  mode: 'interne' | 'public'
  canPrixEstime?: boolean
  canNotesCuisine?: boolean
}) {
  const [catalogue, setCatalogue] = useState<CatalogueProduit[]>([])

  useEffect(() => {
    // Catalogue vivant (105 produits) — alimente l'autocomplete des noms.
    getDocs(query(collection(db, 'catalogue'), orderBy('name', 'asc')))
      .then(snap => {
        setCatalogue(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as CatalogueProduit)))
      })
      .catch(() => {/* autocomplete optionnel — la saisie libre reste possible */})
  }, [])

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
        <Field label="Email" error={errors.email}>
          <input className="input" type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="jean@example.com (optionnel)" />
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
            <AutocompleteProduit
              value={p.produit}
              catalogue={catalogue}
              onChange={(name, prix) => {
                updateProduit(p.id, 'produit', name)
                if (prix != null) {
                  // auto-fill quantite if empty
                  if (!p.quantite) updateProduit(p.id, 'quantite', '1')
                }
              }}
            />
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
          {canPrixEstime && (
            <Field label="Prix estimé (€)">
              <input className="input" type="number" min="0" step="0.01" value={form.prixEstime} onChange={e => set('prixEstime', e.target.value)} placeholder="0.00" />
            </Field>
          )}
          {canNotesCuisine && (
            <Field label="Notes pour la cuisine">
              <textarea className="input" rows={2} style={{ resize: 'none' }} value={form.notesCuisine} onChange={e => set('notesCuisine', e.target.value)} placeholder="Optionnel" />
            </Field>
          )}
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
