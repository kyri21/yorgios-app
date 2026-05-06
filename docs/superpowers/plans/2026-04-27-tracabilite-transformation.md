# Traçabilité Transformation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un mode "Transformation" (hachage, découpe, marinade) dans Fabrication avec traçabilité complète Réception → Transformation → Produit fini via un modal dédié.

**Architecture:** Trois nouveaux champs optionnels sur `lots_cuisine` (`isTransformation`, `transformationType`, `ingredientLotCodes`). Aucune migration — rétrocompatible. Fabrication.tsx gagne un 4e mode de formulaire. Un modal traçabilité fait remonter la chaîne en 1-2 lectures Firestore supplémentaires.

**Tech Stack:** React, Firestore (DB `test`), TypeScript — pas de nouvelle dépendance.

---

## Fichiers touchés

| Fichier | Action |
|---------|--------|
| `src/modules/cuisine/pages/Fabrication.tsx` | Modifier — 4e mode formulaire + sélecteur ingrédients + modal traçabilité + badges TRANSFO |
| `src/modules/cuisine/pages/Livraisons.tsx` | Modifier — exclure lots `isTransformation` de la liste d'envoi |

---

## Task 1 : Types + champs Firestore + badge TRANSFO dans la liste

**Files:**
- Modify: `src/modules/cuisine/pages/Fabrication.tsx`

- [ ] **Step 1 — Étendre le type `Lot`**

Dans `Fabrication.tsx`, remplacer la définition du type `Lot` (ligne ~46) par :

```typescript
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
  // Traçabilité
  isTransformation?: boolean
  transformationType?: 'hachage' | 'decoupe' | 'marinade' | 'autre'
  receptionId?: string | null
  fournisseur?: string | null
  ingredientLotCodes?: string[]
}
```

- [ ] **Step 2 — Ajouter le badge TRANSFO dans le rendu de chaque carte lot**

Après la div `{lot.lotCode}` (ligne ~672), ajouter le badge conditionnel :

```tsx
{(lot as any).isTransformation && (
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
```

- [ ] **Step 3 — Commit**

```bash
git add src/modules/cuisine/pages/Fabrication.tsx
git commit -m "feat(fabrication): type Lot étendu + badge TRANSFO"
```

---

## Task 2 : Mode "🔄 Transformation" dans le formulaire

**Files:**
- Modify: `src/modules/cuisine/pages/Fabrication.tsx`

- [ ] **Step 1 — Ajouter le mode `transformation` au toggle de formulaire**

Changer le type de `formMode` :

```typescript
const [formMode, setFormMode] = useState<'catalogue' | 'manuel' | 'reception' | 'transformation'>('catalogue')
```

Ajouter les états spécifiques au mode transformation, après les états existants du mode réception (~ligne 101) :

```typescript
// Mode "transformation"
const [transfoType, setTransfoType] = useState<'hachage' | 'decoupe' | 'marinade' | 'autre'>('hachage')
const [transfoReceptionId, setTransfoReceptionId] = useState('')
const [transfoReceptions, setTransfoReceptions] = useState<ReceptionSource[]>([])
const [transfoReceptionsLoaded, setTransfoReceptionsLoaded] = useState(false)
```

- [ ] **Step 2 — Fonction `loadTransfoReceptions` (toutes catégories, pas seulement viande)**

Ajouter après `loadReceptions()` :

```typescript
async function loadTransfoReceptions() {
  setTransfoReceptionsLoaded(false)
  try {
    const snap = await getDocs(query(
      collection(db, 'receptions'),
      orderBy('receivedAt', 'desc'),
      limit(50),
    ))
    setTransfoReceptions(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ReceptionSource[])
  } catch { /* silently ignore */ }
  finally { setTransfoReceptionsLoaded(true) }
}
```

- [ ] **Step 3 — Ajouter le bouton "🔄 Transformation" dans le toggle de mode**

Dans le tableau des modes du toggle (ligne ~422), ajouter après `'manuel'` :

```tsx
{ id: 'transformation', label: '🔄 Transformation' },
```

Et dans le handler `onClick` du toggle, ajouter le chargement :

```typescript
if (m.id === 'transformation' && !transfoReceptionsLoaded) loadTransfoReceptions()
```

