import { useEffect, useState } from 'react'
import { collection, deleteDoc, doc, getDocs, setDoc, Timestamp, updateDoc } from 'firebase/firestore'
import { db } from '../firebase/config'

type HaccpCategory = 'VIANDE' | 'VIANDE_HACHEE' | 'POISSON' | 'LAITIER' | 'PLAT_CUISINE' | 'LEGUMES' | 'AUTRE'

type Produit = {
  id: string
  name: string
  abrv: string
  defaultCategory: HaccpCategory
  dlcDays: number
  active: boolean
  inReception?: boolean
  inVitrine?: boolean
  allergenes?: string[]
}

const CATEGORIES: { value: HaccpCategory; label: string; maxC: number; color: string }[] = [
  { value: 'PLAT_CUISINE',  label: 'Plat cuisiné',    maxC: 4,  color: 'var(--primary)' },
  { value: 'LAITIER',       label: 'Lait / Laitier',  maxC: 6,  color: '#0369a1' },
  { value: 'VIANDE',        label: 'Viande',           maxC: 4,  color: 'var(--tertiary)' },
  { value: 'VIANDE_HACHEE', label: 'Viande hachée',   maxC: 2,  color: '#880014' },
  { value: 'POISSON',       label: 'Poisson',          maxC: 2,  color: 'var(--secondary)' },
  { value: 'LEGUMES',       label: 'Légumes',          maxC: 8,  color: '#2d7a4f' },
  { value: 'AUTRE',         label: 'Autre',            maxC: 8,  color: 'var(--on-surface-3)' },
]

const ALLERGENES_LIST = [
  'Gluten', 'Crustacés', 'Œufs', 'Poisson', 'Arachides', 'Soja', 'Lait',
  'Fruits à coque', 'Céleri', 'Moutarde', 'Graines de sésame',
  'Anhydride sulfureux', 'Lupin', 'Mollusques', 'Ail',
]

const EMPTY_FORM = { name: '', abrv: '', defaultCategory: 'PLAT_CUISINE' as HaccpCategory, dlcDays: 3, allergenes: [] as string[] }

function catLabel(c: HaccpCategory) {
  return CATEGORIES.find(x => x.value === c)?.label ?? c
}
function catColor(c: HaccpCategory) {
  return CATEGORIES.find(x => x.value === c)?.color ?? 'var(--on-surface-3)'
}
function catMax(c: HaccpCategory) {
  return CATEGORIES.find(x => x.value === c)?.maxC ?? 8
}

