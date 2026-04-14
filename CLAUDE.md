# CLAUDE.md — Matias PWA (v6)

## ⚠️ RÈGLES ABSOLUES — lire avant toute action

1. **Ne JAMAIS appeler `initializeApp()`** dans un module ou une page.
   → Seul `src/firebase/config.ts` initialise Firebase, une seule fois.

2. **Un seul projet Firestore : `cuisine-yorgios`.**
   → `src/modules/cuisine/firebase/firebase.ts` est un simple re-export de `src/firebase/config.ts`.

3. **Toujours importer** `db`, `auth`, `storage`, `functions` depuis `src/firebase/config.ts`.

4. **Modules indépendants** → zéro import croisé entre modules.
   Exception : `src/pages/CommandePublique.tsx` importe `CommandeFormBody` depuis `modules/corner/pages/Commandes.tsx`.

5. **Rôle `administrateur`** = alias de `patron` (mêmes droits complets).
   → Partout où `patron` est vérifié, ajouter `administrateur`.

6. **Deploy functions** → toujours compiler d'abord :
   ```bash
   cd functions && npm run build && cd .. && firebase deploy --only functions:nomFonction
   ```

7. **Températures** → doc ID format : `{YYYY-MM-DD}_{fridgeId}_{session}` (`matin` ou `soir`).

8. **Pointages** → NE JAMAIS écrire directement dans `pointages` depuis le client.
   → Appeler `createPointage` via `httpsCallable(functions, 'createPointage')`.
   → La règle Firestore bloque les `create` directs.

9. **Route cuisine** → `/cuisine` rend `CuisineDashboard`. Réception = `/cuisine/reception`.

---

## Projet Firebase

- **Project ID** : `cuisine-yorgios`
- **Firestore DB ID** : `test`
- **Région Functions** : `europe-west1`
- **Auth** : Email / Password
- **Hosting URL** : https://cuisine-yorgios.web.app
- **Service account** : `cuisine-yorgios-firebase-adminsdk-fbsvc-1c759ed390.json` (racine, NE PAS commiter)

---

## Équipe & Rôles

| Rôle | Accès | Redirection login |
|------|-------|-------------------|
| `patron` | Tout | `/planning` |
| `administrateur` | Tout (= patron) | `/planning` |
| `manager` | Planning + Corner + CA + Commandes + Pointages | `/planning` |
| `corner` | `/corner` (+ CA lecture seule) + `/messages` + `/planning` (lecture) + `/pointage` | `/corner` |
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
| **iPad Corner** | `corner` | ipad@yorgios.fr |

> Mots de passe : Firebase Console → Authentication.

---

## Structure dossiers

```
src/
  firebase/
    config.ts           ← UNIQUE initializeApp() — exporte db, auth, storage, functions
    messaging.ts        ← FCM
  auth/
    useAuth.ts / AuthGuard.tsx
  router/index.tsx      ← React.lazy() + Suspense (code splitting)
  components/
    Layout.tsx          ← sidebar + bottom nav + bouton ⣿ + FAB pointage sortie
    ModuleGridPanel.tsx ← bottom sheet grille 3×3 sous-pages Corner/Cuisine
    Skeleton.tsx / EmptyState.tsx / Toast.tsx / DailyPointageGate.tsx
  pages/
    Login.tsx / CommandePublique.tsx / CA.tsx / Profile.tsx
    AdminUsers.tsx / AdminSettings.tsx / AdminProduits.tsx / AdminPointages.tsx
    Pointage.tsx / AllergeneMenu.tsx
  modules/
    planning/     ← PlanningGrid (desktop drag-paint) + MobilePlanningView (< 768px)
    cuisine/      ← Dashboard + Réception + Fabrication + Livraisons + Températures + Contrôle + ReceptionHistorique
    corner/       ← Dashboard + Températures + Hygiene + Livraison + Vitrine + StockageFrigo
                     Ruptures + Commandes + Pertes + Controle + PlanningCorner
    crm/          ← CaptationPage + useCaptation hook
    messagerie/   ← index.tsx
  hooks/
    usePointageSortie.ts ← FAB sortie, appelle CF createPointage
  config/
    pointageZones.ts  ← zones GPS (validation réelle côté serveur)

functions/src/
  index.ts          ← 25 Cloud Functions
  domain/loyalty.ts ← paliers fidélité (10→5%, 25→10%, 50→15%)
  crm/index.ts      ← syncContactToBrevo, validatePromoCode, fidélité
```

---

## Collections Firestore (DB `test`)

