# AC Inline Livraison — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter des sections "Actions correctives" expandables inline sur chaque card de livraison dans les onglets "Complétées aujourd'hui" et "Historique" de `Livraison.tsx`.

**Architecture:** Un seul fichier modifié (`Livraison.tsx`). Composant local `AcInlineSection` défini avant le `export default`. Chargement lazy par livraison via `loadLivAcs(id)`. Même composant partagé `ActionCorrectiveModal` que Températures Corner. Les ACs apparaissent automatiquement dans le rapport Contrôle (query existante par date).

**Tech Stack:** React + TypeScript, Firestore `getDocs` (pas `onSnapshot` — chargement à la demande), `ActionCorrectiveModal` depuis `src/components/`.

---

## Fichiers modifiés

| Fichier | Modification |
|---------|-------------|
| `src/modules/corner/pages/Livraison.tsx` | Ajout import, type, états, fonction, composant local, sections dans 2 endroits, 2 modals |

Aucun autre fichier à modifier. `Controle.tsx` inclut déjà les ACs livraison via sa query `date >= from && date <= to`.

---

### Task 1 — Import + Type + États + `isManagerRole` check

**Files:**
- Modify: `src/modules/corner/pages/Livraison.tsx:1-5` (import)
- Modify: `src/modules/corner/pages/Livraison.tsx:7-20` (après les types existants)
- Modify: `src/modules/corner/pages/Livraison.tsx:74-78` (bloc états Historique)

- [ ] **Step 1.1 — Ajouter l'import ActionCorrectiveModal**

Ligne 5, après `import { useAuth } from '../../../auth/useAuth'`, ajouter :

```typescript
import ActionCorrectiveModal, { type AcPayload } from '../../../components/ActionCorrectiveModal'
```

- [ ] **Step 1.2 — Ajouter le type AcItem**

Après le type `DeliveryDoc` (ligne ~30), avant `function todayStart()`, ajouter :

```typescript
type AcItem = {
  id: string
  problem: string
  action: string
  date: string          // YYYY-MM-DD — stocké sur le doc Firestore, nécessaire pour le modal edit
  createdByName?: string
  createdAt?: any
}
```

- [ ] **Step 1.3 — Ajouter les 4 états AC**

Après le bloc `// --- Historique ---` (ligne ~74), ajouter un nouveau bloc :

```typescript
  // --- Actions correctives inline ---
  const [acExpandedId, setAcExpandedId] = useState<string | null>(null)
  const [livAcs, setLivAcs]             = useState<Record<string, AcItem[]>>({})
  const [livAcModal, setLivAcModal]     = useState<AcPayload | null>(null)
  const [editAc, setEditAc]             = useState<AcItem | null>(null)
```

- [ ] **Step 1.4 — Vérifier `isManagerRole`**

Chercher ligne ~366 : `const isManagerRole = ['patron', 'administrateur', 'manager'].includes(user?.role ?? '')` — elle existe déjà. **Ne pas en créer une autre.** On utilisera `isManagerRole` dans les steps suivants.

- [ ] **Step 1.5 — Commit**

```bash
git add src/modules/corner/pages/Livraison.tsx
git commit -m "feat(livraison): add AcItem type + AC inline states"
```

---

### Task 2 — Fonction `loadLivAcs`

**Files:**
- Modify: `src/modules/corner/pages/Livraison.tsx` — après la dernière fonction de chargement (chercher `async function loadHistorique` ou similaire, insérer après)

- [ ] **Step 2.1 — Localiser le bon endroit d'insertion**

```bash
grep -n "async function load\|async function retour\|async function accepter" src/modules/corner/pages/Livraison.tsx
```

Insérer `loadLivAcs` **après** la dernière fonction `async function load…` et avant `const isManagerRole`.

- [ ] **Step 2.2 — Ajouter la fonction**

```typescript
  async function loadLivAcs(id: string) {
    const q = query(
      collection(db, 'actions_correctives'),
      where('refId', '==', id)
    )
    const snap = await getDocs(q)
    setLivAcs(prev => ({
      ...prev,
      [id]: snap.docs.map(s => ({ id: s.id, ...s.data() })) as AcItem[]
    }))
  }
```