Et dans le reset :
```typescript
setTransfoReceptionId('')
setTransfoType('hachage')
```

- [ ] **Step 4 — DLC auto-suggérée selon le type de transformation**

Ajouter une fonction utilitaire dans Fabrication.tsx :

```typescript
const TRANSFO_DLC: Record<string, number> = {
  hachage: 2,
  decoupe: 3,
  marinade: 5,
  autre: 3,
}
const TRANSFO_CATEGORY: Record<string, string> = {
  hachage: 'VIANDE_HACHEE',
  decoupe: 'VIANDE',
  marinade: 'VIANDE',
  autre: 'PLAT_CUISINE',
}
const TRANSFO_LABEL: Record<string, string> = {
  hachage: 'Hachage',
  decoupe: 'Découpe',
  marinade: 'Marinade',
  autre: 'Autre transformation',
}
```

- [ ] **Step 5 — Rendu du formulaire mode `transformation`**

Dans le JSX, à la suite du bloc `formMode === 'reception'` (après la balise `</>` qui ferme ce bloc, ~ligne 594), ajouter :

```tsx
{formMode === 'transformation' && (
  <>
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
            <div
              key={r.id}
              onClick={() => setTransfoReceptionId(active ? '' : r.id)}
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
        })}
      </div>
    )}

    {transfoReceptionId && (() => {
      const r = transfoReceptions.find(r => r.id === transfoReceptionId)
      if (!r) return null
      const dlc = TRANSFO_DLC[transfoType]
      return (
        <div style={{
          fontSize: 12, color: 'var(--on-surface-2)', marginTop: 8,
          padding: '8px 12px', borderRadius: 10,
          background: 'rgba(109,40,217,0.05)', border: '1px solid rgba(109,40,217,0.15)',
        }}>
          <b>{TRANSFO_LABEL[transfoType]}</b> de <b>{r.productName}</b> ({r.fournisseur})
          {r.supplierLot ? ` · lot ${r.supplierLot}` : ''} · DLC auto J+{dlc}
        </div>
      )
    })()}
  </>
)}
```

- [ ] **Step 6 — Logique de soumission pour le mode `transformation`**

Dans `onSubmit`, après les gardes existantes (~ligne 219), ajouter :

```typescript
const isTransformation = formMode === 'transformation'
if (isTransformation && !transfoReceptionId) return setError('Sélectionner une réception source.')
```

Et dans le bloc de calcul des variables (après `isReception`) :

```typescript
const selectedTransfoReception = transfoReceptions.find(r => r.id === transfoReceptionId) || null

const productName = isManuel
  ? manualName.trim()
  : isReception
    ? selectedReception!.productName
    : isTransformation
      ? `${selectedTransfoReception!.productName} — ${TRANSFO_LABEL[transfoType]}`
      : selectedProduit!.name

const abrv = isManuel
  ? manualName.trim().slice(0, 4).toUpperCase().replace(/\s+/g, '')
  : isReception
    ? productName.slice(0, 4).toUpperCase().replace(/\s+/g, '')
    : isTransformation
      ? transfoType.slice(0, 4).toUpperCase()
      : (selectedProduit!.abrv || selectedProduit!.name.slice(0, 3)).trim().toUpperCase()

const dlcDays = isManuel
  ? Number(manualDlcDays) || 3
  : isReception
    ? 7
    : isTransformation
      ? TRANSFO_DLC[transfoType]
      : Number(selectedProduit?.dlcDays ?? 3)

const category = isManuel
  ? manualCategory
  : isReception
    ? (selectedReception!.category || 'PLAT_CUISINE')
    : isTransformation
      ? TRANSFO_CATEGORY[transfoType]
      : (selectedProduit!.gepCategory ?? selectedProduit!.defaultCategory ?? 'AUTRE')
```

Et dans le `setDoc` du lot, ajouter les champs de traçabilité :

```typescript
await setDoc(lotRef, {
  // ... champs existants ...
  receptionId: isReception
    ? selectedReceptionId
    : isTransformation
      ? transfoReceptionId
      : null,
  fournisseur: isReception
    ? selectedReception!.fournisseur
    : isTransformation
      ? selectedTransfoReception!.fournisseur
      : null,
  isTransformation: isTransformation ? true : false,
  transformationType: isTransformation ? transfoType : null,
  ingredientLotCodes: [],
  // ... reste des champs existants ...
})
```

