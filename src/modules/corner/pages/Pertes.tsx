import { useState, useEffect, useRef, useMemo } from 'react'
import {
  Timestamp,
  addDoc,
  collection,
  getDocs,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../auth/useAuth'
import { useToast, useToastState } from '../../../hooks/useToast'
import Toast from '../../../components/Toast'

// ─── Types ────────────────────────────────────────────────────────────────────
type PerteType = 'quantite' | 'prix'
type UniteQuantite = 'kg' | 'g' | 'pièce(s)' | 'L'

interface MercurialeItem {
  id: string
  name: string
  categorie: string
  unite: 'KG' | 'PIECE'
  prixUnitaire: number
}

interface Perte {
  id: string
  date: string
  addedAt: Timestamp
  userId: string
  userName: string
  productName: string
  type: PerteType
  valeur: number
  unite: string
  note?: string
  prixUnitaireRef?: number
  valeurEstimeeEur?: number
}

type Periode = 'jour' | 'semaine' | 'mois'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toLocalISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function startOfWeek(d: Date): Date {
  const copy = new Date(d); const day = copy.getDay()
  const diff = day === 0 ? -6 : 1 - day; copy.setDate(copy.getDate() + diff); copy.setHours(0,0,0,0); return copy
}
function endOfWeek(d: Date): Date {
  const start = startOfWeek(d); const end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23,59,59,999); return end
}
function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0) }
function endOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999) }
function getRangeDates(periode: Periode, anchor: Date): { start: Date; end: Date } {
  if (periode === 'jour') {
    const start = new Date(anchor); start.setHours(0,0,0,0); const end = new Date(anchor); end.setHours(23,59,59,999); return { start, end }
  }
  if (periode === 'semaine') return { start: startOfWeek(anchor), end: endOfWeek(anchor) }
  return { start: startOfMonth(anchor), end: endOfMonth(anchor) }
}
function formatPeriodeLabel(periode: Periode, anchor: Date): string {
  if (periode === 'jour') {
    const today = toLocalISO(new Date()); const anch = toLocalISO(anchor)
    if (anch === today) return "Aujourd'hui"
    return anchor.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
  }
  if (periode === 'semaine') {
    const s = startOfWeek(anchor); const e = endOfWeek(anchor)
    return `${s.getDate()} – ${e.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`
  }
  return anchor.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}
function advanceAnchor(periode: Periode, anchor: Date, dir: 1 | -1): Date {
  const copy = new Date(anchor)
  if (periode === 'jour') copy.setDate(copy.getDate() + dir)
  else if (periode === 'semaine') copy.setDate(copy.getDate() + dir * 7)
  else copy.setMonth(copy.getMonth() + dir)
  return copy
}
function groupByDate(pertes: Perte[]): Map<string, Perte[]> {
  const map = new Map<string, Perte[]>()
  for (const p of pertes) { const existing = map.get(p.date) ?? []; existing.push(p); map.set(p.date, existing) }
  return map
}
function formatHeure(ts: Timestamp): string {
  const d = ts.toDate(); const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}
