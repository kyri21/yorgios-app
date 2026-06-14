# Rapport final — Audit complet Matias PWA

> **Audit mené du 2026-06-12 au 2026-06-13, clos le 2026-06-13.**
> Règle appliquée tout du long : *rien n'a été corrigé sans accord explicite d'Arthur*.
> Base de départ : commit `9cc9137` (snapshot pré-audit). Projet `cuisine-yorgios`, DB Firestore `test`.
> Tous les correctifs sont **déployés en prod** (`firebase deploy --only hosting` / `:functions`) et, pour les écrans visuels, **validés en local par Arthur** avant déploiement. Plusieurs items validés on-device (MobAI, iPhone 13 Pro).

Ce document est le point d'entrée pour comprendre **ce qui a été modifié et amélioré**. Détails de raisonnement dans les autres fichiers `docs/audit/` (cartographies, synthèses, décisions A-G).

---

## 1. Méthode (5 phases)

| Phase | Contenu | Livrable |
|-------|---------|----------|
| 0 — Cartographie | 5 zones de l'app, 28 anomalies pré-classées | `00-SYNTHESE-CARTOGRAPHIE.md`, `cartographie-*.md` |
| 1 — Statique | Lecture code, cluster sécurité P0, permissions cosmétiques | `01-statique.md` |
| 2 — Dynamique | Smoke test web + mobile, isolation des 3 rôles (comptes test) | `02-dynamique-web.md`, `02-dynamique-mobile.md` |
| 3 — UX/archi | 17 items priorisés (U1-U17) + passe visuelle | `03-ux-architecture.md`, `03b-passe-visuelle.md`, `PRODUCT.md` |
| 4 — Synthèse | Registre de décisions A-G, exécution des GO | `04-SYNTHESE-DECISIONS.md` |

---

## 2. Sécurité — Lot A + dérivés (déployé 2026-06-12)

Findings P0 confirmés au scan statique, tous corrigés :

| Réf | Problème | Correctif | Commit |
|-----|----------|-----------|--------|
| A1 | Secret HMAC fallback `'matias-fallback-secret'` en dur (`functions/src/index.ts`) | Secret obligatoire via env, plus de fallback | `e8ffba1` |
| A2 | `sendPasswordReset` callable sans auth ni contrôle de rôle | Réservé à `administrateur` seul (corrige escalade patron→admin) | `c41a9b4` |
| A3 | Token HMAC tronqué à 32 caractères | Token 64c | `e8ffba1` |
| A4 | Anti-spam commandes contournable avec téléphone vide | Validation tél. renforcée | `e8ffba1` |
| A6 | Un `patron` pouvait agir sur un compte `administrateur` | Anti-escalade : patron ne peut pas toucher un admin | `8b961bc` |
| B4 | Managers ne pouvaient pas écrire `settings` (échec silencieux W5/U4) | Écriture settings ouverte aux managers (rules) | `e8ffba1` |
| G1 | Formulaire public `/commande` sans consentement RGPD | Consentement obligatoire (case à cocher) | `482ee3d` |

**Reste à faire (manuel, Arthur) — A5** : changer son propre mot de passe via `/admin/users` → section « Mot de passe ». C'est le seul item non clos de tout l'audit.

Build functions compilé et déployé : `b3f5831`.

---

## 3. D1 — Permissions branchées pour de vrai (déployé 2026-06-12 soir)

**Problème** : les permissions étaient *cosmétiques*. Les rules Firestore ne lisaient pas `settings/permissions` et les `permKeys` (`action_*`, `field_*`) n'étaient câblées nulle part.

**Correctif** (`27eaced`, vérif `99e70ef`) :
- **UI** : `can(role, key)` câblé dans Commandes, Livraison, Fabrication, Livraisons cuisine, Températures (×2).
- **Rules** : helper `permAllows()` **fail-open** (doc manquant → ALLOW, anti-lockout voulu) sur les 4 `delete` sensibles : `lots_cuisine`, `livraisons`, `non_conformites` (clé `action_delete_ac`), `actions_correctives`.
- Tests émulateur : 36/36 (`tests/rules/d1-permissions.test.mjs`, Java 21 requis).
- `firestore.rules` passé au wildcard `{database}` (équivalent ; cible DB `test`).
- Vérifié en prod avec les 3 comptes audit : matrice cohérente, doc `settings/permissions` présent.

---

## 4. Lot C — Performance mobile (déployé 2026-06-13)

Réponse au défaut #1 perçu (« app lente », skeleton 30s). Commit `fd0e094` (branche `perf/lot-c` mergée `--ff-only`).

- **C1 — Vendor chunks** (`vite.config`) : `react-vendor` (165KB) / `firebase` (304KB) / `firebase-firestore` (381KB) séparés et hash-stables → cache CDN durable (11 chunks inchangés au redéploiement).
- **C2 — Persistance + cache-first** : `persistentLocalCache` global (`config.ts`) + planning en cache-first parallèle + **états honnêtes** (timeout 8s / erreur / Réessayer).
- **C3 — N+1 supprimé** : Livraison chargeait les ACs une par une → `fetchLivAcsBatch` (where-in par lots de 30).

**Revue** : Codex (P1/P2/P3 corrigés) + LLM Council (4 modèles, rien de bloquant).
**Validé MobAI iPhone 13 Pro** : cache-first instantané (planning peuplé ~2.8s, plus de skeleton 30s) ; non-perte d'édition confirmée. États honnêtes vérifiés en code (le cache chaud bypasse le chemin on-device). Preuve : `lotc-planning-cachefirst-validated.png`.

