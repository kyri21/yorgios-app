# CLAUDE.md — Matias PWA (v6)

## ⚠️ RÈGLES ABSOLUES — lire avant toute action

1. **Ne JAMAIS appeler `initializeApp()`** dans un module ou une page.
   → Seul `src/firebase/config.ts` initialise Firebase, une seule fois.

2. **Un seul projet Firestore : `cuisine-yorgios`.**
   → `src/modules/cuisine/firebase/firebase.ts` est un simple re-export de `src/firebase/config.ts`.
   → Aucun autre projet Firebase n'est utilisé nulle part.

3. **Toujours importer** `db`, `auth`, `storage` directement depuis `src/firebase/config.ts`.

4. **Modules indépendants** → zéro import croisé entre modules.
   Exception autorisée : `src/pages/CommandePublique.tsx` importe `CommandeFormBody`
   depuis `modules/corner/pages/Commandes.tsx`.

5. **Rôle `administrateur`** = alias de `patron` (mêmes droits complets).
   → Partout où `patron` est vérifié, ajouter `administrateur`.

6. **Deploy functions** → toujours compiler d'abord :
   ```bash
   cd functions && npm run build && cd .. && firebase deploy --only functions:nomFonction
   ```

7. **Températures** → doc ID format : `{YYYY-MM-DD}_{fridgeId}_{session}` (session = `matin` ou `soir`).
   → Ne plus utiliser l'ancien format `{date}_{fridgeId}` sans session.

8. **Pointages** → NE JAMAIS écrire directement dans la collection `pointages` depuis le client.
   → Toujours appeler la CF `createPointage` via `httpsCallable(functions, 'createPointage')`.
   → La règle Firestore bloque les `create` directs (`allow create: if false`).

9. **`getFunctions`** est exporté depuis `src/firebase/config.ts` (région `europe-west1`).
   → Importer `functions` depuis `../firebase/config` pour tout appel `httpsCallable`.

10. **Route cuisine** → `/cuisine` (sans suffixe) rend `CuisineDashboard`.
    → Les liens vers la page Réception doivent pointer vers `/cuisine/reception`.

---

## Projet Firebase

- **Project ID** : `cuisine-yorgios`
- **Firestore DB ID** : `test`
- **Région Functions** : `europe-west1`
- **Auth** : Email / Password
- **Hosting URL** : https://cuisine-yorgios.web.app
- **Service account** : `cuisine-yorgios-firebase-adminsdk-fbsvc-1c759ed390.json` (racine, NE PAS commiter)
- ~~`yorgios-app-6a715-e74c29ecbcc3.json`~~ → ancien projet Streamlit, NE PAS utiliser

---

## Équipe & Rôles

| Rôle | Accès | Redirection login |
|------|-------|-------------------|
| `patron` | Tout | `/planning` |
| `administrateur` | Tout (= patron) | `/planning` |
| `manager` | Planning + Corner + CA + Commandes + Pointages | `/planning` |
| `corner` | `/corner` (+ CA lecture seule) + `/messages` + `/planning` (lecture) + `/pointage` | `/corner` |
| `cuisine` | `/cuisine` + `/messages` + `/pointage` + `/crm/captation` | `/cuisine` |

### Utilisateurs connus
| Nom | Rôle | Email |
|-----|------|-------|
| Alexandre | `patron` | a.cozzika@gmail.com |
| Arthur | `administrateur` | kyriazis@outlook.fr |
| Sébastien | `manager` (supervise, ne pointe pas) | sebastien.coenca@gmail.com |
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
| **iPad Corner** | `corner` | ipad@yorgios.fr |

> ⚠️ Les mots de passe ne sont pas stockés ici. Utiliser Firebase Console → Authentication pour les réinitialiser.

---

## Structure dossiers
```
src/
  firebase/
    config.ts           ← UNIQUE initializeApp() — exporte db, auth, storage, functions (europe-west1)
    messaging.ts        ← FCM
  modules/cuisine/
    firebase/firebase.ts ← re-export de src/firebase/config.ts + ensureAnonAuth()
  auth/
    useAuth.ts / AuthGuard.tsx
  router/index.tsx      ← React.lazy() + Suspense sur tous les modules (code splitting)
  components/
    Layout.tsx          ← sidebar dark + bottom nav + bouton ⣿ Corner/Cuisine + lien Pointages + Paramètres
    ModuleGridPanel.tsx ← grille 3×3 sous-pages Corner/Cuisine (bottom sheet)
    Skeleton.tsx        ← Skeleton / SkeletonCard / SkeletonList — shimmer dark pour les loadings
    EmptyState.tsx      ← EmptyState — état vide avec icône + texte + action optionnelle
  pages/
    Login.tsx
    CommandePublique.tsx
    CA.tsx              ← lecture seule si role=corner
    AdminUsers.tsx
    AdminSettings.tsx   ← /admin/settings (patron/admin) — Firestore: settings/
    AdminPointages.tsx  ← /admin/pointages — relevés hebdo/mensuel + export CSV
    Pointage.tsx        ← onglets Aujourd'hui / Historique — appelle CF createPointage (validation GPS serveur)
    AllergeneMenu.tsx   ← /admin/allergenes (patron/admin/manager) — fiche allergènes client + impression A4
    Profile.tsx
  modules/
    planning/           ← COMPLET — vue mobile distincte (MobilePlanningView)
      components/
        Mobile/MobilePlanningView.tsx ← vue jour par jour pour mobile < 768px
        Grid/PlanningGrid.tsx         ← grille desktop (drag-paint)
    cuisine/            ← COMPLET — Dashboard + Réception + Fabrication + Livraisons + Températures + Contrôle
      pages/
        Dashboard.tsx   ← /cuisine (index) — vue d'accueil : frigos, lots en cours, dernière réception, livraisons
        Reception.tsx / Fabrication.tsx / Livraisons.tsx / Temperatures.tsx / Controle.tsx / ReceptionHistorique.tsx
    corner/             ← COMPLET — Dashboard + 12 pages
      pages/
        Dashboard.tsx   ← /corner (index) — skeleton loading, checkbox animée, EmptyState
        Temperatures.tsx ← 2 relevés/jour (matin + soir), doc ID {date}_{fridgeId}_{session}
        Hygiene.tsx / Livraison.tsx / Ruptures.tsx / Commandes.tsx / StockageFrigo.tsx
        Pertes.tsx       ← /corner/pertes — saisie pertes (poids/qté ou prix €) + rapport jour/semaine/mois
        PlanningCorner.tsx ← /corner/planning — vue semaine lecture seule (toutes les pages, tous les shifts)
    crm/                ← COMPLET — CRM Brevo + fidélité
      types.ts          ← ContactPayload, PromoValidationResult
      hooks/useCaptation.ts ← hook httpsCallable syncContactToBrevo
      CaptationPage.tsx ← /crm/captation — formulaire 4 champs (prenom, tel, WhatsApp opt-in, email opt-in)
  hooks/
    usePointageSortie.ts ← FAB sortie dans Layout — appelle CF createPointage (validation GPS serveur)
  config/
    pointageZones.ts    ← zones GPS (référence frontend uniquement — validation réelle côté serveur)

functions/
  src/
    index.ts            ← 25 Cloud Functions (dont createPointage ajouté session 2026-03-28)
    domain/loyalty.ts   ← paliers fidélité (10→5%, 25→10%, 50→15%)
    crm/index.ts        ← logique métier CRM : syncContactToBrevoLogic, syncOrderToBrevoLogic,
                           checkLoyaltyLogic, validatePromoCodeLogic, markPromoCodeUsed
    messagerie/         ← COMPLET

scripts/
  import_historique.py  ← Import Excel → Firestore — SA key: cuisine-yorgios-firebase-adminsdk-fbsvc-1c759ed390.json

functions/
  src/index.ts          ← 20 Cloud Functions
  .env                  ← GCAL_CALENDAR_ID + GMAIL_USER + GMAIL_APP_PASSWORD

reference/data/
  releve_temperature.xlsx    ← données historiques températures (importées ✅)
  Hygiene.xlsx               ← checklists hygiène historiques (importées ✅)
  europoseidon_liaison.xlsx  ← livraisons température + objectifs CA (importés ✅)
  Liste_produits_Yorgios.xlsx
```

---

## Collections Firestore (DB `test`)

