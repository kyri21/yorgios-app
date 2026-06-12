# D1 — Brancher les permissions pour de vrai (UI + rules) — PLAN — 2026-06-12

> Décision Arthur : « Brancher vraiment (UI + rules) ». Chantier en 2 tranches.
> ⚠️ La tranche 2 (rules) touche les `delete` Firestore → **risque de lockout** → à exécuter en session dédiée avec test par rôle.

## Structure existante (PermissionsContext.tsx)
- 17 permKeys : 6 `page_*` (déjà câblées sidebar/grid), 7 `action_*`, 4 `field_*`.
- `can(role, key)` : `true` pour patron/administrateur ; sinon lit `settings/permissions[role][key]`, défaut `false`.
- Doc Firestore `settings/permissions` : `{ manager: {...}, corner: {...}, cuisine: {...} }` (édité par AdminPermissions, merge avec DEFAULT_PERMISSIONS).

## TRANCHE 1 — UI (sûr, réversible, aucun risque lockout)
Consommer `usePermissions().can(user.role, key)` pour masquer/désactiver. Points de câblage :

| permKey | Fichier | Élément à gater |
|---------|---------|-----------------|
| action_create_commande | corner/Commandes.tsx | bouton « Enregistrer la commande » (form) |
| action_update_statut_commande | corner/Commandes.tsx | changement de statut (onglet Gestion) |
| action_delete_commande | corner/Commandes.tsx | bouton supprimer commande |
| action_derogation_temp | corner/Livraison.tsx | bouton « Accepter (dérogation) » (~l.870) |
| action_delete_lot | cuisine/Fabrication.tsx | bouton 🗑 supprimer lot (~l.1020) |
| action_delete_livraison | corner/Livraison.tsx + cuisine/Livraisons.tsx | bouton « Supprimer » |
| action_delete_ac | components/ActionCorrectiveModal.tsx | bouton supprimer AC (`canDelete`) |
| field_prix_estime | Commandes (form + gestion) | champ prix estimé |
| field_notes_cuisine | Commandes | champ notes cuisine |
| field_notes_manager | Commandes | champ notes manager |
| field_createur_lot | cuisine/Fabrication.tsx | affichage `creatorName` |

Note : aujourd'hui ces boutons sont souvent gardés par un check rôle en dur (ex. `isManager`). La tranche 1 remplace ces checks par `can(role, key)` — comportement identique tant que `settings/permissions` = défauts, mais devient configurable.

## TRANCHE 2 — Rules Firestore (RISQUÉ — session dédiée + tests)
Faire gouverner les `delete`/dérogation par `settings/permissions`. Motif **anti-lockout obligatoire** :

```
function perm(key) {
  // fail-OPEN vers le défaut métier si le doc/clé manque, JAMAIS lockout
  let p = get(/databases/$(database)/documents/settings/permissions).data;
  return p[request.auth.token.role_or_lookup][key];
}
```
Problèmes à résoudre avant d'écrire :
1. Le rôle n'est pas dans le token → il faut `get(/users/$(uid)).data.role` (déjà fait via `role()`).
2. `get()` d'un doc absent lève une erreur → wrapper avec `exists()` et **fallback permissif** (garder le comportement actuel si pas de doc).
3. Chaque `delete` concerné (lots_cuisine, livraisons, non_conformites, actions_correctives) doit garder son comportement actuel comme fallback.
4. Coût : +1 `get()` par évaluation de règle.

**Décision Arthur (2026-06-12) : FAIL-OPEN.** Si `settings/permissions` est absent/incomplet → autoriser comme aujourd'hui. Une permission n'est appliquée par les règles que si elle est explicitement présente et `false`. Pattern :
```
function permAllows(key) {
  let pdoc = /databases/$(database)/documents/settings/permissions;
  return !exists(pdoc)
      || !(role() in get(pdoc).data)
      || !(key in get(pdoc).data[role()])
      || get(pdoc).data[role()][key] == true;  // absent/true ⇒ autorisé (fail-open)
}
```
Appliquer en `&&` sur les `delete` concernés (lots_cuisine, livraisons, non_conformites, actions_correctives) — en gardant aussi le garde de rôle existant. patron/administrateur restent toujours autorisés (role() les couvre déjà dans les défauts).

## Recommandation de séquencement
1. Tranche 1 (UI) : ~5 fichiers, réversible → peut se faire maintenant ou en session dédiée.
2. Tranche 2 (rules) : session dédiée, idéalement avec l'émulateur Firestore (`firebase emulators:start`) pour tester chaque rôle × chaque delete AVANT déploiement prod.
3. Tester : avec les 3 comptes audit (corner/cuisine/manager), décocher une perm dans AdminPermissions → vérifier UI masquée ET delete refusé côté serveur.