⚠️ Note technique : `getDoc` reste server-first même avec persistance ; le cache-first explicite = `getDocFromCache`.

---

## 5. Échecs silencieux — surfacés (déployé 2026-06-13)

Thème transversal de l'audit (objectif #1 de `PRODUCT.md` : *une action doit aboutir ou afficher pourquoi elle échoue*).

| Zone | Avant | Après | Commit |
|------|-------|-------|--------|
| `ActionCorrectiveModal` (HACCP) | save/delete avalés | bandeau d'erreur visible | `7e7f418` |
| `Fabrication` (chargement transfo) | erreur silencieuse | erreur surfacée + logs config | `ed22215` |
| `AdminSettings` / `AdminProduits` | dropdowns échouaient en silence | erreurs remontées | `ed22215` |
| `Commandes` Gestion (`load` + 3 écritures) | `catch{console.error}` muet | état erreur + Réessayer + bandeau ⚠️ | `fd8829b` |
| (rappel session 2026-06-04) `EmployeeManager` | `try/finally` sans catch | catch + bandeau rouge | — |

**Règle durable établie** : ne jamais passer `undefined` à Firestore (omettre la clé ou `stripUndefined`) ; toujours un `catch` qui surface l'erreur sur les écritures.

---

## 6. Refonte visuelle — /impeccable (déployé 2026-06-13)

Skill `impeccable` (anti-AI-slop). Chaque écran : détecteur → critique (score Nielsen /40) → questions de priorité à Arthur → correction → validation locale → déploiement.

| Écran | Score | Changements clés | Commit |
|-------|-------|------------------|--------|
| **Dashboard Corner** | — | Retrait 4 bordures latérales (anti-pattern banni), Commandes ×3→1 carte, grille bas supprimée, hygiène hebdo/mensuel en progressive disclosure, météo démotée, alertes unifiées | `f8a864d` |
| **Livraison Corner** | 36/40 | Onglets scrollables + tap targets ≥44px (retour/suppr/dérogation/✏️), galerie no-silent (erreur+Réessayer), onglet AC réutilise `AcInlineSection` | `541e22a` |
| **Planning mobile** | 33/40 | Retrait 2 side-stripes bannis (`borderLeft 4px`), avatar = seul repère couleur employé | `3bc1443` |
| **Commandes** | 32/40 | Échecs silencieux levés (cf. §5) + grille 4 KPI « BI » → barre récap compacte (terrain pas BI) + autocomplete `produits`→`catalogue` + retrait estimation prix factice | `fd8829b` |

Anti-patterns chassés : bordures latérales colorées, gradient text, glassmorphism, hero-metric, grilles de cartes identiques, em dashes.

---

## 7. Catalogue accessible sur mobile (déployé + validé 2026-06-13)

**Problème** : `/admin/produits` (Catalogue) n'avait **aucun point d'entrée mobile** (absent bottom-nav / onglets / accès rapide).

**Correctif** (`2370d8c`) : Row « Catalogue produits » dans **Profil → Accès rapide** (gardé patron/admin). La page `AdminProduits.tsx` était déjà responsive → aucune refonte.

**Validé sur iPhone via MobAI** : lien présent, page s'ouvre, tout rentre en 390px, 0 débordement. Preuve : `catalogue-mobile-validated.png`.
*(A nécessité 2 relancements PWA : `skipWaiting` active le SW au 1er, sert le nouveau bundle au 2e.)*

---

## 8. Découvertes data (non corrigées — décisions prises)

- **Aucun prix en base** : ni la collection `produits` (88 docs, périmée) ni `catalogue` (105 docs, vivante) n'ont de champ `prix`. L'estimation de prix de Commandes ne se déclenchait donc jamais. **Décision** : feature retirée (devis traiteur = prix négocié, pas qté×PU) plutôt que ressuscitée. Autocomplete rebranché sur `catalogue`.
- **12 produits périmés en vitrine prod** : laissés volontairement → à traiter par les équipes terrain, pas en code.

---

## 9. Clôture (2026-06-13)

- **Comptes de test supprimés** (`d896272`) : `audit.corner@`, `audit.cuisine@`, `audit.manager@yorgios.fr` → Auth + docs `users/`. Confirmé `auth/user-not-found`. Scan préalable : 0 donnée orpheline, 0 doc ZZAUDIT résiduel. **Prod = zéro trace.**
- **Repo** : outil de seed `scripts/audit-fixture.cjs` supprimé ; section « AUDIT EN COURS » de `CLAUDE.md` condensée en « audit clos » ; `docs/audit/` conservé comme archive.

---

## 10. Ce qui reste / pistes futures

- **A5** (manuel, Arthur) : changer son propre mot de passe → Lot A 100% clos.
- **Permissions** : section `/admin/permissions` pour éditer la matrice par rôle existe ; envisager d'étendre `permAllows()` au-delà des 4 deletes si besoin.
- **Prix catalogue** : si un jour l'estimation de devis est souhaitée, seeder les prix dans `catalogue` (lot data dédié).
- **17 items UX U1-U17** : la majorité traités (perf, échecs silencieux, permissions, /impeccable) ; revoir `03-ux-architecture.md` pour le reliquat éventuel.