| Collection | Accès | Usage |
|-----------|-------|-------|
| `users` | tous (own) + patron/admin/manager (all) | profils, role, fcmToken, employeeId |
| `employees` | patron/admin/manager | employés planning |
| `planningWeeks` | lecture tous, écriture patron/admin/manager | semaines planning |
| `produits` | lecture tous, écriture patron/admin/manager | catalogue produits — champs: `name`, `abrv`, `defaultCategory`, `dlcDays`, `allergenes[]`, `active`, `inVitrine`, `inReception`, `inMenu` |
| `receptions` | cuisine | réceptions HACCP |
| `lots_cuisine` | cuisine | lots fabrication |
| `lot_counters` | cuisine | séquences numéros de lot |
| `livraisons` | tous | livraisons cuisine → corner (departTempC, receptionTempC, result…) |
| `temperatures` | tous | relevés frigos — doc ID `{date}_{fridgeId}_{session}` (matin/soir) |
| `archives` | cuisine | archives mensuelles |
| `hygiene_corner` | corner | checklists — doc ID `{date}_quotidien` / `{YYYY-WXX}_hebdo` / `{YYYY-MM}_mensuel` |
| `corner_stock` | corner | produits vitrine avec DLC |
| `corner_commandes` | corner | ruptures jour (legacy) |
| `messages` | tous | messagerie interne (TTL 7j) |
| `commandes_externes` | create public, read/update corner | commandes clients |
| `non_conformites` | corner | livraisons refusées + décisions |
| `objectifs_ca` | patron/admin/manager (écriture) — corner (lecture) | CA mensuel (doc ID = YYYY-MM) |
| `stockage_frigo` | tous | stock frigos corner |
| `pointages` | write tous, read patron/admin/manager | pointages GPS |
| `notifications_log` | own uniquement | anti-doublon notifs |
| `settings` | patron/admin | paramètres app — docs: `notifications`, `emails`, `exports`, `reception` (`fournisseurs[]`), `temperatures` (`alertMinC`), `ruptures` (`produits[]`) |
| `pertes_corner` | corner | pertes journalières — champs: `date`, `productName`, `type` (quantite/prix), `valeur`, `unite`, `note`, `addedAt` |
| `customers` | CRM functions (write) | clients CRM — doc ID = E.164 sans `+` (ex: `33612345678`) — champs: `prenom`, `emailOptIn`, `whatsappOptIn`, `orderCount`, `avgBasket`, `lastOrderAt`, `activePromoCode{code,discountPercent,expiresAt,used,earnedAtOrder}`, `loyaltyTier`, `createdAt`, `source` |
| `crm_sync_log` | CRM functions (write) | logs opérations CRM — champs: `action`, `contactId`, `timestamp`, `vendeurUid`, `brevoStatus` |

---

## Cloud Functions déployées (`europe-west1`) — 24 fonctions

| Fonction | Déclencheur | Rôle |
|----------|------------|------|
| `onNewMessage` | Firestore create `messages/{id}` | Push FCM à tous sauf expéditeur |
| `purgeOldMessages` | Scheduler quotidien | Supprime messages expiresAt < now |
| `onNewCommande` | Firestore create `commandes_externes/{id}` | Push FCM patron + manager |
| `onCommandeUpdated` | Firestore update `commandes_externes/{id}` | Acceptée → GCal + FCM ; Refusée/Livrée → FCM + sync Brevo + fidélité |
| `notifCommandesJ2` | Scheduler 14h00 | Rappel J-2 livraisons |
| `notifCommandesJJ` | Scheduler 09h00 | Rappel jour-J livraisons |
| `onCommandePrete` | httpsCallable | FCM patron+manager+cuisine + message messagerie |
| `onPointageLate` | Firestore create `pointages/{id}` | Email si retard > 10 min |
| `notifTemperatures` | Scheduler 8h30 | FCM corner si frigos matin non saisis |
| `notifTemperaturesEvening` | Scheduler 22h00 | FCM corner si frigos soir non saisis |
| `notifTooGoodToGo` | Scheduler 9h00 | FCM aux employés ayant pointé |
| `notifCartonsChambrefroide` | Scheduler 9h30 | FCM corner+cuisine — "A-t-on besoin de vider les cartons en chambre froide ?" |
| `notifPlatsJour` | Scheduler 11h00 | FCM cuisine + corner — "Faire les plats du jour." |
| `notifUrgences` | Scheduler 15h00 | FCM aux employés ayant pointé |
| `notifHygieneHebdo` | Scheduler samedi 18h | FCM si checklist hebdo non faite |
| `notifHygieneMensuel` | Scheduler 28-31 du mois 18h | FCM si checklist mensuelle non faite |
| `weeklyHygieneRecap` | Scheduler lundi 8h | Email récap températures + hygiène manquants |
| `createUser` | httpsCallable (patron/admin) | Créer un compte utilisateur |
| `deleteUser` | httpsCallable (patron/admin) | Supprimer un compte utilisateur |
| `onLivraisonTemperature` | Firestore create `livraisons/{id}` | FCM patron+admin+manager — départ |
| `onLivraisonReception` | Firestore update `livraisons/{id}` (receptionTempC null→valeur) | FCM patron+admin+manager — réception |
| `syncContactToBrevo` | httpsCallable (corner/manager/patron) | Crée/met à jour contact Brevo + `customers/` Firestore — secrets: BREVO_API_KEY, BREVO_LIST_ID |
| `validatePromoCode` | httpsCallable (corner/manager/patron) | Vérifie code promo client — retourne discountPercent si valide |
| `validatePromoCodePublic` | onRequest (WordPress, header X-Yorgios-Secret) | Même validation, auth par secret header — secret: YORGIOS_WP_SECRET |
| `onCommandeUpdated` *(étendu)* | Firestore update `commandes_externes/{id}` statut→Livrée | + sync Brevo commande + calcul fidélité + marque promo utilisée |

---

## Navigation — bouton ⣿ (grille modules)

- **Bottom nav mobile** : quand on est sur `/corner/*` ou `/cuisine/*`, l'icône de l'item devient ⣿ (9 points)
- Tapper ⣿ ouvre `ModuleGridPanel` : bottom sheet avec grille 3×3 des sous-pages (icônes colorées iOS)
- La page active est mise en avant (bordure orange, ombre colorée)
- Corner : Dashboard, Températures, Livraison, Hygiène, Vitrine, Frigo, Ruptures, Commandes, Contrôle, Pertes, Planning, CA (manager+), CRM
- Cuisine : Réception, Fabrication, Livraisons, Températures, Contrôle, Photos réception, CRM

---

## Planning — UI mobile vs desktop

- **Desktop** (≥ 768px) : grille complète drag-paint, cartes employés, tous les boutons
- **Mobile** (< 768px) : `MobilePlanningView` — vue jour par jour, lecture seule
  - Pills 7 jours avec point orange si employés planifiés
  - Cards par employé : initiales colorées, horaires (8h–16h), durée
  - Absences/événements avec emoji
  - Stats du jour (nb employés, total heures)
  - Navigation semaine ← →

---

## Pointage — relevés

- `/pointage` : onglet "Aujourd'hui" (existant) + onglet "Historique" (semaine, navigation ← →)
- `/admin/pointages` (patron/admin/manager) : relevés hebdo/mensuel + export CSV
  - Sélecteur Semaine / Mois avec navigation
  - Stats : employés présents, journées, sans départ
  - Export CSV UTF-8 BOM (compatible Excel)

---

## Frigos — mapping Excel → app

| Excel (ancien) | App (ID Firestore) | Nom affiché |
|----------------|--------------------|-------------|
| Frigo 1 / 2 / 3 (fusionnés) | `FRIGO_3P` | Frigo 3 portes |
| Vitrine 1 | `VITRINE_1` | Vitrine 1 |
| Vitrine 2 | `VITRINE_2` | Vitrine 2 |
| Vitrine 3 | `VITRINE_3` | Vitrine 3 |
| Grand frigo / Grand Frigo | `GRAND_FRIGO` | Grand frigo |

---

## Hygiène Corner — items (correspondance Excel ↔ app)

### Quotidien (13 items)
`plats_service`, `int_vitrines`, `ustensiles`, `meuble_vente`, `comptoir_balance`,
`micro_ondes`, `evier_papier`, `etiquettes`, `plan_travail`, `ext_placards`,
`ext_frigo`, `poubelle`, `vitres`

### Hebdomadaire (5 items)
`int_frigos`, `etageres_materiels`, `support_papier`, `placard_hygiene`, `machine_glacon`

### Mensuel (1 item)
`placard_rangement`

---

## PWA & Notifications push

- **Nom app** : `Matias` (manifest `name` + `short_name`)
- **Icône** : oeil grec (nazar/mati) — source dans `image icon app/`, déployée dans `public/icons/`
  - `icon-192.png` (192×192) et `icon-512.png` (512×512)
- `vite-plugin-pwa` — SW auto-généré
- `public/firebase-messaging-sw.js` — SW FCM background
- `VITE_FIREBASE_VAPID_KEY` dans `.env`
- Tokens FCM dans `users/{uid}.fcmToken`

