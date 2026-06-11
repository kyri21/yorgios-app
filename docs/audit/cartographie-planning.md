# Cartographie — Module PLANNING (audit Phase 0, 2026-06-12, commit 9cc9137)

## Vue principale : PlanningModule (index.tsx:194)

| Bouton | Ligne | Visibilité | Handler |
|--------|-------|-----------|---------|
| Semaine/Mois | 287-299 | Toujours | `setView()` |
| ◀/▶ semaine | 303, 307 | `view==='week'` | `planning.goToWeek(prev/nextMonday())` |
| Input date semaine | 308-309 | `view==='week'` | `planning.goToWeek(mondayOf(date))` |
| ◀/▶ mois | 315, 319 | `view==='month'` | `setCurrentMonth()` |
| ✏️ Absence/événement | 331-347 | `isEditor && week && selectedEmpId` | Ouvre EventModal |
| 💾 Sauvegarder | 350-365 | `isEditor && week` | `planning.save()` — désactivé si `!dirty` |
| ⧉ Dupliquer semaine | 370-405 | `isEditor && week` | `handleDuplicate()` → `duplicateWeek()` |
| 👥 Gérer employés | 406 | `isEditor && week` | EmployeeManager modal |
| ⚡ Extra rapide | 407-411 | `isEditor && week` | QuickExtraModal |
| 🗑 Vider semaine | 412-420 | `isEditor && week` | confirm → `clearCurrentWeek()` |
| ↩ Historique | 424-438 | `isEditor && history.length>0` | `undoTo(entry)` (max 10 snapshots) |
| 📥 Importer | 440 | `isEditor && week` | ImportModal |
| 📤 Exports | 442 | Toujours | CSV semaine / ICS par employé |
| ⏏ Déconnexion | 443 | Toujours | `signOut()` |

## PlanningGrid (Grid/PlanningGrid.tsx:63) — desktop
- Grille 7j × 13h (8-20h), peinture pointer down/enter/up si `canEdit && selectedEmpId`
- Clic droit → EventModal. Aucune écriture Firestore directe (state local via hook).

## MobilePlanningView (Mobile/MobilePlanningView.tsx:66)
- Navigation ‹ › semaine, sélecteur 7 jours, 3 sections (travaillent / événement / repos)
- Tap employé → bottom sheet : selects Début/Fin (**bloc continu uniquement** ≠ peinture desktop), Appliquer, Repos, ajout/retrait événements
- 💾 Enregistrer visible si `canEdit && dirty` (363-376)

## EventModal (Events/EventModal.tsx:33)
- Onglet Ajouter : types jour_off/conge/sans_solde/absence/retard/malade ; retard→minutes, malade/parti_tot→hours
- Congé : bloqué < 1 mois sauf patron/admin/manager (`canBypassMonthCheck`)
- Onglet Modifier/Supprimer : détection events sur plage, Remplacer (`onReplace`) ou Supprimer tous

## MonthlyView + PrimesTab
- Stats par employé×semaine, exports Excel (`exportMonthlyExcel` + primesMap) / PDF
- PrimesTab : paliers CA + contrats éditables (panneau ⚙️ si canEdit), toggles comportement/ponctualité par employé
- Save primes : 3 écritures `primes_mois`, `primes_employe/{empId}_{month}`, `settings/primes_ca` + `settings/contrats` — try/catch ✅ surfacé (`setSaveError`)

## EmployeeManager (Employees/EmployeeManager.tsx:16)
- Liste : + Ajouter / ⏸ Suspendre / ✏️ Éditer / 🗑 Supprimer (= `deactivateEmployee`, soft delete)
- Édition : nom, statut (stagiaire/alternant/extra), initiales, couleur, heures contrat, primes custom (`deleteField()` si vidé), avenants, indisponibilités
- `createEmployee`/`updateEmployee` passent par `stripUndefined()` ✅ ; erreur surfacée ✅

## ImportModal (Import/ImportModal.tsx:27)
- Étapes upload→resolve→preview→preview-grid→importing→done ; CSV + ICS ; modes merge/replace

## Firestore — écritures

| Collection | Op | Fichier:ligne | Catch surfacé ? |
|------------|----|---------------|-----------------|
| planningWeeks/{wid} + days | writeBatch.set | firebase/planning.ts:60-81 | ❌ non (hook sans try/catch) |
| planningWeeks/.../events | writeBatch.set | planning.ts:103-117 | ❌ non |
| employees | addDoc/updateDoc | employees.ts:45-59 | ✅ via EmployeeManager |
| primes_mois / primes_employe | setDoc | primes.ts:25-38 | ✅ via PrimesTab |
| settings/primes_ca + contrats | setDoc | PrimesTab.tsx:136-137 | ✅ |

## ⚠️ Anomalies

### Critiques
1. **`usePlanning.save()` (314-329) et `loadCurrentWeek()` sans try/catch** → échec réseau = échec silencieux, `dirty` peut rester incohérent. Concerne desktop ET mobile (même hook).
2. **Import non atomique** (doImport:120-162) : boucle `await saveWeek()` sans batch → import partiel possible.

### Majeures
3. PrimesTab.tsx:104-106 : `.catch(() => setLoading(false))` muet au chargement.
4. EventModal.tsx:258-260 : `minutes`/`hours` peuvent valoir `undefined` dans l'objet event sans stripUndefined avant save (risque règle 14/Firestore undefined).
5. Divergence desktop (peinture incrémentale) vs mobile (bloc continu) — documentée et validée par Arthur, mais à garder en tête pour les tests.

### Mineures
6. Historique limité à 10 snapshots (usePlanning.ts:326).
7. Pas de retry réseau nulle part ; pas de memoization PlanningGrid (91 cellules re-render).
8. eslint-disable sur deps useEffect (index.tsx:225, MobilePlanningView.tsx:87).
9. Validation avenants : `effectiveDate: ''` acceptée.