- [ ] **Step 2.3 — Commit**

```bash
git add src/modules/corner/pages/Livraison.tsx
git commit -m "feat(livraison): add loadLivAcs function"
```

---

### Task 3 — Composant local `AcInlineSection`

**Files:**
- Modify: `src/modules/corner/pages/Livraison.tsx` — juste avant `export default function Livraison()`

- [ ] **Step 3.1 — Insérer le composant local**

```bash
grep -n "export default function Livraison" src/modules/corner/pages/Livraison.tsx
```

Insérer **juste avant** cette ligne :

```typescript
function AcInlineSection({
  livId, receptionAt, acs, isManager, onAdd, onEdit,
}: {
  livId: string
  receptionAt: any
  acs: AcItem[]
  isManager: boolean
  onAdd: (p: AcPayload) => void
  onEdit: (ac: AcItem) => void
}) {
  const dateISO = receptionAt?.toDate
    ? receptionAt.toDate().toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10)

  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {acs.map(ac => (
        <div key={ac.id} style={{
          background: 'var(--surface-low)', borderRadius: 10,
          padding: '10px 12px', border: '1px solid var(--border-soft)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger)' }}>{ac.problem || '—'}</div>
            {isManager && (
              <button
                onClick={() => onEdit(ac)}
                style={{
                  padding: '3px 7px', borderRadius: 7, border: '1px solid var(--border)',
                  background: 'var(--surface-mid)', cursor: 'pointer', fontSize: 11,
                  flexShrink: 0,
                }}
              >✏️</button>
            )}
          </div>
          <div style={{
            fontSize: 12, color: 'var(--on-surface)', lineHeight: 1.5,
            fontFamily: 'Manrope, sans-serif', whiteSpace: 'pre-wrap',
          }}>
            {ac.action}
          </div>
          <div style={{ fontSize: 10, color: 'var(--on-surface-3)', marginTop: 4 }}>
            par {ac.createdByName || '—'} ·{' '}
            {ac.createdAt?.toDate
              ? ac.createdAt.toDate().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
              : ''}
          </div>
        </div>
      ))}
      <button
        onClick={() => onAdd({ type: 'temperature_reception', date: dateISO, refId: livId, problem: '' })}
        style={{
          fontSize: 11, color: 'var(--primary)', background: 'none',
          border: '1px dashed rgba(0,66,117,0.4)', borderRadius: 8,
          padding: '5px 10px', cursor: 'pointer', fontWeight: 600,
          fontFamily: 'Manrope, sans-serif', alignSelf: 'flex-start',
        }}
      >➕ Ajouter une action corrective</button>
    </div>
  )
}
```

- [ ] **Step 3.2 — Commit**

```bash
git add src/modules/corner/pages/Livraison.tsx
git commit -m "feat(livraison): add AcInlineSection local component"
```

---

### Task 4 — Toggle AC dans les cards "Complétées aujourd'hui"

**Files:**
- Modify: `src/modules/corner/pages/Livraison.tsx` — bloc `done.map(l => { ... })`, ligne ~659-736

- [ ] **Step 4.1 — Localiser la fin de la card "done"**

```bash
grep -n "↩ Retour cuisine\|retourCuisine\|Retour cuisine" src/modules/corner/pages/Livraison.tsx
```

Trouver le `</div>` qui ferme le `<div key={l.id}` de `done.map`. C'est après le bouton "↩ Retour cuisine".

- [ ] **Step 4.2 — Insérer la section AC toggle**

Dans `done.map(l => { return ( <div key={l.id} ...> ... [fin des boutons retour/dérogation] ...` ajouter **avant** le `</div>` fermant la card :

