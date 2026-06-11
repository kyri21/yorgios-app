# Audit Matias — Phase 1 : Statique (vérifications croisées) — 2026-06-12, commit e8efaa8

> Vérifications manuelles ciblées des items « à vérifier » de la Phase 0 + croisement UI × router × rules.
> **Rien n'est corrigé. Chaque item attend le GO d'Arthur (colonne Décision vide).**

## A. Sécurité backend — items P0 tranchés

| # | Anomalie | Verdict | Preuve | Décision Arthur |
|---|----------|---------|--------|-----------------|
| 1 | Secret HMAC fallback `'matias-fallback-secret'` | ✅ CONFIRMÉ | index.ts:52 — `process.env.YORGIOS_WP_SECRET \|\| 'matias-fallback-secret'` | ☐ |
| 2 | `sendPasswordReset` sans auth ni rôle | ✅ CONFIRMÉ — **aucun `if (!request.auth)`** dans la fonction (≠ toutes les autres CF user) | index.ts:877+ | ☐ |
| 3 | Token HMAC tronqué 32 chars | ✅ CONFIRMÉ | index.ts:53 — `.digest('hex').slice(0, 32)` | ☐ |
| 4a | `sendGmaoEmail` : auth seul, pas de rôle | ✅ CONFIRMÉ | index.ts:1784 — `if (!request.auth)` puis rien | ☐ |
| 4b | `onCommandePrete` : auth seul | ✅ CONFIRMÉ (risque faible) | index.ts:633 | ☐ |
| 4c | `syncContactToBrevo` / `validatePromoCode` : pas de check rôle (délèguent à crm/) | ✅ CONFIRMÉ — wrappers sans `request.auth` visible (2090-2108) | à border : tout employé peut écrire CRM Brevo | ☐ |
| 5 | Anti-spam commandes contournable | ✅ CONFIRMÉ — `if (telephone)` : tél. vide = **aucun contrôle** ; seuil `> 3` = 4 autorisées ; pas d'index (filtre mémoire) | index.ts:189-211 | ☐ |
| 6 | RGPD : `/commande` sans consentement | ✅ CONFIRMÉ — **aucune checkbox, aucun `consentAt` stocké, aucun lien /rgpd** ; juste un texte statique « Vos données sont utilisées… » | CommandePublique.tsx:158 | ☐ |

### Contre-épreuve : CF correctement protégées (ne pas toucher)
createUser/deleteUser/updateUserEmail/setUserDisabled (patron/admin, index.ts:926…1039), updateUserPassword (admin only, 990), sendNightlyRupturesNow/previewNightlyRuptures (2039/2058), createPointage (manager exclu, 2173-2175). ✅

## B. UI × router × rules — croisement par rôle

### Routes (router/index.tsx) — divergences avec la table CLAUDE.md
| Route | Rôles réels (router) | Table CLAUDE.md | Verdict |
|-------|---------------------|-----------------|---------|
| `/pointage` | patron, admin, cuisine, corner (manager exclu, l.110) | « tous sauf manager » | ✅ CONCORDE (faux positif Phase 0) |
| `/ca` | + corner + cuisine en lecture (l.90, commenté volontaire) | « patron, admin, manager » | ⚠️ Doc périmée, pas un bug |
| `/admin/allergenes` | les 5 rôles (l.190, commenté « info utile pour tous ») | « patron, admin, manager » | ⚠️ Doc périmée, pas un bug |
→ **Action douce** : mettre à jour la table des routes dans CLAUDE.md (pas de code). ☐

### Règles Firestore trop permissives (écart UI/intention vs serveur)
| Collection | Règle | Risque | Décision |
|------------|-------|--------|----------|
| `temperatures` | create/update = **isAnyRole** | un compte corner peut écrire une temp cuisine et inversement | ☐ |
| `livraisons` | update = **isCorner** sans restriction de champ | corner peut modifier `departTempC` (donnée cuisine) | ☐ |
| `lots_cuisine` | update/delete = **isAnyRole** | voulu (ouvert le 2026-05-06) — à garder | ✅ intentionnel |
| `annonces` | update = `isPatronOrManager() OR isAnyRole()` ≡ isAnyRole | nécessaire pour `readBy` mais autorise tout champ | ☐ |
| `actions_correctives` | create = isAnyRole | OK (cuisine+corner documentent) | ✅ |

## C. 🔑 Découverte structurante — le chantier permissions ne protège rien côté serveur