Et dans le reset après soumission, ajouter :
```typescript
setTransfoReceptionId('')
setTransfoType('hachage')
```

Et dans le bouton submit, étendre la condition `disabled` :

```typescript
disabled={loading || !computed.okQty || (
  formMode === 'catalogue' ? !productId :
  formMode === 'reception' ? !selectedReceptionId :
  formMode === 'transformation' ? !transfoReceptionId :
  !manualName.trim()
)}
```

- [ ] **Step 7 — Commit**

```bash
git add src/modules/cuisine/pages/Fabrication.tsx
git commit -m "feat(fabrication): mode Transformation — hachage/découpe/marinade avec réception source"
```

---

## Task 3 : Sélecteur de lots sources (ingrédients) sur les modes catalogue et manuel

**Files:**
- Modify: `src/modules/cuisine/pages/Fabrication.tsx`

- [ ] **Step 1 — Ajouter l'état pour les lots de transformation disponibles**

```typescript
// Sélecteur ingrédients (modes catalogue + manuel)
const [transfoLots, setTransfoLots] = useState<Lot[]>([])
const [transfoLotsLoaded, setTransfoLotsLoaded] = useState(false)
const [selectedIngredientLotIds, setSelectedIngredientLotIds] = useState<string[]>([])
const [showIngredientPicker, setShowIngredientPicker] = useState(false)
```

- [ ] **Step 2 — Fonction `loadTransfoLots`**

```typescript
async function loadTransfoLots() {
  setTransfoLotsLoaded(false)
  try {
    const since = new Date()
    since.setDate(since.getDate() - 14) // 14j de fenêtre pour les lots transfo
    const snap = await getDocs(query(
      collection(db, 'lots_cuisine'),
      where('isTransformation', '==', true),
      where('createdAt', '>=', Timestamp.fromDate(since)),
      orderBy('createdAt', 'desc'),
    ))
    setTransfoLots(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }) as Lot))
  } catch { /* silently ignore */ }
  finally { setTransfoLotsLoaded(true) }
}
```

- [ ] **Step 3 — Ajouter le sélecteur dans le JSX, sous le select produit (mode catalogue) et sous le champ nom (mode manuel)**

Juste avant le bloc `{error && ...}` (fin du formulaire, ~ligne 596), ajouter :

