import { useEffect, useState } from 'react'
import { collection, deleteDoc, doc, getDocs, getDoc, setDoc, Timestamp, updateDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { DEFAULT_PRIORITY_LEVELS, type PriorityLevel } from './AdminSettings'

// ─── Types ────────────────────────────────────────────────────────────────────

type GepCategory = 'VIANDE' | 'VIANDE_HACHEE' | 'POISSON' | 'LAITIER' | 'PLAT_CUISINE' | 'LEGUMES' | 'AUTRE'
type DisplayCategory = 'Mezze' | 'Plats' | 'Bowl' | 'Tiropitas' | 'Salades' | 'Desserts' | 'Boissons' | 'Autre'

type Produit = {
  id: string
  name: string
  abrv: string
  defaultCategory: DisplayCategory
  gepCategory: GepCategory
  dlcDays: number
  active: boolean
  inReception: boolean
  inFabrication: boolean
  inVitrine: boolean
  allergenes: string[]
  priority: number | null
}

const DISPLAY_CATEGORIES: DisplayCategory[] = [
  'Mezze', 'Plats', 'Bowl', 'Tiropitas', 'Salades', 'Desserts', 'Boissons', 'Autre',
]

const GEP_CATEGORIES: { value: GepCategory; label: string; maxC: number; color: string }[] = [
  { value: 'PLAT_CUISINE',  label: 'Plat cuisiné',   maxC: 4,  color: 'var(--primary)'       },
  { value: 'LAITIER',       label: 'Lait / Laitier', maxC: 6,  color: '#0369a1'               },
  { value: 'VIANDE',        label: 'Viande',          maxC: 4,  color: '#b45309'               },
  { value: 'VIANDE_HACHEE', label: 'Viande hachée',  maxC: 2,  color: '#880014'               },
  { value: 'POISSON',       label: 'Poisson',         maxC: 2,  color: '#0e7490'               },
  { value: 'LEGUMES',       label: 'Légumes',         maxC: 8,  color: 'var(--success)'        },
  { value: 'AUTRE',         label: 'Autre',           maxC: 8,  color: 'var(--on-surface-3)'   },
]

const ALLERGENES_LIST = [
  'Gluten', 'Crustacés', 'Œufs', 'Poisson', 'Arachides', 'Soja', 'Lait',
  'Fruits à coque', 'Céleri', 'Moutarde', 'Graines de sésame',
  'Anhydride sulfureux', 'Lupin', 'Mollusques', 'Ail',
]

const EMPTY_FORM = {
  name: '', abrv: '',
  defaultCategory: 'Plats' as DisplayCategory,
  gepCategory: 'PLAT_CUISINE' as GepCategory,
  dlcDays: 3,
  allergenes: [] as string[],
  inReception: false,
  inFabrication: true,
  inVitrine: false,
  priority: null as number | null,
}

function gepLabel(c: GepCategory)  { return GEP_CATEGORIES.find(x => x.value === c)?.label ?? c }
function gepColor(c: GepCategory)  { return GEP_CATEGORIES.find(x => x.value === c)?.color ?? 'var(--on-surface-3)' }
function gepMax(c: GepCategory)    { return GEP_CATEGORIES.find(x => x.value === c)?.maxC ?? 8 }

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AdminProduits() {
  const [produits, setProduits]     = useState<Produit[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm]             = useState(EMPTY_FORM)
  const [creating, setCreating]     = useState(false)

  const [editId, setEditId]         = useState<string | null>(null)
  const [editForm, setEditForm]     = useState(EMPTY_FORM)
  const [editSaving, setEditSaving] = useState(false)

  const [showInactive, setShowInactive] = useState(false)
  const [filterCat, setFilterCat]       = useState<string>('all')
  const [filterPriority, setFilterPriority] = useState<string>('all')
  const [search, setSearch]             = useState('')
  const [sortByPriority, setSortByPriority] = useState(false)
  const [priorityLevels, setPriorityLevels] = useState<PriorityLevel[]>(DEFAULT_PRIORITY_LEVELS)

  // Catégories d'affichage existantes (pour datalist)
  const displayCategories = [...new Set(
    produits.map(p => p.defaultCategory).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'fr'))

  async function load() {
    setLoading(true)
    try {
      const snap = await getDocs(collection(db, 'catalogue'))
      const list: Produit[] = snap.docs
        .map(d => {
          const data = d.data() as any
          return {
            id: d.id,
            name:            data.name            ?? '',
            abrv:            data.abrv            ?? '',
            defaultCategory: data.defaultCategory ?? '',
            gepCategory:     (data.gepCategory ?? data.defaultCategory ?? 'PLAT_CUISINE') as GepCategory,
            dlcDays:         data.dlcDays         ?? 3,
            active:          data.active          !== false,
            inReception:     data.inReception     === true,
            inFabrication:   data.inFabrication   !== false,
            inVitrine:       data.inVitrine        === true,
            allergenes:      data.allergenes       ?? [],
            priority:        data.priority        ?? null,
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      setProduits(list)
    } catch (e: any) {
      setError(e?.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    getDoc(doc(db, 'settings', 'priority_levels')).then(snap => {
      if (snap.exists()) {
        const lvls = (snap.data() as any).levels
        if (Array.isArray(lvls) && lvls.length > 0) setPriorityLevels(lvls)
      }
    }).catch(e => console.error('[AdminProduits] chargement priority_levels', e))
  }, [])

  async function create() {
    if (!form.name.trim())          return setError('Nom obligatoire')
    if (!form.abrv.trim())          return setError('Abréviation obligatoire')
    if (!form.defaultCategory.trim()) return setError('Catégorie d\'affichage obligatoire')
    if (form.dlcDays < 1)           return setError('DLC doit être ≥ 1 jour')
    setCreating(true); setError(null)
    try {
      const ref = doc(collection(db, 'catalogue'))
      await setDoc(ref, {
        name:            form.name.trim(),
        abrv:            form.abrv.trim().toUpperCase().slice(0, 4),
        defaultCategory: form.defaultCategory.trim(),
        gepCategory:     form.gepCategory,
        dlcDays:         Number(form.dlcDays),
        allergenes:      form.allergenes,
        active:          true,
        inReception:     form.inReception,
        inFabrication:   form.inFabrication,
        inVitrine:       form.inVitrine,
        priority:        form.priority ?? null,
        createdAt:       Timestamp.now(),
      })
      setForm(EMPTY_FORM)
      setShowCreate(false)
      await load()
    } catch (e: any) { setError(e?.message)
    } finally { setCreating(false) }
  }

  async function saveEdit(id: string) {
    if (!editForm.name.trim())          return setError('Nom obligatoire')
    if (!editForm.abrv.trim())          return setError('Abréviation obligatoire')
    if (!editForm.defaultCategory.trim()) return setError('Catégorie d\'affichage obligatoire')
    setEditSaving(true); setError(null)
    try {
      await updateDoc(doc(db, 'catalogue', id), {
        name:            editForm.name.trim(),
        abrv:            editForm.abrv.trim().toUpperCase().slice(0, 4),
        defaultCategory: editForm.defaultCategory.trim(),
        gepCategory:     editForm.gepCategory,
        dlcDays:         Number(editForm.dlcDays),
        allergenes:      editForm.allergenes,
        priority:        editForm.priority ?? null,
        updatedAt:       Timestamp.now(),
      })
      setEditId(null)
      await load()
    } catch (e: any) { setError(e?.message)
    } finally { setEditSaving(false) }
  }

  async function toggle(p: Produit, field: 'active' | 'inReception' | 'inFabrication' | 'inVitrine') {
    try {
      await updateDoc(doc(db, 'catalogue', p.id), { [field]: !p[field] })
      await load()
    } catch (e: any) { setError(e?.message) }
  }

  async function deleteProduit(p: Produit) {
    if (!confirm(`Supprimer définitivement "${p.name}" ?`)) return
    try {
      await deleteDoc(doc(db, 'catalogue', p.id))
      await load()
    } catch (e: any) { setError(e?.message) }
  }

  function openEdit(p: Produit) {
    setEditId(p.id)
    setEditForm({
      name: p.name, abrv: p.abrv,
      defaultCategory: p.defaultCategory,
      gepCategory: p.gepCategory,
      dlcDays: p.dlcDays,
      allergenes: p.allergenes,
      inReception: p.inReception,
      inFabrication: p.inFabrication,
      inVitrine: p.inVitrine,
      priority: p.priority,
    })
    setError(null)
  }

  const filtered = produits
    .filter(p => showInactive ? p.active === false : p.active !== false)
    .filter(p => filterCat === 'all' || p.defaultCategory === filterCat)
    .filter(p => filterPriority === 'all' || (filterPriority === 'null' ? p.priority == null : p.priority === Number(filterPriority)))
    .filter(p => !search.trim() || p.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (!sortByPriority) return a.name.localeCompare(b.name, 'fr')
      if (a.priority === b.priority) return a.name.localeCompare(b.name, 'fr')
      if (a.priority === null) return 1
      if (b.priority === null) return -1
      return a.priority - b.priority
    })

  return (
    <div className="page">

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p className="section-label">Administration</p>
          <h1 style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 24, fontWeight: 800, color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0 }}>Catalogue</h1>
          <p style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 3 }}>Produits · fabrication, réception, vitrine</p>
        </div>
        <button
          onClick={() => { setShowCreate(v => !v); setError(null) }}
          className={showCreate ? 'btn-secondary' : 'btn-primary'}
          style={{ fontSize: 13, padding: '8px 14px' }}
        >
          {showCreate ? 'Annuler' : '+ Nouveau'}
        </button>
      </div>

      {/* Légende GEP */}
      <div className="card">
        <p className="section-label" style={{ marginBottom: 8 }}>Catégories GEP — températures max réception</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {GEP_CATEGORIES.map(c => (
            <div key={c.value} style={{
              fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 99,
              background: 'var(--surface-mid)', color: 'var(--on-surface-2)',
              border: '1px solid var(--border-soft)',
            }}>
              {c.label} ≤{c.maxC}°C
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 8, marginBottom: 0 }}>
          <b style={{ color: 'var(--on-surface-2)' }}>Catégorie affichage</b> : libre (ex : "Plats", "Sauces", "Boissons") — utilisée pour grouper dans Ruptures<br />
          <b style={{ color: 'var(--on-surface-2)' }}>Catégorie GEP</b> : réglementation HACCP — détermine le seuil de température à la réception<br />
          <b style={{ color: 'var(--on-surface-2)' }}>Abrév.</b> : 2-4 lettres pour le code lot · <b style={{ color: 'var(--on-surface-2)' }}>DLC</b> : jours de conservation après fabrication
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
          <ProductForm
            form={form} setForm={setForm}
            displayCategories={displayCategories}
            priorityLevels={priorityLevels}
          />
          <button className="btn-primary" style={{ marginTop: 14, width: '100%' }} onClick={create} disabled={creating}>
            {creating ? 'Création…' : 'Créer le produit'}
          </button>
        </div>
      )}

      {/* Barre de recherche */}
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--on-surface-3)', pointerEvents: 'none' }}>🔍</span>
        <input
          className="input-filled"
          placeholder="Rechercher un produit…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ paddingLeft: 36 }}
        />
      </div>

      {/* Filtres */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--on-surface)' }}>
          {showInactive ? 'Désactivés' : `Actifs (${filtered.length})`}
        </span>
        <div style={{ flex: 1 }} />
        {displayCategories.length > 0 && (
          <select
            value={filterCat}
            onChange={e => setFilterCat(e.target.value)}
            className="input-filled"
            style={{ fontSize: 12, padding: '5px 10px', width: 'auto' }}
          >
            <option value="all">Toutes catégories</option>
            {displayCategories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <select
          value={filterPriority}
          onChange={e => setFilterPriority(e.target.value)}
          className="input-filled"
          style={{ fontSize: 12, padding: '5px 10px', width: 'auto' }}
        >
          <option value="all">Toutes priorités</option>
          {priorityLevels.map(l => (
            <option key={l.level} value={String(l.level)}>{l.name}</option>
          ))}
          <option value="null">Sans priorité</option>
        </select>
        <button
          onClick={() => setSortByPriority(v => !v)}
          className={sortByPriority ? 'btn-primary' : 'btn-secondary'}
          style={{ fontSize: 12, padding: '5px 12px' }}
          title="Trier par priorité de vente"
        >{sortByPriority ? '★ Priorité' : '↕ Priorité'}</button>
        <button onClick={() => setShowInactive(v => !v)} className="btn-secondary" style={{ fontSize: 12, padding: '5px 12px' }}>
          {showInactive ? '← Actifs' : 'Désactivés'}
        </button>
      </div>

      {/* Liste */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" /></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.length === 0 && (
            <p style={{ color: 'var(--on-surface-3)', fontSize: 13, textAlign: 'center', padding: '30px 0' }}>
              {showInactive ? 'Aucun produit désactivé.' : 'Aucun produit. Créez-en un !'}
            </p>
          )}
          {filtered.map(p => {
            const isEditing = editId === p.id
            return (
              <div key={p.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {!isEditing ? (
                  <>
                    {/* Vue résumé */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px' }}>
                      {/* Badge abrév */}
                      <div style={{
                        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                        background: 'var(--surface-mid)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, fontWeight: 800, letterSpacing: '0.04em',
                        color: gepColor(p.gepCategory),
                      }}>
                        {p.abrv || '?'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 15, fontWeight: 700, color: p.active === false ? 'var(--on-surface-3)' : 'var(--on-surface)' }}>
                            {p.name}
                          </span>
                          {p.priority != null && (() => {
                            const lvl = priorityLevels.find(l => l.level === p.priority)
                            return lvl ? (
                              <span style={{
                                fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 99,
                                background: lvl.color + '22', color: lvl.color,
                                border: `1px solid ${lvl.color}44`, flexShrink: 0,
                              }}>{lvl.name}</span>
                            ) : null
                          })()}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 2 }}>
                          <span style={{ fontWeight: 600, color: 'var(--on-surface-2)' }}>{p.defaultCategory || '—'}</span>
                          {' · '}
                          <span style={{ color: gepColor(p.gepCategory) }}>{gepLabel(p.gepCategory)}</span>
                          {' · '}DLC {p.dlcDays}j · max {gepMax(p.gepCategory)}°C
                        </div>
                        {/* Flags */}
                        <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
                          <FlagChip active={p.inFabrication} label="🍳 Fab." title="Cuisine fabrique ce produit" />
                          <FlagChip active={p.inReception}   label="📋 Récep." title="Reçu d'un fournisseur" />
                          <FlagChip active={p.inVitrine}     label="🏪 Vitrine" title="Vendu en vitrine corner" />
                        </div>
                        {p.allergenes && p.allergenes.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 5 }}>
                            {p.allergenes.map(a => (
                              <span key={a} style={{
                                fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 99,
                                background: 'rgba(0,66,117,0.08)', border: '1px solid rgba(0,66,117,0.15)',
                                color: 'var(--primary)',
                              }}>{a}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      {/* Actions rapides */}
                      <div style={{ display: 'flex', gap: 5, flexShrink: 0, flexDirection: 'column', alignItems: 'flex-end' }}>
                        <div style={{ display: 'flex', gap: 5 }}>
                          <button onClick={() => openEdit(p)} title="Modifier" style={iconBtn}>✏️</button>
                          <button
                            onClick={() => toggle(p, 'active')}
                            title={p.active ? 'Désactiver' : 'Réactiver'}
                            style={{
                              ...iconBtn,
                              border: `1px solid ${p.active ? 'rgba(192,57,43,0.3)' : 'rgba(45,122,79,0.3)'}`,
                              background: p.active ? 'rgba(192,57,43,0.06)' : 'rgba(45,122,79,0.06)',
                              color: p.active ? 'var(--danger)' : 'var(--success)',
                            }}
                          >{p.active ? '✕' : '✓'}</button>
                        </div>
                        {/* Toggle rapide flags */}
                        <div style={{ display: 'flex', gap: 4 }}>
                          <ToggleBtn active={p.inFabrication} onClick={() => toggle(p, 'inFabrication')} label="🍳" title="Toggle Fabrication" />
                          <ToggleBtn active={p.inReception}   onClick={() => toggle(p, 'inReception')}   label="📋" title="Toggle Réception" />
                          <ToggleBtn active={p.inVitrine}     onClick={() => toggle(p, 'inVitrine')}     label="🏪" title="Toggle Vitrine" />
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div style={{ padding: 14 }}>
                    <p className="section-label" style={{ color: 'var(--primary)', marginBottom: 12 }}>Modifier — {editForm.name || '…'}</p>
                    <ProductForm
                      form={editForm} setForm={setEditForm}
                      displayCategories={displayCategories}
                      priorityLevels={priorityLevels}
                    />
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button className="btn-primary" style={{ flex: 1, fontSize: 13 }} onClick={() => saveEdit(p.id)} disabled={editSaving}>
                        {editSaving ? 'Sauvegarde…' : 'Enregistrer'}
                      </button>
                      <button onClick={() => { setEditId(null); setError(null) }} className="btn-secondary" style={{ fontSize: 13 }}>Annuler</button>
                      <button onClick={() => deleteProduit(p)} style={{ ...iconBtn, border: '1px solid rgba(192,57,43,0.3)', background: 'rgba(192,57,43,0.06)', color: 'var(--danger)', fontSize: 16 }} title="Supprimer définitivement">🗑</button>
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

// ─── Sous-composants ─────────────────────────────────────────────────────────

const iconBtn: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--surface-low)',
  color: 'var(--on-surface-2)', cursor: 'pointer', fontSize: 13,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

function FlagChip({ active, label, title }: { active: boolean; label: string; title: string }) {
  if (!active) return null
  return (
    <span title={title} style={{
      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
      background: 'rgba(0,66,117,0.08)', border: '1px solid rgba(0,66,117,0.2)',
      color: 'var(--primary)',
    }}>{label}</span>
  )
}

function ToggleBtn({ active, onClick, label, title }: { active: boolean; onClick: () => void; label: string; title: string }) {
  return (
    <button onClick={onClick} title={title} style={{
      height: 24, borderRadius: 6, padding: '0 7px',
      border: `1px solid ${active ? 'rgba(0,66,117,0.3)' : 'var(--border)'}`,
      background: active ? 'rgba(0,66,117,0.08)' : 'var(--surface-low)',
      color: active ? 'var(--primary)' : 'var(--on-surface-3)',
      cursor: 'pointer', fontSize: 11, fontWeight: active ? 700 : 400,
    }}>{label}</button>
  )
}

function ProductForm({
  form, setForm, displayCategories, priorityLevels,
}: {
  form: typeof EMPTY_FORM
  setForm: React.Dispatch<React.SetStateAction<typeof EMPTY_FORM>>
  displayCategories: string[]
  priorityLevels: PriorityLevel[]
}) {
  const uid = Math.random().toString(36).slice(2)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Nom + Abrév */}
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

      {/* Catégorie affichage */}
      <div>
        <label className="section-label" style={{ display: 'block', marginBottom: 4 }}>
          Catégorie * <span style={{ fontWeight: 400, color: 'var(--on-surface-3)' }}>(groupe les produits dans Ruptures & Commandes)</span>
        </label>
        <select
          className="input-filled"
          value={form.defaultCategory}
          onChange={e => setForm(f => ({ ...f, defaultCategory: e.target.value as DisplayCategory }))}
        >
          {DISPLAY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Catégorie GEP + DLC */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'end' }}>
        <div>
          <label className="section-label" style={{ display: 'block', marginBottom: 4 }}>Catégorie GEP (HACCP) *</label>
          <select className="input-filled" value={form.gepCategory}
            onChange={e => setForm(f => ({ ...f, gepCategory: e.target.value as GepCategory }))}>
            {GEP_CATEGORIES.map(c => (
              <option key={c.value} value={c.value}>{c.label} (max {c.maxC}°C réception)</option>
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

      {/* Priorité de vente */}
      <div>
        <label className="section-label" style={{ display: 'block', marginBottom: 4 }}>
          Priorité de vente <span style={{ fontWeight: 400, color: 'var(--on-surface-3)' }}>(tri Ruptures → Dashboard cuisine)</span>
        </label>
        <select
          className="input-filled"
          value={form.priority ?? ''}
          onChange={e => setForm(f => ({ ...f, priority: e.target.value ? Number(e.target.value) : null }))}
        >
          <option value="">— Aucune priorité —</option>
          {[...priorityLevels].sort((a, b) => a.level - b.level).map(l => (
            <option key={l.level} value={l.level}>{l.level} — {l.name}</option>
          ))}
        </select>
      </div>

      {/* Flags présence */}
      <div>
        <label className="section-label" style={{ display: 'block', marginBottom: 8 }}>Présence dans les onglets</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <FlagToggle
            checked={form.inFabrication}
            onChange={v => setForm(f => ({ ...f, inFabrication: v }))}
            label="🍳 Fabrication cuisine"
            hint="La cuisine fabrique ce produit (lots, DLC…) — ex : jus de citron, houmous maison"
          />
          <FlagToggle
            checked={form.inReception}
            onChange={v => setForm(f => ({ ...f, inReception: v }))}
            label="📋 Réception cuisine"
            hint="Reçu d'un fournisseur et contrôlé à la réception (température, N° lot fournisseur)"
          />
          <FlagToggle
            checked={form.inVitrine}
            onChange={v => setForm(f => ({ ...f, inVitrine: v }))}
            label="🏪 Vitrine corner"
            hint="Proposé dans le formulaire d'ajout vitrine (saisie manuelle)"
          />
        </div>
      </div>

      {/* Allergènes */}
      <div>
        <label className="section-label" style={{ display: 'block', marginBottom: 8 }}>Allergènes</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
          {ALLERGENES_LIST.map(a => {
            const on = form.allergenes.includes(a)
            return (
              <label key={a} onClick={() => setForm(f => ({
                ...f,
                allergenes: on ? f.allergenes.filter(x => x !== a) : [...f.allergenes, a]
              }))} style={{
                display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                padding: '5px 8px', borderRadius: 8,
                background: on ? 'rgba(0,66,117,0.07)' : 'var(--surface-low)',
                border: `1px solid ${on ? 'rgba(0,66,117,0.2)' : 'transparent'}`,
                userSelect: 'none',
              }}>
                <div style={{
                  width: 15, height: 15, borderRadius: 4, flexShrink: 0,
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

function FlagToggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label onClick={() => onChange(!checked)} style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
      padding: '8px 10px', borderRadius: 10,
      background: checked ? 'rgba(0,66,117,0.06)' : 'var(--surface-low)',
      border: `1px solid ${checked ? 'rgba(0,66,117,0.2)' : 'transparent'}`,
      userSelect: 'none',
    }}>
      <div style={{
        width: 18, height: 18, borderRadius: 5, flexShrink: 0, marginTop: 1,
        background: checked ? 'var(--primary)' : 'var(--surface-high)',
        border: `2px solid ${checked ? 'var(--primary)' : 'var(--border)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {checked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: checked ? 'var(--primary)' : 'var(--on-surface)' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 2 }}>{hint}</div>
      </div>
    </label>
  )
}