```tsx
              {/* Section AC inline */}
              <div style={{ marginTop: 8, borderTop: '1px solid var(--border-soft)', paddingTop: 8 }}>
                <button
                  onClick={() => {
                    const next = acExpandedId === l.id ? null : l.id
                    setAcExpandedId(next)
                    if (next && livAcs[l.id] === undefined) loadLivAcs(l.id)
                  }}
                  style={{
                    fontSize: 11, color: 'var(--primary)', background: 'none', border: 'none',
                    cursor: 'pointer', fontWeight: 600, fontFamily: 'Manrope, sans-serif',
                    padding: 0,
                  }}
                >
                  📋 Actions correctives
                  {livAcs[l.id]?.length ? ` (${livAcs[l.id].length})` : ''}
                  {acExpandedId === l.id ? ' ▲' : ' ▶'}
                </button>
                {acExpandedId === l.id && (
                  <AcInlineSection
                    livId={l.id}
                    receptionAt={l.receptionAt}
                    acs={livAcs[l.id] ?? []}
                    isManager={isManagerRole}
                    onAdd={p => setLivAcModal(p)}
                    onEdit={ac => setEditAc(ac)}
                  />
                )}
              </div>
```

- [ ] **Step 4.3 — Commit**

```bash
git add src/modules/corner/pages/Livraison.tsx
git commit -m "feat(livraison): add AC inline toggle on completed cards"
```

---

### Task 5 — Toggle AC dans les cards "Historique"

**Files:**
- Modify: `src/modules/corner/pages/Livraison.tsx` — bloc `histLivraisons.map(l => { ... })`, ligne ~789-912

- [ ] **Step 5.1 — Localiser la fin de la card historique**

```bash
grep -n "Réception\|departPhotoUrl\|receptionPhotoUrl" src/modules/corner/pages/Livraison.tsx | grep -v "//\|setPhotoModal\|style\|Photo" | tail -20
```

La card historique ferme à la fin de la section miniatures photos (`</div>` après le bloc `(l.departPhotoUrl || l.receptionPhotoUrl)`). Elle se termine par `</div>` puis `)`  puis `})}`.

- [ ] **Step 5.2 — Insérer la section AC toggle dans historique**

Dans `histLivraisons.map(l => { return ( <div key={l.id} className="card"> ... [après miniatures photos] ...` ajouter **avant** le `</div>` fermant la card :

```tsx
                {/* Section AC inline */}
                <div style={{ marginTop: 8, borderTop: '1px solid var(--border-soft)', paddingTop: 8 }}>
                  <button
                    onClick={() => {
                      const next = acExpandedId === l.id ? null : l.id
                      setAcExpandedId(next)
                      if (next && livAcs[l.id] === undefined) loadLivAcs(l.id)
                    }}
                    style={{
                      fontSize: 11, color: 'var(--primary)', background: 'none', border: 'none',
                      cursor: 'pointer', fontWeight: 600, fontFamily: 'Manrope, sans-serif',
                      padding: 0,
                    }}
                  >
                    📋 Actions correctives
                    {livAcs[l.id]?.length ? ` (${livAcs[l.id].length})` : ''}
                    {acExpandedId === l.id ? ' ▲' : ' ▶'}
                  </button>
                  {acExpandedId === l.id && (
                    <AcInlineSection
                      livId={l.id}
                      receptionAt={l.receptionAt}
                      acs={livAcs[l.id] ?? []}
                      isManager={isManagerRole}
                      onAdd={p => setLivAcModal(p)}
                      onEdit={ac => setEditAc(ac)}
                    />
                  )}
                </div>
```

- [ ] **Step 5.3 — Commit**

```bash
git add src/modules/corner/pages/Livraison.tsx
git commit -m "feat(livraison): add AC inline toggle on historique cards"
```

---

### Task 6 — Modals ActionCorrectiveModal en bas du JSX

**Files:**
- Modify: `src/modules/corner/pages/Livraison.tsx` — juste avant la fermeture du modal `ncModal` (vers ligne ~1200) ou après le dernier modal existant

- [ ] **Step 6.1 — Localiser le dernier modal existant**

```bash
grep -n "photoModal && (\|ncModal && (\|{photoModal\|{ncModal" src/modules/corner/pages/Livraison.tsx
```

Repérer où se terminent les modals existants (avant le `</div>` final qui ferme tout le composant).

