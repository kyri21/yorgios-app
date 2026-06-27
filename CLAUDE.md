## Brain Obsidian — contexte projet
> Note complète : `/home/demis/Documents/claude-brain/Projects/Matias — Yorgios Restaurant App.md`
> Contient : carte des modules, toutes les routes, collections Firestore, règles absolues, équipe.

---

# CLAUDE.md — Matias PWA (mis à jour 2026-06-12)

## ✅ AUDIT COMPLET — CLOS 2026-06-13

Audit complet de la PWA mené les 2026-06-12/13 (5 phases : cartographie, statique, dynamique web+mobile, UX, synthèse). Tous les correctifs validés par Arthur ont été déployés en prod : Lot A sécurité (secret HMAC, sendPasswordReset admin-only, token 64c, anti-spam) + A6/B4/G1, D1 permissions (UI `can()` + rules `permAllows()` fail-open), Lot C perf mobile (cache-first + vendor chunks), correctifs échecs silencieux, refonte /impeccable (Dashboard, Livraison, Planning mobile, Commandes), Catalogue accessible mobile. **Comptes de test supprimés, prod nettoyée (0 trace).**

- 📄 **RAPPORT FINAL** (ce qui a été modifié/amélioré, par zone, avec commits) : `docs/audit/06-RAPPORT-FINAL.md` — **lire en premier pour reprendre le contexte audit.**
- **Reste (manuel, Arthur)** : A5 — changer son propre mot de passe via `/admin/users` → section « Mot de passe ».
- **Archive des findings** : `docs/audit/` (synthèses, décisions A-G, 5 `cartographie-*.md` du code) + `PRODUCT.md` (racine).
- ⚠️ **Règle de test en prod (durable)** : jamais « On s'en occupe », pas de `viewed:true` sur ruptures, aucune action déclenchant emails/FCM réels (REFUSE, NC, congés, commande).
- ⚠️ **12 produits périmés en vitrine prod** : à traiter par les équipes terrain, pas en code.

## Fonctionnalités déployées session 2026-06-26

### Planning — Journal d'audit (qui a modifié quoi/quand) — COUCHE 1
- **But** : le patron contrôle le travail du manager (+ litige employé « erreur camouflée »). Choix retenu : **audit a posteriori seul** (pas de validation a priori — voir Couche 2 ci-dessous, NON faite).
- **Collection `planning_audit`** : `{ weekId, mondayDate, kind: 'hours'|'events', authorUid, authorName, at: serverTimestamp, before, after }`. `before`/`after` = snapshot COMPLET de la semaine.
- **Capture** dans le goulot unique `saveWeek`/`saveWeekEvents` (`firebase/planning.ts`) via `appendAudit()`, **dans le même writeBatch** que la donnée → atomique. Skip si `before===after`. `loadAuditEntries(monday)` pour lire (tri `at desc`).
- **`usePlanning`** : `authorName = displayName || email` propagé sur tous les chemins d'écriture (save, undoTo, setEventRange, removeEventRange, clearWeek, duplicateWeek).
- **UI** : `src/modules/planning/components/History/PlanningHistory.tsx` — bouton 🕓 toolbar (vue semaine, `isEditor`), **drawer desktop / bottom-sheet mobile**, diff lisible (« Markella · Mar : +14h,15h −18h »). iPhone + web.
- **Règles** : `planning_audit` read+create `isPatronOrManager()`, **update/delete = `false`** (inviolable, même patron). Index composite `weekId ASC + at DESC`.
- ⚠️ **PIÈGE ATOMICITÉ** : l'audit étant dans le même batch que la sauvegarde, déployer `firestore:rules` AVANT le code/hosting — sinon le create `planning_audit` refusé fait échouer TOUT le batch → la sauvegarde du planning casse.
- ⚠️ **Limites** : ne capture qu'à partir du déploiement (ne reconstitue pas le passé du litige). +2 lectures par sauvegarde (capture du `before`). NE PAS confondre avec le bouton ↩ existant (`planning.history`) = undo de session volatil.
- **Déployé en prod** ✅ (rules + index + hosting le 2026-06-26)

### Pointages — détection no-show (CF `detectNoShow`)
- **Faille comblée** : la détection de retard était 100 % réactive — `onPointageLate` est un trigger sur création de `pointages/{id}`, donc un employé qui ne pointe JAMAIS n'était signalé nulle part (cas Oreline 2026-06-26). `autoCheckoutSortie` ne boucle que sur les arrivées existantes → angle mort.
- **Fix** : CF planifiée `detectNoShow` (`*/30 7-23 * * *` Paris) qui part du **planning** (pas des pointages). Pour chaque employé prévu, début + 30 min dépassé, sans arrivée pointée et non couvert par congé/maladie/absence → **alerte FCM + email** (rien écrit au planning, le manager qualifie). Idempotent via `pointages_noshow/{date}_{empId}`.
- ⚠️ **Prérequis** : l'employé doit être **lié à un compte** (`users.employeeId`) — sinon il ne peut pas pointer et serait un no-show quotidien → la CF le skip (anti-bruit). Volet organisationnel : lier tout employé planifiable via `/admin/users`.
- **Matérialisation alerte** : notif push système (tap → `/admin/pointages`) + bannière in-app avant-plan (`Layout.tsx`, clic suit désormais `data.link` du push au lieu de `/messages` en dur) + email `alert_emails`. **Destinataires = patron/admin UNIQUEMENT — le manager n'est PAS alerté** (push roles `['patron','administrateur']` + emails managers filtrés de `getAlertEmails`). Décision Arthur 2026-06-27.
- **Qualification** (`AdminPointages.tsx`, page où atterrit le push) : panneau « 🚫 À qualifier » listant les `pointages_noshow` non résolus de la période. 3 actions inline : **⏰ Retard** (saisie min) / **🚫 Absence** → écrivent l'event dans `planningWeeks/{weekId}/events/{date}` (même cible qu'EventModal/onPointageLate) ; **✓ Présent (RAS)** → classe sans rien inscrire. Marque `resolved/resolution/resolvedBy/resolvedAt` sur le marqueur (= trace de qui a qualifié).
- **Règle** `pointages_noshow` : read+write `isPatronOrManager()`. `notifyRoles` envoie maintenant aussi `data: { link }`.
- **Déployé en prod** ✅ (rules + functions:detectNoShow + hosting le 2026-06-26). Chemin de données vérifié end-to-end via script admin (requête période / merge events / résolution).

### Couche 2 — validation patron (NON FAITE, à activer sur demande)
- Workflow `draft → soumis → validé` : réutiliser le champ **`locked`** déjà présent dans `planningWeeks/{weekId}`. Manager « Soumettre », patron « Valider » (+ FCM via CF type `onPlanningSubmitted`). Modif après validation → entrée audit taguée `afterValidation`.
- S'appuie sur la Couche 1 (déjà en prod), aucune migration. Plan détaillé en mémoire projet.

## Fonctionnalités déployées session 2026-06-04

### Planning — création d'employé corrigée (bug "le bouton ne marche pas")
- **Fichiers** : `src/modules/planning/firebase/employees.ts` + `src/modules/planning/components/Employees/EmployeeManager.tsx`
- **Cause racine** : `src/firebase/config.ts` utilise `getFirestore(app, 'test')` SANS `ignoreUndefinedProperties`. À la création d'un employé via 👥 → « + Ajouter un employé » avec Statut=défaut et primes vides, `handleSave` envoyait `primeComportement/primePonctualite/subStatus: undefined` → `addDoc` levait `Unsupported field value: undefined`. Le `try/finally` SANS `catch` avalait l'erreur → rien ne se passait. `QuickExtraModal` (⚡ Extra) marchait car il n'envoie que des champs définis.
- **Fix 1** : helper `stripUndefined()` dans `employees.ts`, appliqué dans `createEmployee`/`updateEmployee` (les sentinelles `deleteField()` sont des objets → préservées).
- **Fix 2** : `handleSave` a maintenant un `catch` + bandeau rouge ⚠️ qui affiche l'erreur (plus d'échec silencieux). Reset de l'erreur dans `openNew()`.
- ⚠️ **Règle générale** : ne JAMAIS passer `undefined` à Firestore (addDoc/setDoc/updateDoc) → omettre la clé ou `stripUndefined`. Toujours un `catch` qui surface l'erreur sur les écritures.
- **Vérifié sur iPhone via MobAI** : échec silencieux reproduit sur l'ancien bundle, création OK sur le bundle corrigé. ⚠️ Le service worker PWA garde l'ancien bundle jusqu'au relancement de l'app (bannière « Nouvelle version disponible »).
- **Rappel** : utilisateur (`users`) ≠ employé (`employees`). Créer un user ne crée pas l'employé planning. Lier via `/admin/users` → dropdown « lier au planning » (`users.employeeId`).
- **Déployé en prod** ✅

## Fonctionnalités déployées session 2026-06-01

### Planning — type `Arrêt maladie` (🤒) dans EventModal
- **Fichier** : `src/modules/planning/components/Events/EventModal.tsx`
- `malade` existait déjà partout (type `AbsenceType`, compteur `maladesHeures` dans `usePlanning`, rendu `EVENT_META` grille + mobile) — manquait UNIQUEMENT dans `EVENT_TYPES` du modal.
- Ajouté avec flag `hasHours` → champ « Heures manquées (par jour) », step 0.5. `malade`/`parti_tot` utilisent le champ `hours` (pas `minutes` comme `retard`).
- `onConfirm`/`onReplace` étendus avec un 5e param `hours?` ; `index.tsx` forwarde vers `setEventRange(..., minutes, hours)`.
- **Déployé en prod** ✅

