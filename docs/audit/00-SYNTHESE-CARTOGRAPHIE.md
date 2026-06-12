# Audit Matias — Phase 0 : Cartographie — SYNTHÈSE

> Générée le 2026-06-12 sur commit `9cc9137` (snapshot pré-audit).
> Détail par zone : voir les 5 fichiers `cartographie-*.md` de ce dossier.
> **Rien n'est corrigé à ce stade — toutes les anomalies attendent validation d'Arthur.**

## Méthode

5 subagents Explore en parallèle ont cartographié : module planning, module corner,
modules cuisine+CRM, pages globales/admin/router, backend (rules + Cloud Functions).
Les affirmations à fort impact ont été contre-vérifiées manuellement.

### Faux positifs déjà écartés (NE PAS retraiter)
- ❌ « ActionCorrectiveModal.tsx inexistant » → FAUX, le fichier existe (`src/components/ActionCorrectiveModal.tsx`)
- ❌ « PermissionsProvider non branché » → FAUX, branché dans `src/App.tsx:9`

### Confirmées manuellement ✅
- ✅ `functions/src/index.ts:52` : `process.env.YORGIOS_WP_SECRET || 'matias-fallback-secret'` — fallback secret en dur
- ✅ `sendPasswordReset` (functions/src/index.ts:877+) : **aucune vérification `request.auth` ni rôle** — n'importe qui peut déclencher des emails de reset vers n'importe quelle adresse

## TOP anomalies (pré-classement, à re-vérifier en Phase 1)

### 🔴 P0 — Sécurité / intégrité
| # | Anomalie | Localisation | Statut |
|---|----------|--------------|--------|
| 1 | Secret fallback `'matias-fallback-secret'` si env absent → tokens HMAC emails prédictibles | functions/src/index.ts:52 | ✅ confirmé |
| 2 | `sendPasswordReset` sans check auth/rôle → spam reset possible sur tout email | functions/src/index.ts:877 | ✅ confirmé |
| 3 | Tokens HMAC tronqués à 32 chars (`.slice(0, 32)`) | functions/src/index.ts:53 | à vérifier |
| 4 | CF callable sans check rôle : `sendGmaoEmail`, `syncContactToBrevo`, `onCommandePrete`, `validatePromoCode` | functions/src/index.ts | à vérifier |
| 5 | `commandes_externes` create public sans tél. obligatoire → anti-spam contournable | rules:148 + index.ts:192 | à vérifier |
| 6 | RGPD : formulaire public `/commande` collecte PII sans consentement explicite stocké | CommandePublique + onNewCommande | à vérifier (la page /rgpd existe, vérifier le lien/checkbox) |

### 🟠 P1 — Bugs / fiabilité (le pattern « bouton qui ne marche pas »)
| # | Anomalie | Localisation |
|---|----------|--------------|
| 7 | `usePlanning.save()` SANS try/catch → échec silencieux de la sauvegarde planning (desktop ET mobile) | usePlanning.ts:314-329 |
| 8 | `Hygiene.tsx` : erreur de sauvegarde via `alert()` uniquement, écriture sans surface d'erreur propre | corner/Hygiene.tsx:197 |
| 9 | `AnnonceGate` : `catch {}` silencieux sur la confirmation de lecture → l'employé croit avoir lu, Firestore non mis à jour | AnnonceGate.tsx:51 |
| 10 | `useAuth` : `catch` silencieux sur getDoc profil → déconnexion silencieuse si réseau faible | auth/useAuth.ts:38 |
| 11 | `DailyPointageGate` : catch muet sur le check « déjà pointé » → double pointage possible | DailyPointageGate.tsx:72 |
| 12 | Livraisons cuisine : `setDoc(livraison)` + `updateDoc(lot.sent)` non atomiques (2 écritures séquentielles) → incohérence si crash | cuisine/Livraisons.tsx:389-418 + removeDepart 599-611 |
| 13 | Import planning non atomique (boucle saveWeek sans batch) | ImportModal doImport:120-162 |
| 14 | EventModal : `minutes/hours: undefined` possibles dans weekEvents sans stripUndefined | EventModal.tsx:258-260 |
| 15 | `DailyPointageGate` teste un rôle `'chef'` qui n'existe pas | DailyPointageGate.tsx:34 |

### 🟡 P2 — Performance (app « perçue lente », signalé 2026-05-07)
| # | Anomalie | Localisation |
|---|----------|--------------|
| 16 | N+1 : 1 query `actions_correctives` PAR livraison REFUSE | corner/Livraison.tsx:261-267 |
| 17 | Corner Dashboard : `getDocsFromServer` 200 livraisons + 200 corner_stock + 10 getDoc temp + 3 hygiene à CHAQUE ouverture | corner/Dashboard.tsx:166-183 |
| 18 | Controle corner : charge TOUS les docs (temperatures, livraisons, NC, corner_stock, hygiene) sans limit ni where date | corner/Controle.tsx:352-395 |
| 19 | Reception cuisine historique : `getDocs(receptions)` SANS limit | cuisine/Reception.tsx:187 + ReceptionHistorique.tsx:44 |
| 20 | `catalogue` rechargé en full scan (`getDocsFromServer`) sur Dashboard cuisine, Fabrication, Livraisons | cuisine/Dashboard.tsx:225, Fabrication.tsx:189, Livraisons.tsx:252 |
| 21 | Index composites manquants probables : commandes_externes (dateLivraison+statut), pointages | firestore.indexes.json |