- [ ] **Step 6.2 — Insérer les 2 modals AC**

Après le dernier modal existant, avant le `</div>` final du composant :

```tsx
      {/* ── MODAL AC — ajout ── */}
      {livAcModal && (
        <ActionCorrectiveModal
          payload={livAcModal}
          createdByName={user?.displayName ?? ''}
          onClose={() => setLivAcModal(null)}
          onSaved={() => {
            loadLivAcs(livAcModal.refId)
            setLivAcModal(null)
          }}
        />
      )}

      {/* ── MODAL AC — édition/suppression ── */}
      {editAc && acExpandedId && (
        <ActionCorrectiveModal
          payload={{
            type: 'temperature_reception',
            date: editAc.date,
            refId: editAc.id,
            problem: editAc.problem,
          }}
          createdByName={user?.displayName ?? ''}
          onClose={() => setEditAc(null)}
          onSaved={() => {
            loadLivAcs(acExpandedId)
            setEditAc(null)
          }}
          editId={editAc.id}
          initialAction={editAc.action}
          canDelete={isManagerRole}
          onDeleted={() => {
            loadLivAcs(acExpandedId)
            setEditAc(null)
          }}
        />
      )}
```

- [ ] **Step 6.3 — Commit**

```bash
git add src/modules/corner/pages/Livraison.tsx
git commit -m "feat(livraison): add AC add/edit modals"
```

---

### Task 7 — Build & deploy

- [ ] **Step 7.1 — TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -E "error TS|Livraison"
```

Résultat attendu : aucune ligne `error TS` concernant `Livraison.tsx`. Corriger toute erreur de typage avant de continuer.

- [ ] **Step 7.2 — Build**

```bash
npm run build 2>&1 | tail -20
```

Résultat attendu : `✓ built in Xs` sans erreurs.

- [ ] **Step 7.3 — Deploy**

```bash
firebase deploy --only hosting
```

- [ ] **Step 7.4 — Test manuel**

1. Ouvrir `/corner/livraison` sur l'iPad Corner ou le navigateur.
2. Aller sur l'onglet "Aujourd'hui" → section "Complétées aujourd'hui".
3. Cliquer "📋 Actions correctives ▶" sur une card → section s'ouvre, bouton "➕ Ajouter".
4. Ajouter une AC → modal s'ouvre, sauvegarder → AC apparaît dans la section.
5. Cliquer ✏️ (si rôle manager/patron) → modal edit avec pré-remplissage.
6. Aller sur l'onglet "Historique", choisir une date → même comportement sur les cards.
7. Aller sur Contrôle → générer un rapport sur la même période → les ACs livraison apparaissent dans la section "📝 Actions correctives".

- [ ] **Step 7.5 — Commit final**

```bash
git add -A
git commit -m "feat(livraison): AC inline déployé — cards done + historique + modals"
```

---

## Self-review

**Couverture spec :**
- ✅ Cards "Complétées aujourd'hui" → Task 4
- ✅ Cards "Historique" → Task 5
- ✅ `acExpandedId`, `livAcs`, `livAcModal`, `editAc` → Task 1
- ✅ `AcItem` type avec `date` (nécessaire pour edit) → Task 1
- ✅ `loadLivAcs(id)` query par `refId` → Task 2
- ✅ Toggle expand → Task 4 & 5
- ✅ Bouton ➕ Ajouter → `AcInlineSection` Task 3
- ✅ Bouton ✏️ isManager → `AcInlineSection` Task 3
- ✅ Modals add/edit → Task 6
- ✅ Rapport hygiène → aucune modification nécessaire (query existante dans Controle.tsx)

**Type consistency :**
- `AcItem.date` défini Task 1 → utilisé Task 6 (`editAc.date`) ✅
- `isManagerRole` (existant ligne 366) → utilisé Task 4, 5 (pas de doublon) ✅
- `AcPayload` importé depuis `ActionCorrectiveModal` → utilisé Task 3, 6 ✅
- `loadLivAcs` défini Task 2 → appelé Task 4, 5, 6 ✅