| Collection | Accès | Usage |
|-----------|-------|-------|
| `users` | tous (own) + patron/admin/manager (all) | profils, role, fcmToken, employeeId |
| `employees` | patron/admin/manager | employés planning |
| `planningWeeks` | lecture tous, écriture patron/admin/manager | semaines planning |
| `produits` | lecture tous, écriture patron/admin/manager | catalogue — `name`, `abrv`, `defaultCategory`, `dlcDays`, `allergenes[]`, `active`, `inVitrine`, `inReception`, `inMenu` |
| `receptions` | cuisine | réceptions HACCP |
| `lots_cuisine` | cuisine | lots fabrication |
| `lot_counters` | cuisine | séquences numéros de lot |
| `livraisons` | tous | livraisons cuisine → corner |
| `temperatures` | tous | relevés frigos — doc ID `{YYYY-MM-DD}_{fridgeId}_{session}` |
| `archives` | cuisine | archives mensuelles |
| `hygiene_corner` | corner | checklists — `{date}_quotidien` / `{YYYY-WXX}_hebdo` / `{YYYY-MM}_mensuel` |
| `corner_stock` | corner | produits vitrine avec DLC |
| `messages` | tous | messagerie interne (TTL 7j) |
| `commandes_externes` | create public, read/update corner | commandes clients |
| `non_conformites` | corner | livraisons refusées + décisions |
| `objectifs_ca` | patron/admin/manager (écriture), corner (lecture) | CA mensuel (doc ID = YYYY-MM) |
| `stockage_frigo` | tous | stock frigos corner |
| `pointages` | write bloqué client (CF uniquement), read patron/admin/manager | pointages GPS |
| `settings` | patron/admin (écriture), tous (lecture) | `reception.fournisseurs[]`, `temperatures.alertMinC`, `ruptures.produits[]` |
| `pertes_corner` | corner | pertes — `date`, `productName`, `type`, `valeur`, `unite`, `note` |
| `customers` | CRM functions | clients — doc ID = E.164 sans `+` — fidélité + promos |
| `crm_sync_log` | CRM functions | logs sync Brevo |

---

## Cloud Functions (`europe-west1`) — 25 fonctions

| Fonction | Déclencheur | Rôle |
|----------|------------|------|
| `onNewMessage` | Firestore create `messages/{id}` | Push FCM à tous sauf expéditeur |
| `purgeOldMessages` | Scheduler quotidien | Supprime messages expirés |
| `onNewCommande` | Firestore create `commandes_externes/{id}` | Anti-spam 3/24h + Push FCM |
| `onCommandeUpdated` | Firestore update `commandes_externes/{id}` | Acceptée → GCal + FCM ; Livrée → Brevo + fidélité |
| `onCommandePrete` | httpsCallable | FCM patron+manager+cuisine + messagerie |
| `notifCommandesJ2` | Scheduler 14h00 | Rappel J-2 livraisons |
| `notifCommandesJJ` | Scheduler 09h00 | Rappel jour-J livraisons |
| `onPointageLate` | Firestore create `pointages/{id}` | Email si retard > 10 min |
| `createPointage` | httpsCallable | Validation GPS Haversine serveur, anti-doublon |
| `notifTemperatures` | Scheduler 8h30 | FCM si frigos matin non saisis |
| `notifTemperaturesEvening` | Scheduler 22h00 | FCM si frigos soir non saisis |
| `notifTooGoodToGo` | Scheduler 9h00 | FCM employés pointés |
| `notifCartonsChambrefroide` | Scheduler 9h30 | FCM corner+cuisine |
| `notifPlatsJour` | Scheduler 11h00 | FCM cuisine+corner |
| `notifUrgences` | Scheduler 15h00 | FCM employés pointés |
| `notifHygieneHebdo` | Scheduler samedi 18h | FCM si checklist hebdo non faite |
| `notifHygieneMensuel` | Scheduler 28-31 du mois 18h | FCM si checklist mensuelle non faite |
| `weeklyHygieneRecap` | Scheduler lundi 8h | Email récap températures + hygiène |
| `createUser` | httpsCallable (patron/admin) | Créer compte utilisateur |
| `deleteUser` | httpsCallable (patron/admin) | Supprimer compte utilisateur |
| `onLivraisonTemperature` | Firestore create `livraisons/{id}` | FCM départ livraison |
| `onLivraisonReception` | Firestore update `livraisons/{id}` | FCM réception livraison |
| `syncContactToBrevo` | httpsCallable | Sync contact Brevo + `customers/` |
| `validatePromoCode` | httpsCallable | Vérifie code promo (app) |
| `validatePromoCodePublic` | onRequest | Vérifie code promo (WordPress, X-Yorgios-Secret) |

---

## Routes

| Route | Auth | Accès |
|-------|------|-------|
| `/login` | Non | Public |
| `/commande` | Non | Public |
| `/planning/*` | Oui | patron, admin, manager, corner (lecture) |
| `/cuisine` | Oui | patron, admin, manager, cuisine — Dashboard |
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