### 🔵 P3 — Nettoyage / architecture
| # | Sujet | Détail |
|---|-------|--------|
| 22 | `AdminDocuments.tsx` orphelin (confirmé CLAUDE.md) — mais l'agent global dit qu'une route existerait encore : à trancher | src/pages/AdminDocuments.tsx |
| 23 | Rules orphelines : `notifications_log`, `corner_commandes`, `hygiene_cuisine`, `lot_counters`(?) — collections sans usage client trouvé | firestore.rules |
| 24 | `ruptures_actives` : delete interdit + aucun cleanup scheduled → accumulation infinie | rules:129 |
| 25 | Emails destinataires hardcodés en fallback dans ~8 CF au lieu de settings | functions/src/index.ts multiples |
| 26 | `alert()` restants (Livraisons cuisine ×4, Controle cuisine, Hygiene corner) au lieu de toasts | voir détails |
| 27 | Chantier permissions (AdminPermissions + PermissionsContext) : fonctionnel mais partiel — perms appliquées sidebar+grid, pas dans les pages elles-mêmes | src/contexts/, src/pages/AdminPermissions.tsx |
| 28 | 3 notions de « livraison » dans la nav (coursier /livraisons, corner/livraison, cuisine/livraisons) — confusion UX | Phase 3 |

## Avancement des phases (MAJ 2026-06-12)
- ✅ **Phase 0** — cartographie : `00-SYNTHESE` + 5 `cartographie-*.md`
- ✅ **Phase 1** — statique : `01-statique.md` (cluster sécurité P0 confirmé ; découverte clé : permissions cosmétiques ; 1 faux positif Phase 0 corrigé)
- ✅ **Phase 2 volet WEB** — `02-dynamique-web.md` : socle sain (0 erreur console), bundle 1 Mo, 2 retouches UX responsive. 2 comptes test créés + cloisonnement corner validé.
- ✅ **Phase 2 volet MOBILE** — `02-dynamique-mobile.md` : planning éditable iPhone VALIDÉ, isolation corner+cuisine+**manager** OK (W5: manager+settings=échec silencieux), GdprConsentModal + DailyPointageGate confirmés. Reste optionnel : compléter un pointage, service worker, FCM, ajout absence mobile, reproduire M4.
- 🟡 **Phase 3** — `03-ux-architecture.md` + `PRODUCT.md` créés : 17 items UX/archi priorisés (U1-U17). **Reste : passe visuelle fine /impeccable écran par écran (session dédiée, navigateur + captures).**
- ⬜ **Phase 4** — SYNTHESE finale avec GO/NO-GO d'Arthur item par item, puis exécution des correctifs validés. **C'est l'étape où Arthur tranche chaque ☐.**

### Comptes test (à supprimer en fin d'audit)
`audit.corner@yorgios.fr`, `audit.cuisine@yorgios.fr`, `audit.manager@yorgios.fr` — mots de passe communiqués à Arthur en privé.

### Comptes test (à supprimer en fin d'audit)
`audit.corner@yorgios.fr` (corner) et `audit.cuisine@yorgios.fr` (cuisine). Mots de passe communiqués à Arthur en privé.

### Prompt de reprise (nouvelle session)
> Audit Matias — reprendre à la fin de la Phase 2-mobile. Lis docs/audit/00-SYNTHESE + 01-statique + 02-dynamique-web + 02-dynamique-mobile. MobAI est bridgé sur l'iPhone d'Arthur (device id 00008110-000E44E814DB801E). Finir Phase 2-mobile : pointage géoloc (DailyPointageGate), bannière service-worker « nouvelle version », push FCM, ajout d'absence via le bouton 🤒 du bottom sheet, et isolation des rôles cuisine (audit.cuisine@yorgios.fr) + manager. Puis Phase 3 : créer PRODUCT.md puis /impeccable sur le flux retrait DLC vitrine (12 produits périmés en prod) + corriger M1 (bundle 1 Mo + skeleton 30s) et M2 (aria-labels). Puis Phase 4 : synthèse GO/NO-GO item par item. RIEN ne se corrige sans accord d'Arthur. Précautions prod : jamais « On s'en occupe », pas de viewed:true ruptures, pas d'action qui envoie emails/FCM réels (REFUSE, NC, congés, commande), planning éditable = ne jamais taper 💾 Enregistrer sur un vrai employé. Pour MobAI : login Arthur kyriazis@outlook.fr (mdp en mémoire), attention au password autofill iOS d'autres comptes (fermer), et au passage en App Switcher (rouvrir Safari via open_app sans fresh).