---

## UI/UX — Design system (dark iOS)

- **Fond** `#000`, **Surface** `#1c1c1e`, **Surface 2** `#2c2c2e`, **Bordure** `#38383a`
- **Accent** orange `#E8760A`, **Danger** `#ff453a`, **Success** `#32d74b`, **Warning** `#ffd60a`
- **Font** : Inter
- **Layout mobile** : bottom nav + safe area iOS
- **Layout desktop** : sidebar 220px (`md:`)
- Toujours tester en navigation privée (SW cache)

---

## Routes

| Route | Auth | Accès |
|-------|------|-------|
| `/login` | Non | Public |
| `/commande` | Non | Public |
| `/planning/*` | Oui | patron, admin, manager, corner (lecture) |
| `/cuisine` | Oui | patron, admin, manager, cuisine — **Dashboard Cuisine** (index) |
| `/cuisine/reception` | Oui | patron, admin, manager, cuisine |
| `/cuisine/fabrication` | Oui | patron, admin, manager, cuisine |
| `/cuisine/livraisons` | Oui | patron, admin, manager, cuisine |
| `/cuisine/temperatures` | Oui | patron, admin, manager, cuisine |
| `/cuisine/controle` | Oui | patron, admin, manager, cuisine |
| `/cuisine/reception-historique` | Oui | patron, admin, manager, cuisine |
| `/corner/*` | Oui | patron, admin, manager, corner |
| `/ca` | Oui | patron, admin, manager |
| `/messages` | Oui | tous |
| `/pointage` | Oui | tous sauf manager |
| `/profile` | Oui | tous |
| `/admin/users` | Oui | patron, admin |
| `/admin/settings` | Oui | patron, admin |
| `/admin/pointages` | Oui | patron, admin, manager |
| `/admin/produits` | Oui | patron, admin |
| `/admin/allergenes` | Oui | patron, admin, manager |
| `/crm/captation` | Oui | patron, admin, manager, corner, cuisine |

> ⚠️ La route `/cuisine` (sans slash final) rend maintenant `CuisineDashboard`. L'ancienne route `/cuisine` qui rendait `Reception` directement est remplacée. Les liens dans `ModuleGridPanel.tsx` pointant vers `/cuisine` amènent au dashboard — vérifier s'ils doivent pointer vers `/cuisine/reception`.

---

## État d'avancement

| Module / Feature | Statut |
|-----------------|--------|
| Planning | ✅ Complet |
| Planning — vue mobile distincte | ✅ Complet |
| Cuisine | ✅ Complet |
| Corner (12 pages dont CA lecture seule) | ✅ Complet |
| Messagerie | ✅ Complet |
| Commandes publiques + gestion | ✅ Complet |
| Non-conformités | ✅ Complet |
| Objectifs CA + Prime | ✅ Complet — lecture seule pour corner |
| Gestion utilisateurs `/admin/users` | ✅ Complet |
| Admin Paramètres `/admin/settings` | ✅ Complet |
| Stockage Frigo | ✅ Complet |
| Pointage GPS multi-zones | ✅ Complet — onglet Historique ajouté |
| Relevés pointage `/admin/pointages` | ✅ Complet — export CSV |
| Bouton ⣿ navigation modules (Corner/Cuisine) | ✅ Complet |
| Températures 2 relevés/jour (matin+soir) | ✅ Complet — UI compacte grille 5×2, un seul bouton save |
| Hygiène items = Excel réel | ✅ Complet — UI dark cohérente (plus de classes light mode) |
| Import historique Excel → Firestore | ✅ Exécuté — 3 540 docs importés |
| Import planning Excel → Firestore | ✅ Exécuté — 24 semaines (oct.2025→avr.2026) via `scripts/import_planning.py` |
| Import livraisons Excel → Firestore | ✅ Exécuté — 82 docs → `livraisons` via `scripts/import_livraisons.py` |
| Import vitrine historique Excel → Firestore | ✅ Exécuté — 3 916 docs `active:false` → `corner_stock` via `scripts/import_vitrine.py` |
| Cloud Functions (16) | ✅ Toutes déployées |
| notifTemperatures — format doc ID `_matin` | ✅ Corrigé et déployé |
| Email retard pointage | ✅ `GMAIL_APP_PASSWORD` configuré, `onPointageLate` + `weeklyHygieneRecap` redéployés |
| Protocoles PDF `/protocoles` | ❌ Non développé (décision reportée) |
| Notifications push avancées (frontend) | ❌ Pas encore développé |
| Icône PWA oeil grec + nom "Matias" | ✅ Complet — icône, `index.html`, manifest, Layout, Login |
| Login page — dark theme Matias | ✅ Complet — fond noir, inputs sombres, icône oeil |
| Vitrine — saisie lot multi-produits | ✅ Complet — date fab + DLC J+3 auto + sélection multiple |
| Node.js 22 upgrade (functions) | ✅ Complet — `firebase.json` + `functions/package.json` mis à jour, 16 fonctions redéployées |
| UI dark mode — Dashboard, CA, Livraison, Commandes, StockageFrigo, Vitrine mobile | ✅ Complet |
| UI dark mode — Ruptures.tsx | ✅ Complet |
| UI dark mode — Module cuisine complet (5 pages) | ✅ Complet — cuisine.css supprimé, dark iOS inline styles |
| Livraison corner — onglet Historique + photos cliquables | ✅ Complet — date picker, modal photo plein écran |
| Vitrine + Dashboard — tables DLC DÉPASSÉE / DLC du JOUR | ✅ Complet — tableaux rouge/jaune avec colonnes Produit/Fab/DLC |
| Contrôle corner — fix index Firestore temperatures | ✅ Corrigé — supprimé orderBy('session') qui nécessitait index composite |
| Contrôle — rapport hygiène complet + export Excel + PDF | ✅ Complet — pivot tables, 6 feuilles, jspdf-autotable |
| Hygiène — date picker pour saisie rétroactive | ✅ Complet |
| Login — redesign Patreon-style + oeil grec watermark | ✅ Complet — no card, fond noir, oeil en arrière-plan |
| Nommage Matias/Yorgios | ✅ Matias = app, Yorgios = restaurant. AdminSettings + DailyPointageGate → Matias |
| Seuil alarme températures — configurable AdminSettings | ✅ `settings/temperatures.alertMinC` — corner + cuisine Temperatures.tsx chargent depuis Firestore |
| Renommage "Commandes" → "Commandes clients" | ✅ `ModuleGridPanel.tsx` grille ⣿ |
| Push 22h températures soir manquantes | ✅ CF `notifTemperaturesEvening` déployée (scheduler 22h) |
| Email récap hebdo hygiène + températures | ✅ CF `weeklyHygieneRecap` déployée (lundi 8h) — `GMAIL_APP_PASSWORD` configuré ✅ |
| Bouton TooGoodToGo | ✅ Dashboard corner — deep link `toogoodtogo://fr-fr` + fallback web intelligent (visibilitychange) |
| Formulaire commandes clients — champs événement | ✅ `dateEvenement`, `typeEvenement`, `nombreConvives` — public + interne |
| Températures — vue semaine heatmap | ✅ Onglet "📊 Semaine" — grille frigos × 7 jours, nav semaine, stats |
| Dashboard corner — card Commandes clients | ✅ Remplace Ruptures — nb commandes aujourd'hui / cette semaine |
| Dashboard corner — hygiène 3 niveaux | ✅ Card Hygiène affiche Quotidien + Hebdo + Mensuel (Fait / À faire) |
| Push hygiène hebdo J-1 (samedi 18h) | ✅ CF `notifHygieneHebdo` déployée |
| Push hygiène mensuel J-1 (avant-dernier jour du mois 18h) | ✅ CF `notifHygieneMensuel` déployée |
| Messagerie — dark mode complet | ✅ Fond #000, barre input #1c1c1e, boutons dark, accent orange envoi |
| Profile — planning lié + export ICS | ✅ Complet — lier via `/admin/users` dropdown "LIEN PLANNING" ; bouton "Télécharger .ics" sous les shifts |
| Températures cuisine — 5 frigos corrects | ✅ Complet — Frigo 1 entrée, Grand frigo porte inox, Grand frigo porte verre, Frigo 2 milieu, Frigo four |
| Fabrication — edit + archive + supprimer lots | ✅ Complet — ✏️ modifier qté/date, ✓ Livré archive, 🗑 supprimer, 📦 voir archives |
| Réception — produits depuis Firestore | ✅ Complet — charge `inReception==true`, fallback tous actifs si aucun flag |
| AdminProduits `/admin/produits` | ✅ Complet — CRUD + 🏪 toggle `inVitrine` + 📋 toggle `inReception` + désactiver |
| Vitrine corner — 2 modes ajout | ✅ Complet — "✏️ Saisie manuelle" (liste Firestore `inVitrine`) + "📦 Depuis lot cuisine" (lots archivés) |
| StockageFrigo — ajout depuis lot cuisine | ✅ Complet — bouton "📦 Depuis cuisine" pré-remplit nom/qté/DLC |
| AdminSettings — fournisseurs réception | ✅ Complet — liste éditable dans Paramètres → `settings/reception.fournisseurs[]` |
| Produits Firestore — flags en masse | ✅ Script `scripts/setup_produits_flags.py` — 69 docs vides supprimés, `inVitrine` set par catégorie, 9 produits réception créés |
| Index Firestore composite | ✅ `firestore.indexes.json` — `lots_cuisine`: archived ASC + archivedAt DESC |
| Suppression "Yorgios" dans l'UI | ✅ Tout renommé "Matias" dans src/, public/, vite.config.ts (IDs Firebase cuisine-yorgios conservés) |
| Gmail credentials functions | ✅ `GMAIL_APP_PASSWORD` configuré dans `functions/.env`, fonctions redéployées |
| Planning — header responsive (wrap) + supprimer semaine | ✅ `flexWrap: wrap` — bouton 🗑 vide toute la semaine + sauvegarde Firestore immédiate |
| Livraison corner — onglet 📷 Galerie photos | ✅ Galerie filtrée par plage de dates, miniatures cliquables (départ + réception), modal plein écran |
| Vitrine corner — onglet 📋 Historique | ✅ Tableau filtrable : produit, lot, date ajout, date fab, DLC, date retirée, statut — plage de dates + recherche texte |
| Fabrication cuisine — QR code / étiquette lot | ✅ Bouton ⬛ sur chaque lot → modal QR (api.qrserver.com) + 🖨️ impression fenêtre dédiée (lotCode, produit, fab, DLC, qté) |
| Toast global | ✅ `src/hooks/useToast.ts` + `src/components/Toast.tsx` — 3 états (success/error/info), slide-up 2.5s, branché sur Hygiene, Temperatures, Vitrine, StockageFrigo, Fabrication, Pointage |
| Bandeau hors-ligne | ✅ Layout.tsx — listeners `online`/`offline`, bandeau orange fixed top, disparaît à la reconnexion |
| Heures totales par employé — AdminPointages | ✅ Bloc "Récapitulatif employés" : total heures + jours travaillés par personne sur la période |
| Dashboard corner — "À faire aujourd'hui" | ✅ Card en tête de dashboard : Hygiène quotidienne, Temp matin, Temp soir (jaune <17h / rouge ≥17h), DLC vitrine — vert/rouge + navigation directe |
| Allergènes produits — AdminProduits | ✅ Champ `allergenes: string[]` — 14 allergènes INCO 2014, checkboxes dark iOS, badges orange dans la liste, sauvegardé dans Firestore `produits` |
| Allergènes — affichage dans Reception.tsx | ✅ Bloc orange ⚠️ avec badges après sélection produit si allergènes présents |
| Fiche Allergènes `/admin/allergenes` | ✅ Complet — toggle "en vente" (`inMenu`) persisté Firestore, ajout nouveau produit + allergènes, édition allergènes existants, impression A4 tableau 14 colonnes headers verticaux |