`AdminPermissions` écrit `settings/permissions`, et `PermissionsContext` masque des liens de menu selon `can(role, permKey)`. **Mais :**
1. **Aucune règle Firestore ne lit `settings/permissions`** → décocher « supprimer une livraison » pour un manager masque le bouton, mais le manager peut toujours écrire via la console/un autre client. C'est de la sécurité **cosmétique**.
2. Les permKeys `action_*` (7) et `field_*` (4) ne sont **consommées dans aucune page** — seules les `page_*` filtrent la sidebar/grille.
→ Décision à prendre : (a) brancher les `action_*`/`field_*` dans les pages + (b) refléter `settings/permissions` dans les rules, OU (c) assumer que c'est purement de l'affichage et le documenter comme tel. ☐

## D. Échecs silencieux (silent failures) — localisés Phase 0, confirmés
| Fichier:ligne | Problème | Gravité | Décision |
|---------------|----------|---------|----------|
| usePlanning.ts:314-329 | `save()` + `loadCurrentWeek()` sans try/catch → sauvegarde planning échoue sans message | 🟠 | ☐ |
| AnnonceGate.tsx:51 | `catch {}` sur updateDoc readBy → lecture annonce non enregistrée silencieusement | 🟠 | ☐ |
| auth/useAuth.ts:38 | catch silencieux getDoc profil → déconnexion silencieuse si réseau faible | 🟠 | ☐ |
| DailyPointageGate.tsx:72 | catch muet check « déjà pointé » → double pointage possible | 🟠 | ☐ |
| corner/Hygiene.tsx:197 | erreur save via `alert()` seul | 🟡 | ☐ |
| AdminSettings.tsx (multiple) | setDoc merge sans surface d'erreur | 🟡 | ☐ |
| cuisine : Reception/Fabrication/Temperatures | catch muets (historique, traçabilité, loadWeek, loadAcForDate) | 🟡 | ☐ |

## E. Intégrité données — écritures non atomiques
| Fichier:ligne | Problème | Décision |
|---------------|----------|----------|
| cuisine/Livraisons.tsx:389-418 | `setDoc(livraison)` puis `updateDoc(lot.sent)` séquentiels — crash entre les deux = incohérence | ☐ |
| cuisine/Livraisons.tsx:599-611 | `deleteDoc(livraison)` puis `updateDoc(lot)` — idem | ☐ |
| planning ImportModal:120-162 | boucle `saveWeek` sans batch → import partiel | ☐ |
| cuisine/Fabrication.tsx:350-360 | anti-doublon lotCode non transactionnel (check puis set) — race | ☐ |
→ Remède commun proposé : `writeBatch` ou `runTransaction`. À valider.

## F. Performance (app « lente ») — causes confirmées, remèdes proposés
| Fichier:ligne | Cause | Remède proposé | Décision |
|---------------|-------|----------------|----------|
| corner/Livraison.tsx:261-267 | N+1 : 1 getDocs AC par livraison REFUSE | 1 query `where refId in [...]` (chunks de 10) ou charger à l'expand | ☐ |
| corner/Controle.tsx:352-395 | full-scan toutes collections sans limit/where | `where date >=/<=` Firestore + index | ☐ |
| cuisine/Reception.tsx:187, ReceptionHistorique.tsx:44 | `getDocs(receptions)` sans limit | limit + pagination ou where date | ☐ |
| cuisine Dashboard:225 / Fabrication:189 / Livraisons:252 | `catalogue` full-scan `getDocsFromServer` | cache (le catalogue change rarement) — getDocs + staleTime, ou contexte partagé | ☐ |
| corner/Dashboard:166-183 | 200 livraisons + 200 stock + 13 getDoc à chaque ouverture | filtre date + réduire limit | ☐ |
| firestore.indexes.json | index composites probables manquants (commandes_externes dateLivraison+statut) | à confirmer via erreurs console Phase 2 | ☐ |

## Bilan Phase 1
- **0 faux positif nouveau** ; 1 faux positif Phase 0 corrigé (`/pointage` concorde).
- Le cluster sécurité P0 (#1-6) est **entièrement confirmé** dans le code.
- La découverte la plus importante n'est pas une faille isolée mais **structurelle** (section C) : le système de permissions est cosmétique.
- Prochaine étape : Phase 2 — vérifier en conditions réelles (rendu, perf mesurée, mobile). Web : tenté en headless. Mobile : nécessite MobAI + iPhone d'Arthur.