export default function AdminProduits() {
  const [produits, setProduits] = useState<Produit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [creating, setCreating] = useState(false)

  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState(EMPTY_FORM)
  const [editSaving, setEditSaving] = useState(false)

  const [showInactive, setShowInactive] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const snap = await getDocs(collection(db, 'produits'))
      const list: Produit[] = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      setProduits(list)
    } catch (e: any) {
      setError(e?.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function create() {
    if (!form.name.trim()) return setError('Nom obligatoire')
    if (!form.abrv.trim()) return setError('Abréviation obligatoire')
    if (form.dlcDays < 1) return setError('DLC doit être ≥ 1 jour')
    setCreating(true)
    setError(null)
    try {
      const ref = doc(collection(db, 'produits'))
      await setDoc(ref, {
        name: form.name.trim(),
        abrv: form.abrv.trim().toUpperCase().slice(0, 4),
        defaultCategory: form.defaultCategory,
        dlcDays: Number(form.dlcDays),
        allergenes: form.allergenes,
        active: true,
        createdAt: Timestamp.now(),
      })
      setForm(EMPTY_FORM)
      setShowCreate(false)
      await load()
    } catch (e: any) {
      setError(e?.message)
    } finally {
      setCreating(false)
    }
  }

  async function saveEdit(id: string) {
    if (!editForm.name.trim()) return setError('Nom obligatoire')
    if (!editForm.abrv.trim()) return setError('Abréviation obligatoire')
    setEditSaving(true)
    setError(null)
    try {
      await updateDoc(doc(db, 'produits', id), {
        name: editForm.name.trim(),
        abrv: editForm.abrv.trim().toUpperCase().slice(0, 4),
        defaultCategory: editForm.defaultCategory,
        dlcDays: Number(editForm.dlcDays),
        allergenes: editForm.allergenes,
        updatedAt: Timestamp.now(),
      })
      setEditId(null)
      await load()
    } catch (e: any) {
      setError(e?.message)
    } finally {
      setEditSaving(false)
    }
  }

  async function toggleActive(p: Produit) {
    try {
      await updateDoc(doc(db, 'produits', p.id), { active: !p.active })
      await load()
    } catch (e: any) {
      setError(e?.message)
    }
  }

  async function toggleInReception(p: Produit) {
    try {
      await updateDoc(doc(db, 'produits', p.id), { inReception: !p.inReception })
      await load()
    } catch (e: any) {
      setError(e?.message)
    }
  }

  async function toggleInVitrine(p: Produit) {
    try {
      await updateDoc(doc(db, 'produits', p.id), { inVitrine: !p.inVitrine })
      await load()
    } catch (e: any) {
      setError(e?.message)
    }
  }

  const visible = produits.filter(p => showInactive ? !p.active : p.active !== false)

  return (
    <div className="page">

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p className="section-label">Administration</p>
          <h1 style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 24, fontWeight: 800, color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0 }}>Produits</h1>
          <p style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 3 }}>Catalogue cuisine · fabrication & réception</p>
        </div>
        <button onClick={() => { setShowCreate(v => !v); setError(null) }} className={showCreate ? 'btn-secondary' : 'btn-primary'} style={{ fontSize: 13, padding: '8px 14px' }}>
          {showCreate ? 'Annuler' : '+ Nouveau'}
        </button>
      </div>

      {/* Légende catégories */}
      <div className="card">
        <p className="section-label" style={{ marginBottom: 10 }}>Catégories HACCP &amp; températures max réception</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {CATEGORIES.map(c => (
            <div key={c.value} style={{
              fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 99,
              background: 'var(--surface-mid)', color: 'var(--on-surface-2)',
              border: '1px solid var(--border-soft)',
            }}>
              {c.label} ≤{c.maxC}°C
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 10, marginBottom: 0 }}>
          <b style={{ color: 'var(--on-surface-2)' }}>Abréviation</b> : 2-4 lettres utilisées dans le code lot (ex: Moussaka → MOU, Tzatziki → TZA)<br />
          <b style={{ color: 'var(--on-surface-2)' }}>DLC</b> : nombre de jours après fabrication avant péremption
        </p>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', background: 'rgba(192,57,43,0.1)', border: '1px solid rgba(192,57,43,0.2)', color: 'var(--danger)', borderRadius: 10, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Formulaire création */}
      {showCreate && (
        <div className="card" style={{ border: '1px solid rgba(0,66,117,0.25)' }}>
          <p className="section-label" style={{ color: 'var(--primary)', marginBottom: 14 }}>Nouveau produit</p>
          <ProductForm form={form} setForm={setForm} />
          <button className="btn-primary" style={{ marginTop: 14, width: '100%' }} onClick={create} disabled={creating}>
            {creating ? 'Création…' : 'Créer le produit'}
          </button>
        </div>
      )}

      {/* Toggle actif/inactif */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--on-surface)' }}>
          {showInactive ? 'Produits désactivés' : `Produits actifs (${visible.length})`}
        </span>
        <button onClick={() => setShowInactive(v => !v)} className="btn-secondary" style={{ fontSize: 12, padding: '5px 12px' }}>
          {showInactive ? '← Actifs' : 'Désactivés'}
        </button>
      </div>

      {/* Liste */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" /></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visible.length === 0 && (
            <p style={{ color: 'var(--on-surface-3)', fontSize: 13, textAlign: 'center', padding: '30px 0' }}>
              {showInactive ? 'Aucun produit désactivé.' : 'Aucun produit actif. Créez-en un !'}
            </p>
          )}
          {visible.map(p => {
            const isEditing = editId === p.id
            return (
              <div key={p.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {!isEditing ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px' }}>
                    {/* Badge catégorie */}
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: 'var(--surface-mid)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 800, color: catColor(p.defaultCategory),
                      letterSpacing: '0.04em',
                    }}>
                      {p.abrv}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: p.active === false ? 'var(--on-surface-3)' : 'var(--on-surface)' }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 2 }}>
                        <span style={{ color: catColor(p.defaultCategory), fontWeight: 600 }}>{catLabel(p.defaultCategory)}</span>
                        {' · '}DLC {p.dlcDays}j · max {catMax(p.defaultCategory)}°C réception
                      </div>
                      {p.allergenes && p.allergenes.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
                          {p.allergenes.map(a => (
                            <span key={a} style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 99, background: 'rgba(0,66,117,0.1)', border: '1px solid rgba(0,66,117,0.2)', color: 'var(--primary)' }}>{a}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => toggleInVitrine(p)}
                        title={p.inVitrine ? 'Retirer de la vitrine' : 'Ajouter à la vitrine'}
                        style={{
                          height: 30, borderRadius: 8, padding: '0 8px',
                          border: `1px solid ${p.inVitrine ? 'rgba(0,66,117,0.3)' : 'var(--border)'}`,
                          background: p.inVitrine ? 'rgba(0,66,117,0.1)' : 'var(--surface-low)',
                          color: p.inVitrine ? 'var(--primary)' : 'var(--on-surface-3)', cursor: 'pointer', fontSize: 11,
                          fontWeight: 700, whiteSpace: 'nowrap',
                        }}
                      >
                        {p.inVitrine ? '🏪 Vitrine' : '🏪'}
                      </button>
                      <button
                        onClick={() => toggleInReception(p)}
                        title={p.inReception ? 'Retirer de la réception' : 'Ajouter à la réception'}
                        style={{
                          height: 30, borderRadius: 8, padding: '0 8px',
                          border: `1px solid ${p.inReception ? 'rgba(84,101,30,0.3)' : 'var(--border)'}`,
                          background: p.inReception ? 'rgba(84,101,30,0.1)' : 'var(--surface-low)',
                          color: p.inReception ? 'var(--secondary)' : 'var(--on-surface-3)', cursor: 'pointer', fontSize: 11,
                          fontWeight: 700, whiteSpace: 'nowrap',
                        }}
                      >
                        {p.inReception ? '📋 Récep.' : '📋'}
                      </button>
                      <button onClick={() => { setEditId(p.id); setEditForm({ name: p.name, abrv: p.abrv, defaultCategory: p.defaultCategory, dlcDays: p.dlcDays, allergenes: p.allergenes ?? [] }); setError(null) }} style={{
                        width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)',
                        background: 'var(--surface-low)', color: 'var(--on-surface-2)', cursor: 'pointer', fontSize: 13,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>✏️</button>
                      <button onClick={() => toggleActive(p)} title={p.active === false ? 'Réactiver' : 'Désactiver'} style={{
                        width: 30, height: 30, borderRadius: 8,
                        border: `1px solid ${p.active === false ? 'rgba(45,122,79,0.3)' : 'rgba(192,57,43,0.3)'}`,
                        background: p.active === false ? 'rgba(45,122,79,0.08)' : 'rgba(192,57,43,0.08)',
                        color: p.active === false ? 'var(--success)' : 'var(--danger)', cursor: 'pointer', fontSize: 13,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>{p.active === false ? '✓' : '✕'}</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '14px' }}>
                    <ProductForm form={editForm} setForm={setEditForm} />
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button className="btn-primary" style={{ flex: 1, fontSize: 13 }} onClick={() => saveEdit(p.id)} disabled={editSaving}>
                        {editSaving ? 'Sauvegarde…' : 'Enregistrer'}
                      </button>
                      <button onClick={() => setEditId(null)} className="btn-secondary" style={{ fontSize: 13 }}>Annuler</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Formulaire partagé création / édition ──────────────────────────
function ProductForm({
  form, setForm,
}: {
  form: { name: string; abrv: string; defaultCategory: HaccpCategory; dlcDays: number; allergenes: string[] }
  setForm: React.Dispatch<React.SetStateAction<typeof form>>
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 }}>
        <div>
          <label className="section-label" style={{ display: 'block', marginBottom: 4 }}>Nom du produit *</label>
          <input className="input-filled" placeholder="ex : Moussaka" value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div>
          <label className="section-label" style={{ display: 'block', marginBottom: 4 }}>Abrév. *</label>
          <input className="input-filled" placeholder="MOU" maxLength={4} value={form.abrv}
            onChange={e => setForm(f => ({ ...f, abrv: e.target.value.toUpperCase().slice(0, 4) }))}
            style={{ width: 72, textAlign: 'center', fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.08em' }} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'end' }}>
        <div>
          <label className="section-label" style={{ display: 'block', marginBottom: 4 }}>Catégorie HACCP *</label>
          <select className="input-filled" value={form.defaultCategory}
            onChange={e => setForm(f => ({ ...f, defaultCategory: e.target.value as HaccpCategory }))}>
            {CATEGORIES.map(c => (
              <option key={c.value} value={c.value}>{c.label} (max {c.maxC}°C)</option>
            ))}
          </select>
        </div>
        <div>
          <label className="section-label" style={{ display: 'block', marginBottom: 4 }}>DLC (jours) *</label>
          <input className="input-filled" type="number" min="1" max="30" value={form.dlcDays}
            onChange={e => setForm(f => ({ ...f, dlcDays: parseInt(e.target.value) || 1 }))}
            style={{ width: 72, textAlign: 'center' }} />
        </div>
      </div>
      <div>
        <label className="section-label" style={{ display: 'block', marginBottom: 8 }}>Allergènes</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {ALLERGENES_LIST.map(a => {
            const on = form.allergenes.includes(a)
            return (
              <label key={a} onClick={() => setForm(f => ({
                ...f,
                allergenes: on ? f.allergenes.filter(x => x !== a) : [...f.allergenes, a]
              }))} style={{
                display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                padding: '6px 8px', borderRadius: 8,
                background: on ? 'rgba(0,66,117,0.08)' : 'var(--surface-low)',
                border: `1px solid ${on ? 'rgba(0,66,117,0.25)' : 'transparent'}`,
                userSelect: 'none',
              }}>
                <div style={{
                  width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                  background: on ? 'var(--primary)' : 'var(--surface-high)',
                  border: `2px solid ${on ? 'var(--primary)' : 'var(--border)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {on && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                </div>
                <span style={{ fontSize: 12, color: on ? 'var(--primary)' : 'var(--on-surface-2)', fontWeight: on ? 600 : 400 }}>{a}</span>
              </label>
            )
          })}
        </div>
      </div>
    </div>
  )
}