### Planning desktop — bouton « 🤒 Absence / événement »
- **Fichier** : `src/modules/planning/index.tsx` (barre d'outils, ~ligne 325)
- Visible quand `isEditor && view==='week' && selectedEmpId`. Ouvre `EventModal` sur aujourd'hui (date locale calculée inline).
- Remplace le clic droit (non découvrable, zéro support tactile). **Le clic droit reste actif** comme raccourci expert.
- **Déployé en prod** ✅

### Planning mobile (iPhone/Android) — ÉDITABLE
- **Fichier** : `src/modules/planning/components/Mobile/MobilePlanningView.tsx` (réécrit) + `usePlanning.ts` + `index.tsx`
- Avant : 100% lecture seule. Maintenant éditable pour patron/admin/manager (lecture seule conservée pour `corner`).
- **Tap sur la carte d'un employé** (ou chip « En repos ») → bottom sheet :
  - **Horaires** : deux `<select>` Début → Fin (**bloc continu uniquement**, pas de service coupé). Bouton Appliquer + bouton Repos (efface).
  - **Absence / événement** : réutilise le `EventModal` desktop (même moteur, zéro divergence) + liste des events du jour avec ✕ pour retirer.
- **Barre « 💾 Enregistrer » explicite** (pas d'auto-save) → `planning.save` (persiste `draft` + `weekEvents` en parallèle).
- **Hook `usePlanning`** : nouveau `setEmpDayHours(dayIndex, empId, startHour|null, endHour)` — règle un bloc continu atomiquement sur `HOURS` (8→20) ; `startHour=null` = repos.
- Décisions UX validées par Arthur : bloc continu + save explicite (cf. règle ci-dessous).
- ⚠️ **Non testé sur device réel** — MobAI bloqué par limite offre gratuite (`device_limit_reached`).
- **Déployé en prod** ✅

---

## À FAIRE — session suivante

### Optimisation performances (signalé 2026-05-07)
- L'application est perçue comme lente — audit des requêtes Firestore, re-renders React, bundle size
- Pistes identifiées : requêtes sans index, getDocsFromServer systématiques, état non mémoïsé

### Fonctionnalités NON commencées
1. **AdminSettings** — section "Contrats de travail" CRUD (`settings/contrats`)
2. **EmployeeManager** — dropdown heures contrat (depuis `settings/contrats`)
3. **Lien employé ↔ utilisateur** (pour planning + primes)
4. **AdminSettings** — gestion permissions par rôle via l'interface (pas de code)

---

## Mentions légales & RGPD

- **Responsable du traitement** : Arthur Kyriazis — 17 rue de Paradis, 75010 Paris — kyriazis@outlook.fr
- **Page légale** : `/rgpd` (publique, sans auth) — `src/pages/Rgpd.tsx`
  - Onglet 1 : CGU (conditions d'utilisation)
  - Onglet 2 : Politique de confidentialité complète RGPD
- **Lien** affiché dans Login.tsx : "CGU et politique de confidentialité"
- Pas de société — application personnelle non commercialisée, mise à disposition des employés Yorgios
- **Ne jamais mettre** de nom de société fictif ou de SIRET dans les documents légaux
- Si besoin de modifier le contenu légal : éditer uniquement `src/pages/Rgpd.tsx`, constante `LAST_UPDATE` à mettre à jour

## Fonctionnalités déployées session 2026-05-07 (suite)

### Corner Livraison — AC automatique après REFUSE température
- **Fichier** : `src/modules/corner/pages/Livraison.tsx`
- Après NC decision + 1.8s : `ActionCorrectiveModal` s'ouvre automatiquement avec `problem: "Température élevée : X°C"` pré-rempli
- Variables `livrId` et `tempDisplay` capturées AVANT `setTimeout` (règle 14 — setState async)
- Bandeau orange sur cartes REFUSÉES sans AC dans "Complétées aujourd'hui"
- `useEffect` sur `livraisons` : auto-charge les ACs des livraisons REFUSE du jour
- **Déployé en prod** ✅

### Corner Livraison — onglet ⚠️ AC
- 5e onglet après Coursier — agrège toutes les anomalies de température sur une période
- Filtre : `(result === 'REFUSE' || result === 'A_VERIFIER') && departTempC != null` — sans température de départ = pas d'anomalie
- Chargement ACs en parallèle (`Promise.all`), compteurs, bandeau orange si aucune AC, ajout/édition inline
- **Déployé en prod** ✅

### Documents — permissions élargies
- `isSuperUser` = patron/admin/manager → tous les onglets admin (Modifier charte, Livret PDF, Gérer docs, Signatures)
- `canGmao` = isSuperUser OU `email === 'ipad@yorgios.fr'` → onglets GMAO et CRETA GEL
- iPad corner identifié par **email**, pas par rôle — rôle `corner` inchangé partout ailleurs
- **Déployé en prod** ✅

---

## Fonctionnalités déployées session 2026-05-07

### Vitrine corner — bug lots déjà présents corrigé
- **Cause racine** : query `corner_stock` dans `loadLots()` utilisait `limit(300)` sans filtre `active==true` — l'historique (actif + retiré) remplissait le limit et les items actifs récents pouvaient être absents de `vitrineNamesLower`
- **Fix 1** : query changée en `where('active', '==', true)` — seuls les items actuellement en vitrine sont chargés
- **Fix 2** : auto-repair name-based — si `productName` d'un lot cuisine est déjà actif en vitrine, `lots_cuisine` est marqué `sent:false, archived:true` en background
- **Fix 3** : `saveLotCuisine()` — lots "ignorés" (déjà en vitrine) trackés dans `skippedIds`, auto-réparés Firestore + supprimés de l'UI sans clic "✓ déjà là"
- **Déployé en prod** ✅

### Manager — accès aux Paramètres
- Route `/admin/settings` ouverte à `manager` (router/index.tsx)
- Sidebar desktop + mobile : `isAdmin` → `isSuperUser` pour le lien Paramètres (Layout.tsx)
- Dans AdminSettings : "Gérer les utilisateurs" masqué aux managers (`isPatronOrAdmin`), Catalogue visible
- **Déployé en prod** ✅

---

## Fonctionnalités déployées session 2026-05-06

### Export Excel mensuel — colonne Prime (M) automatique
- **`exportMonthlyExcel`** accepte maintenant `primes?: Record<string, number | null>` (6e param optionnel)
- Colonne "Prime" en M — valeur numérique dans la ligne TOTAL uniquement, style bleu `#004275`
- Appelé depuis `MonthlyView.tsx` avec `primesMap` calculé via `getPrime(empId)` sur tous les stats
- **Déployé en prod** ✅

### PrimesTab — bug barème corrigé
- `onPrimesChange` passait `DEFAULT_CA_PALIERS` au lieu des paliers Firestore chargés
- **Cause** : React setState est async — dans un `.then()`, les variables d'état locales gardent l'ancienne valeur. Utiliser des variables locales `let loadedPaliers` avant `setCaPaliers`.
- **Déployé en prod** ✅

### ActionCorrectiveModal — étendu (edit + delete + manual)
- Nouveau props : `editId?` (mode édition → `updateDoc`), `initialAction?` (pré-remplissage textarea)
- `canDelete?` + `onDeleted?` → bouton supprimer avec confirmation (réservé patron/manager)
- `payload.problem === ''` → champ "Problème constaté" libre apparaît (ajout manuel sans alerte)
- Pour ajout manuel : `setAcModal({ type, date, refId: \`manual_${Date.now()}\`, problem: '' })`
- **Déployé en prod** ✅

### Températures Corner + Cuisine — AC améliorées
- Bouton **➕ Ajouter** dans l'onglet "📋 Actions" (ajout manuel sans alerte préalable)
- Bouton **✏️** sur chaque card AC (patron/admin/manager uniquement) → modal edit/delete
- `isManager = ['patron', 'administrateur', 'manager'].includes(user?.role ?? '')`
- État supplémentaire dans chaque composant : `editAc: AcItem | null`
- **Déployé en prod** ✅

### Permissions Firestore — suppression lots + livraisons ouverte à la cuisine
- **`lots_cuisine` delete** : `isCorner()` → `isAnyRole()` — les utilisateurs cuisine peuvent désormais supprimer leurs propres lots en Fabrication (avant : réservé au corner)
- **`livraisons` delete** : `isPatronOrManager()` → `isCuisine()` — les utilisateurs cuisine peuvent désormais supprimer leurs départs en Livraison
- **Aucun changement UI** — les boutons "Supprimer" étaient déjà visibles, seules les règles Firestore bloquaient
- **À VENIR** : section dans `/admin/settings` pour gérer les permissions par rôle via l'interface (pas de code)
- **Déployé en prod** ✅

---

## Fonctionnalités déployées session 2026-05-05 (3e session)

### Contrôle Corner — tableaux dépliables dans le rapport
- **Fichier** : `src/modules/corner/pages/Controle.tsx` — composant `PreviewTable`
- **Avant** : texte statique gris `"… et X lignes de plus (visible dans l'export)"` — impossible à lire inline.
- **Après** : bouton toggle `▼ Afficher tout (X lignes de plus)` / `▲ Rétracter` — state local `expanded` dans `PreviewTable`. Chaque section (températures, hygiène, vitrine, livraisons, actions correctives) a son propre toggle indépendant.
- **Déployé en prod** ✅

---

## Fonctionnalités déployées session 2026-05-05 (2e session)

### Export Excel mensuel — refonte complète + détails comptable
- **Fichiers** : `src/modules/planning/utils/exports.ts` + `src/modules/planning/components/Monthly/MonthlyView.tsx`
- **Problème** : l'ancien export ne montrait que des totaux, sans ventilation hebdomadaire ni dates précises.
- **Nouveau format** — 2 feuilles :
  - **Feuille "Planning [mois]"** : tableau semaine par semaine par employé (identique à la vue app), avec sous chaque employé des lignes détail italique :
    - `↳ Retards` : liste "lun 13 avr (60min) · mer 15 avr (30min)"
    - `↳ Congés payés` : liste "lun 14 avr · mar 15 avr · …"
    - `↳ Sans solde` : liste des jours
    - `↳ Absences` : liste des jours
  - **Feuille "Événements"** : liste chronologique de tous les événements (date, employé, type, détail) — lisible directement par le comptable
- **Architecture** : `MonthlyView` stocke désormais `rawWeekData: { mon, events }[]` en state. Passé à `exportMonthlyExcel` avec `weeks: Date[]`. Le `buildEventIndex` reconstruit un index `empId → type → [{dateISO, minutes, hours}]` à partir des `WeekEvents` bruts.
- **Styles** : en-têtes bleu `#004275`, lignes TOTAL en gras fond gris, lignes détail en italique fond crème.

---

## Fonctionnalités déployées session 2026-05-04

### Bug Vitrine — lots cuisine — CORRIGÉ ET DÉPLOYÉ
- **Cause** : `addedIds = new Set(toAdd.map(...))` capturait TOUS les lots sélectionnés, y compris ceux sautés par `continue` (doublons). Ces lots gardaient `sent:true` en Firestore → réapparaissaient à la prochaine ouverture du formulaire.
- **Fix 1** : `processedIds` (Set local dans la boucle) ne collecte que les lots effectivement écrits en Firestore. `setLots` ne filtre que les lots réellement traités.
- **Fix 2** : `processedLotIdsRef` (useRef<Set<string>>) persiste les IDs traités pour toute la session. Filtre appliqué dans `loadLots()` avant les autres filtres. Protège contre les lag d'index Firestore sur `getDocsFromServer`.
- **Fichier** : `src/modules/corner/pages/Vitrine.tsx`

### Actions correctives HACCP — DÉPLOYÉ COMPLET (session 2026-05-05)

- **Collection Firestore `actions_correctives`** — règles : read isAnyRole(), create isAnyRole(), update/delete isPatronOrManager()
- **Structure** : `{ type, date, refId, problem, action, createdAt, createdBy, createdByName, fridgeId?, fridgeName?, session?, tempC?, alertMin?, alertMax?, productName?, fournisseur?, category?, decision? }`
- **Composant partagé** : `src/components/ActionCorrectiveModal.tsx` — props : `payload: AcPayload`, `createdByName`, `onClose()`, `onSaved()`. Suggestions pills par type + textarea.
- **Corner Températures** (`src/modules/corner/pages/Temperatures.tsx`) — onglet "📋 Actions", section rouge post-save, `loadAcForDate`, `documented: Set<string>`
- **Cuisine Températures** (`src/modules/cuisine/pages/Temperatures.tsx`) — MÊME PATTERN : onglet "📋 Actions", section rouge post-save si alertes `CUI_*`, `loadAcForDate` appelé au mount et au changement de date
- **Réception cuisine** (`src/modules/cuisine/pages/Reception.tsx`) — après save si `decision !== 'ACCEPTE'` : bandeau orange "📝 Action corrective requise" + bouton ouvre `ActionCorrectiveModal` avec `type: 'temperature_reception'`. `alert()` remplacé par message state.
- **Controle.tsx** (`src/modules/corner/pages/Controle.tsx`) — section "📝 Actions correctives" dans rapport + export Excel (onglet) + export PDF (page). Query : `actions_correctives where date >= from && date <= to`.

---

## À VÉRIFIER — bugs connus

### PrimesTab — modifié, potentiellement cassé
`PrimesTab.tsx` charge `settings/contrats` + `settings/primes_ca`. Si `settings/contrats` absent — fallback `DEFAULT_CONTRACTS`. Les cards utilisent `getContractForHours()` au lieu de `getBareme()`. **Non testé**.

**Si les primes sont cassées** : vérifier que `calcPrime` reçoit `compMax/2` pour comp et ponct, et que `derived.caMaxPrimes` est calculé depuis les contrats au moment du save.

---

### Fix heures malade/absent — déployé, non testé
`usePlanning.ts` — `computeWeekCounters` : `absenceDaySet` skippe les jours avec `malade`/`conge`/`absence`/`sans_solde`/`jour_off`. À vérifier sur Mellina ou un autre exemple concret.

---

### Charte — active: false (intentionnel)
`settings/reglement_interieur` existe (version 1.0, contenu complet). `active: false` = charte désactivée intentionnellement le temps de révision. Pour activer : `/documents` → onglet "✏️ Modifier charte" → switch ON. Les employés seront alors invités à signer.

---

## Fonctionnalités déployées session 2026-05-03

### Annonces obligatoires — lecture forcée avant accès app
- **Collection `annonces`** : `{ titre, corps, destIds: string[] ('*'=tous), destAll: boolean, actif: boolean, createdAt, createdByName, readBy: {[uid]: Timestamp} }`.
- **`AnnonceGate.tsx`** : modal fullscreen lecture obligatoire — bouton "J'ai lu" activé uniquement après scroll complet. Met à jour `readBy.{uid}` à la confirmation.
- **`AdminAnnonces.tsx`** — route `/admin/annonces` (patron/admin/manager) : rédiger annonce, cibler tous ou UIDs individuels, activer/désactiver, suivi de lecture par employé avec barre de progression.
- **`Layout.tsx`** : query `annonces where actif==true` + filtre client-side `destIds.includes(uid||'*') && uid not in readBy`. Bannière orange cliquable si annonces en attente. Exclu pour `planning@yorgios.fr`.
- **Firestore rules** : read=isAnyRole(), create/delete=isPatronOrManager(), update=isAnyRole() (pour marquer lu).
- **Index** : `actif ASC + createdAt ASC` — déployé en prod.
- **Comptes système exclus** (sélection AdminAnnonces) : `planning@yorgios.fr`, `ipad@yorgios.fr`, `ipad.cuisine@yorgios.fr`.

---

## Fonctionnalités déployées session 2026-05-01

### Charte — toggle ON/OFF (patron/admin)
- **`settings/reglement_interieur.active: boolean`** — nouveau champ. `true` par défaut (absent = actif).
- **`Documents.tsx` — onglet "✏️ Modifier charte"** : switch bleu/gris en haut de la section. ON = charte soumise à signature (comportement actuel). OFF = aucune notification, aucune demande de signature, onglet Charte affiche juste le texte en lecture avec bandeau gris "en cours de révision".
- **`Layout.tsx`** : si `active === false` → `setCharteNeedsSigning(false)` immédiatement, bannière et badge supprimés.
- Usage : mettre OFF pendant révision, remettre ON pour soumettre à signature.

### Ruptures corner — blocage produits déjà signalés dans la journée
- **`Ruptures.tsx`** : au mount, query `ruptures_actives where createdAt >= minuit` → collecte tous les noms envoyés aujourd'hui dans `alreadySentToday: Set<string>`.
- **Best-sellers** : produits déjà envoyés grisés (opacité 0.45), badge ✓ gris, `disabled`.
- **Catalogue** : produits déjà envoyés filtrés de la grille (disparaissent comme les produits sélectionnés).
- **Après chaque envoi** : `alreadySentToday` mis à jour localement sans nouveau round-trip Firestore.

### Documents à signer — module générique
- **Collection `documents_a_signer`** : `{ title, type: 'text'|'pdf', content?, fileUrl?, version, targetUids: string[], active, createdAt, signatures: {[uid]: {signedAt, version}} }`.
- **Firestore rules** : `read` = isAnyRole() ; `create/delete` = isPatron() ; `update` = isPatron() OU uid dans `targetUids`.
- **`Documents.tsx` — onglet "📄 Gérer docs"** (patron/admin) : créer un doc (PDF upload ou texte collé), sélectionner destinataires triés par groupe Corner/Cuisine/Manager avec "Tout cocher/décocher", toggle actif/inactif par doc, compteur signatures, suppression.
- **`Documents.tsx` — onglet "📝 À signer"** (tout utilisateur ciblé) : visible uniquement si `targetUids` contient l'UID. Badge orange avec nombre en attente. Clic → lecture (PDF iframe ou texte rendu) + checkbox "J'ai lu et j'accepte" + bouton Signer. Liste séparée docs signés / en attente.
- **`Layout.tsx`** : `pendingDocsCount` chargé au login via query `array-contains uid + active==true`. Bannière et badge Documents couvrent désormais charte ET docs à signer `(charteNeedsSigning || pendingDocsCount > 0)`.

---

## Fonctionnalités déployées session 2026-04-29

### Documents — page `/documents` unifiée (ex-Documents RH + ex-AdminDocuments)
- **Page `/documents`** — accessible à tous les rôles. Hub avec **7 onglets** (2 publics + 5 admin) :
  - **"📋 Charte"** : lecture scroll-obligatoire + signature électronique (prénom+nom). Sauvegarde dans `users/{uid}.reglementSigned: { version, signedAt, signedName }`.
  - **"📖 Livret"** : PDF du livret d'accueil affiché en iframe depuis Firebase Storage. Bouton "Ouvrir dans un nouvel onglet".
  - **"✏️ Modifier charte"** (patron/admin uniquement) : textarea éditable + versionnage. Sauvegarde dans `settings/reglement_interieur: { content, version, updatedAt }`. Quand version change → tous les employés doivent re-signer.
  - **"⬆️ Livret PDF"** (patron/admin uniquement) : upload PDF → Firebase Storage → URL dans `settings/documents_rh.livretUrl`. **Aucun code à modifier pour mettre à jour le livret.**
  - **"✅ Signatures"** (patron/admin uniquement) : liste de tous les users ayant `reglementSigned` avec nom, version signée et date.
  - **"🔧 GMAO"** (patron/admin uniquement) : demandes de réparation — formulaire (motif, département, date, N° intervention, photo), filtres statut+dates, changement statut, email Christelle (`cvandaele@la-grande-epicerie.fr`) via CF `sendGmaoEmail`.
  - **"🧊 CRETA GEL"** (patron/admin uniquement) : bons de livraison — upload PDF/image, libellé, date, filtres dates, lien "Voir".
- **Fichier** : `src/pages/Documents.tsx` — seul fichier, route `/documents`. `AdminDocuments.tsx` est orphelin (non bundlé, peut être supprimé).
- **Onglets admin** : `isAdmin = ['patron', 'administrateur'].includes(user.role)` — les managers ne voient que Charte + Livret.
- **Chargement lazy** : GMAO et CRETA GEL se chargent uniquement au premier clic sur l'onglet (flags `gmaoLoaded` / `cretaLoaded`).
- **Firestore** : `settings/reglement_interieur` + `settings/documents_rh` + `gmao_demandes` + `creta_gel_docs` — règles inchangées.

### Documents RH — Layout + Profile
- **`Layout.tsx`** — lien "📋 Documents" dans sidebar (tous les rôles sauf planning@). Top bar mobile : bouton 📋 avec fond orangé si charte à signer. Bannière orange "Charte à signer → Signer" dans le contenu principal si `reglementSigned.version !== reglement_interieur.version`, masquée quand déjà sur `/documents`. Le `useEffect` compare les deux docs Firestore au chargement.
- **`Profile.tsx`** — ligne "📋 Documents RH" en haut de la section "Accès rapide" avec statut : "⚠ Charte à signer" ou "✓ Charte signée".

### Planning — congés sans restriction pour admin/manager/patron
- **`EventModal.tsx`** — nouvelle prop `userRole?`. Si `patron`, `administrateur` ou `manager` : `congeBlocked = false` quelle que soit la date. Permet de saisir des congés à posteriori sans blocage.
- **`planning/index.tsx`** — passe `userRole={user.role}` au modal.
- Les employés classiques (corner/cuisine) gardent la validation 1 mois.

### Dashboard cuisine — jours de fermeture corner
- **Fonctions** dans `Dashboard.tsx` : `isCornerClosed(d)` (dimanche + 1er jan, 1er mai, 15 août, 25 déc), `getLastOpenDay(from)`, `getCommandesEffectiveStart()`.
- **Ruptures** : si avant midi et hier fermé → cutoff = dernier jour ouvert à 13h. Remplace et généralise la logique "lundi spécial" (lundi matin = hier dimanche → samedi 13h, identique à avant).
- **Commandes** : requête Firestore part du dernier jour ouvert si en fenêtre de récupération. `commandesToday` inclut les commandes du dernier jour ouvert jusqu'à aujourd'hui. Exemple : 1er mai fermé → commandes du 30 avril visibles le 2 mai avant midi.

### Documents RH — rendu charte mis en forme
- **`renderCharteContent(text)`** dans `Documents.tsx` — parser texte → React nodes. Rendu document moderne : bloc méta (Version/Responsables) dans encadré gris, sections numérotées avec badge cercle bleu + titre Epilogue bold, sous-sections (7.1…) avec bordure gauche bleue, bullets avec `·` primaire, labels inline en gras ("Prise de poste :", "Tolérance :" etc. détectés par regex `^([^:]{2,45})\s*:\s*(.+)$`), séparateurs `---` en ligne fine. L'admin continue d'éditer en texte brut — seul l'affichage change.

---

## Fonctionnalités déployées session 2026-04-28 (suite)

- **Congés — suivi employé** : section "Mes demandes de congés" dans `Profile.tsx` — liste temps réel (`onSnapshot`) des propres demandes avec badges statut colorés (⏳ En attente / ✓ Acceptée / ✗ Refusée). Commentaire manager affiché si présent.

- **Congés — gestion managers** : nouvelle page `/admin/conges` (`AdminConges.tsx`) accessible à patron/admin/manager. Liste temps réel avec tabs "En attente / Traitées". Clic → bottom sheet avec résumé + textarea commentaire + boutons Accepter (vert) / Refuser (rouge). Champs ajoutés sur update : `statut`, `commentaire`, `traitePar`, `traiteAt`.

- **Congés — badge sidebar** : icône 🏖 dans sidebar et top bar mobile (patron/admin/manager) avec badge rouge comptant les demandes en attente (`onSnapshot` live).

- **Congés — synchro planning** : CF `onCongesStatutChange` — trigger sur update `conges_demandes/{id}`. Si statut → "Acceptée" : lookup `users/{uid}.employeeId` → écrit `{ empId, type:'conge' }` dans `planningWeeks/{weekId}/events/{dateISO}` pour chaque jour de la plage. Si statut revient depuis "Acceptée" : supprime les events. Synchro automatique semaine + stats mois (computeWeekCounters lit déjà les events conge).

- **Congés — email retour employé** : même CF envoie email à l'employé avec statut + commentaire manager quand statut passe à "Acceptée" ou "Refusée".

- **Firestore rules** : `conges_demandes` — `allow read` étendu à `request.auth.uid == resource.data.uid` (employees lisent leurs propres demandes).

- **Prérequis synchro planning** : l'employé doit avoir `employeeId` lié dans `users/{uid}` (Admin → Utilisateurs). Si absent, la CF log un warning et la demande reste gérée mais le planning n'est pas mis à jour.

## Fonctionnalités déployées session 2026-04-28

- **Planning — Extra rapide** : bouton "⚡ Extra" violet dans la toolbar planning. `QuickExtraModal` : formulaire minimal (prénom, heures/semaine optionnel, couleur). Crée un employé avec `subStatus:'extra'` — apparaît immédiatement dans les EmpCards, placeable dans les shifts normalement.

- **Planning — Congés : validation 1 mois** : dans `EventModal`, si type `conge` et date de début < 1 mois : message rouge "Demande trop proche" + bouton désactivé. Si dates valides → popup intermédiaire avant sauvegarde.

- **Ruptures corner — photos obligatoires** : les 3 photos vitrine (gauche, centre, droite) passent à `required: true`. Bouton "Envoyer" désactivé + message orange tant que les 3 ne sont pas prises. Frigo corner reste optionnel.

- **AdminSettings — Comptes iPad** : input pleine largeur + bouton compact aligné à droite en dessous (plus de flex row qui compresse l'input).

- **AdminSettings — Demandes de congés destinataires** : section "Autres destinataires email" remplacée par checkboxes (même pattern que Alertes email — responsables). Stocké en `string[]` dans `settings/emails.congesDestinataires`. Compat ascendante : ancien format CSV string auto-converti au chargement.

- **Profil — Demandes de congés** : validation "moins d'un mois" avec blocage + message d'erreur rouge. Post-envoi : popup "Demande envoyée ✓ — Pour rappel, toute demande peut être déclinée. Merci d'attendre la validation de votre manager." Destinataires chargés depuis `settings/emails`.

- **CF `onCongesDemande`** : trigger Firestore create `conges_demandes/{id}` — envoie email depuis `GMAIL_USER` aux destinataires configurés dans `settings/emails.congesDestinataires`. Email contient : nom, email, dates (du → au), motif. Fallback : `a.cozzika@gmail.com` + `kyriazis@outlook.fr`.

- **Firestore rules** : ajout collection `conges_demandes` — `allow create: if isAnyRole()` + `allow read, update: if isPatronOrManager()`.

## Fonctionnalités déployées session 2026-04-27

- **Traçabilité transformation** : mode "🔄 Transformation" dans Fabrication (hachage/découpe/marinade), sélecteur réception source, DLC auto, badge TRANSFO violet. Sélecteur lots sources (ingrédients) sur modes catalogue/manuel. Modal 🔍 traçabilité — chaîne complète Réception → Transformation → Production. Lots `isTransformation` exclus de la liste d'envoi corner dans Livraisons.

- **Fabrication — filtre liste principale** : l'onglet principal n'affiche que les lots du jour (tous) + lots d'anciens jours non encore envoyés (`!sent`). Les lots `sent=true` d'anciens jours disparaissent. Badge **ENVOYÉ** vert sur les lots du jour déjà expédiés. Bouton "✓ Livré" supprimé — archivage uniquement via le flux Livraisons → Vitrine/Frigo.

- **Fabrication — créateur du lot** : `creatorName` (prénom) stocké à la création. Affiché sous la DLC, uniquement pour `patron` et `administrateur`. Backfill automatique au chargement pour les lots existants sans `creatorName`.

- **Livraison corner — section "À confirmer — sans temp"** : les lots envoyés sans température de départ ont leur propre section séparée. "À compléter (N)" ne compte plus que les lots nécessitant une saisie de température réelle.

- **Livraisons cuisine — statuts corrigés** : `needsReception` basé sur `receptionAt` (pas `receptionTempC`) pour les lots sans temp. Nouveaux statuts : "En attente corner" (orange) et "Reçu sans temp" (vert) pour les lots sans température de départ.

- **Planning — modifier/supprimer un événement** : `EventModal` a un nouvel onglet "✏️ Modifier / Supprimer". Affiche les événements détectés sur la plage, permet de changer le type (remove + re-add via `onReplace`) ou de tout supprimer. `onReplace` branché dans `index.tsx` : `removeEventRange` puis `setEventRange` en séquence.

## Fonctionnalités déployées session 3 (2026-04-26)

- **AdminUsers — section MOT DE PASSE** : fix timing `auth.currentUser` via `onAuthStateChanged` dans `useEffect`. UI refaite : input pleine largeur + bouton "Changer le mot de passe" en dessous (plus en ligne). Visible uniquement pour `administrateur`. Testé et confirmé fonctionnel.

## Fonctionnalités déployées session 2 (2026-04-26)

- **Stats mois** : Alexandre/Arthur/Layal exclus via `EXCLUDED_NAMES`. Tous les employés avec `subStatus` non-null aussi exclus (stagiaires, alternants, extras).
- **`SubStatus`** sur `Employee` : `'stagiaire' | 'alternant' | 'extra'`. Champ optionnel Firestore — absent = employé lambda.
- **EmployeeManager** : dropdown "Statut" dans formulaire + badge violet en liste.
- **PrimesTab** : même exclusion `subStatus` que MonthlyView.
- **EmpCard** (planning semaine) : badge violet sous le nom + bordure violette pour les non-lambda.

---

## Fonctionnalités NON COMMENCÉES

1. **AdminSettings** — section "Contrats de travail" : CRUD des types de contrats — `settings/contrats`
2. **EmployeeManager** — dropdown heures contrat avec les types configurés (au lieu de `input number` libre)
3. **Lien employé — utilisateur** pour le planning et les primes

### Structure `settings/contrats`
```json
{ "types": [
  { "hours": 15, "label": "Mi-temps 15h", "compMax": 20, "caMax": 60 },
  { "hours": 20, "label": "20h", "compMax": 30, "caMax": 100 },
  { "hours": 25, "label": "25h", "compMax": 40, "caMax": 150 },
  { "hours": 30, "label": "30h", "compMax": 50, "caMax": 200 },
  { "hours": 33, "label": "Hybride 33h", "compMax": 55, "caMax": 225 },
  { "hours": 35, "label": "35h", "compMax": 60, "caMax": 250 }
]}
```

---

## REGLES ABSOLUES — lire avant toute action

1. **Ne JAMAIS appeler `initializeApp()`** dans un module ou une page.
   Seul `src/firebase/config.ts` initialise Firebase, une seule fois.

2. **Un seul projet Firestore : `cuisine-yorgios`.**
   `src/modules/cuisine/firebase/firebase.ts` est un simple re-export de `src/firebase/config.ts`.

3. **Toujours importer** `db`, `auth`, `storage`, `functions` depuis `src/firebase/config.ts`.

4. **Modules indépendants** — zéro import croisé entre modules.
   Exception : `src/pages/CommandePublique.tsx` importe `CommandeFormBody` depuis `modules/corner/pages/Commandes.tsx`.

5. **Rôle `administrateur`** = alias de `patron` (mêmes droits complets).
   Partout où `patron` est vérifié, ajouter `administrateur`.

6. **Deploy functions** — toujours compiler d'abord :
   ```bash
   cd functions && npm run build && cd .. && firebase deploy --only functions:nomFonction
   ```

7. **Températures** — doc ID format : `{YYYY-MM-DD}_{fridgeId}_{session}` (`matin` ou `soir`).

8. **Pointages** — NE JAMAIS écrire directement dans `pointages` depuis le client.
   Appeler `createPointage` via `httpsCallable(functions, 'createPointage')`.

9. **Route cuisine** — `/cuisine` rend `CuisineDashboard`. Réception = `/cuisine/reception`.

10. **Ruptures — accumulation obligatoire** — Chaque envoi corner crée un **nouveau doc** `ruptures_actives` sans jamais archiver les précédents. `flatMap` + déduplication case-insensitive sur TOUS les docs non-vus — les envois du jour s'additionnent.
    NE JAMAIS marquer `viewed: true` les ruptures existantes lors d'un nouvel envoi corner.
    NE JAMAIS cliquer "On s'en occupe" lors des tests.

11. **Ruptures — tri par priorité** — Dashboard cuisine groupe par champ `priority` de `catalogue`. Noms dans `ruptures_actives` doivent correspondre EXACTEMENT aux noms du catalogue. Priorité 1 en premier, `null` = "Sans priorité" en dernier.

12. **Catalogue** — collection `catalogue` (pas `produits`). Noms exacts obligatoires partout (ruptures, best-sellers dans settings, pertes, vitrine). Best-sellers dans `settings/ruptures.produits[]` doivent matcher exactement les noms du catalogue.

13. **Compte `planning@yorgios.fr`** — accès planning lecture seule uniquement. Pas de DailyPointageGate, pas d'autres routes. Bouton "Mon planning" sur Login — connexion automatique sans saisie.

14. **React setState est async** — dans un `.then()` ou callback, les variables d'état capturées gardent l'ancienne valeur. Toujours stocker dans une variable locale `let loaded = value` AVANT `setState`, puis utiliser `loaded` dans la suite du callback.

15. **`actions_correctives` — refId = ID du parent, jamais de l'AC elle-même.** Dans un modal edit, `payload.refId` doit être l'ID de la ressource parente (livraison, frigo…), pas `editAc.id`. `editAc.id` va dans `editId` uniquement. Pattern : `refId: acExpandedId!, editId: editAc.id`.
    État expand cross-onglets : toujours `useEffect(() => setExpandedId(null), [tab])` pour éviter les cards auto-dépliées en changeant d'onglet.

---

## Projet Firebase

- **Project ID** : `cuisine-yorgios`
- **Firestore DB ID** : `test`
- **Région Functions** : `europe-west1`
- **Auth** : Email / Password
- **Hosting URL** : https://cuisine-yorgios.web.app
- **Service account** : `cuisine-yorgios-firebase-adminsdk-fbsvc-1c759ed390.json` (racine, NE PAS commiter)

---

## Équipe et Rôles

| Rôle | Accès | Redirection login |
|------|-------|-------------------|
| `patron` | Tout | `/planning` |
| `administrateur` | Tout (= patron) | `/planning` |
| `manager` | Planning + Corner + CA + Commandes + Pointages + Paramètres + Annonces + Congés | `/planning` |
| `corner` | `/corner` + CA lecture + `/messages` + `/planning` lecture + `/pointage` | `/corner` |
| `cuisine` | `/cuisine` + `/messages` + `/pointage` + `/crm/captation` | `/cuisine` |

### Utilisateurs
| Nom | Rôle | Email |
|-----|------|-------|
| Alexandre | `patron` | a.cozzika@gmail.com |
| Arthur | `administrateur` | kyriazis@outlook.fr |
| Sébastien | `manager` | sebastien.coenca@gmail.com |
| Timour | `cuisine` | ytimour86@gmail.com |
| Junior | `cuisine` | jrmaissonn@yahoo.com |
| Danioko | `cuisine` | mdanioko650@gmail.com |
| Ali | `cuisine` | c_ali@hotmail.fr |
| Periklis | `cuisine` | perkokko@gmail.com |
| **iPad Cuisine** | `cuisine` | ipad.cuisine@yorgios.fr |
| Markella | `corner` | markellaksilogian@gmail.com |
| Elena | `corner` | elenaakt9@hotmail.com |
| Wahib | `corner` | wahibjeanbaptistelinard@gmail.com |
| Layal | `corner` | lay.berkous@gmail.com |
| Mellina | `corner` | mellinaten@gmail.com |
| **iPad Corner** | `corner` | ipad@yorgios.fr |
| **Planning** | `corner` | planning@yorgios.fr |

> Mots de passe : Firebase Console — Authentication.

---

## Structure dossiers

```
src/
  firebase/
    config.ts           — UNIQUE initializeApp() — exporte db, auth, storage, functions
    messaging.ts        — FCM + registerDeviceAsIPad()
  auth/
    useAuth.ts / AuthGuard.tsx
  router/index.tsx      — React.lazy() + Suspense (code splitting)
  components/
    Layout.tsx          — sidebar + bottom nav + FAB pointage sortie + bannière messages
    ModuleGridPanel.tsx — bottom sheet grille 3x3 sous-pages Corner/Cuisine
    DailyPointageGate.tsx — gate géoloc (exclut planning@yorgios.fr)
    AnnonceGate.tsx     — modal lecture obligatoire (scroll-to-bottom avant confirmation)
  pages/
    Login.tsx           — boutons iPad Corner/Cuisine + bouton Planning (auto-login) + "Mot de passe oublié"
    AdminProduits.tsx   — catalogue (filtre catégorie + priorité)
    AdminSettings.tsx   — fournisseurs, alertes temp, best-sellers ruptures, niveaux priorité, barème CA, contrats
    AdminUsers.tsx      — CRUD utilisateurs + CF updateUserEmail/setUserDisabled/updateUserPassword
    AdminDocuments.tsx  — ORPHELIN (fusionné dans Documents.tsx — peut être supprimé)
    Documents.tsx       — hub unifié 7 onglets : Charte, Livret, Modifier charte, Livret PDF, Signatures, GMAO, CRETA GEL
    AdminAnnonces.tsx   — gestion annonces obligatoires (patron/admin/manager)
    AdminConges.tsx     — validation demandes de congés (patron/admin/manager)
  modules/
    planning/     — PlanningGrid (desktop) + MobilePlanningView (< 768px)
    cuisine/      — Dashboard + Réception + Fabrication + Livraisons + Températures + Contrôle + ReceptionHistorique
    corner/       — Dashboard + Températures + Hygiene + Livraison + Vitrine + StockageFrigo
                     Ruptures + Commandes + Pertes + Controle + PlanningCorner
    crm/          — CaptationPage + useCaptation hook
  hooks/
    usePointageSortie.ts — FAB sortie, appelle CF createPointage

functions/src/
  index.ts          — Cloud Functions
  domain/loyalty.ts — paliers fidélité
  crm/index.ts      — syncContactToBrevo, validatePromoCode
```

---

## Collections Firestore (DB `test`)

| Collection | Accès | Usage |
|-----------|-------|-------|
| `users` | own + patron/admin/manager | profils, role, fcmToken |
| `employees` | patron/admin/manager | employés planning |
| `planningWeeks` | lecture tous, écriture patron/admin/manager | semaines planning |
| `planning_audit` | read+create isPatronOrManager, **update/delete = false** | journal d'audit append-only — `{ weekId, kind, authorUid, authorName, at, before, after }`. Index `weekId ASC + at DESC` |
| `pointages_noshow` | read+write isPatronOrManager (create par CF) | marqueurs no-show `detectNoShow` — doc ID `{date}_{empId}`, `{ date, employeeId, employeeName, plannedStartHour, alertedAt, resolved?, resolution?, resolvedBy?, resolvedAt? }`. Idempotence + qualification |
| `catalogue` | lecture isAnyRole, écriture isPatronOrManager | 104 produits — `name`, `abrv`, `defaultCategory`, `gepCategory`, `dlcDays`, `priority`, `active`, `inVitrine`, `inReception`, `inFabrication`, `allergenes[]` |
| `receptions` | cuisine | réceptions HACCP |
| `lots_cuisine` | lecture isAnyRole, create cuisine, update isAnyRole, delete isAnyRole | lots fabrication — `receptionId`, `fournisseur` pour traçabilité |
| `lot_counters` | cuisine | séquences numéros de lot |
| `livraisons` | lecture isAnyRole, create cuisine, update isAnyRole, delete isCuisine | livraisons cuisine — corner |
| `temperatures` | lecture isAnyRole, create/update isAnyRole, delete patron/manager | relevés frigos — doc ID `{YYYY-MM-DD}_{fridgeId}_{session}` |
| `archives` | cuisine | archives mensuelles |
| `hygiene_corner` | corner | checklists — `{date}_quotidien` / `{YYYY-WXX}_hebdo` / `{YYYY-MM}_mensuel` |
| `corner_stock` | corner | produits vitrine avec DLC |
| `stockage_frigo` | corner | stock frigos corner (mutuellement exclusif avec corner_stock) |
| `ruptures_actives` | create corner, update cuisine/patron/admin/manager | `{ ruptures[], presqueRuptures[], personne, createdAt, viewed }` |
| `messages` | tous | messagerie interne (TTL 7j) |
| `commandes_externes` | create public, read/update corner | commandes clients |
| `non_conformites` | corner | livraisons refusées + décisions |
| `objectifs_ca` | écriture patron/admin/manager, lecture corner | CA mensuel (doc ID = YYYY-MM) |
| `pointages` | write bloqué client (CF uniquement), read patron/admin/manager | pointages GPS |
| `settings` | écriture patron/admin, lecture tous | voir section Settings ci-dessous |
| `pertes_corner` | corner | pertes |
| `deliveries` | lecture isAuth, write CF uniquement | suivi coursier Twilio — `trackingUrl`, `eta`, `status`, `rawMessage` |
| `devices` | lecture isAnyRole, écriture own ou patron/admin | `{ type: 'ipad_corner' ou 'mobile', fcmToken, label }` |
| `customers` | CRM functions | fidélité + promos |
| `gmao_demandes` | patron/admin/manager | `{ motif, departement, date, numeroIntervention, statut, photoUrl?, createdAt }`. Statuts : `en cours` / `en attente` / `terminé`. Photos dans Storage `gmao/` |
| `creta_gel_docs` | patron/admin/manager | `{ label, fileUrl, fileType, date, createdAt }`. Fichiers dans Storage `creta_gel/` |
| `annonces` | lecture isAnyRole, create/delete isPatronOrManager, update isAnyRole | `{ titre, corps, destIds: string[] ('*'=tous), destAll, actif, createdAt, createdByName, readBy: {[uid]: Timestamp} }` |
| `documents_a_signer` | read isAuth, create/delete patron, update patron ou uid dans targetUids | `{ title, type: 'text'|'pdf', content?, fileUrl?, version, targetUids[], active, signatures: {[uid]: {signedAt, version}} }` |
| `conges_demandes` | create isAnyRole, read own ou isPatronOrManager, update isPatronOrManager | `{ uid, nom, email, du, au, motif, statut, commentaire?, traitePar?, traiteAt? }` |

### Catalogue — champs clés
- `defaultCategory` : groupement affichage (Mezze, Plats, Bowl, Tiropitas, Salades, Desserts, Boissons, Autre)
- `gepCategory` : seuil GEP livraison (VIANDE, POISSON, PLAT_CUISINE, LEGUMES, etc.)
- `priority` : number | null — 1 = urgent (affiché en premier dans dashboard cuisine)
- `inFabrication: true` par défaut si absent — filtre `!== false`

---

## Settings Firestore (collection `settings`, DB `test`)

| Doc | Champs | Usage |
|-----|--------|-------|
| `settings/ruptures` | `produits: string[]` | Best-sellers corner (noms exacts catalogue) |
| `settings/primes_ca` | CA progressif | Barème CA planning |
| `settings/contrats` | `types: ContractType[]` | Types contrats (20/25/30/35h + custom). Fallback `DEFAULT_CONTRACTS` si absent |
| `settings/nightly_ruptures` | `enabled: boolean`, `pauseFrom: string`, `pauseTo: string` (YYYY-MM-DD), `ccEmails: string[]` | Email Timour 21h30 — toggle + vacances + CC |
| `settings/alert_emails` | `responsables: string[]` | Destinataires retard/REFUSE/NC. Fallback `['a.cozzika@gmail.com', 'kyriazis@outlook.fr', 'sebastien.coenca@gmail.com']` si vide |
| `settings/history_limits` | `lotsJours: number` (défaut 30), `livraisonsJours: number` (défaut 30) | Durée historique lots Fabrication + galerie photos Livraison. Températures/hygiène/pointages = illimités |
| `settings/commandes_emails` | `relanceEnabled: boolean`, `destinataires: string[]` | Relance commandes 6h/12h/18h + email immédiat nouvelle commande. Défaut : `a.cozzika@gmail.com` |
| `settings/notifications` | `costas: boolean`, `weeklyHygieneLundi.email: boolean`, `gmaoRappelLundi.email: boolean` | Toggles notifications |
| `settings/priority_levels` | levels[] | Niveaux de priorité catalogue |

---

## Cloud Functions (`europe-west1`)

| Fonction | Déclencheur | Rôle |
|----------|------------|------|
| `onNewMessage` | Firestore create `messages/{id}` | Push FCM à tous sauf expéditeur |
| `purgeOldMessages` | Scheduler quotidien | Supprime messages expirés |
| `onNewCommande` | Firestore create `commandes_externes/{id}` | Anti-spam 3/24h + Push FCM + email `settings/commandes_emails.destinataires` |
| `onCommandeUpdated` | Firestore update `commandes_externes/{id}` | Acceptée — GCal + FCM ; Livrée — Brevo + fidélité |
| `onCommandePrete` | httpsCallable | FCM patron+manager+cuisine + messagerie |
| `notifCommandesJ7` | Scheduler 8h00 | Email HTML toutes commandes J+0 vers J+7 |
| `notifCommandesJ2` | Scheduler 14h00 | FCM + Email HTML commandes dans 2 jours |
| `notifCommandesJJ` | Scheduler 09h00 | FCM rappel jour-J |
| `relanceCommandes` | Scheduler `0 6,12,18 * * *` Paris | Relance si `relanceEnabled===true` dans `settings/commandes_emails` |
| `onPointageLate` | Firestore create `pointages/{id}` | Email HTML à `settings/alert_emails.responsables` si retard > 10 min + event `retard` dans `planningWeeks` |
| `createPointage` | httpsCallable | Validation GPS Haversine, anti-doublon, bloc sortie < 1h, overtime auto-checkout |
| `autoCheckoutSortie` | Scheduler `*/30 7-23 * * *` Paris | Auto-checkout 1h après fin shift si pas de départ manuel. Timestamp = heure fin prévue |
| `detectNoShow` | Scheduler `*/30 7-23 * * *` Paris | **No-show** : employé prévu au planning, non pointé ≥ 30 min après début → FCM + email **patron/admin uniquement (PAS manager)**. ALERTE SEULEMENT (rien écrit au planning). Idempotent via `pointages_noshow/{date}_{empId}`. Skip si couvert par congé/maladie/absence, si déjà pointé, ou si employé non lié à un compte |
| `notifTemperatures` | Scheduler 8h30 | FCM si frigos matin non saisis |
| `notifTemperaturesEvening` | Scheduler 22h00 | FCM si frigos soir non saisis |
| `notifCartonsChambrefroide` | Scheduler 9h30 | FCM corner+patron+admin+manager (cuisine exclue) |
| `notifPlatsJour` | Scheduler 11h00 | FCM corner+patron+admin+manager (cuisine exclue) |
| `notifUrgences` | Scheduler 15h00 | FCM employés pointés |
| `notifCostas` | Scheduler dimanche 10h | FCM corner+patron+admin+manager (si `settings/notifications.costas`) |
| `notifHygieneHebdo` | Scheduler samedi 18h | FCM si checklist hebdo non faite |
| `notifHygieneMensuel` | Scheduler 28-31 du mois 18h | FCM si checklist mensuelle non faite |
| `weeklyHygieneRecap` | Scheduler lundi 8h | Email récap températures + hygiène (si `settings/notifications.weeklyHygieneLundi.email`) |
| `notifNightlyRuptures` | Scheduler 21h30 | Email Timour groupé par priorité. Vérifie `settings/nightly_ruptures.enabled` + pause vacances |
| `previewNightlyRuptures` | httpsCallable (patron/admin) | Aperçu email ruptures sans envoi — retourne `{ items, commandes, hasContent, emailHtml }` |
| `createUser` | httpsCallable (patron/admin) | Créer compte utilisateur |
| `deleteUser` | httpsCallable (patron/admin) | Supprimer compte utilisateur |
| `updateUserEmail` | httpsCallable (patron/admin) | Modifier email utilisateur |
| `setUserDisabled` | httpsCallable (patron/admin) | Désactiver/réactiver compte (`disabledUntil` optionnel) |
| `updateUserPassword` | httpsCallable (administrateur uniquement) | Modifier mot de passe utilisateur |
| `onLivraisonTemperature` | Firestore create `livraisons/{id}` | FCM départ livraison |
| `onLivraisonReception` | Firestore update `livraisons/{id}` | FCM + email `settings/alert_emails.responsables` si REFUSE |
| `onNonConformiteCreated` | Firestore create `non_conformites/{id}` | Email décision NC à `settings/alert_emails.responsables` |
| `sendGmaoEmail` | httpsCallable (patron/admin) | Email à Christelle `cvandaele@la-grande-epicerie.fr`. Objet éditable + `customBody` |
| `gmaoWeeklyReminder` | Scheduler lundi 9h | Email à Alexandre + Sébastien si demandes GMAO "en cours" (si `settings/notifications.gmaoRappelLundi.email`) |
| `incomingSms` | onRequest (Twilio webhook) | Parse SMS coursier — `deliveries` + FCM |
| `syncContactToBrevo` | httpsCallable | Sync contact Brevo + `customers/` |
| `validatePromoCode` | httpsCallable | Vérifie code promo (app) |
| `validatePromoCodePublic` | onRequest | Vérifie code promo (WordPress) |

---

## Routes

| Route | Accès |
|-------|-------|
| `/login` | Public |
| `/commande` | Public |
| `/planning/*` | patron, admin, manager, corner |
| `/cuisine/*` | patron, admin, manager, cuisine |
| `/corner/*` | patron, admin, manager, corner |
| `/ca` | patron, admin, manager |
| `/messages` | tous |
| `/pointage` | tous sauf manager |
| `/profile` | tous |
| `/livraisons` | tous |
| `/commandes` | tous |
| `/admin/users` | patron, admin |
| `/admin/settings` | patron, admin, manager |
| `/admin/pointages` | patron, admin, manager |
| `/admin/produits` | patron, admin |
| `/admin/allergenes` | patron, admin, manager |
| `/admin/annonces` | patron, admin, manager |
| `/admin/conges` | patron, admin, manager |
| `/documents` | tous |
| `/crm/captation` | tous |

---

## Design System — Aegean Precision (light mode)

**LIGHT MODE uniquement** — zéro fond sombre, zéro `#000`, `#1c1c1e`, `bg-gray-9*`, `bg-slate-*`.

### Variables CSS (`src/index.css`)
| Token | Valeur | Usage |
|-------|--------|-------|
| `--surface` | `#fcf9f3` | Fond de base |
| `--surface-low` | `#f6f3ed` | Sections |
| `--surface-mid` | `#ede9e1` | Cards interactives |
| `--surface-high` | `#e5e2dc` | Cards actives |
| `--primary` | `#004275` | Bleu grec — actions, brand |
| `--on-surface` | `#1c1c18` | Texte principal |
| `--on-surface-2` | `#5a5a55` | Texte secondaire |
| `--on-surface-3` | `#9a9a94` | Placeholders |
| `--danger` | `#c0392b` | Erreurs |
| `--success` | `#2d7a4f` | Validation |
| `--warning` | `#b45309` | Avertissements |
| `--border` | `rgba(28,28,24,0.12)` | Bordures |
| `--border-soft` | `rgba(28,28,24,0.06)` | Séparateurs légers |

### Classes
`.page` `.card` `.btn-primary` `.btn-secondary` `.btn-danger` `.btn-icon`
`.input` `.input-filled` `.section-title` `.section-label`
`.chip-ok` `.chip-danger` `.chip-warn` `.nav-tabs` `.nav-tab` `.glass` `.divider`
`.spinner` `.skeleton`

### Règles
- Overlays modals : `rgba(28,28,24,0.45)`
- Fonts : **Epilogue** (titres h1-h3) + **Manrope** (body)
- Tap targets min 44x44px mobile

---

## Frigos — IDs Firestore

### Corner
| ID | Nom |
|----|-----|
| `FRIGO_3P` | Frigo 3 portes |
| `VITRINE_1` | Vitrine 1 |
| `VITRINE_2` | Vitrine 2 |
| `VITRINE_3` | Vitrine 3 |
| `GRAND_FRIGO` | Grand frigo |

### Cuisine
| ID | Nom |
|----|-----|
| `CUI_FRIGO1_ENTREE` | Frigo 1 entrée |
| `CUI_GRAND_FRIGO_INOX` | Grand frigo porte inox |
| `CUI_GRAND_FRIGO_VERRE` | Grand frigo porte verre |
| `CUI_FRIGO2_MILIEU` | Frigo 2 milieu |
| `CUI_FRIGO_FOUR` | Frigo four |

---

## Hygiène Corner — items

### Quotidien (13)
`plats_service`, `int_vitrines`, `ustensiles`, `meuble_vente`, `comptoir_balance`,
`micro_ondes`, `evier_papier`, `etiquettes`, `plan_travail`, `ext_placards`,
`ext_frigo`, `poubelle`, `vitres`

### Hebdomadaire (5)
`int_frigos`, `etageres_materiels`, `support_papier`, `placard_hygiene`, `machine_glacon`

### Mensuel (1)
`placard_rangement`

---

## Règles GEP — températures livraison

| Catégorie | Clé RULES | Max standard | Max tolérance |
|-----------|-----------|-------------|---------------|
| Viande hachée | `VIANDE_HACHEE` | 2°C | 3°C |
| Viande | `VIANDE` | 3°C | 5°C |
| Poisson | `POISSON` | 2°C | 3°C |
| Lait | `LAIT` | 4°C | 6°C |
| Plat cuisiné frais | `PLAT_CUISINE` | 3°C | 5°C |
| Pâtisserie fraîche | `PATISSERIE` | 3°C | 5°C |
| Légumes | `LEGUME` | 8°C | 10°C |

Tout dépassement de `maxTol` — `result: 'REFUSE'` — email `settings/alert_emails.responsables` + FCM.
`managerOverride: true` sur le doc `livraisons/` = validation manuelle hors tolérance GEP.

---

## PWA

- **Nom** : `Matias` — icône oeil grec dans `public/icons/`
- `vite-plugin-pwa` — SW auto-généré, `skipWaiting: true`, `clientsClaim: true`
- `public/firebase-messaging-sw.js` — SW FCM background
- Bannière "Nouvelle version disponible" via `onNeedRefresh` dans `main.tsx`

---

## Variables d'environnement

**`.env` (racine)**
```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_VAPID_KEY=
```

**`functions/.env`**
```
GCAL_CALENDAR_ID=yorgios.system@gmail.com
GMAIL_USER=a.cozzika@gmail.com
GMAIL_APP_PASSWORD=xxxx
BREVO_API_KEY=xxxx
BREVO_LIST_ID=3
YORGIOS_WP_SECRET=xxxx
TWILIO_AUTH_TOKEN=xxxx
TWILIO_ACCOUNT_SID=xxxx
```

---

## Commandes utiles

```bash
npm run dev
npm run build && firebase deploy --only hosting
cd functions && npm run build && cd .. && firebase deploy --only functions:nomFonction
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

---

## ARCHITECTURE METIER — REGLES INVIOLABLES

### Planning — employés

- **`Employee.subStatus?: 'stagiaire' | 'alternant' | 'extra'`** — absent = employé lambda.
- Exclus du décompte mensuel (stats + exports Excel/PDF) ET des primes.
- Apparaissent dans la grille semaine avec badge violet + bordure violette.
- `EXCLUDED_NAMES = ['Layal', 'Alexandre', 'Arthur']` dans `primes.ts` — exclus aussi des stats/primes (patrons + cas particuliers).
- Pour créer un extra : EmployeeManager → dropdown "Statut" → Extra. Heures contrat = 0 si pas de contrat fixe.

---

### Cycle de vie d'un lot cuisine

```
Fabrication (cuisine)
  vers Livraison cuisine (départ + temp)
    vers Livraison corner (arrivée + temp)
      vers Frigo corner (stockage_frigo)  vers  Vitrine (corner_stock, active=true)
      vers Vitrine directe (corner_stock)
```

1. **Pas de doublon** dans `lots_cuisine`, `stockage_frigo`, `corner_stock`. Bloquer si doublon.
2. **Lot livré + accepté** — `lots_cuisine.archived=true`. Disparaît de "Lots en cours".
3. **Lot ajouté en vitrine depuis lots cuisine** — archive `lots_cuisine` + crée `corner_stock`.
4. **Lot transféré frigo vers vitrine** — `deleteDoc stockage_frigo` automatique. Frigo et vitrine sont mutuellement exclusifs.
5. **Retour cuisine depuis Vitrine** — `corner_stock.active=false` + `lots_cuisine.sent=false`.

---

### Cuisine — Dashboard

- **Encadré rouge ruptures** : un seul encadré en haut, triés par priorité catalogue. Fenêtre : avant 10h — depuis hier 13h ; après 10h — depuis minuit.
- **Ruptures** : `flatMap` sur tous les docs `viewed==false` — déduplication case-insensitive.
- **"On s'en occupe"** — `batch.update viewed:true` sur tous les docs visibles.
- **Commandes** : filtre `STATUTS_ACTIFS = ['en cours', 'devis envoyé', 'accepté']`.
- **Dashboard ruptures weekend** : Sam+Dim cumulés jusqu'à lundi 12h.
- **Pastilles priorité** : `priority === null` = jaune `#ca8a04`. Priorité définie = rouge (rupture) ou orange (presque rupture).

---

### Cuisine — Réception

- Produits depuis `catalogue where inReception==true && active==true`.
- N° lot : saisie manuelle ou scan code-barres (html5-qrcode, lazy).
- Crée un doc `receptions` — référencé dans Fabrication (`receptionId`).
- DLC viande en mode Réception = **7 jours** (filtre liste réceptions aussi étendu à 7j).

---

### Cuisine — Fabrication

- Vérifier `lotCode` inexistant avant `setDoc`. Bloquer si doublon.
- Mode Réception : pré-remplit `productName` + `fournisseur`, stocke `receptionId`.
- Mode Transformation : hachage/découpe/marinade — `isTransformation:true`, `transformationType`, DLC auto, badge TRANSFO violet. Exclu de Livraisons (`!l.isTransformation`).
- DLC auto : J+`dlcDays` depuis date fabrication (configurable dans catalogue).
- Durée historique lots : `settings/history_limits.lotsJours` (défaut 30j) — query Firestore date-based dans `loadLots()`.
- **Onglet principal** : lots du jour (tous) + lots d'anciens jours `sent!=true`. Les lots `sent=true` d'anciens jours ne s'affichent PAS — ils sont en transit ou archivés. Badge **ENVOYÉ** vert sur les lots du jour déjà expédiés.
- **Pas de bouton "Livré"** — archivage uniquement via flux Livraisons → Vitrine/Frigo corner.
- `creatorName` stocké à la création (prénom depuis profil Firestore). Affiché sous la DLC pour patron/admin uniquement. Backfill automatique au chargement.
- Filtre viande (VIANDE/VIANDE_HACHEE) + badge >4j.

---

### Cuisine — Livraison (départ)

- Lots non livrés (`sent!=true && !isTransformation`). Température obligatoire pour lots soumis GEP.
- Lots sans temp — case à cocher côté corner à l'arrivée.
- Lots sélectionnés — `sent=true`.
- **Statuts affichés** : avec temp non réceptionné → "À compléter (réception)" ; sans temp non confirmé → "En attente corner" ; avec temp reçu → "Réception OK (résultat)" ; sans temp confirmé → "Reçu sans temp".

---

### Corner — Dashboard

- **Filtre livraisons pending** (card du dashboard) : `receptionTempC == null && !receptionAt && !returned && departAt >= todayStart`. Affiche uniquement les livraisons en attente du jour pour le compteur de la card.
- **`overdueLivraisons`** : calculés depuis les 200 dernières livraisons — lots pending avec `departAt + 6h < now`. Déclenche un **bandeau orange en haut de page** cliquable vers `/corner/livraison`. Texte : `"X lot(s) non réceptionné(s) depuis plus de 6h"`.
- Le filtre `departAt >= todayStart` est UNIQUEMENT dans `Dashboard.tsx` pour le compteur de la card. `Livraison.tsx` affiche TOUS les jours sans filtre de date.
- **Commandes** : même filtre `STATUTS_ACTIFS` que cuisine.

---

### Corner — Livraison (arrivée)

- `load()` récupère les **200 dernières** livraisons sans filtre date.
- `pending` : `receptionAt == null && !returned` — SANS filtre de date. Tous les lots non traités de tous les jours sont visibles.
- Lots AVEC `departTempC` en premier, SANS `departTempC` ensuite.
- **"À compléter (N)"** : uniquement les lots avec `departTempC != null` — saisie temp arrivée + photo — résultat GEP. Dépassement `maxTol` — email + FCM.
- **"À confirmer — sans temp (N)"** : section séparée — checkbox groupée "Livraison reçue" — `result: 'ACCEPTE'`. NE PAS les compter dans "À compléter".
- `done` (Complétées aujourd'hui) : `receptionAt >= todayStart()` — filtré par date de réception corner, pas date d'envoi cuisine.
- `stalePending` : lots pending avec `departAt < todayStart()` — bandeau orange + badge date sur chaque carte.
- Bouton "Retour cuisine" : tous rôles. Bouton "Supprimer" : patron/admin/manager.

---

### Corner — Vitrine

**3 modes d'ajout** :
1. **Manuel** : catalogue `inVitrine==true`, multi-sélection.
2. **Lot cuisine** : `lots_cuisine where sent==true && inVitrine!=false`. Sélection — `addDoc corner_stock` + archive `lots_cuisine`.
3. **Frigo** : `stockage_frigo`. Sélection — `addDoc corner_stock` + `deleteDoc stockage_frigo`.

Pastilles DLC : AUJ. = orange, DEMAIN = violet.

---

### Corner — Ruptures

- Best-sellers depuis `settings/ruptures.produits[]` (noms exacts catalogue).
- Catalogue depuis `catalogue` (active==true), ordre fixe : Mezze, Salades, Tiropitas, Plats, Bowl, Desserts, Autre, Boissons.
- 3 états : null, urgent, moins-urgent, null. Croix dans panel = null direct.
- Chaque envoi = **nouveau doc** `ruptures_actives`, jamais d'archivage des précédents.
- `ruptures[]` = urgent, `presqueRuptures[]` = moins-urgent.
- Lien WhatsApp `wa.me` vers Timour (+33781468107) après envoi ruptures.

---

### Corner — Hygiène

- Quotidien (13 items) / Hebdo (5 items) / Mensuel (1 item).
- Doc IDs : `{date}_quotidien` / `{YYYY-WXX}_hebdo` / `{YYYY-MM}_mensuel`.

---

### Corner — Pertes

- Produits depuis `catalogue`. Guards null impératifs sur tous les champs.

---

### Documents — GMAO + CRETA GEL (onglets admin dans `/documents`)

- **GMAO** : collection `gmao_demandes`. Photos dans Storage `gmao/`. Filtres client-side : statut + plage dates sur champ `date`.
- **CRETA GEL** : collection `creta_gel_docs`. Fichiers dans Storage `creta_gel/`. Filtres client-side : plage dates sur champ `date`.
- Accessible via `/documents` → onglets 🔧 GMAO / 🧊 CRETA GEL (patron/administrateur uniquement).

---

### Pointages

- `createPointage` (CF) : bloc sortie < 1h après arrivée — `BLOCKED_1H:HH:MM:message`.
- Overtime : re-arrivée après auto-checkout — supprime l'auto-checkout, crée nouvelle arrivée.
- `autoCheckoutSortie` : `*/30 7-23 * * *` Paris — crée départ `{ autoCheckout: true, plannedEndHour }` si pas de départ manuel 1h après fin shift. Timestamp = heure de fin prévue.
- `onPointageLate` : event `retard` dans `planningWeeks/{weekId}/events/{dateISO}` : `{ empId, type: 'retard', minutes }`.
- Champs ajoutés sur pointage arrivée : `lateMinutes`, `plannedStartHour`, `plannedEndHour`.
- Layout.tsx : double confirmation sortie — 1er clic "Pointer ma sortie", 2ème clic "Oui, je quitte mon poste". FAB affiche `blockedUntil` si < 1h.

---

### Planning — barèmes

- **CA progressif** — `/admin/settings` — `settings/primes_ca`
- **Comportement/ponctualité** — `src/modules/planning/utils/primes.ts`, constante `BAREME`
- **Prime hygiène** — même fichier, `HYGIENE_BONUS = 50`
- **Montants custom par employé** — `/planning` — section Employés
- **Contrats** — `settings/contrats.types[]`. Fallback `DEFAULT_CONTRACTS` si absent. `getContractForHours(emp.weeklyCapHours, contracts)` utilisé dans PrimesTab.

---

### Livraisons coursier (Twilio)

- CF `incomingSms` — parse SMS — écrit dans `deliveries`.
- Page `/livraisons` : `onSnapshot deliveries where status=='in_progress'`.
- iPad Corner : enregistre `devices/{uid}` au login, son + WakeLock sur nouvelle livraison.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **yorgios-app** (5635 symbols, 8675 relationships, 224 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/yorgios-app/context` | Codebase overview, check index freshness |
| `gitnexus://repo/yorgios-app/clusters` | All functional areas |
| `gitnexus://repo/yorgios-app/processes` | All execution flows |
| `gitnexus://repo/yorgios-app/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