---

## Design System — Aegean Precision (light mode)

> Références visuelles : `reference/UI UX/` (31 écrans PNG)

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

### Classes disponibles
`.page` · `.card` · `.btn-primary` · `.btn-secondary` · `.btn-danger` · `.btn-icon`
`.input` (underlined) · `.input-filled` (fond teinté) · `.section-title` · `.section-label`
`.chip-ok` · `.chip-danger` · `.chip-warn` · `.nav-tabs` / `.nav-tab` · `.glass` · `.divider`
`.spinner` · `.skeleton`

### Règles
- Overlays modals : `rgba(28,28,24,0.45)` — pas `rgba(0,0,0,...)`
- Fond lightbox photo : `rgba(28,28,24,0.88)` OK (contexte sombre intentionnel)
- Texte blanc sur bouton coloré (`.btn-primary`, chips) : OK
- Fonts : **Epilogue** (titres h1-h3) + **Manrope** (body) — chargées globalement
- Tap targets min 44×44px mobile
- Lire le `screen.png` de référence avant de coder une page

---

## Frigos — IDs Firestore

### Corner
| ID | Nom affiché |
|----|-------------|
| `FRIGO_3P` | Frigo 3 portes |
| `VITRINE_1` | Vitrine 1 |
| `VITRINE_2` | Vitrine 2 |
| `VITRINE_3` | Vitrine 3 |
| `GRAND_FRIGO` | Grand frigo |

### Cuisine
| ID | Nom affiché |
|----|-------------|
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

## PWA

- **Nom** : `Matias` — icône oeil grec dans `public/icons/`
- `vite-plugin-pwa` — SW auto-généré
- `public/firebase-messaging-sw.js` — SW FCM background
- `VITE_FIREBASE_VAPID_KEY` dans `.env`

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
```

---

## Commandes utiles

```bash
npm run dev
npm run deploy                                    # build + firebase deploy hosting
cd functions && npm run build && cd .. && firebase deploy --only functions:nomFonction
firebase deploy --only firestore:rules
```

---

## ⚠️ ARCHITECTURE MÉTIER — RÈGLES INVIOLABLES

> Ces règles décrivent les dépendances logiques et codépendances entre onglets.  
> **Ne JAMAIS modifier un onglet sans vérifier que ces invariants sont respectés.**

---

### Cycle de vie d'un lot cuisine (flux principal)

```
Fabrication (cuisine)
  → Livraison cuisine (départ + temp)
    → Livraison corner (arrivée + temp)
      → Frigo corner (stockage_frigo)  ──→  Vitrine (corner_stock, active=true)
      → Vitrine directe (corner_stock)