```tsx
{(formMode === 'catalogue' || formMode === 'manuel') && (
  <div style={{ marginTop: 14 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
      <label style={labelStyle}>Lots sources (ingrédients) — optionnel</label>
      <button
        type="button"
        onClick={() => {
          setShowIngredientPicker(v => !v)
          if (!transfoLotsLoaded) loadTransfoLots()
        }}
        style={{
          fontSize: 11, padding: '3px 10px', borderRadius: 7, border: '1px solid var(--border)',
          background: showIngredientPicker ? 'rgba(109,40,217,0.08)' : 'var(--surface-mid)',
          color: showIngredientPicker ? '#6d28d9' : 'var(--on-surface-3)',
          cursor: 'pointer', fontWeight: 600, fontFamily: 'Manrope, sans-serif',
        }}
      >
        {showIngredientPicker ? '▲ Masquer' : '+ Ajouter'}
      </button>
    </div>

    {/* Chips des lots déjà sélectionnés */}
    {selectedIngredientLotIds.length > 0 && (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {selectedIngredientLotIds.map(id => {
          const lot = transfoLots.find(l => l.id === id)
          return (
            <span key={id} style={{
              fontSize: 11, padding: '3px 8px', borderRadius: 6,
              background: 'rgba(109,40,217,0.10)', color: '#6d28d9',
              border: '1px solid rgba(109,40,217,0.20)',
              display: 'flex', alignItems: 'center', gap: 5,
              fontFamily: 'Manrope, sans-serif', fontWeight: 600,
            }}>
              {lot?.productName ?? id}
              <button
                type="button"
                onClick={() => setSelectedIngredientLotIds(ids => ids.filter(i => i !== id))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6d28d9', fontSize: 13, lineHeight: 1, padding: 0 }}
              >×</button>
            </span>
          )
        })}
      </div>
    )}

    {showIngredientPicker && (
      <div style={{ maxHeight: 220, overflowY: 'auto', borderRadius: 10, background: 'var(--surface-mid)', border: '1px solid var(--border-soft)' }}>
        {!transfoLotsLoaded ? (
          <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--on-surface-3)' }}>Chargement…</div>
        ) : transfoLots.length === 0 ? (
          <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--on-surface-3)' }}>
            Aucun lot de transformation disponible (14 derniers jours).
          </div>
        ) : transfoLots.map(l => {
          const isSelected = selectedIngredientLotIds.includes(l.id)
          const dlcDate = l.dlcAt?.toDate ? l.dlcAt.toDate() : null
          const prodDate = l.producedAt?.toDate ? l.producedAt.toDate() : null
          const dateStr = prodDate ? prodDate.toLocaleDateString('fr-FR') : '—'
          return (
            <div
              key={l.id}
              onClick={() => setSelectedIngredientLotIds(ids =>
                isSelected ? ids.filter(i => i !== l.id) : [...ids, l.id]
              )}
              style={{
                padding: '10px 12px', cursor: 'pointer',
                borderLeft: isSelected ? '3px solid #6d28d9' : '3px solid transparent',
                background: isSelected ? 'rgba(109,40,217,0.07)' : 'transparent',
                transition: 'background 0.12s',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: isSelected ? 700 : 500, color: isSelected ? '#6d28d9' : 'var(--on-surface)' }}>
                {l.productName}
              </div>
              <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 2 }}>
                {l.lotCode} · {dateStr}
                {dlcDate && <> · DLC {dlcDate.toLocaleDateString('fr-FR')}</>}
              </div>
            </div>
          )
        })}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 4 — Sauvegarder `ingredientLotCodes` dans le `setDoc`**

Dans le bloc `setDoc(lotRef, { ... })`, remplacer `ingredientLotCodes: []` par :

```typescript
ingredientLotCodes: isTransformation ? [] : selectedIngredientLotIds,
```

Et dans le reset après soumission :
```typescript
setSelectedIngredientLotIds([])
setShowIngredientPicker(false)
```

- [ ] **Step 5 — Commit**

```bash
git add src/modules/cuisine/pages/Fabrication.tsx
git commit -m "feat(fabrication): sélecteur lots sources (ingrédients) sur mode catalogue/manuel"
```

---

## Task 4 : Modal de traçabilité

**Files:**
- Modify: `src/modules/cuisine/pages/Fabrication.tsx`

- [ ] **Step 1 — État du modal**

```typescript
// Modal traçabilité
const [traceLot, setTraceLot] = useState<Lot | null>(null)
const [traceData, setTraceData] = useState<{
  ingredientLots: Array<{ lot: Lot; reception: ReceptionSource | null }>
  directReception: ReceptionSource | null
} | null>(null)
const [traceLoading, setTraceLoading] = useState(false)
```

- [ ] **Step 2 — Fonction `loadTraceData`**

```typescript
async function loadTraceData(lot: Lot) {
  setTraceLoading(true)
  setTraceData(null)
  try {
    // Réception directe (mode réception ou transformation)
    let directReception: ReceptionSource | null = null
    if (lot.receptionId) {
      const snap = await getDoc(doc(db, 'receptions', lot.receptionId))
      if (snap.exists()) directReception = { id: snap.id, ...(snap.data() as any) } as ReceptionSource
    }

    // Lots ingrédients + leurs réceptions
    const ingredientLotCodes: string[] = (lot as any).ingredientLotCodes ?? []
    let ingredientLots: Array<{ lot: Lot; reception: ReceptionSource | null }> = []
    if (ingredientLotCodes.length > 0) {
      const snaps = await Promise.all(
        ingredientLotCodes.map(id => getDoc(doc(db, 'lots_cuisine', id)))
      )
      ingredientLots = await Promise.all(snaps.map(async snap => {
        if (!snap.exists()) return null
        const ingLot = { id: snap.id, ...(snap.data() as any) } as Lot
        let reception: ReceptionSource | null = null
        if (ingLot.receptionId) {
          const rSnap = await getDoc(doc(db, 'receptions', ingLot.receptionId))
          if (rSnap.exists()) reception = { id: rSnap.id, ...(rSnap.data() as any) } as ReceptionSource
        }
        return { lot: ingLot, reception }
      })).then(list => list.filter(Boolean) as Array<{ lot: Lot; reception: ReceptionSource | null }>)
    }

    setTraceData({ ingredientLots, directReception })
  } catch { /* silently ignore */ }
  finally { setTraceLoading(false) }
}
```

- [ ] **Step 3 — Bouton "🔍" sur chaque carte lot (dans la rangée d'action buttons)**

Dans le groupe de boutons actions (après le bouton QR "⬛", ~ligne 758), ajouter :

```tsx
<button
  onClick={() => { setTraceLot(lot); loadTraceData(lot) }}
  title="Traçabilité"
  style={{
    width: 34, height: 34, borderRadius: 10,
    border: '1.5px solid rgba(109,40,217,0.25)',
    background: 'rgba(109,40,217,0.06)',
    color: '#6d28d9',
    cursor: 'pointer', fontSize: 15,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }}
