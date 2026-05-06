# Spec — AC inline dans Livraison Corner

**Date :** 2026-05-06
**Statut :** Approuvé

## Objectif

Ajouter des sections "Actions correctives" inline sur chaque card de livraison (onglets "Complétées aujourd'hui" et "Historique"), suivant exactement le pattern déjà déployé dans Températures Corner.

## Fichier concerné

`src/modules/corner/pages/Livraison.tsx` — seul fichier modifié.

## Nouveaux types et états

```typescript
type AcItem = {
  id: string
  problem: string
  action: string
  createdByName?: string
  createdAt?: any
}

const [acExpandedId, setAcExpandedId] = useState<string | null>(null)
const [livAcs, setLivAcs]             = useState<Record<string, AcItem[]>>({})
const [livAcModal, setLivAcModal]     = useState<AcPayload | null>(null)
const [editAc, setEditAc]             = useState<AcItem | null>(null)
```

`isManager` est déjà disponible en dehors — ajouter :
```typescript
const isManager = ['patron', 'administrateur', 'manager'].includes(user?.role ?? '')
```

## Fonction de chargement

```typescript
async function loadLivAcs(id: string) {
  const q = query(collection(db, 'actions_correctives'), where('refId', '==', id))
  const snap = await getDocs(q)
  setLivAcs(prev => ({
    ...prev,
    [id]: snap.docs.map(s => ({ id: s.id, ...s.data() })) as AcItem[]
  }))
}
```

Appelée au premier expand (lazy) et après chaque save/delete.

## Toggle sur les cards

Ajouté **en bas de chaque card** dans `done.map()` et `histLivraisons.map()` :

```tsx
{/* Section AC */}
<div style={{ marginTop: 8, borderTop: '1px solid var(--border-soft)', paddingTop: 8 }}>
  <button
    onClick={() => {
      const next = acExpandedId === l.id ? null : l.id
      setAcExpandedId(next)
      if (next && livAcs[l.id] === undefined) loadLivAcs(l.id)
    }}
    style={{ fontSize: 12, color: 'var(--primary)', background: 'none', border: 'none',
             cursor: 'pointer', fontWeight: 600, fontFamily: 'Manrope, sans-serif' }}
  >
    📋 Actions correctives{livAcs[l.id]?.length ? ` (${livAcs[l.id].length})` : ''}
    {acExpandedId === l.id ? ' ▲' : ' ▶'}
  </button>

  {acExpandedId === l.id && (
    <AcInlineSection
      livId={l.id}
      receptionAt={l.receptionAt}
      acs={livAcs[l.id] ?? []}
      isManager={isManager}
      onAdd={(payload) => setLivAcModal(payload)}
      onEdit={(ac) => setEditAc(ac)}
    />
  )}
</div>
```

## Composant local AcInlineSection

Petit composant interne (dans le même fichier) pour lisibilité :

```tsx
function AcInlineSection({ livId, receptionAt, acs, isManager, onAdd, onEdit }: {
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
        <div key={ac.id} className="card" style={{ padding: '10px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger)' }}>{ac.problem}</div>
            {isManager && (
              <button onClick={() => onEdit(ac)}
                style={{ padding: '3px 7px', borderRadius: 7, border: '1px solid var(--border)',
                         background: 'var(--surface-low)', cursor: 'pointer', fontSize: 11 }}>✏️</button>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--on-surface)', lineHeight: 1.4 }}>{ac.action}</div>
          <div style={{ fontSize: 10, color: 'var(--on-surface-3)', marginTop: 4 }}>
            par {ac.createdByName || '—'}
          </div>
        </div>
      ))}
      <button
        onClick={() => onAdd({ type: 'temperature_reception', date: dateISO, refId: livId, problem: '' })}
        style={{ fontSize: 11, color: 'var(--primary)', background: 'none', border: '1px dashed var(--primary)',
                 borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontWeight: 600,
                 fontFamily: 'Manrope, sans-serif', alignSelf: 'flex-start' }}
      >➕ Ajouter une AC</button>
    </div>
  )
}
```

## Modals en bas du composant principal

```tsx
{livAcModal && (
  <ActionCorrectiveModal
    payload={livAcModal}
    createdByName={user?.displayName ?? ''}
    onClose={() => setLivAcModal(null)}
    onSaved={() => { loadLivAcs(livAcModal.refId); setLivAcModal(null) }}
  />
)}
{editAc && acExpandedId && (
  <ActionCorrectiveModal
    payload={{ type: 'temperature_reception', date: new Date().toISOString().slice(0,10), refId: editAc.id, problem: editAc.problem }}
    createdByName={user?.displayName ?? ''}
    onClose={() => setEditAc(null)}
    onSaved={() => { loadLivAcs(acExpandedId); setEditAc(null) }}
    editId={editAc.id}
    initialAction={editAc.action}
    canDelete={isManager}
    onDeleted={() => { loadLivAcs(acExpandedId); setEditAc(null) }}
  />
)}
```

## Intégration rapport Contrôle

**Aucune modification nécessaire.** `Controle.tsx` query déjà `actions_correctives where date >= from && date <= to`. Les ACs livraison auront `date = receptionAt.toISOString().slice(0,10)` → incluses automatiquement dans le rapport hygiène sur la bonne période.

## Import à ajouter

```typescript
import ActionCorrectiveModal, { type AcPayload } from '../../../components/ActionCorrectiveModal'
```

## Résumé des changements

| Quoi | Où | Lignes estimées |
|------|----|----------------|
| Import ActionCorrectiveModal | Ligne 2-3 | +1 |
| Type AcItem | Après LivrDoc | +5 |
| 4 nouveaux useState + isManager | Bloc états | +6 |
| Fonction loadLivAcs | Après load() | +8 |
| Toggle + section dans done.map() | ~ligne 734 | +15 |
| Toggle + section dans histLivraisons.map() | ~ligne 900 | +15 |
| Composant AcInlineSection | Avant export default | +35 |
| 2 modals en bas du JSX | Avant dernier </div> | +20 |