```

**Règles de ce flux :**

1. **Un lot ne peut jamais être en double** dans aucun état : `lots_cuisine`, `stockage_frigo`, `corner_stock`. Si un lotCode existe déjà → erreur bloquante, jamais de doublon silencieux.
2. **Un lot livré et accepté par le corner est archivé** (`lots_cuisine.archived=true, sent=false`). Il disparaît de la liste "Lots en cours" cuisine.
3. **Un lot ajouté en vitrine depuis les lots cuisine** → archivage dans `lots_cuisine` + création dans `corner_stock`. Aucun lot déjà en vitrine n'est proposable à la sélection.
4. **Un lot transféré du frigo vers la vitrine** → `deleteDoc` dans `stockage_frigo` automatiquement. Le frigo et la vitrine sont mutuellement exclusifs pour un même article.
5. **Retour cuisine depuis Vitrine** → `corner_stock.active=false` + si `lotCode` présent → `lots_cuisine.sent=false` pour réapparition côté cuisine.

---

### Cuisine — Dashboard

- **Bandeau rouge ruptures** : fenêtre dynamique — avant 10h : affiche depuis hier 13h ; après 10h : affiche depuis minuit. Filtre `ruptures_actives where viewed==false`.
- **Deux envois ruptures/jour** (matin + soir) → s'additionnent, pas de doublon. La déduplification se fait par nom produit avec `Set`.
- **Encart commandes semaine + mois** : calculé sur `commandes_externes` en temps réel.
- **Bandeau météo** : Open-Meteo, 7 jours, toujours présent.
- **Liste d'actions** : températures matin + soir (liens directs), hygiène du jour.

---

### Cuisine — Réception

- Sélection produits depuis catalogue (`produits where inReception==true && active==true`).
- **Champ N° lot** : saisie manuelle ou scan code-barres (html5-qrcode, lazy).
- **Onglet Historique** : toutes réceptions avec photo miniature, badge HACCP, température, N° lot.
- La réception crée un document dans `receptions` — utilisé pour la traçabilité Fabrication.

---

### Cuisine — Fabrication

- **Aucun lot en double** : vérifier `lotCode` inexistant avant `setDoc`. Bloquer si doublon.
- **Lots modifiables** tant que non livrés (`sent != true`).
- **Mode "📦 Réception"** : pré-remplit `productName` + `fournisseur` depuis la réception source, stocke `receptionId` pour traçabilité 100%.
- **DLC auto** : J+3 depuis date fabrication (configurable par produit via `dlcDays` du catalogue).
- Les lots livrés et acceptés corner sont archivés et non modifiables.

---

### Cuisine — Livraison (départ)

- L'employé sélectionne parmi les lots non livrés (`lots_cuisine where sent!=true`).
- **Température obligatoire** pour les lots soumis à la GEP (2 minimums pour l'ensemble de la livraison).
- Lots sans température → s'ajoutent à la livraison sans saisie de temp, case à cocher à l'arrivée côté corner.
- Les lots sélectionnés passent à `sent=true` dans `lots_cuisine`.
- Items manuels s'ajoutent à la livraison aux côtés des lots.

---

### Corner — Dashboard

- **Bandeau météo** lundi→dimanche, toujours présent.
- **Actions requises** avec notifications push sonores :
  - Hygiène quotidienne (cases à cocher, lien direct)
  - Températures matin + soir (lien direct)
  - DLC : alerte si un item de `corner_stock` a DLC ≤ 3 jours
  - Cartons chambre froide
  - Plats du jour
- **Bandeau livraison** : livraisons en cours depuis `deliveries`.
- **Bandeau commandes** : si commande à réaliser cette semaine.
- **PAS de bandeau TooGoodToGo** (supprimé définitivement).

---

### Corner — Livraison (arrivée)

**Ordre d'affichage impératif** : lots AVEC `departTempC` en premier, lots SANS `departTempC` ensuite.

- Lots avec `departTempC` → champ température arrivée + photo optionnelle → résultat GEP (ACCEPTE / REFUSE / A_VERIFIER).
- Lots sans `departTempC` → case à cocher "Livraison reçue ✓" → écrit `result: 'ACCEPTE'` sans température.
- **Si température arrivée > seuil GEP** → email à patron (`a.cozzika@gmail.com`) ET push notification. CF `onLivraisonReception` gère ça.
- **Bouton "↩ Retour cuisine"** : disponible tous rôles → `returned: true` sur le doc livraison.
- **Bouton "🗑 Supprimer"** : visible uniquement patron/administrateur/manager.
- `pending` filter : `receptionTempC == null && !receptionAt && !returned`.
- `done` filter : `(receptionTempC != null || receptionAt != null) && !returned`.

**Sous-onglets obligatoires** :
- Aujourd'hui : lots envoyés depuis cuisine (le jour J)
- Historique : filtrable par date de réception, nom produit, date de retrait
- Galerie photo : produits relevés en température
- Coursier : tracking livraison Twilio (`deliveries` collection)

---

### Corner — Vitrine

**Trois modes d'ajout** (formulaire) :
1. **✏️ Manuel** : saisie nom + date fab + DLC auto (fab+3j). Produits depuis catalogue (`produits where inVitrine==true`). Multi-sélection possible.
2. **📦 Lot cuisine** : lots reçus depuis cuisine (`lots_cuisine where sent==true`). Aucun doublon (lotCode ou productName+fabDay déjà actif en vitrine). Sélection → `addDoc corner_stock` + archive `lots_cuisine`.
3. **🧊 Frigo** : articles depuis `stockage_frigo`. Sélection → `addDoc corner_stock` + **`deleteDoc stockage_frigo`** automatique.

**Onglets obligatoires** :
- Stock : items actifs en vitrine (`active==true`)
- Lots : lots reçus cuisine non encore mis en vitrine
- Historique : tous les items triés/filtrés (nom, date fab, date entrée, date sortie)

---

### Corner — Frigo (Stockage Frigo)

- Articles stockés entre réception cuisine et mise en vitrine.
- **Dépendance directe avec Vitrine** : si un article frigo est sélectionné pour la vitrine → `deleteDoc stockage_frigo` automatique. Invariant : un article ne peut pas être à la fois dans le frigo ET en vitrine.
- Permet transfert entre frigos (updateDoc).

---

### Corner — Ruptures

- **Section "Disponibilité plats"** : catalogue complet `produits` (active==true), trié par `defaultCategory` puis `name`, affiché en **grille 2 colonnes**.
- **3 états par clic** : null → 🔴 urgent → 🟠 moins urgent → null. Déselection directe via ✕.
- **Produit sélectionné disparaît de la grille** et apparaît dans le panel "Sélection" en tête.
- Les produits sensibles/best-sellers configurables dans `settings/ruptures` → apparaissent en priorité.
- `ruptures_actives` : écrit les ruptures urgentes + presques-ruptures, lu par Dashboard cuisine.
- **Fenêtre lecture Dashboard cuisine** : avant 10h → depuis hier 13h ; après 10h → depuis minuit du jour J.
- Deux envois possibles par jour s'additionnent (déduplification par `Set` de noms).

---

### Corner — Hygiène

- **Quotidien** : 13 items, case à cocher par jour.
- **Hebdomadaire** : 5 items, valider 1×/semaine. Notification push jeudi si non fait.
- **Mensuel** : 1 item, valider 1×/mois. Notification le 20 du mois si non fait.
- **Historique** : visuel semaine par semaine ✅/🟡/❌ pour chaque période.
- Doc IDs : `{date}_quotidien` / `{YYYY-WXX}_hebdo` / `{YYYY-MM}_mensuel`.

---

### Corner — Pertes

- Produit sélectionné depuis catalogue avec son prix unitaire.
- **Rapport** : affiche par jour/semaine/mois, KPI total combiné (prix exact + estimé). Ne jamais crasher sur champs manquants — guards null impératifs.

---

### Règles GEP — températures réception (inviolables)

| Catégorie | Max standard | Max tolérance |
|-----------|-------------|---------------|
| Viande hachée | 2°C | 3°C |
| Viande | 3°C | 5°C |
| Poisson | 2°C | 3°C |
| Lait | 4°C | 6°C |
| Plat cuisiné frais | 3°C | 5°C |
| Pâtisserie fraîche | 3°C | 5°C |
| Légumes | 8°C | 10°C |

Tout dépassement de `maxTol` → `result: 'REFUSE'` → email patron + push FCM.

---

## ✅ Suivi livraison Twilio — IMPLÉMENTÉ (session 2026-04-13)

### Objectif
Remplacer le flux `SMS → iPhone → WhatsApp` par `Twilio → Firebase → App React + Push temps réel`.
Le livreur est externe — format SMS non contrôlé, contient généralement un lien de tracking GPS.

### Variables d'environnement à ajouter (`functions/.env`)
```
TWILIO_AUTH_TOKEN=xxxx          # pour vérifier la signature webhook
TWILIO_ACCOUNT_SID=xxxx
```

### Cloud Function à créer : `incomingSms`
- **Type** : `onRequest` (HTTP, public mais sécurisé par signature Twilio)
- **Endpoint** : `POST /incomingSms`
- **Sécurité** : vérifier signature Twilio via `twilio.validateRequest(authToken, signature, url, params)`
- **Parsing** :
  - extraire URL de tracking (regex robuste : `https?://[^\s]+`)
  - extraire ETA si présent (regex `\b\d{1,2}[h:]\d{2}\b`)
  - jamais crasher si format inattendu — tout logger