>🔍</button>
```

- [ ] **Step 4 — Rendu du modal traçabilité**

Juste avant la fermeture `</div>` principale du composant (~avant la balise de fermeture du return), ajouter :

```tsx
{/* ========== MODAL TRAÇABILITÉ ========== */}
{traceLot && (
  <div
    onClick={() => setTraceLot(null)}
    style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(28,28,24,0.5)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}
  >
    <div
      onClick={e => e.stopPropagation()}
      style={{
        background: 'var(--surface)', borderRadius: 20, padding: 24,
        maxWidth: 420, width: '100%',
        boxShadow: '0 8px 32px rgba(28,28,24,0.12)',
        maxHeight: '80vh', overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 17, fontWeight: 800, color: 'var(--on-surface)', margin: 0 }}>
          🔍 Traçabilité
        </h2>
        <button onClick={() => setTraceLot(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--on-surface-3)' }}>×</button>
      </div>

      {/* Lot courant */}
      <TraceNode
        icon="🍽"
        label={traceLot.productName}
        sub={`${traceLot.lotCode} · FAB ${traceLot.producedAt?.toDate?.().toLocaleDateString('fr-FR') ?? '—'} · DLC ${traceLot.dlcAt?.toDate?.().toLocaleDateString('fr-FR') ?? '—'}`}
        color="var(--primary)"
      />

      {traceLoading && (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      )}

      {!traceLoading && traceData && (
        <>
          {/* Réception directe (lot lui-même lié à une réception) */}
          {traceData.directReception && (
            <>
              <TraceArrow />
              <TraceNode
                icon="📦"
                label={traceData.directReception.productName}
                sub={`${traceData.directReception.fournisseur} · reçu le ${traceData.directReception.receivedAt?.toDate?.().toLocaleDateString('fr-FR') ?? '—'}${traceData.directReception.supplierLot ? ` · lot ${traceData.directReception.supplierLot}` : ''}`}
                color="var(--success)"
              />
            </>
          )}

          {/* Lots ingrédients (lot de production avec des lots sources) */}
          {traceData.ingredientLots.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '16px 0 8px' }}>
                Ingrédients sources
              </div>
              {traceData.ingredientLots.map(({ lot: ingLot, reception }) => (
                <div key={ingLot.id} style={{ marginBottom: 12 }}>
                  <TraceArrow />
                  <TraceNode
                    icon="🔄"
                    label={ingLot.productName}
                    sub={`${ingLot.lotCode} · ${ingLot.transformationType ? TRANSFO_LABEL[ingLot.transformationType] : 'Transformation'} le ${ingLot.producedAt?.toDate?.().toLocaleDateString('fr-FR') ?? '—'}`}
                    color="#6d28d9"
                    badge={ingLot.transformationType ? TRANSFO_LABEL[ingLot.transformationType] : undefined}
                  />
                  {reception && (
                    <>
                      <TraceArrow nested />
                      <TraceNode
                        icon="📦"
                        label={reception.productName}
                        sub={`${reception.fournisseur} · reçu le ${reception.receivedAt?.toDate?.().toLocaleDateString('fr-FR') ?? '—'}${reception.supplierLot ? ` · lot ${reception.supplierLot}` : ''}`}
                        color="var(--success)"
                        nested
                      />
                    </>
                  )}
                </div>
              ))}
            </>
          )}

          {!traceData.directReception && traceData.ingredientLots.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--on-surface-3)', textAlign: 'center', padding: '20px 0' }}>
              Aucune traçabilité enregistrée pour ce lot.
            </div>
          )}
        </>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 5 — Ajouter les mini-composants `TraceNode` et `TraceArrow`**