---

| Login iPad Corner | ✅ Complet — bouton "📱 iPad Corner", compte `ipad@yorgios.fr` / mdp `corner` |
| Login iPad Cuisine | ✅ Complet — compte `ipad.cuisine@yorgios.fr` / mdp `cuisine` |
| Nouveaux utilisateurs cuisine | ✅ Créés — Timour, Junior, Danioko, Ali, Periklis (scripts/create_users.mjs) |
| Module CRM — Captation Brevo | ✅ Complet — `/crm/captation` corner+cuisine+manager, 3 CF déployées (syncContactToBrevo, validatePromoCode, validatePromoCodePublic) |
| CRM — Fidélité + codes promo | ✅ Complet — paliers 10/25/50 commandes, génération code YRG-FIDELITE-XXXX, validation dans Commandes.tsx |
| CRM — Secrets Firebase | ✅ Configurés — BREVO_API_KEY, BREVO_LIST_ID=3, YORGIOS_WP_SECRET |
| Ruptures — disponibilité plats | ✅ Complet — section "0️⃣ EST-CE QUE J'AI DU STOCK ?" avec OUI/NON iOS pour 10 plats, NON → auto-rupture |
| Planning — export Excel mois | ✅ Complet — bouton "📊 Exporter Excel" dans MonthlyView, 2 feuilles (récap + détail semaines) |
| Planning Corner lecture seule | ✅ Complet — `/corner/planning`, vue semaine complète, navigation ← → |
| Notifications 9h30 + 11h | ✅ Complet — `notifCartonsChambrefroide` + `notifPlatsJour` déployées |
| Dashboard corner — cases à cocher tâches | ✅ Complet — TooGoodToGo, cartons, plats du jour (localStorage, reset quotidien) |
| Ruptures — photos & stock optionnels | ✅ Complet — plus de blocage à l'envoi |
| FAB pointage sortie | ✅ Complet — bouton rouge pulsant bas-droite, toutes pages, hook `usePointageSortie.ts` |
| Module Pertes corner `/corner/pertes` | ✅ Complet — saisie poids/qté/prix + rapport jour/semaine/mois, collection `pertes_corner` |
| Module CRM Brevo + fidélité | ✅ Complet — `/crm/captation` corner+cuisine+manager, syncContactToBrevo, validatePromoCode, validatePromoCodePublic, onCommandeUpdated étendu |
| CRM — code promo dans Commandes.tsx | ✅ Complet — champ "Code fidélité", validation CF, prix réduit affiché, persisté Firestore |
| Ruptures — disponibilité plats OUI/NON | ✅ Complet — section "0️⃣ EST-CE QUE J'AI DU STOCK ?" 10 produits boutons iOS, NON → auto-rupture |
| Planning — export Excel mois | ✅ Complet — bouton "📊 Exporter Excel", 2 feuilles (récap + détail semaines) |
| Nouveaux comptes cuisine | ✅ Créés — Timour (ytimour86), Junior (jrmaissonn), Danioko (mdanioko650), Ali (c_ali), Periklis (perkokko) |
| iPad Cuisine | ✅ Créé — `ipad.cuisine@yorgios.fr` / mdp `cuisine`, rôle `cuisine` |
| CRM grille ⣿ Cuisine + Corner | ✅ Ajouté dans `ModuleGridPanel.tsx` pour les deux modules |
| AdminSettings — seuil températures + plats ruptures | ✅ Complet — `settings/temperatures.alertMinC` + `settings/ruptures.produits[]` éditables, chargés dynamiquement dans Temperatures.tsx + Ruptures.tsx |
| Cuisine — Historique photos réceptions | ✅ Complet — `/cuisine/reception-historique`, filtres date+fournisseur, modal photo, bouton imprimer, grille ⣿ |
| Réception cuisine — fournisseur "Autre" | ✅ Complet — option "Autre…" + saisie libre `fournisseurAutre`, validation, valeur envoyée en Firestore |
| **Audit sécurité — règles Firestore** | ✅ 2026-03-28 — isolation par rôle (Corner/Cuisine), livraisons create/update séparés, settings lisible par tous |
| **Anti-spam commandes publiques** | ✅ 2026-03-28 — CF `onNewCommande` : max 3 commandes/24h par téléphone |
| **Validation GPS côté serveur** | ✅ 2026-03-28 — CF `createPointage` : Haversine serveur, anti-doublon, rôle vérifié. Firestore bloque les creates directs |
| **Mots de passe hors CLAUDE.md** | ✅ 2026-03-28 — supprimés du fichier, remplacés par note Firebase Console |
| **Gitignore secrets/** | ✅ 2026-03-28 — `secrets/` ajouté au .gitignore |
| **Code splitting (lazy loading)** | ✅ 2026-03-28 — tous les modules en `React.lazy()` + `<Suspense fallback={LoadingScreen}>` dans router |
| **Nettoyage artefacts Streamlit** | ✅ 2026-03-28 — Procfile, pages/*.py, cornerConfig.ts supprimés |
| **Skeleton loaders** | ✅ 2026-03-28 — `src/components/Skeleton.tsx` (Skeleton / SkeletonCard / SkeletonList) |
| **Empty states** | ✅ 2026-03-28 — `src/components/EmptyState.tsx` |
| **Transitions / animations CSS** | ✅ 2026-03-28 — page-in, skeleton-shimmer, check-pop, sheet-in, card hover lift dans index.css |
| **Dashboard Cuisine** | ✅ 2026-03-28 — `src/modules/cuisine/pages/Dashboard.tsx` — frigos, lots en cours, réception, livraisons |
| **Dashboard Corner amélioré** | ✅ 2026-03-28 — skeleton loading, checkbox animée (check-pop) |
| **lucide-react installé** | ✅ 2026-03-28 — disponible pour remplacement des SVG inline futurs |

## 🔴 À FAIRE — prochaine session

### 1. Refonte composants Planning (DERNIÈRE ÉTAPE DESIGN)
**Session 2026-03-29 batch 2 — Pages utilisateurs 100% migrées. Reste uniquement les composants internes du module Planning :**

| Fichier | Lignes | Statut |
|---------|--------|--------|
| `src/modules/planning/components/Events/EventModal.tsx` | 283 | ❌ dark slate `#1e293b`/`#0f172a` — à migrer Aegean |
| `src/modules/planning/components/Import/ImportModal.tsx` | 506 | ❌ dark slate — à migrer Aegean |
| `src/modules/planning/components/Monthly/MonthlyView.tsx` | 115 | ❌ dark slate — à migrer Aegean |

Ces 3 fichiers utilisent un thème dark slate (Tailwind `#1e293b`, `#0f172a`, `#334155`) — pas le dark iOS mais tout aussi incompatible avec Aegean. Lire chaque fichier et remplacer par `var(--surface)`, `var(--on-surface)`, `var(--primary)`, etc.

**État global refonte :**
- Toutes les pages utilisateur ✅ (Corner, Cuisine, Messagerie, Profil, Pointage, CA, Admin, Planning mobile)
- Composants partagés ✅ (Layout, Toast, Skeleton, DailyPointageGate, GdprConsentModal, ModuleGridPanel)
- Composants planning internes ❌ (EventModal, ImportModal, MonthlyView)

### 2. Déployer CF syncContactToBrevo (champs nom/email/entreprise)
```bash
cd functions && npm run build && cd .. && firebase deploy --only functions:syncContactToBrevo
```

### 3. Protocoles PDF `/protocoles`
- Non développé (décision reportée)

### 4. Module Pertes — référentiel produits + prix
- En attente du fichier Excel références + prix unitaires (à fournir par l'utilisateur)

## Cloud Functions déployées — liste complète (25 fonctions)

| Fonction | Déclencheur | Rôle |
|----------|------------|------|
| `onNewMessage` | Firestore create `messages/{id}` | Push FCM à tous sauf expéditeur |
| `purgeOldMessages` | Scheduler quotidien | Supprime messages expiresAt < now |
| `onNewCommande` | Firestore create `commandes_externes/{id}` | Anti-spam 3/24h par tél + Push FCM patron+manager |
| `onCommandeUpdated` | Firestore update `commandes_externes/{id}` | Acceptée → GCal + FCM ; Refusée/Livrée → FCM + sync Brevo + fidélité |
| `notifCommandesJ2` | Scheduler 14h00 | Rappel J-2 livraisons |
| `notifCommandesJJ` | Scheduler 09h00 | Rappel jour-J livraisons |
| `onCommandePrete` | httpsCallable | FCM patron+manager+cuisine + messagerie |
| `onPointageLate` | Firestore create `pointages/{id}` | Email si retard > 10 min |
| `notifTemperatures` | Scheduler 8h30 | FCM si frigos matin non saisis |
| `notifTemperaturesEvening` | Scheduler 22h00 | FCM si frigos soir non saisis |
| `notifTooGoodToGo` | Scheduler 9h00 | FCM aux employés ayant pointé |
| `notifPlatsJour` | Scheduler 11h00 | FCM cuisine + corner |
| `notifUrgences` | Scheduler 15h00 | FCM aux employés ayant pointé |
| `notifHygieneHebdo` | Scheduler samedi 18h | FCM si checklist hebdo non faite |
| `notifHygieneMensuel` | Scheduler 28-31 du mois 18h | FCM si checklist mensuelle non faite (avant-dernier jour) |
| `weeklyHygieneRecap` | Scheduler lundi 8h | Email récap températures + hygiène manquants |
| `createUser` | httpsCallable | Créer un compte utilisateur |
| `deleteUser` | httpsCallable | Supprimer un compte utilisateur |
| `onLivraisonTemperature` | Firestore create `livraisons/{id}` | FCM patron+admin+manager — départ |
| `onLivraisonReception` | Firestore update `livraisons/{id}` | FCM patron+admin+manager — réception |
| `syncContactToBrevo` | httpsCallable | Crée/met à jour contact Brevo + `customers/` |
| `validatePromoCode` | httpsCallable | Vérifie code promo (app Matias) |
| `validatePromoCodePublic` | onRequest | Vérifie code promo (WordPress, header X-Yorgios-Secret) |
| `createPointage` | httpsCallable | **Validation GPS serveur** — Haversine, anti-doublon, rôle vérifié — écrit en Firestore via admin SDK |
| `notifCartonsChambrefroide` | Scheduler 9h30 | FCM corner+cuisine |

---

## Corrections importantes apportées

### Bug timezone `weekId` (planning)
- `weekId()` dans `src/modules/planning/firebase/planning.ts` utilisait `.toISOString()` (UTC)
- En France (UTC+1), minuit local = veille 23h UTC → mauvaise clé Firestore
- **Fix** : utilise désormais `toLocalISO(monday)` (date locale)

### Import planning Excel
- Script : `scripts/import_planning.py`
- Mapping initiales : D=Arthur, S=Sébastien, A=Alexandre, E=Elena, K=Markella, Y=Layal, N=Mellina, X=Wahib
- 24 semaines importées, 3 feuilles ignorées (dates manquantes)
- Relancer : `python3 scripts/import_planning.py [--dry-run]`

### Vitrine — structure Firestore enrichie
- Nouveaux champs : `fabricationAt` (Timestamp), `dateAjout` (Timestamp)
- DLC = fabrication + 3 jours (calculé côté client, non modifiable)

---

## Règles GEP — températures livraison

| Catégorie | Max standard | Max tolérance |
|-----------|-------------|---------------|
| Viande hachée | 2°C | 3°C |
| Viande | 3°C | 5°C |
| Poisson | 2°C | 3°C |
| Lait | 4°C | 6°C |
| Plat cuisiné frais | 3°C | 5°C |
| Pâtisserie fraîche | 3°C | 5°C |
| Légumes | 8°C | 10°C |

---

## Commandes utiles
```bash
npm run dev
npm run deploy                                                         # build + hosting
cd functions && npm run build && cd .. && firebase deploy --only functions:nomFonction
firebase deploy --only firestore:rules
python3 scripts/import_historique.py --dry-run                        # test import
python3 scripts/import_historique.py                                  # import réel
```

## Variables d'environnement (`.env` racine)
```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_VAPID_KEY=
```

## Variables d'environnement (`functions/.env`)
```
GCAL_CALENDAR_ID=yorgios.system@gmail.com
GMAIL_USER=a.cozzika@gmail.com
GMAIL_APP_PASSWORD=xxxx     ← à configurer (myaccount.google.com > Mots de passe des applications)
```

> ⚠️ Node.js 20 → déprécié 30/04/2026 : upgrade vers Node 22 dans `functions/package.json` avant cette date.

---

## 🚀 Mettre le code sur GitHub (sauvegarde sécurisée)

> L'app tourne déjà seule : Firebase Hosting + Functions + Firestore sont dans le cloud.
> GitHub sert uniquement à sauvegarder le **code source**.

### Fichiers à NE JAMAIS commiter (déjà dans .gitignore)
- `cuisine-yorgios-firebase-adminsdk-fbsvc-1c759ed390.json` — clé service account Firebase
- `functions/.env` — GMAIL_APP_PASSWORD
- `.streamlit/secrets.toml` — anciens secrets Streamlit
- `memory/` — mémoire Claude locale

### Procédure complète (à faire une seule fois)

```bash
# 1. Vérifier que les fichiers sensibles sont bien ignorés
git status --short
# ✅ Les fichiers .json service account et functions/.env ne doivent PAS apparaître

# 2. Ajouter tous les fichiers source
git add .

# 3. Vérifier ce qui sera commité (RELIRE avant de continuer)
git diff --staged --name-only

# 4. Commiter
git commit -m "Initial commit — Matias PWA v6"

# 5. Pousser sur GitHub
git push origin main
```

### Où retrouver les secrets si tu changes d'ordinateur
Ces fichiers NE sont PAS sur GitHub — à conserver en lieu sûr (ex: clé USB chiffrée, 1Password) :

| Fichier | Où le retrouver |
|---------|----------------|
| `cuisine-yorgios-firebase-adminsdk-fbsvc-1c759ed390.json` | Firebase Console → Paramètres projet → Comptes de service → Générer une nouvelle clé |
| `functions/.env` | Remettre manuellement : `GCAL_CALENDAR_ID`, `GMAIL_USER`, `GMAIL_APP_PASSWORD` |
| `.env` (racine) | Firebase Console → Paramètres projet → Vos applications → Config SDK |

### Pour cloner sur un nouvel ordinateur
```bash
git clone https://github.com/kyri21/yorgios-app.git
cd yorgios-app
npm install

# Remettre les fichiers secrets (voir tableau ci-dessus)
# Copier cuisine-yorgios-firebase-adminsdk-fbsvc-1c759ed390.json à la racine
# Créer .env avec les variables Firebase
# Créer functions/.env avec GMAIL_APP_PASSWORD

npm run dev        # développement local
npm run deploy     # build + push Firebase Hosting
```

---

## 🎨 REFONTE DESIGN — ÉTAT AVANCEMENT

> Design system Aegean Precision — **SHELL + 3 PAGES TERMINÉS, migration couleurs bulk faite**.
> Lire `reference/UI UX/stitch_r_ception_marchandises 1ere partie/aegean_precision/DESIGN.md` avant chaque page.

### ✅ Terminé (session 2026-03-28)
- **index.html** : fonts Epilogue + Manrope depuis Google Fonts
- **src/index.css** : design system complet Aegean (variables CSS, composants `.btn-primary`, `.input`, `.chip-ok/danger/warn`, `.nav-tabs/.nav-tab`, `.glass`)
- **Layout.tsx** : fond eggshell, sidebar blanche, bottom nav glass, accent `#004275`, icône ⚙️ Paramètres dans header mobile pour patron/admin
- **Login.tsx** : fond eggshell, card blanche, bouton gradient bleu, Epilogue/Manrope
- **corner/index.tsx** : "Commandes" → "Commandes clients", onglet CRM ajouté, style `.nav-tabs` Aegean
- **cuisine/index.tsx** : onglet CRM ajouté, style `.nav-tabs` Aegean
- **CaptationPage.tsx** : champs Prénom, Nom, Téléphone, Email, Entreprise — design Aegean
- **crm/types.ts** + **useCaptation.ts** + **functions/src/crm/index.ts** : champs `nom`, `email`, `entreprise` ajoutés

### ✅ Terminé (session 2026-03-29)

**Pages refaites complètement (structure éditoriale Aegean) :**
- **Dashboard Corner** (`modules/corner/pages/Dashboard.tsx`)
- **Températures Corner** (`modules/corner/pages/Temperatures.tsx`)
- **Hygiène Corner** (`modules/corner/pages/Hygiene.tsx`)
- **Dashboard Cuisine** (`modules/cuisine/pages/Dashboard.tsx`)
- **Températures Cuisine** (`modules/cuisine/pages/Temperatures.tsx`) — IDs frigos corrects : `CUI_FRIGO1_ENTREE`, `CUI_GRAND_FRIGO_INOX`, `CUI_GRAND_FRIGO_VERRE`, `CUI_FRIGO2_MILIEU`, `CUI_FRIGO_FOUR`
- **Réception Cuisine** (`modules/cuisine/pages/Reception.tsx`)
- **Fabrication Cuisine** (`modules/cuisine/pages/Fabrication.tsx`)

**Migration bulk variables CSS sur 28 fichiers (couleurs correctes, structure à finaliser) :**
Les remplacements suivants ont été appliqués sur toutes les pages restantes :
- `var(--text-1/2/3)` → `var(--on-surface/2/3)`
- `var(--surface-2)` → `var(--surface-mid)`
- `var(--border-dark)` → `var(--border)`
- `var(--accent)` / `#E8760A` → `var(--primary)` / `#004275`
- Couleurs inline dark iOS → variables Aegean light (success, danger, warning, primary tint)

> ⚠️ Ces pages ont les **bonnes couleurs** mais n'ont pas encore la **structure éditoriale Aegean complète** (headers Epilogue, `.page`/`.card`, tabs `.nav-tabs`, `.section-label`). Elles sont lisibles et cohérentes mais pas finies.

### ⚠️ CF à déployer
```bash
cd functions && npm run build && cd .. && firebase deploy --only functions:syncContactToBrevo
```

### ❌ Pages internes à refaire — structure éditoriale Aegean complète
Refaire dans cet ordre, **lire le screen.png correspondant avant chaque page** :

| Page | Fichier | Référence | Priorité |
|------|---------|-----------|----------|
| ~~Dashboard Cuisine~~ | ✅ done | — | — |
| ~~Températures Cuisine~~ | ✅ done | — | — |
| ~~Réception~~ | ✅ done | — | — |
| ~~Fabrication~~ | ✅ done | — | — |
| Livraisons Corner | `modules/corner/pages/Livraison.tsx` | `r_ception_livraisons_aegean_precision/screen.png` | 1 |
| Vitrine | `modules/corner/pages/Vitrine.tsx` | `photos_vitrine_aegean_precision/screen.png` | 2 |
| Commandes | `modules/corner/pages/Commandes.tsx` | `d_tail_commande_aegean_precision/screen.png` | 2 |
| Ruptures | `modules/corner/pages/Ruptures.tsx` | `ruptures_commandes_aegean_precision_1/screen.png` | 2 |
| Pertes | `modules/corner/pages/Pertes.tsx` | `saisie_des_pertes_aegean_precision/screen.png` | 3 |
| Contrôle Corner | `modules/corner/pages/Controle.tsx` | `contr_le_archives_aegean_precision/screen.png` | 3 |
| Stockage Frigo | `modules/corner/pages/StockageFrigo.tsx` | `stockage_frigo_aegean_precision/screen.png` | 3 |
| Messagerie | `modules/messagerie/index.tsx` | `messagerie_aegean_precision/screen.png` | 4 |
| Profil | `pages/Profile.tsx` | `profil_utilisateur_aegean_precision/screen.png` | 4 |
| Planning mobile | `modules/planning/components/Mobile/MobilePlanningView.tsx` | `planning_hebdomadaire/screen.png` | 4 |
| Planning desktop | `modules/planning/index.tsx` | `planning_hebdomadaire_version_desktop/screen.png` | 4 |
| CA | `pages/CA.tsx` | palette Aegean (pas de référence) | 5 |
| Pointage | `pages/Pointage.tsx` | palette Aegean (pas de référence) | 5 |
| ModuleGridPanel | `components/ModuleGridPanel.tsx` | palette Aegean (adapter le bottom sheet) | 5 |
| Pages Admin | `pages/AdminUsers.tsx`, `AdminSettings.tsx`, `AdminProduits.tsx`, `AdminPointages.tsx`, `AllergeneMenu.tsx` | palette Aegean (pas de référence) | 5 |

### Règles strictes pour la refonte des pages
1. **Lire le screen.png AVANT de coder** — `Read` sur le fichier image
2. **Garder toute la logique métier et Firebase** — seul le design change
3. **Ne pas utiliser `#000` ni `#1c1c1e`** — utiliser les variables CSS `var(--surface)`, `var(--on-surface)`, etc.
4. **Accent orange `#E8760A` → `#004275`** (bleu grec) ou `var(--primary)`
5. **Toujours tester sur mobile** (les designs sont iPhone-first)
6. **Classes CSS disponibles** : `.page`, `.card`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.input`, `.input-filled`, `.chip-ok`, `.chip-danger`, `.chip-warn`, `.section-title`, `.section-label`, `.divider`, `.glass`, `.skeleton`, `.spinner`

---

### Nouveau Design System — "Aegean Precision" (référence)

> Source : `reference/UI UX/stitch_r_ception_marchandises 1ere partie/aegean_precision/DESIGN.md`
> 31 écrans disponibles dans `reference/UI UX/`

#### Philosophie
- **Nom** : "The Architectural Ledger" — éditorial haut de gamme, Mediterranean luxury
- **Mode** : **LIGHT MODE** (exit dark iOS) — fond chaud eggshell, pas de noir
- **Règle "No-Line"** : zéro bordure 1px. Séparation par shifts de background et whitespace uniquement
- **Typo** : Epilogue (titres) + Manrope (body) — remplace Inter

#### Palette de couleurs (Material Design tokens)
| Token | Hex | Usage |
|-------|-----|-------|
| `primary` | `#004275` | Bleu grec profond — actions principales, brand |
| `secondary` | `#54651e` | Vert olive — états HACCP OK/validé |
| `tertiary` | `#880014` | Madder sunset — états HACCP critique/danger |
| `surface` | `#fcf9f3` | Blanc eggshell chaud — fond de base (Level 0) |
| `surface-container-low` | `#f6f3ed` | Sections (Level 1) |
| `surface-container-highest` | `#e5e2dc` | Cards actives (Level 2) |
| `on-surface` | `#1c1c18` | Texte principal (pas de noir pur) |
| HACCP OK bg | `#d7ec95` | secondary_container |
| HACCP danger bg | `#b10f21` | tertiary_container |

#### Règles de composants
- **Glassmorphism** : modals flottants et navbars → surface à 85% opacité + backdrop-blur 20px
- **Boutons primary** : gradient #004275 → #005a9c, radius xl, padding 0.7rem / 2rem
- **Inputs** : underlined ou fond `surface-container-high` — PAS de box 4 côtés. Focus = bordure basse animée primary 2px
- **Tap targets** : min 4rem (64px) — pour mains gantées en cuisine
- **Cards** : pas de bordure. Hover = shift background `surface-container-lowest`
- **Ombres** : uniquement éléments flottants (FAB, overlay) — blur 32px, 0px offset, 6% opacité
- **Ghost borders** : si obligatoire → `outline-variant` (#c1c7d2) à 15% opacité max

#### Écrans de référence disponibles (31 captures)

**Partie 1** (`reference/UI UX/stitch_r_ception_marchandises 1ere partie/`) :
| Dossier | Page correspondante |
|---------|-------------------|
| `aegean_precision/` | DESIGN.md — système de design |
| `cockpit_dashboard_aegean_edition/` | Dashboard principal |
| `menu_corner_aegean_precision/` | Navigation Corner |
| `r_ception_marchandises_aegean_precision/` | Réception — version Precision |
| `r_ception_marchandises_aegean_edition/` | Réception — version Edition |
| `r_ception_livraisons_aegean_precision/` | Réception livraisons Corner |
| `lots_en_cours_aegean_precision/` | Fabrication — Lots en cours |
| `nouveau_lot_aegean_precision/` | Fabrication — Nouveau lot |
| `saisie_temp_ratures_aegean_precision/` | Saisie températures |
| `contr_le_temp_ratures_aegean_edition/` | Contrôle températures |
| `archives_rapports_aegean_precision/` | Archives & Rapports |
| `d_tail_archives_aegean_precision/` | Détail d'une archive |
| `messagerie_aegean_precision/` | Messagerie |
| `profil_utilisateur_aegean_precision/` | Profil utilisateur |
| `demande_de_cong_s_aegean_precision/` | Congés (non développé) |
| `planning_hebdomadaire/` | Planning mobile |
| `planning_hebdomadaire_version_desktop/` | Planning desktop (web) |
| `d_tail_commande_aegean_precision/` | Détail commande client |
| `nouvelle_commande_aegean_precision/` | Nouvelle commande |
| `photos_vitrine_aegean_precision/` | Photos vitrine |
| `check_stock_aegean_precision/` | Check stock / Ruptures |
| `rapport_de_pertes_aegean_precision/` | Rapport de pertes |
| `contr_le_archives_aegean_precision/` | Contrôle & archives Corner |
| `d_part_cuisine_aegean_precision/` | Départ cuisine |
| `stockage_frigo_aegean_precision/` | Stockage frigo |
| `ruptures_commandes_aegean_precision_1/` | Ruptures (vue 1) |
| `ruptures_commandes_aegean_precision_2/` | Ruptures (vue 2) |

**Partie 2** (`reference/UI UX/stitch_r_ception_marchandises 2e partie/`) :
| Dossier | Page correspondante |
|---------|-------------------|
| `rapport_hygi_ne_aegean_precision/` | Rapport hygiène |
| `saisie_des_pertes_aegean_precision/` | Saisie des pertes |
| `stock_frigo_aegean_precision/` | Stock frigo (vue 2) |

#### Plan d'exécution de la refonte

**Étape 1 — Changements immédiats** (sans refonte visuelle)
1. Renommer "Commandes" → "Commandes clients" dans corner nav
2. Ajouter CRM dans onglets corner + cuisine
3. Mettre à jour formulaire CRM (Prénom, Nom, Tel, Email, Entreprise)
4. Rendre Paramètres accessible sur mobile

**Étape 2 — Migration design system**
1. Installer fonts Epilogue + Manrope (Google Fonts)
2. Réécrire les variables CSS dans `src/index.css` (dark → light Aegean palette)
3. Créer composants de base : `Button`, `Input`, `Card`, `Chip` selon le nouveau design
4. Migrer Layout.tsx (sidebar + bottom nav) vers le nouveau design

**Étape 3 — Refonte page par page** (lire les screen.png correspondants avant chaque page)
- Dashboard Corner → `cockpit_dashboard_aegean_edition/screen.png`
- Dashboard Cuisine → à créer selon palette Aegean
- Réception → `r_ception_marchandises_aegean_precision/screen.png`
- Fabrication → `lots_en_cours_aegean_precision/screen.png` + `nouveau_lot_aegean_precision/screen.png`
- Températures → `saisie_temp_ratures_aegean_precision/screen.png`
- Livraisons → `r_ception_livraisons_aegean_precision/screen.png`
- Planning mobile → `planning_hebdomadaire/screen.png`
- Planning desktop → `planning_hebdomadaire_version_desktop/screen.png`
- Messagerie → `messagerie_aegean_precision/screen.png`
- Profil → `profil_utilisateur_aegean_precision/screen.png`
- Commandes → `d_tail_commande_aegean_precision/screen.png` + `nouvelle_commande_aegean_precision/screen.png`
- Vitrine → `photos_vitrine_aegean_precision/screen.png`
- Ruptures → `ruptures_commandes_aegean_precision_1/screen.png`
- Pertes → `saisie_des_pertes_aegean_precision/screen.png` + `rapport_de_pertes_aegean_precision/screen.png`
- Stockage frigo → `stockage_frigo_aegean_precision/screen.png`
- Archives → `archives_rapports_aegean_precision/screen.png`
- Hygiène → `rapport_hygi_ne_aegean_precision/screen.png`

#### ⚠️ Instructions critiques pour la refonte
1. **Lire chaque screen.png AVANT de coder la page correspondante**
2. **Garder toute la logique métier et Firebase** — seul le design change
3. **Tester sur mobile après chaque page** (les designs sont iPhone-first)
4. **La seule capture desktop** est `planning_hebdomadaire_version_desktop/screen.png`
5. **Ne pas utiliser de noir pur (#000)** — utiliser `on-surface` (#1c1c18)
6. **Accent orange `#E8760A` remplacé par `primary` #004275** (bleu grec)

---

## 🔧 AUDIT & PLAN D'AMÉLIORATION — Session 2026-03-28

> Audit complet réalisé par Claude Code. Travaux à effectuer dans l'ordre A → B → C.
> En cas d'interruption, reprendre ici et cocher les cases au fil de l'avancement.

---

### PHASE A — Sécurité (priorité absolue)

#### A1. Règles Firestore — isolation par rôle ✅ FAIT (2026-03-28)
**Problème** : `isAnyRole()` trop permissif — un employé `cuisine` peut écrire dans les collections `corner` et vice versa.
**Fichier** : `firestore.rules`
**Action** : Remplacer `isAnyRole()` par des helpers précis :
- `temperatures` → `isCorner()` pour corner, `isCuisine()` pour cuisine (selon le champ `site` du doc)
- `livraisons` → écriture `isCuisine()` (départ) / `isCorner()` (réception)
- `hygiene_corner` → écriture `isCorner()` uniquement
- `stockage_frigo` → `isCorner()` uniquement
- `non_conformites` → `isCorner()` uniquement
- `pertes_corner` → `isCorner()` uniquement
- `messages` → `isAnyRole()` OK (messagerie commune)

#### A2. Rate limiting commandes publiques ✅ FAIT (2026-03-28)
**Problème** : `commandes_externes` — `allow create: if true` sans aucun frein → spam possible.
**Action** : Ajouter dans la Cloud Function `onNewCommande` (ou nouvelle CF) un check anti-spam :
- Vérifier que le même numéro de téléphone n'a pas soumis plus de 3 commandes dans les 24h
- Ajouter un champ `_ip` (si possible via App Check) ou au minimum activer **Firebase App Check**

#### A3. Validation GPS côté serveur ✅ FAIT (2026-03-28)
**Problème** : La validation de zone GPS pour le pointage est **uniquement côté client** (`usePointageSortie.ts`). Un client modifié peut écrire `statut: 'validé'` peu importe la position.
**Action** : Créer une Cloud Function `httpsCallable` `createPointage` qui :
1. Reçoit `{ lat, lng, type }` de l'app
2. Calcule la distance par rapport aux zones connues (même logique Haversine que `src/utils/geo.ts`)
3. Détermine `statut` côté serveur
4. Écrit en Firestore
- Modifier `firestore.rules` pour que `pointages` n'accepte plus de `create` direct côté client
- Modifier `usePointageSortie.ts` et `Pointage.tsx` pour appeler la CF

#### A4. Retirer les mots de passe du CLAUDE.md ✅ FAIT (2026-03-28)
**Problème** : Mots de passe en clair dans ce fichier (section "Utilisateurs connus").
**Action** : Remplacer les valeurs `mdp: xxx` par `mdp: [voir gestionnaire de mots de passe]`
**Note** : Changer les mots de passe des comptes iPad et employés cuisine après.

#### A5. Déplacer les clés service account hors du projet ✅ FAIT (2026-03-28) — `secrets/` ajouté au .gitignore
**Problème** : `secrets/firebase-admin.json` et `cuisine-yorgios-firebase-adminsdk-fbsvc-1c759ed390.json` sont dans l'arbre du projet.
**Action** :
- Déplacer vers `~/.secrets/yorgios/`
- Vérifier `.gitignore` couvre bien `secrets/` et `*.json` service account à la racine
- Mettre à jour les scripts Python qui référencent ces chemins

---

### PHASE B — Performance & Architecture

#### B1. Custom Claims pour les rôles ❌ À FAIRE
**Problème** : Le rôle est lu depuis Firestore (`users/{uid}.role`) à chaque chargement → 1 read supplémentaire par page.
**Action** :
- Modifier la Cloud Function `createUser` pour appeler `admin.auth().setCustomUserClaims(uid, { role })` lors de la création
- Créer une CF `setUserRole` (callable, patron/admin) pour mettre à jour le claim quand on change un rôle
- Modifier `src/auth/useAuth.ts` pour lire `user.getIdTokenResult().claims.role` au lieu de Firestore
- Garder Firestore `users/{uid}` pour les autres champs (fcmToken, etc.)
- **Impact** : Économise 1 read Firestore par navigation + auth plus rapide

#### B2. Code splitting — lazy loading des modules ✅ FAIT (2026-03-28)
**Problème** : Tous les modules sont chargés au démarrage (bundle unique).
**Fichier** : `src/router/index.tsx`
**Action** : Wrapper chaque import de page/module avec `React.lazy()` + `<Suspense>` :
```tsx
const Planning = React.lazy(() => import('../modules/planning'))
const Cuisine = React.lazy(() => import('../modules/cuisine'))
// etc.
```
- Ajouter un `<Suspense fallback={<LoadingScreen />}>` autour des routes

#### B3. Décomposer `planning/index.tsx` (444 lignes) ❌ À FAIRE
**Action** :
- Extraire la logique de state dans un hook `usePlanningState.ts`
- Extraire les boutons d'action dans `PlanningToolbar.tsx`
- Garder `index.tsx` comme simple orchestrateur (~100 lignes)

#### B4. Décomposer `functions/src/index.ts` (957 lignes) ❌ À FAIRE
**Action** :
- Créer `functions/src/notifications/index.ts` — toutes les CFs scheduler notif
- Créer `functions/src/commandes/index.ts` — onNewCommande, onCommandeUpdated, notifCommandes
- Créer `functions/src/pointages/index.ts` — onPointageLate + future CF createPointage (A3)
- Garder `functions/src/index.ts` comme fichier de re-export uniquement
- Compiler et redéployer : `cd functions && npm run build && firebase deploy --only functions`

#### B5. Supprimer la double vérification auth dans planning ✅ FAIT (2026-03-28)
**Fichier** : `src/modules/planning/index.tsx`
**Action** : Supprimer le `if (!user) return <LoginPage />` interne (déjà géré par `AuthGuard` dans le router)

#### B6. Nettoyer les artefacts Python/Streamlit ✅ FAIT (2026-03-28) — Procfile, pages/*.py, cornerConfig.ts supprimés
**Action** :
- Supprimer `Procfile` (référence `streamlit run app.py` qui n'existe plus)
- Supprimer `pages/07_📅 Planning équipe (V2).py`
- Supprimer `cornerConfig.ts` (`@deprecated`)
- Vérifier que `.venv/` est dans `.gitignore`

#### B7. Unifier `useAuth` (doublon) ✅ VÉRIFIÉ (2026-03-28) — pas de doublon, tout pointe vers src/auth/useAuth
**Problème** : `src/auth/useAuth.ts` et `src/hooks/useAuth.ts` — vérifier s'il y a vraiment un doublon.
**Action** : Lire les deux fichiers, supprimer celui qui est un simple re-export ou le fusionner.

---

### PHASE C — Design & UX

#### C1. Skeleton loaders uniformes ✅ FAIT (2026-03-28) — src/components/Skeleton.tsx
**Problème** : Pas d'états de chargement cohérents — chaque page gère ça différemment (parfois rien du tout).
**Action** :
- Créer `src/components/Skeleton.tsx` — composant réutilisable avec animation pulse dark
- Ajouter des skeletons dans : Dashboard corner, Températures, Vitrine, Commandes, Planning mobile

#### C2. Transitions de navigation ✅ FAIT (2026-03-28) — page-in, skeleton-shimmer, check-pop, sheet-in dans index.css
**Problème** : Les changements de page sont abrupts (pas de transition).
**Action** :
- Ajouter des transitions CSS `fade-in` sur `.page` via `src/index.css`
- Animer le bottom nav mobile (scale sur l'icône active)
- Ajouter `transition` sur les modals/bottom sheets existants

#### C3. Unifier le système de styles ❌ À FAIRE
**Problème** : 3 systèmes coexistent : inline styles JS + CSS variables + Tailwind utilitaires.
**Action** :
- Normaliser vers CSS variables + classes utilitaires dans `index.css` (le système existant)
- Identifier et convertir les inline styles récurrents en classes réutilisables
- Ne pas supprimer Tailwind (trop présent) mais limiter son usage aux utilitaires de layout

#### C4. Améliorer le Dashboard Corner ✅ FAIT (2026-03-28) — skeleton loading, checkbox animée
**Objectif** : Premier écran vu par les employés corner — doit être informatif, beau, rapide.
**Action** :
- Réorganiser les cards avec une hiérarchie visuelle claire (urgences en rouge en haut)
- Ajouter des micro-animations sur les cases à cocher
- Améliorer la lisibilité mobile (taille de police, espacement)
- Card "Températures" : afficher la dernière valeur connue si disponible

#### C5. Dashboard Cuisine ✅ FAIT (2026-03-28) — src/modules/cuisine/pages/Dashboard.tsx créé, devient la page d'accueil /cuisine
**Objectif** : Vue rapide de l'état de la cuisine.
**Vérifier** : Existe-t-il un dashboard cuisine ? Sinon créer une page d'accueil `/cuisine` synthétique.
**Action** :
- Afficher : lots en cours, dernière réception, températures frigos
- Alertes visuelles si températures hors seuil

#### C6. Bibliothèque d'icônes ✅ FAIT (2026-03-28) — lucide-react installé (disponible pour usages futurs)
**Problème** : SVG inline dans `Layout.tsx` — difficile à maintenir.
**Action** :
- Installer `lucide-react` (léger, tree-shakeable, compatible dark)
- Remplacer les SVG inline de `Layout.tsx` progressivement

#### C7. États vides (empty states) ✅ FAIT (2026-03-28) — src/components/EmptyState.tsx créé, utilisé dans Dashboard Cuisine
**Problème** : Quand une liste est vide (pas de commandes, pas de pertes...), rien n'est affiché ou texte brut.
**Action** :
- Créer `src/components/EmptyState.tsx` avec icône + message contextuel
- Appliquer dans : Commandes, Pertes, Vitrine, Historique livraisons

#### C8. Accessibilité mobile — zones de tap ❌ À FAIRE
**Problème** : Certains boutons/liens ont des zones de tap trop petites sur mobile.
**Action** : Vérifier que tous les éléments interactifs font au minimum 44×44px (standard iOS/Android)

---

### Ordre d'exécution recommandé

```
A1 (règles Firestore)
→ A4 (mots de passe CLAUDE.md)
→ A2 (rate limit commandes)
→ A3 (GPS serveur — CF + règles)
→ A5 (déplacer secrets)
→ B6 (nettoyage artifacts)
→ B7 (doublon useAuth)
→ B5 (double auth planning)
→ B2 (lazy loading routes)
→ B1 (Custom Claims)
→ B3 (décomposer planning)
→ B4 (décomposer functions)
→ C6 (lucide-react)
→ C1 (skeletons)
→ C2 (transitions)
→ C7 (empty states)
→ C4 (dashboard corner)
→ C5 (dashboard cuisine)
→ C8 (tap targets)
→ C3 (unifier styles)
```
