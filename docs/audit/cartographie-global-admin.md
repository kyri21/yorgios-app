# Cartographie — Pages globales, admin, router, navigation (audit Phase 0, 2026-06-12, commit 9cc9137)

## Routes (src/router/index.tsx) — vérifié par agent
| Route | Composant | Rôles |
|-------|-----------|-------|
| /login, /rgpd, /commande | Login, Rgpd, CommandePublique | Public |
| /planning/* | PlanningModule | patron, admin, manager, corner |
| /cuisine/* | CuisineModule | patron, admin, manager, cuisine |
| /corner/* | CornerModule | patron, admin, manager, corner |
| /ca | CA | tous rôles (corner/cuisine en readOnly) — ⚠️ CLAUDE.md dit « patron, admin, manager » → divergence à vérifier Phase 1 |
| /messages, /profile, /livraisons, /commandes, /documents, /crm/captation | — | tous |
| /pointage | Pointage | tous (CLAUDE.md dit « sauf manager » → divergence à vérifier) |
| /admin/users, /admin/produits, /admin/permissions | — | patron, admin |
| /admin/settings, /admin/pointages, /admin/annonces, /admin/conges | — | patron, admin, manager |
| /admin/allergenes | AllergeneMenu | tous (CLAUDE.md dit patron/admin/manager → divergence à vérifier) |

## Layout.tsx (1027 l.)
- Sidebar : Planning/Cuisine/Corner/Messages(badge)/Profil/Documents(badge charte+docs)/Pointages/Allergènes/Annonces/Congés/Paramètres — les 3 derniers filtrés par `can(role, permKey)` (PermissionsContext)
- Écrans bloquants : DailyPointageGate (géoloc + CF createPointage, bypass manager), AnnonceGate (scroll obligatoire → updateDoc readBy), GdprConsentModal (gdprConsentAt), bannières charte/annonces
- Badges temps réel : messages non lus, congés en attente (onSnapshot), annonces non lues (onSnapshot)
- ⚠️ import dynamique firebase/firestore ligne 289-290 (branche docs à signer) — code suspect à vérifier

## PermissionsContext (chantier en cours — ÉTAT)
- ✅ Branché dans App.tsx:9 (vérifié manuellement — l'agent s'était trompé)
- 18 PermKeys (pages + actions + champs), defaults par rôle, chargés depuis `settings/permissions` (getDoc au mount, merge defaults)
- Consommé par : Layout.tsx:338 (sidebar), ModuleGridPanel.tsx:178 (grille mobile), AdminPermissions.tsx (édition)
- ❗ **Inachevé** : les permKeys `action_*` et `field_*` ne sont PAS encore consommés dans les pages (Commandes, Livraison, Fabrication…) — seules les permKeys `page_*` sont actives. Les rules Firestore ne lisent pas non plus `settings/permissions`.

## Pages admin
| Page | Actions clés | Erreurs |
|------|-------------|---------|
| AdminUsers (520 l.) | CF createUser/deleteUser/updateUserEmail/setUserDisabled/updateUserPassword, updateDoc rôle | ✅ setError |
| AdminPermissions (182 l.) | getDoc/setDoc settings/permissions, tableau 3 rôles × 18 perms | ✅ |
| AdminSettings (1145 l.) | ~12 sections → setDoc merge sur settings/* | ⚠️ try/catch silencieux généralisé |
| AdminPointages (431 l.) | getDocs pointages + valider/refuser updateDoc | ✅ |
| AdminAnnonces (351 l.) | onSnapshot annonces, addDoc/updateDoc/deleteDoc, exclusion comptes système | ✅ |
| AdminConges (274 l.) | valider/refuser updateDoc conges_demandes | ✅ |
| AdminProduits (648 l.) | CRUD catalogue | ✅ |
| AdminDocuments (609 l.) | ORPHELIN selon CLAUDE.md — l'agent affirme qu'une route existe encore (router:229-234) → **à trancher Phase 1 : supprimer le fichier ou la route** | ⚠️ catch {} lignes 90, 99 |

## Pages utilisateur
- **Pointage** (481 l.) : Aujourd'hui / Historique (manager voit tout), lecture seule
- **CA** (224 l.) : 12 getDoc objectifs_ca, setDoc si patron/admin/manager ✅
- **Documents** (1661 l.) : charte + documents_a_signer + signatures (+ GMAO/CRETA selon canGmao)
- **Profile** (659 l.) : displayName, CF changePassword, prefs notifications
- **Livraisons** (209 l.) : coursier Twilio onSnapshot
- **AllergeneMenu** (528 l.) : fiche allergènes

## Gates
- **DailyPointageGate** (297 l.) : check « déjà pointé » getDocs — ⚠️ **catch muet (72)** → gate idle si réseau KO → double pointage possible ; ⚠️ teste rôle `'chef'` inexistant (34) ; bypass manager « Je ne suis pas sur zone »
- **AnnonceGate** (178 l.) : scroll obligatoire ; ⚠️ **`catch {}` sur updateDoc readBy (51)** → confirmation de lecture peut se perdre silencieusement
- **GdprConsentModal** : updateDoc gdprConsentAt — vérifier en Phase 2 que le flux s'affiche réellement

## Hooks
- **useAuth** (46 l.) : onAuthStateChanged → getDoc users/{uid} — ⚠️ **catch silencieux (38)** → user=null = déconnexion silencieuse si réseau faible
- **usePointageSortie** (104 l.) : canPointer, blockedUntil 1h, CF createPointage départ

## Cloud Functions appelées côté client
createPointage, createUser, deleteUser, updateUserEmail, updateUserPassword, setUserDisabled, changePassword(?→ vérifier nom exact), sendGmaoEmail, validatePromoCode, onCommandePrete, syncContactToBrevo, generateMonthlyArchives, sendNightlyRupturesNow, previewNightlyRuptures, sendPasswordReset

## ⚠️ Synthèse anomalies global/admin
| Sévérité | Anomalie | Réf |
|----------|----------|-----|
| 🔴 | AnnonceGate catch {} sur confirmation lecture | AnnonceGate.tsx:51 |
| 🔴 | DailyPointageGate catch muet check pointage | DailyPointageGate.tsx:72 |
| 🔴 | useAuth catch silencieux | useAuth.ts:38 |
| 🟠 | AdminSettings : setDoc silencieux généralisé | AdminSettings.tsx |
| 🟠 | AdminDocuments orphelin/route à trancher | router + AdminDocuments.tsx |
| 🟡 | rôle 'chef' inexistant testé | DailyPointageGate.tsx:34 |
| 🟡 | import dynamique firestore suspect | Layout.tsx:289-290 |
| 🟡 | Divergences router vs CLAUDE.md (/ca, /pointage, /admin/allergenes) | à vérifier Phase 1 |