- **Déduplication** : si `trackingUrl` déjà actif en Firestore → update `updatedAt` + `rawMessage`, pas de nouveau doc
- **Notifications** : après écriture, envoyer FCM aux cibles (voir ci-dessous)

### Collection Firestore : `deliveries`
```
{
  trackingUrl:  string           // URL extraite (ou null si non trouvée)
  rawMessage:   string           // SMS brut complet
  phoneNumber:  string           // From Twilio
  eta:          string | null    // "14:30" ou null
  status:       "in_progress" | "completed"
  createdAt:    Timestamp
  updatedAt:    Timestamp
}
```
Index : `status ASC + createdAt DESC`

### Règles Firestore à ajouter
```
match /deliveries/{id} {
  allow read: if request.auth != null;
  allow write: if false;   // écriture uniquement via CF backend (admin SDK)
}
```

### Notifications FCM (dans la CF `incomingSms`)
Cibles :
1. `users` où `onShift == true` → envoyer à tous leurs `fcmTokens[]`
2. `devices` où `type == "ipad_corner"` → envoyer à leur `fcmToken`

Payload :
```json
{
  "notification": { "title": "🚚 Livraison en cours", "body": "ETA {eta} — {trackingUrl}" },
  "data": { "trackingUrl": "...", "type": "delivery" }
}
```

### Collection `devices` (nouveau)
```
{
  type:      "ipad_corner" | "mobile"
  fcmToken:  string
  label:     string         // ex: "iPad Corner"
  updatedAt: Timestamp
}
```
→ L'iPad Corner s'enregistre automatiquement au login avec `type: "ipad_corner"`.

### Page React : `/livraisons`
- Route accessible à tous les rôles authentifiés
- **Realtime** : `onSnapshot` sur `deliveries` where `status == "in_progress"` orderBy `createdAt DESC`
- **Composant `DeliveryCard`** :
  - Heure de réception + ETA
  - Bouton "Suivre →" → ouvre `trackingUrl` (nouvel onglet)
  - Bouton "Livraison terminée" → update `status: "completed"`
  - Chip statut (`.chip-ok` = terminé, `.chip-warn` = en cours)