À la fin de Fabrication.tsx, avant `HistoriqueTab`, ajouter :

```tsx
function TraceArrow({ nested }: { nested?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', paddingLeft: nested ? 24 : 0, margin: '4px 0' }}>
      <div style={{ width: 1, height: 16, background: 'var(--border)', marginLeft: nested ? 10 : 10 }} />
      <span style={{ fontSize: 10, color: 'var(--on-surface-3)', marginLeft: 4 }}>↓</span>
    </div>
  )
}

function TraceNode({ icon, label, sub, color, badge, nested }: {
  icon: string; label: string; sub: string; color: string; badge?: string; nested?: boolean
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '10px 12px', borderRadius: 12,
      background: 'var(--surface-low)', border: `1px solid ${color}22`,
      marginLeft: nested ? 20 : 0,
    }}>
      <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.3 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--on-surface)' }}>{label}</span>
          {badge && (
            <span style={{
              fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
              color, background: `${color}18`, border: `1px solid ${color}30`,
              borderRadius: 5, padding: '1px 6px', textTransform: 'uppercase',
            }}>{badge}</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 2 }}>{sub}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 6 — Commit**

```bash
git add src/modules/cuisine/pages/Fabrication.tsx
git commit -m "feat(fabrication): modal traçabilité — chaîne Réception → Transformation → Production"
```

---

## Task 5 : Exclure les lots `isTransformation` de la liste d'envoi corner

**Files:**
- Modify: `src/modules/cuisine/pages/Livraisons.tsx`

- [ ] **Step 1 — Ajouter `isTransformation` au type local du lot (si le fichier a un type `Lot` local)**

Dans `Livraisons.tsx`, trouver le type qui représente un lot cuisine (chercher `sent?: boolean`) et y ajouter :

```typescript
isTransformation?: boolean
```

- [ ] **Step 2 — Exclure les lots transformation du filtre `availableLots`**

Dans `Livraisons.tsx`, chercher toutes les occurrences de `lots.filter(l => !l.sent)` (~ligne 325 et 348 et 748) et les modifier en :

```typescript
lots.filter(l => !l.sent && !l.isTransformation)
```

Il y a 3 occurrences dans le fichier.

- [ ] **Step 3 — Commit**

```bash
git add src/modules/cuisine/pages/Livraisons.tsx
git commit -m "fix(livraisons): exclure lots isTransformation de la liste d'envoi corner"
```

---

## Task 6 : Build + deploy

- [ ] **Step 1 — Build**

```bash
npm run build
```

Expected: `✓ built in XX.XXs` sans erreur TypeScript.

- [ ] **Step 2 — Deploy hosting**

```bash
firebase deploy --only hosting
```

Expected: `✔  Deploy complete!`

- [ ] **Step 3 — Test manuel**

Scénario à vérifier :
1. Aller sur `/cuisine` → Fabrication → mode "🔄 Transformation"
2. Choisir "Hachage", sélectionner une réception boeuf → DLC J+2 affiché
3. Valider → lot créé avec badge TRANSFO dans la liste
4. Vérifier que ce lot n'apparaît PAS dans `/cuisine/livraisons` (liste d'envoi)
5. Retourner en Fabrication → mode "📋 Catalogue" → section "Lots sources" → "Ajouter"
6. Sélectionner le lot de viande hachée → valider le lot Moussaka
7. Cliquer 🔍 sur le lot Moussaka → modal affiche la chaîne complète

- [ ] **Step 4 — Commit final**

```bash
git add .
git commit -m "feat: traçabilité transformation — build + deploy"
```
