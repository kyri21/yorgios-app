import { useState } from 'react'
import { Timestamp, addDoc, collection } from 'firebase/firestore'
import { db } from '../firebase/config'
import { CommandeFormBody } from '../modules/corner/pages/Commandes'

// ─── Types locaux ─────────────────────────────────────────────────
type ProduitLigne = { id: number; produit: string; quantite: string; unite: string }

const CRENEAUX = ['Matin 8h-12h', 'Midi 12h-14h', 'Après-midi 14h-18h', 'Soir 18h-20h', 'À préciser']

let _id = 100
const nextId = () => _id++
const emptyProduit = (): ProduitLigne => ({ id: nextId(), produit: '', quantite: '', unite: 'pièces' })

function todayPlusOne(): string {
  const d = new Date(); d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

const rePhone = /^[\d\s\+\-\(\)\.]{7,20}$/
const reEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const INIT_FORM = {
  nom: '', prenom: '', telephone: '', email: '', entreprise: '',
  adresseLivraison: '', creneauHoraire: CRENEAUX[0],
  dateLivraison: todayPlusOne(), heureLivraison: '12:00', mode: 'Livraison',
  dateEvenement: '', typeEvenement: '', nombreConvives: '',
  instructionsSpeciales: '', prixEstime: '', notesCuisine: '', notesManager: '', saisiPar: 'Client',
}

function genCommandeId(): string {
  const d = new Date()
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`
  return `CMD-${ymd}-${String(Math.floor(Math.random() * 9000) + 1000)}`
}

function validateForm(f: typeof INIT_FORM, prods: ProduitLigne[]): Record<string, string> {
  const e: Record<string, string> = {}
  if (!f.nom.trim())              e.nom = 'Champ obligatoire'
  if (!f.prenom.trim())           e.prenom = 'Champ obligatoire'
  if (!f.telephone.trim())        e.telephone = 'Champ obligatoire'
  else if (!rePhone.test(f.telephone)) e.telephone = 'Numéro invalide'
  if (!f.email.trim())            e.email = 'Champ obligatoire'
  else if (!reEmail.test(f.email)) e.email = 'Email invalide'
  if (!f.adresseLivraison.trim()) e.adresseLivraison = 'Champ obligatoire'
  if (!f.dateLivraison)           e.dateLivraison = 'Champ obligatoire'
  if (!f.heureLivraison)          e.heureLivraison = 'Champ obligatoire'
  if (!prods.some(p => p.produit.trim())) e.produits = 'Au moins un produit requis'
  return e
}

export default function CommandePublique() {
  const [form, setForm]         = useState({ ...INIT_FORM })
  const [produits, setProduits] = useState<ProduitLigne[]>([emptyProduit()])
  const [errors, setErrors]     = useState<Record<string, string>>({})
  const [saving, setSaving]     = useState(false)
  const [submitted, setSubmitted] = useState(false)

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
    if (Object.keys(errs).length) { setErrors(errs); window.scrollTo({ top: 0, behavior: 'smooth' }); return }

    setSaving(true)
    try {
      const cmdId = genCommandeId()
      const prodsClean = produits.filter(p => p.produit.trim()).map(({ produit, quantite, unite }) => ({ produit, quantite, unite }))
      await addDoc(collection(db, 'commandes_externes'), {
        id: cmdId, dateSaisie: Timestamp.now(), saisiPar: 'Formulaire public',
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
        prixEstime: null, notesCuisine: '', notesManager: '', lienGcal: '',
      })
      setSubmitted(true)
    } catch {
      setErrors({ _global: 'Une erreur est survenue. Veuillez réessayer.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#f9fafb', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #1E3A5F 0%, #2E5C9A 100%)',
        padding: '20px 20px 24px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px' }}>Matias</div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>Formulaire de commande</div>
      </div>

      {/* Contenu */}
      <div style={{ maxWidth: 540, margin: '0 auto', padding: '20px 16px 48px' }}>

        {submitted ? (
          <div style={{
            background: '#fff', borderRadius: 20, padding: 32, textAlign: 'center',
            boxShadow: '0 4px 20px rgb(0 0 0 / 0.08)',
            marginTop: 20,
          }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: '#15803d', marginBottom: 8 }}>Commande transmise !</h2>
            <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6 }}>
              Votre commande a bien été reçue. Notre équipe vous recontactera rapidement pour confirmer les détails.
            </p>
          </div>
        ) : (
          <>
            {errors._global && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '12px 16px', fontSize: 13, color: '#dc2626', marginBottom: 16 }}>
                ⚠️ {errors._global}
              </div>
            )}

            <CommandeFormBody
              form={form} set={set} produits={produits}
              addProduit={addProduit} removeProduit={removeProduit} updateProduit={updateProduit}
              errors={errors} mode="public"
            />

            <button
              onClick={handleSubmit}
              disabled={saving}
              style={{
                width: '100%', padding: '16px', borderRadius: 14, fontSize: 15, fontWeight: 700,
                background: 'linear-gradient(135deg, #1E3A5F 0%, #2E5C9A 100%)',
                color: '#fff', border: 'none', cursor: 'pointer', marginTop: 8,
                boxShadow: '0 4px 14px rgb(30 58 95 / 0.35)',
                opacity: saving ? 0.6 : 1,
              }}>
              {saving ? 'Envoi en cours…' : '📨 Envoyer ma commande'}
            </button>

            <p style={{ textAlign: 'center', fontSize: 11, color: '#9ca3af', marginTop: 16 }}>
              Vos données sont utilisées uniquement pour le traitement de votre commande.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
