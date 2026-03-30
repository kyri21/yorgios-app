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

## 🚚 Suivi livraison Twilio — À IMPLÉMENTER

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