function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}
function calcEstimatedEur(valeur: number, unite: string, prixUnitaire: number): number {
  if (unite === 'kg') return valeur * prixUnitaire
  if (unite === 'g')  return (valeur / 1000) * prixUnitaire
  if (unite === 'pièce(s)') return valeur * prixUnitaire
  if (unite === 'L')  return valeur * prixUnitaire
  return 0
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function Pertes() {
  const { user } = useAuth()
  const { show } = useToast()
  const { toast, setToast } = useToastState()

  const [onglet, setOnglet] = useState<'saisie' | 'rapport'>('saisie')

  // ── Mercuriale
  const [mercuriale, setMercuriale] = useState<MercurialeItem[]>([])
  const [selectedItem, setSelectedItem] = useState<MercurialeItem | null>(null)

  // ── Autocomplete
  const [productName, setProductName] = useState('')
  const [suggestions, setSuggestions] = useState<MercurialeItem[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Formulaire
  const [type, setType] = useState<PerteType>('quantite')
  const [valeur, setValeur] = useState('')
  const [unite, setUnite] = useState<UniteQuantite>('kg')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  // ── Rapport
  const [periode, setPeriode] = useState<Periode>('jour')
  const [anchor, setAnchor] = useState<Date>(new Date())
  const [pertes, setPertes] = useState<Perte[]>([])
  const [loadingRapport, setLoadingRapport] = useState(false)

  // ── Charger mercuriale
  useEffect(() => {
    getDocs(query(collection(db, 'mercuriale'), where('active', '==', true), orderBy('name')))
      .then(snap => {
        const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as MercurialeItem[]
        setMercuriale(items)
      })
      .catch(() => {})
  }, [])

  // ── Suggestions autocomplete
  useEffect(() => {
    if (!productName.trim()) { setSuggestions([]); return }
    const q = productName.toLowerCase()
    setSuggestions(mercuriale.filter(p => p.name.toLowerCase().includes(q)).slice(0, 8))
  }, [productName, mercuriale])

  // ── Valeur estimée en € (calculée en temps réel)
  const estimatedEur = useMemo(() => {
    if (!selectedItem || type !== 'quantite') return null
    const v = parseFloat(valeur)
    if (isNaN(v) || v <= 0) return null
    return calcEstimatedEur(v, unite, selectedItem.prixUnitaire)
  }, [selectedItem, type, valeur, unite])

  // ── Charger rapport
  useEffect(() => { if (onglet === 'rapport') chargerPertes() }, [onglet, periode, anchor])

  async function chargerPertes() {
    setLoadingRapport(true)
    try {
      const { start, end } = getRangeDates(periode, anchor)
      const snap = await getDocs(query(
        collection(db, 'pertes_corner'),
        where('date', '>=', toLocalISO(start)),
        where('date', '<=', toLocalISO(end)),
        orderBy('date', 'asc'), orderBy('addedAt', 'asc')
      ))
      setPertes(snap.docs.map(d => ({ id: d.id, ...d.data() } as Perte)))
    } catch { show('Erreur chargement rapport', 'error') }
    finally { setLoadingRapport(false) }
  }

  // ── Enregistrer perte
  async function handleSave() {
    if (!productName.trim()) { show('Nom du produit requis', 'error'); return }
    const val = parseFloat(valeur)
    if (!valeur || isNaN(val) || val <= 0) { show('Valeur invalide', 'error'); return }
    setSaving(true)
    try {
      const today = toLocalISO(new Date())
      await addDoc(collection(db, 'pertes_corner'), {
        date: today,
        addedAt: Timestamp.now(),
        userId: user?.uid ?? '',
        userName: user?.displayName ?? user?.email ?? '',
        productName: productName.trim(),
        type,
        valeur: val,
        unite: type === 'prix' ? '€' : unite,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(selectedItem ? { prixUnitaireRef: selectedItem.prixUnitaire } : {}),
        ...(estimatedEur !== null ? { valeurEstimeeEur: estimatedEur } : {}),
      })
      show('Perte enregistrée', 'success')
      setProductName(''); setValeur(''); setNote(''); setType('quantite'); setUnite('kg'); setSelectedItem(null)
    } catch { show('Erreur enregistrement', 'error') }
    finally { setSaving(false) }
  }

  // ── Supprimer perte
  async function handleDelete(id: string) {
    try {
      await deleteDoc(doc(db, 'pertes_corner', id))
      setPertes(prev => prev.filter(p => p.id !== id))
      show('Perte supprimée', 'info')
    } catch { show('Erreur suppression', 'error') }
  }

  // ── Stats rapport
  const totalPrix   = pertes.filter(p => p.type === 'prix').reduce((acc, p) => acc + p.valeur, 0)
  const totalEstime = pertes.filter(p => p.type === 'quantite' && p.valeurEstimeeEur != null).reduce((acc, p) => acc + (p.valeurEstimeeEur ?? 0), 0)
  const grouped = groupByDate([...pertes].sort((a, b) => a.date.localeCompare(b.date)))
  const sortedDates = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b))

  return (
    <div className="page">
      <Toast toast={toast} setToast={setToast} />

      {/* Header */}
      <div>
        <p className="section-label" style={{ marginBottom: 2 }}>HACCP Ledger</p>
        <h1 style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 24, fontWeight: 800, color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0 }}>
          {onglet === 'saisie' ? 'Saisie des Pertes' : 'Rapport de Pertes'}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: '4px 0 0', fontFamily: 'Manrope, sans-serif' }}>
          {onglet === 'saisie'
            ? 'Enregistrez les produits non conformes pour maintenir la précision de votre inventaire HACCP.'
            : 'Consultez et analysez les pertes sur la période sélectionnée.'}
        </p>
      </div>

      {/* Tabs switcher Aegean */}
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--surface-mid)', borderRadius: 14 }}>
        {(['saisie', 'rapport'] as const).map(t => (
          <button
            key={t}
            onClick={() => setOnglet(t)}
            style={{
              flex: 1, padding: '9px 0', borderRadius: 10, border: 'none',
              background: onglet === t ? 'var(--surface)' : 'transparent',
              color: onglet === t ? 'var(--primary)' : 'var(--on-surface-3)',
              fontWeight: 700, fontFamily: 'Manrope, sans-serif', fontSize: 14,
              cursor: 'pointer',
              boxShadow: onglet === t ? '0 1px 6px rgba(28,28,24,0.08)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            {t === 'saisie' ? 'Saisie' : 'Rapport'}
          </button>
        ))}
      </div>

      {/* ══ ONGLET SAISIE ══ */}
      {onglet === 'saisie' && (
        <>
          {/* Produit + autocomplete */}
          <div className="card" style={{ position: 'relative' }}>
            <label className="section-label" style={{ marginBottom: 6 }}>Description du produit</label>
            <input
              ref={inputRef}
              className="input"
              placeholder="Rechercher ou saisir un nom…"
              value={productName}
              onChange={e => { setProductName(e.target.value); setSelectedItem(null); setShowSuggestions(true) }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              autoComplete="off"
            />
            {showSuggestions && suggestions.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0,
                background: 'var(--surface)', borderRadius: '0 0 12px 12px', zIndex: 50,
                maxHeight: 220, overflowY: 'auto',
                boxShadow: '0 8px 32px rgba(28,28,24,0.12)',
              }}>
                {suggestions.map(item => (
                  <div
                    key={item.id}
                    onMouseDown={() => {
                      setProductName(item.name)
                      setSelectedItem(item)
                      setUnite(item.unite === 'KG' ? 'kg' : 'pièce(s)')
                      setShowSuggestions(false)
                    }}
                    style={{ padding: '10px 14px', fontSize: 14, color: 'var(--on-surface)', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                  >
                    <div style={{ fontWeight: 600, fontFamily: 'Manrope, sans-serif' }}>{item.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 1 }}>
                      {item.categorie} · {item.prixUnitaire.toFixed(2)} €/{item.unite === 'KG' ? 'kg' : 'pièce'}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {selectedItem && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, background: 'rgba(0,66,117,0.08)', color: 'var(--primary)', borderRadius: 20, padding: '3px 10px', fontWeight: 700, fontFamily: 'Manrope, sans-serif' }}>
                  {selectedItem.categorie}
                </span>
                <span style={{ fontSize: 12, color: 'var(--on-surface-3)' }}>
                  {selectedItem.prixUnitaire.toFixed(2)} €/{selectedItem.unite === 'KG' ? 'kg' : 'pièce'}
                </span>
              </div>
            )}
          </div>

          {/* Type de perte */}
          <div className="card">
            <label className="section-label" style={{ marginBottom: 10 }}>Type de perte</label>
            <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--surface-mid)', borderRadius: 14, marginBottom: 16 }}>
              <button
                onClick={() => { setType('quantite'); setUnite(selectedItem?.unite === 'PIECE' ? 'pièce(s)' : 'kg') }}
                style={{
                  flex: 1, padding: '9px 0', borderRadius: 10, border: 'none',
                  background: type === 'quantite' ? 'var(--surface)' : 'transparent',
                  color: type === 'quantite' ? 'var(--primary)' : 'var(--on-surface-3)',
                  fontWeight: 700, fontFamily: 'Manrope, sans-serif', fontSize: 13, cursor: 'pointer',
                  boxShadow: type === 'quantite' ? '0 1px 6px rgba(28,28,24,0.08)' : 'none',
                }}
              >
                Poids / Unités
              </button>
              <button
                onClick={() => setType('prix')}
                style={{
                  flex: 1, padding: '9px 0', borderRadius: 10, border: 'none',
                  background: type === 'prix' ? 'var(--surface)' : 'transparent',
                  color: type === 'prix' ? 'var(--danger)' : 'var(--on-surface-3)',
                  fontWeight: 700, fontFamily: 'Manrope, sans-serif', fontSize: 13, cursor: 'pointer',
                  boxShadow: type === 'prix' ? '0 1px 6px rgba(28,28,24,0.08)' : 'none',
                }}
              >
                Retour caisse
              </button>
            </div>

            {type === 'quantite' ? (
              <>
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label className="section-label" style={{ marginBottom: 4 }}>Quantité</label>
                    <input className="input" type="number" inputMode="decimal" placeholder="0" value={valeur} onChange={e => setValeur(e.target.value)} min="0" />
                  </div>
                  <div>
                    <label className="section-label" style={{ marginBottom: 4 }}>Unité de saisie</label>
                    <select className="input" value={unite} onChange={e => setUnite(e.target.value as UniteQuantite)}>
                      <option value="kg">kg</option>
                      <option value="g">g</option>
                      <option value="pièce(s)">pièce(s)</option>
                      <option value="L">L</option>
                    </select>
                  </div>
                </div>
                {estimatedEur !== null && (
                  <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(136,0,20,0.06)', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, color: 'var(--on-surface-2)', fontFamily: 'Manrope, sans-serif' }}>Perte estimée</span>
                    <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--danger)', fontFamily: 'Epilogue, sans-serif' }}>{estimatedEur.toFixed(2)} €</span>
                  </div>
                )}
              </>
            ) : (
              <div>
                <label className="section-label" style={{ marginBottom: 4 }}>Prix sur étiquette</label>
                <div style={{ position: 'relative' }}>
                  <input className="input" style={{ paddingRight: 32 }} type="number" inputMode="decimal" placeholder="0.00" value={valeur} onChange={e => setValeur(e.target.value)} min="0" step="0.01" />
                  <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--on-surface-3)', fontSize: 15 }}>€</span>
                </div>
              </div>
            )}
          </div>

          {/* Note */}
          <div className="card">
            <label className="section-label" style={{ marginBottom: 6 }}>Motif / Observation (optionnel)</label>
            <input className="input" placeholder="Raison, commentaire…" value={note} onChange={e => setNote(e.target.value)} />
          </div>

          <button className="btn-primary" style={{ opacity: saving ? 0.6 : 1 }} onClick={handleSave} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer la Perte'}
          </button>

          <button
            onClick={() => { setProductName(''); setValeur(''); setNote(''); setType('quantite'); setUnite('kg'); setSelectedItem(null) }}
            style={{ background: 'none', border: 'none', color: 'var(--on-surface-3)', fontSize: 13, cursor: 'pointer', textAlign: 'center', padding: '4px 0', fontFamily: 'Manrope, sans-serif' }}
          >
            Annuler la saisie
          </button>
        </>
      )}

      {/* ══ ONGLET RAPPORT ══ */}
      {onglet === 'rapport' && (
        <>
          {/* Sélecteur période */}
          <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--surface-mid)', borderRadius: 14 }}>
            {(['jour', 'semaine', 'mois'] as Periode[]).map(p => (
              <button
                key={p}
                onClick={() => { setPeriode(p); setAnchor(new Date()) }}
                style={{
                  flex: 1, padding: '9px 0', borderRadius: 10, border: 'none',
                  background: periode === p ? 'var(--surface)' : 'transparent',
                  color: periode === p ? 'var(--primary)' : 'var(--on-surface-3)',
                  fontWeight: 700, fontFamily: 'Manrope, sans-serif', fontSize: 13, cursor: 'pointer',
                  boxShadow: periode === p ? '0 1px 6px rgba(28,28,24,0.08)' : 'none',
                }}
              >
                {p === 'jour' ? "Today" : p === 'semaine' ? 'Semaine' : 'Mois'}
              </button>
            ))}
          </div>

          {/* Navigation période */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button
              onClick={() => setAnchor(a => advanceAnchor(periode, a, -1))}
              style={{ background: 'var(--surface-low)', border: 'none', borderRadius: 10, padding: '8px 16px', color: 'var(--on-surface)', fontSize: 18, cursor: 'pointer' }}
            >←</button>
            <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--on-surface)', fontFamily: 'Manrope, sans-serif' }}>
              {formatPeriodeLabel(periode, anchor)}
            </span>
            <button
              onClick={() => setAnchor(a => advanceAnchor(periode, a, 1))}
              style={{ background: 'var(--surface-low)', border: 'none', borderRadius: 10, padding: '8px 16px', color: 'var(--on-surface)', fontSize: 18, cursor: 'pointer' }}
            >→</button>
          </div>

          {/* Stats KPI */}
          <div style={{ display: 'grid', gridTemplateColumns: totalEstime > 0 ? '1fr 1fr 1fr' : '1fr 1fr', gap: 10 }}>
            <div className="card" style={{ textAlign: 'center', padding: '14px 10px' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--on-surface)', fontFamily: 'Epilogue, sans-serif' }}>{pertes.length}</div>
              <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 2, fontFamily: 'Manrope, sans-serif', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Unités perdues</div>
            </div>
            <div style={{ background: 'rgba(136,0,20,0.06)', borderRadius: 14, padding: '14px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--danger)', fontFamily: 'Epilogue, sans-serif' }}>{totalPrix.toFixed(2)} €</div>
              <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 2, fontFamily: 'Manrope, sans-serif', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Valeur financière</div>
            </div>
            {totalEstime > 0 && (
              <div style={{ background: 'rgba(180,83,9,0.06)', borderRadius: 14, padding: '14px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--warning)', fontFamily: 'Epilogue, sans-serif' }}>~{totalEstime.toFixed(2)} €</div>
                <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 2, fontFamily: 'Manrope, sans-serif', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Estimation</div>
              </div>
            )}
          </div>

          {/* Liste */}
          {loadingRapport ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--on-surface-3)' }}>
              <div className="spinner" style={{ margin: '0 auto' }} />
            </div>
          ) : pertes.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--on-surface)', fontFamily: 'Epilogue, sans-serif', marginBottom: 4 }}>
                Aucune perte sur cette période
              </div>
              <div style={{ fontSize: 13, color: 'var(--on-surface-3)', fontFamily: 'Manrope, sans-serif' }}>
                Félicitations. Vos protocoles de gestion des stocks ont été parfaitement respectés.
              </div>
            </div>
          ) : (
            sortedDates.map(dateStr => (
              <div key={dateStr}>
                {periode !== 'jour' && (
                  <p className="section-label" style={{ marginBottom: 6, paddingLeft: 4 }}>
                    {formatDateLabel(dateStr)}
                  </p>
                )}
                <div className="card" style={{ padding: '8px 14px' }}>
                  {(grouped.get(dateStr) ?? []).map((perte, idx, arr) => (
                    <div key={perte.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      paddingBottom: idx < arr.length - 1 ? 12 : 0,
                      marginBottom: idx < arr.length - 1 ? 12 : 0,
                      borderBottom: idx < arr.length - 1 ? '1px solid var(--border)' : 'none',
                    }}>
                      <div style={{
                        width: 4, minHeight: 36, borderRadius: 2,
                        background: perte.type === 'prix' ? 'var(--danger)' : 'var(--primary)',
                        flexShrink: 0,
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--on-surface)', fontFamily: 'Manrope, sans-serif', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {perte.productName}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: perte.type === 'prix' ? 'var(--danger)' : 'var(--primary)' }}>
                            {perte.type === 'prix' ? `${perte.valeur.toFixed(2)} €` : `${perte.valeur} ${perte.unite}`}
                          </span>
                          {perte.type === 'quantite' && perte.valeurEstimeeEur != null && (
                            <span style={{ fontSize: 12, color: 'var(--warning)', fontWeight: 600 }}>
                              ≈ {perte.valeurEstimeeEur.toFixed(2)} €
                            </span>
                          )}
                          <span style={{ fontSize: 12, color: 'var(--on-surface-3)' }}>{formatHeure(perte.addedAt)}</span>
                          {perte.note && <span style={{ fontSize: 12, color: 'var(--on-surface-3)', fontStyle: 'italic' }}>— {perte.note}</span>}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDelete(perte.id)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--on-surface-3)', fontSize: 18, cursor: 'pointer', padding: '4px 6px', flexShrink: 0 }}
                        title="Supprimer"
                      >🗑</button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </>
      )}
    </div>
  )
}