- **Empty state** si aucune livraison active
- **Son** sur iPad Corner : `new Audio('/sounds/ding.mp3').play()` à chaque nouveau doc Firestore

### iPad Corner — comportements spéciaux
- Enregistre `devices/{uid}` avec `type: "ipad_corner"` au login
- Page `/livraisons` affichée en permanence (mode kiosk)
- Notification sonore à chaque nouvelle livraison (listener Firestore)
- Écran toujours allumé via `navigator.wakeLock.request('screen')`

### Design (Aegean Precision)
- Header : section-label "Livraisons" + h1 Epilogue
- Cards : `.card` avec chip statut + heure + ETA proéminent
- Bouton tracking : `.btn-primary` pleine largeur
- Bouton terminer : `.btn-secondary`

### Ajout dans ModuleGridPanel
- Ajouter "🚚 Livraisons" dans la grille ⣿ Corner + Cuisine (route `/livraisons`)

### Ordre d'implémentation recommandé
1. CF `incomingSms` (webhook + parsing + Firestore)
2. Règles Firestore `deliveries`
3. Page `/livraisons` + `DeliveryCard`
4. Enregistrement FCM iPad Corner (`devices/`)
5. Notifications FCM dans la CF
6. Son + WakeLock iPad Corner
7. Ajout dans ModuleGridPanel + router

---

## ✅ PLANNING — Chantiers réalisés (session 2026-04-10/11)

Branche mergée : `feature/planning-primes-refonte`

| # | Chantier | Fichiers clés |
|---|----------|---------------|
| 1 | Fix bug Layal — `EXCLUDED_NAMES` exporte depuis `primes.ts`, filtre `empMap` + filtre chargement Firestore | `PrimesTab.tsx`, `primes.ts` |
| 2 | Prime CA progressive — `calcCaPrime()` barème 5 paliers, remplace `perfOk` binaire | `primes.ts`, `PrimesTab.tsx`, `MonthlyView.tsx` |
| 3 | Montants primes custom par employé — champs `primeComportement`/`primePonctualite` sur `employees`, UI dans EmployeeManager, `deleteField()` pour effacement | `EmployeeManager.tsx`, `types.ts`, `primes.ts` |
| 4 | Fix Stats → colonne 🏆 Prime se rafraîchit — `caRealise`/`caObjectif` désormais inclus dans `primeMois` passé à MonthlyView via `onPrimesChange` | `PrimesTab.tsx`, `MonthlyView.tsx` |
| 5 | Colonne "Parti tôt" dans Stats mensuel — affiche `partiTotHeures` | `MonthlyView.tsx` |
| 6 | Découpe heures par mois — semaines frontière filtrées jour par jour, heures supp = 0 sur semaine incomplète | `dateUtils.ts`, `MonthlyView.tsx` |
| 7 | Avenants contrat — `Avenant` interface, `getContractAt(emp, date)`, UI EmployeeManager, `getPrime()` utilise heures effectives fin de mois | `types.ts`, `primes.ts`, `MonthlyView.tsx`, `EmployeeManager.tsx` |

### Où modifier les barèmes

- **Barème CA progressif** → `/admin/settings` → section "Barème primes CA progressif" (tableau éditable, sauvegardé dans `settings/primes_ca`)
- **Barème global comportement/ponctualité** → `src/modules/planning/utils/primes.ts`, constante `BAREME` (`comp` = total comportement, chaque critère = `comp/2`)
- **Prime hygiène** → même fichier, constante `HYGIENE_BONUS = 50`
- **Montants custom par employé** → `/planning` → 👥 Employés → modifier → section "Primes personnalisées"
- **Avenants contrat** → même UI → section "Avenants contrat" (date d'effet + heures)

---

## ✅ PLANNING — Chantiers réalisés (session 2026-04-11)

| # | Chantier | Fichiers clés |
|---|----------|---------------|
| 8 | Employé suspendu — champ `suspended`, filtre dans `subscribeEmployees`/`fetchEmployees`, bouton ⏸/▶ dans EmployeeManager, badge "Suspendu", invisible partout ailleurs | `types.ts`, `firebase/employees.ts`, `EmployeeManager.tsx` |
| 9 | Barème CA modifiable depuis l'app — `CaPalier` interface, `DEFAULT_CA_PALIERS`, `calcCaPrime` accepte paliers en param, UI dans `/admin/settings`, Firestore `settings/primes_ca` | `primes.ts`, `PrimesTab.tsx`, `AdminSettings.tsx` |

## ✅ DASHBOARDS — Restauration depuis stash (session 2026-04-11)

| Élément | Fichier |
|---------|---------|
| Météo semaine (Open-Meteo, 7 jours) | `corner/Dashboard.tsx`, `cuisine/Dashboard.tsx` |
| Ruptures corner actives temps réel (consolidées, dédupliquées, bouton "✓ On s'en occupe") | `cuisine/Dashboard.tsx` |
| Commandes clients de la semaine | `cuisine/Dashboard.tsx` |
| Bouton ← retour dans header mobile (sous-pages) | `Layout.tsx` |

---

## ✅ BUGS & FONCTIONNALITÉS — Session 2026-04-13 (audit complet)

| # | Fix | Fichiers |
|---|-----|----------|
| B1 | **Bug géoloc** — clé localStorage `pointageGateDate` désormais par UID (`pointageGateDate_${uid}`). Sans ça un user pouvait bypasser la gate si quelqu'un d'autre l'avait dismissée sur l'appareil | `DailyPointageGate.tsx`, `Layout.tsx` |
| B2 | **Corner Températures** — bouton ± restauré pour saisir des températures négatives | `corner/Temperatures.tsx` |
| B3 | **Corner Dashboard** — suppression bandeau TooGoodToGo (bouton vert) ; bannière commandes pleine largeur si commandes du jour/semaine | `corner/Dashboard.tsx` |
| B4 | **Bannière ruptures cuisine vide** — `Ruptures.tsx` n'écrivait que dans `messages`, jamais dans `ruptures_actives`. Fix : double write + règles Firestore + filtre fenêtre 13h J-1 dans Dashboard cuisine | `corner/Ruptures.tsx`, `cuisine/Dashboard.tsx`, `firestore.rules` |
| B5 | **Pertes rapport crash** — accès à `item.categorie`/`item.prixUnitaire`/`item.unite` inexistants. Fix : `defaultCategory`, `prix`, guards null | `corner/Pertes.tsx` |
| B6 | **Hygiène onglet Historique** — crash TypeScript (`ITEMS['historique']` undefined) + grille 7 jours avec statuts ✅/🟡/❌ implémentée | `corner/Hygiene.tsx` |

### Collection `ruptures_actives` — structure (créée session 2026-04-13)
```
{ ruptures: string[], presqueRuptures: string[], personne: string, createdAt: Timestamp, viewed: boolean }
```
- Écrite par `corner/Ruptures.tsx` à chaque envoi
- Lue par `cuisine/Dashboard.tsx` (filtre `viewed==false` + `createdAt >= hier 13h`)
- Règles : corner create, cuisine/patron/admin/manager update (`viewed=true`)

## ✅ PLANNING — Chantiers réalisés (session 2026-04-13)

| # | Chantier | Fichiers clés |
|---|----------|---------------|
| 10 | Heures dimanche + jours fériés dans Stats mensuel — colonne 🎆 Férié, calcul via algorithme Pâques de Gauss, 11 fériés légaux français, `getFrenchHolidays(year)` exportée depuis `usePlanning.ts` | `types.ts`, `hooks/usePlanning.ts`, `components/Monthly/MonthlyView.tsx`, `utils/exports.ts` |

### Comment fonctionne le calcul fériés
- `computeWeekCounters` accepte un 4e param `monday?: Date`
- Si fourni, les ISO dates des 7 jours sont calculées et vérifiées contre `getFrenchHolidays(year)`
- Les heures travaillées un jour férié incrémentent `heuresFerie` (indépendamment de `heuresDimanche`)
- Un dimanche férié (ex. 1er janvier 2023 = dimanche) incrémente **les deux**
- Export Excel inclut les colonnes H. Dimanche et H. Fériés

---

## ✅ CUISINE & TWILIO — Chantiers réalisés (session 2026-04-13 suite)

| # | Chantier | Fichiers clés |
|---|----------|---------------|
| 11 | **Réception scanner code-barres** — onglets "Nouvelle réception" / "Historique" dans `Reception.tsx` ; bouton 📷 sur champ N° lot → modal `html5-qrcode` (lazy load) | `Reception.tsx`, `BarcodeScanner.tsx`, `package.json` |
| 12 | **Réception Historique intégré** — liste avec photo miniature cliquable, badge HACCP, température, N° lot, bouton actualiser | `Reception.tsx` |
| 13 | **Fabrication traçabilité** — mode "📦 Réception" (3e onglet formulaire) : sélectionner réception source → pré-remplit `productName` + `fournisseur`, stocke `receptionId` dans le lot | `Fabrication.tsx` |
| 14 | **iPad Corner `devices/{uid}`** — `registerDeviceAsIPad()` appelée après login `ipad@yorgios.fr`, écrit `{ type, fcmToken, label, updatedAt }` | `Login.tsx`, `messaging.ts` |
| 15 | **Règle Firestore `devices`** — lecture isAnyRole(), écriture uid==propre doc ou patron/admin | `firestore.rules` |
| 16 | **Page `/livraisons`** — `onSnapshot` sur `deliveries` where `status=='in_progress'`, ETA proéminent, bouton tracking, bouton "Terminée", WakeLock, son ding.mp3 | `src/pages/Livraisons.tsx` |
| 17 | **Route + ModuleGridPanel** — `/livraisons` accessible à tous ; entrée "Coursier" dans grilles Corner ET Cuisine | `router/index.tsx`, `ModuleGridPanel.tsx` |

### Collections ajoutées / modifiées
- `devices/{uid}` : `{ type: 'ipad_corner'|'mobile', fcmToken, label, updatedAt }` — règle Firestore déployée
- `lots_cuisine` : nouveaux champs optionnels `receptionId`, `fournisseur` pour traçabilité

## ✅ AUDIT & CORRECTIONS — Session 2026-04-14 (COMPLET — mergé + déployé)

Branche `fix/audit-corrections` mergée dans `main` — deployed https://cuisine-yorgios.web.app

### Corrections appliquées (T1→T8)

| # | Fix | Fichier |
|---|-----|---------|
| T1 | **Corner Dashboard** — TooGoodToGo supprimé | `corner/Dashboard.tsx` |
| T2 | **Cuisine Dashboard** — fenêtre ruptures 13h/10h + commandes du mois | `cuisine/Dashboard.tsx` |
| T3 | **Fabrication** — anti-doublon lotCode | `cuisine/Fabrication.tsx` |
| T4 | **Pertes rapport** — label + KPI total combiné | `corner/Pertes.tsx` |
| T5 | **Vitrine** — doublons bloqués (hard error) | `corner/Vitrine.tsx` |
| T6 | **Corner Livraison** — tri avec-temp en premier · checkbox sans departTempC · boutons "↩ Retour cuisine" (tous) + "🗑 Supprimer" (patron/admin/manager) · email patron si REFUSE via CF `onLivraisonReception` | `corner/Livraison.tsx`, `functions/src/index.ts` |
| T7 | **Corner Ruptures** — grille 2 colonnes par catégorie · 3 états null→🔴→🟠 · panel "Sélection" en tête · produit sélectionné disparaît de la liste | `corner/Ruptures.tsx` |
| T8 | **Frigo ↔ Vitrine** — onglet "🧊 Frigo" dans formulaire vitrine · sélection d'articles `stockage_frigo` → `addDoc` corner_stock + `deleteDoc` stockage_frigo automatique | `corner/Vitrine.tsx` |

### CF déployées
- `onLivraisonReception` — email à `a.cozzika@gmail.com` si résultat REFUSE

### Comportements clés à connaître (session 2026-04-14)

**Corner Livraison (`corner/Livraison.tsx`)**
- `LivrDoc` a un champ `returned?: boolean` — les livraisons retournées sont filtrées du pending/done
- Items sans `departTempC` → checkbox (écrit `receptionTempC: null, result: 'ACCEPTE'`)
- `pending` filter : `receptionTempC == null && !receptionAt && !returned` (les deux conditions pour exclure les checkbox-validés)
- `done` filter : `(receptionTempC != null || receptionAt != null) && !returned`
- Bouton "Supprimer" visible uniquement pour patron/administrateur/manager

**Corner Ruptures (`corner/Ruptures.tsx`)**
- `stockChecks: Record<string, 'urgent' | 'moins-urgent' | null>` — plus de boolean
- Catalogue chargé depuis collection `produits` (active==true), trié `defaultCategory` puis `name`
- `toggleStockCheck(name)` cycle : null → 'urgent' → 'moins-urgent' → null
- ✕ dans le panel Sélection = `setStockChecks(prev => ({ ...prev, [name]: null }))` (déselection directe, pas cycle)
- `ruptures_actives` : fusionne sélections catalogue + saisies manuelles CmdRow[]

**Corner Vitrine (`corner/Vitrine.tsx`)**
- `formMode: 'manuel' | 'lot' | 'frigo'` — 3 modes
- Mode 'frigo' : charge `stockage_frigo` (limit 100), sélection multiple → `addDoc` corner_stock + `deleteDoc` stockage_frigo
- Champ `sourceFromFrigo: true` + `frigoId` dans les docs corner_stock créés depuis le frigo

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **yorgios-app** (1374 symbols, 3095 relationships, 112 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/yorgios-app/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/yorgios-app/context` | Codebase overview, check index freshness |
| `gitnexus://repo/yorgios-app/clusters` | All functional areas |
| `gitnexus://repo/yorgios-app/processes` | All execution flows |
| `gitnexus://repo/yorgios-app/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

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
