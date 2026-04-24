# CLAUDE.md — Matias PWA

## ✅ SESSION 2026-04-24 — Pointages, GEP, alertes réception

### Déployé
| Fonctionnalité | Fichier(s) | Notes |
|----------------|-----------|-------|
| Login — "Mot de passe oublié" avec `sendPasswordResetEmail` | `src/pages/Login.tsx` | Caché en mode iPad. Email vide → message d'erreur. |
| `onLivraisonReception` — email REFUSE à tous responsables (HTML) | `functions/src/index.ts` | Destinataires : Alexandre + Arthur + Sébastien |
| `onNonConformiteCreated` — email décision NC à tous responsables | `functions/src/index.ts` | Déclenché à la création d'un doc `non_conformites/` |
| Règles GEP mises à jour — nomenclature officielle | `src/modules/cuisine/pages/Livraisons.tsx` | Voir tableau ci-dessous |
| Aliases catégories GEP élargis | `src/modules/cuisine/pages/Livraisons.tsx` | `plat_cuisine_frais`, `patisserie_fraiche`, `poisson_frais`… |
| Fix Firestore — Feuille de Vigne Farcie (24/04) → ACCEPTE | script node | `managerOverride: true`, validé par manager |
| `onPointageLate` — email HTML + event planning + FCM | `functions/src/index.ts` | Email tous responsables, event `retard` dans `planningWeeks` |
| `autoCheckoutSortie` — CF scheduler toutes les 30 min | `functions/src/index.ts` | Auto-checkout 1h après fin shift si pas de départ manuel |
| `createPointage` — bloc départ < 1h après arrivée | `functions/src/index.ts` | Erreur `BLOCKED_1H:HH:MM:message` |
| `createPointage` — overtime : re-arrivée après auto-checkout | `functions/src/index.ts` | Supprime auto-checkout, laisse passer nouvelle arrivée |
| `usePointageSortie` — expose `blockedUntil` | `src/hooks/usePointageSortie.ts` | Date quand sortie devient disponible |
| Layout modal sortie — double confirmation + message blocage | `src/components/Layout.tsx` | 2 étapes : "Pointer ma sortie" → "Oui, je quitte mon poste" |

### Règles GEP officielles (seuils tolérance max)
| Clé RULES | max_tol |
|-----------|---------|
| `VIANDE_HACHEE` | 3°C |
| `VIANDE` | 5°C |
| `POISSON` | 3°C |
| `LAIT` | 6°C |
| `PLAT_CUISINE` | 5°C |
| `PATISSERIE` | 5°C |
| `LEGUME` | 10°C |

### Règles issues de cette session
- **`RESPONSABLES_EMAILS`** → constante globale dans `functions/src/index.ts` : `['a.cozzika@gmail.com', 'kyriazis@outlook.fr', 'sebastien.coenca@gmail.com']`. Utiliser partout pour les emails d'alerte.
- **Email REFUSE livraison** → 2 emails : (1) alerte immédiate à la réception (`onLivraisonReception`), (2) confirmation décision corner (`onNonConformiteCreated`).
- **`managerOverride: true`** → champ sur doc `livraisons/` pour signaler une validation manuelle hors tolérance GEP.
- **Retard planning** → `onPointageLate` écrit dans `planningWeeks/{weekId}/events/{dateISO}` : `{ empId, type: 'retard', minutes }`. Visible dans l'onglet "Mois".
- **Champs ajoutés sur pointage arrivée** → `lateMinutes`, `plannedStartHour`, `plannedEndHour` (écrits par `onPointageLate` via `event.data.ref.update()`).
- **`autoCheckoutSortie`** → schedule `*/30 7-23 * * *` Paris. Crée un départ `{ autoCheckout: true, plannedEndHour }` si aucun départ manuel 1h après fin shift. Timestamp = heure de fin prévue (pas l'heure courante).
- **Overtime** → si employé re-pointe arrivée après auto-checkout : `createPointage` supprime l'auto-checkout et crée nouvelle arrivée (pas d'erreur doublon).
- **Bloc sortie 1h** → `createPointage` (départ) vérifie que l'arrivée a > 60 min. Renvoie `failed-precondition` avec message `BLOCKED_1H:HH:MM:...`.
- **Double confirmation sortie** → Layout.tsx : 1er clic = "Pointer ma sortie", 2ème clic = "Oui, je quitte mon poste". Le FAB affiche `blockedUntil` si < 1h.

---

## ✅ SESSION 2026-04-21 — Email Timour + Dashboard ruptures

### Déployé
| Fonctionnalité | Fichier(s) | Notes |
|----------------|-----------|-------|
| Email Timour redesigné — groupé par priorité catalogue | `functions/src/index.ts` | badges 🔴/🟠 par groupe de priorité |
| CF `previewNightlyRuptures` — aperçu sans envoi | `functions/src/index.ts` | callable patron/admin |
| CF `notifNightlyRuptures` — check enabled + pause vacances | `functions/src/index.ts` | lit `settings/nightly_ruptures` |
| AdminSettings — toggle on/off + date pickers vacances | `src/pages/AdminSettings.tsx` | sauvegardé dans `settings/nightly_ruptures` |
| AdminSettings — bouton "👁 Aperçu" + modal HTML | `src/pages/AdminSettings.tsx` | appelle `previewNightlyRuptures` |
| Dashboard cuisine — pastilles jaunes pour priority=null | `src/modules/cuisine/pages/Dashboard.tsx` | couleur `#ca8a04` |

### Règles issues de cette session
- **`settings/nightly_ruptures`** → `{ enabled: boolean, pauseFrom: string, pauseTo: string }` (format YYYY-MM-DD). La CF 21h30 vérifie ce doc avant d'envoyer.
- **Email ruptures** → groupé par niveau de priorité (comme le dashboard), puis trié alpha dans chaque groupe. Items `priority=null` → groupe "Sans priorité" en dernier.
- **Dashboard cuisine — pastilles** → `priority === null` = jaune `#ca8a04`. Priorité définie = rouge (rupture) ou orange (presque rupture).
- **`previewNightlyRuptures`** → callable (patron/admin) → retourne `{ items, commandes, hasContent, emailHtml }` sans envoyer.

---

## ✅ SESSION 2026-04-20 — Chantier multi-features (13 tâches toutes terminées)

| # | Tâche | Commit |
|---|-------|--------|
| 1 | Vitrine pastilles AUJ.=orange DEMAIN=violet + colonnes header +12px | 44e010f |
| 2 | Vitrine bug retour cuisine sans lotCode → `lots_cuisine.sent=false` | 44e010f |
| 3 | Dashboard cuisine ruptures : Sam+Dim cumulés jusqu'à lundi 12h | 7a9c9a7 |
| 4 | Fabrication — filtre viande (VIANDE/VIANDE_HACHEE) + badge >4j | b02fd7b |
| 5 | Fabrication — lots `sent=true` visibles + delete/modify tous rôles | b02fd7b |
| 6 | Notifications — retirer cuisine de `notifPlatsJour` + `notifCartonsChambrefroide` | f589cc6 |
| 7 | WhatsApp wa.me lien vers Timour (+33781468107) après envoi ruptures | 1010fe4 |
| 8 | Commandes clients — route `/commandes` tous rôles + filtre semaine/mois | 415e222 |
| 9 | Firestore rules — `gmao_demandes` + `creta_gel_docs` | 933e28a |
| 10 | Page `AdminDocuments.tsx` — GMAO (form + photo + email Christelle) + CRETA GEL (upload/view) | 598697f |
| 11 | Router + sidebar — route `/admin/documents` patron/admin | 598697f |
| 12 | CFs `sendGmaoEmail` (callable) + `gmaoWeeklyReminder` (scheduler lundi 9h) | f589cc6 |
| 13 | Build + deploy hosting | — |

### Règles issues de ce chantier
- **Documents GMAO** → collection `gmao_demandes` : `{ motif, departement, date, numeroIntervention, statut, photoUrl?, createdAt }`. Statuts : `en cours` / `en attente` / `terminé`.
- **CRETA GEL** → collection `creta_gel_docs` : `{ label, fileUrl, fileType, date, createdAt }`. Fichiers dans Storage `creta_gel/`.
- **Photos GMAO** → Storage `gmao/`.
- **Route `/commandes`** → accessible à TOUS les rôles. La page `Commandes.tsx` est réutilisée depuis `modules/corner/pages/`.
- **CF `sendGmaoEmail`** → callable (patron/admin) → envoie email à Christelle `cvandaele@la-grande-epicerie.fr`. Objet éditable avec template pré-rempli, champ `customBody` supporté.
- **CF `gmaoWeeklyReminder`** → scheduler lundi 9h → email à Alexandre + Sébastien si demandes "en cours".
- **`notifPlatsJour` + `notifCartonsChambrefroide`** → cuisine retirée des destinataires.

---

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

9. **Route cuisine** → `/cuisine` rend `CuisineDashboard`. Réception = `/cuisine/reception`.

10. **Ruptures — accumulation obligatoire** → Chaque envoi corner crée un **nouveau doc** `ruptures_actives` sans jamais archiver les précédents. `flatMap` + déduplication case-insensitive sur TOUS les docs non-vus → les envois du jour s'additionnent.
    → NE JAMAIS marquer `viewed: true` les ruptures existantes lors d'un nouvel envoi corner.
    → NE JAMAIS cliquer "✓ On s'en occupe" lors des tests.

11. **Ruptures — tri par priorité** → Dashboard cuisine groupe par champ `priority` de `catalogue`. Noms dans `ruptures_actives` doivent correspondre EXACTEMENT aux noms du catalogue. Priorité 1 en premier, `null` = "Sans priorité" en dernier.

12. **Catalogue** → collection `catalogue` (pas `produits`). Noms exacts obligatoires partout (ruptures, best-sellers dans settings, pertes, vitrine). Best-sellers dans `settings/ruptures.produits[]` doivent matcher exactement les noms du catalogue.

13. **Compte `planning@yorgios.fr`** → accès planning lecture seule uniquement. Pas de DailyPointageGate, pas d'autres routes. Bouton "📅 Mon planning" sur Login → connexion automatique sans saisie.

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

> Mots de passe : Firebase Console → Authentication.

---

## Structure dossiers

```
src/
  firebase/
    config.ts           ← UNIQUE initializeApp() — exporte db, auth, storage, functions
    messaging.ts        ← FCM + registerDeviceAsIPad()
  auth/
    useAuth.ts / AuthGuard.tsx
  router/index.tsx      ← React.lazy() + Suspense (code splitting)
  components/
    Layout.tsx          ← sidebar + bottom nav + FAB pointage sortie + bannière messages
    ModuleGridPanel.tsx ← bottom sheet grille 3×3 sous-pages Corner/Cuisine
    DailyPointageGate.tsx ← gate géoloc (exclut planning@yorgios.fr)
  pages/
    Login.tsx           ← boutons iPad Corner/Cuisine + bouton Planning (auto-login)
    AdminProduits.tsx   ← catalogue (filtre catégorie + priorité)
    AdminSettings.tsx   ← fournisseurs, alertes temp, best-sellers ruptures, niveaux priorité, barème CA
  modules/
    planning/     ← PlanningGrid (desktop) + MobilePlanningView (< 768px)
    cuisine/      ← Dashboard + Réception + Fabrication + Livraisons + Températures + Contrôle + ReceptionHistorique
    corner/       ← Dashboard + Températures + Hygiene + Livraison + Vitrine + StockageFrigo
                     Ruptures + Commandes + Pertes + Controle + PlanningCorner
    crm/          ← CaptationPage + useCaptation hook
  hooks/
    usePointageSortie.ts ← FAB sortie, appelle CF createPointage

functions/src/
  index.ts          ← 26 Cloud Functions
  domain/loyalty.ts ← paliers fidélité
  crm/index.ts      ← syncContactToBrevo, validatePromoCode
```

---

## Collections Firestore (DB `test`)

| Collection | Accès | Usage |
|-----------|-------|-------|
| `users` | own + patron/admin/manager | profils, role, fcmToken |
| `employees` | patron/admin/manager | employés planning |
| `planningWeeks` | lecture tous, écriture patron/admin/manager | semaines planning |
| `catalogue` | lecture isAnyRole, écriture isPatronOrManager | 104 produits — `name`, `abrv`, `defaultCategory`, `gepCategory`, `dlcDays`, `priority`, `active`, `inVitrine`, `inReception`, `inFabrication`, `allergenes[]` |
| `receptions` | cuisine | réceptions HACCP |
| `lots_cuisine` | lecture isAnyRole, create cuisine, update isAnyRole, delete corner | lots fabrication — `receptionId`, `fournisseur` pour traçabilité |
| `lot_counters` | cuisine | séquences numéros de lot |
| `livraisons` | lecture isAnyRole, create cuisine, update isAnyRole | livraisons cuisine → corner |
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
| `settings` | écriture patron/admin, lecture tous | fournisseurs, alertes, best-sellers ruptures, priority_levels, primes_ca |
| `pertes_corner` | corner | pertes |
| `deliveries` | lecture isAuth, write CF uniquement | suivi coursier Twilio — `trackingUrl`, `eta`, `status`, `rawMessage` |
| `devices` | lecture isAnyRole, écriture own ou patron/admin | `{ type: 'ipad_corner'\|'mobile', fcmToken, label }` |
| `customers` | CRM functions | fidélité + promos |

### Catalogue — champs clés
- `defaultCategory` : groupement affichage (Mezze · Plats · Bowl · Tiropitas · Salades · Desserts · Boissons · Autre)
- `gepCategory` : seuil GEP livraison (VIANDE, POISSON, PLAT_CUISINE, LEGUMES, etc.)
- `priority` : number | null — 1 = urgent (affiché en premier dans dashboard cuisine)
- `inFabrication: true` par défaut si absent — filtre `!== false`

---

## Cloud Functions (`europe-west1`)

| Fonction | Déclencheur | Rôle |
|----------|------------|------|
| `onNewMessage` | Firestore create `messages/{id}` | Push FCM à tous sauf expéditeur |
| `purgeOldMessages` | Scheduler quotidien | Supprime messages expirés |
| `onNewCommande` | Firestore create `commandes_externes/{id}` | Anti-spam 3/24h + Push FCM |
| `onCommandeUpdated` | Firestore update `commandes_externes/{id}` | Acceptée → GCal + FCM ; Livrée → Brevo + fidélité |
| `onCommandePrete` | httpsCallable | FCM patron+manager+cuisine + messagerie |
| `notifCommandesJ7` | Scheduler 8h00 | Email HTML toutes commandes J+0→J+7 |
| `notifCommandesJ2` | Scheduler 14h00 | FCM + Email HTML commandes dans 2 jours |
| `notifCommandesJJ` | Scheduler 09h00 | FCM rappel jour-J |
| `onPointageLate` | Firestore create `pointages/{id}` | Email si retard > 10 min |
| `createPointage` | httpsCallable | Validation GPS Haversine, anti-doublon |
| `notifTemperatures` | Scheduler 8h30 | FCM si frigos matin non saisis |
| `notifTemperaturesEvening` | Scheduler 22h00 | FCM si frigos soir non saisis |
| `notifCartonsChambrefroide` | Scheduler 9h30 | FCM corner+cuisine |
| `notifPlatsJour` | Scheduler 11h00 | FCM cuisine+corner |
| `notifUrgences` | Scheduler 15h00 | FCM employés pointés |
| `notifHygieneHebdo` | Scheduler samedi 18h | FCM si checklist hebdo non faite |
| `notifHygieneMensuel` | Scheduler 28-31 du mois 18h | FCM si checklist mensuelle non faite |
| `weeklyHygieneRecap` | Scheduler lundi 8h | Email récap températures + hygiène |
| `createUser` | httpsCallable (patron/admin) | Créer compte utilisateur |
| `deleteUser` | httpsCallable (patron/admin) | Supprimer compte utilisateur |
| `onLivraisonTemperature` | Firestore create `livraisons/{id}` | FCM départ livraison |
| `onLivraisonReception` | Firestore update `livraisons/{id}` | FCM + email patron si REFUSE |
| `incomingSms` | onRequest (Twilio webhook) | Parse SMS coursier → `deliveries` + FCM |
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
| `/admin/users` | patron, admin |
| `/admin/settings` | patron, admin |
| `/admin/pointages` | patron, admin, manager |
| `/admin/produits` | patron, admin |
| `/admin/allergenes` | patron, admin, manager |
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
`.page` · `.card` · `.btn-primary` · `.btn-secondary` · `.btn-danger` · `.btn-icon`
`.input` · `.input-filled` · `.section-title` · `.section-label`
`.chip-ok` · `.chip-danger` · `.chip-warn` · `.nav-tabs` / `.nav-tab` · `.glass` · `.divider`
`.spinner` · `.skeleton`

### Règles
- Overlays modals : `rgba(28,28,24,0.45)`
- Fonts : **Epilogue** (titres h1-h3) + **Manrope** (body)
- Tap targets min 44×44px mobile

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

## ⚠️ ARCHITECTURE MÉTIER — RÈGLES INVIOLABLES

### Cycle de vie d'un lot cuisine

```
Fabrication (cuisine)
  → Livraison cuisine (départ + temp)
    → Livraison corner (arrivée + temp)
      → Frigo corner (stockage_frigo)  ──→  Vitrine (corner_stock, active=true)
      → Vitrine directe (corner_stock)
```

1. **Pas de doublon** dans `lots_cuisine`, `stockage_frigo`, `corner_stock`. Bloquer si doublon.
2. **Lot livré + accepté** → `lots_cuisine.archived=true`. Disparaît de "Lots en cours".
3. **Lot ajouté en vitrine depuis lots cuisine** → archive `lots_cuisine` + crée `corner_stock`.
4. **Lot transféré frigo → vitrine** → `deleteDoc stockage_frigo` automatique. Frigo et vitrine sont mutuellement exclusifs.
5. **Retour cuisine depuis Vitrine** → `corner_stock.active=false` + `lots_cuisine.sent=false`.

---

### Cuisine — Dashboard

- **Encadré rouge ruptures** : un seul encadré en haut, triés par priorité catalogue. Fenêtre : avant 10h → depuis hier 13h ; après 10h → depuis minuit.
- **Ruptures** : `flatMap` sur tous les docs `viewed==false` → déduplication case-insensitive.
- **"✓ On s'en occupe"** → `batch.update viewed:true` sur tous les docs visibles.
- **Commandes** : filtre `STATUTS_ACTIFS = ['en cours', 'devis envoyé', 'accepté']`.

---

### Cuisine — Réception

- Produits depuis `catalogue where inReception==true && active==true`.
- N° lot : saisie manuelle ou scan code-barres (html5-qrcode, lazy).
- Crée un doc `receptions` — référencé dans Fabrication (`receptionId`).

---

### Cuisine — Fabrication

- Vérifier `lotCode` inexistant avant `setDoc`. Bloquer si doublon.
- Mode "📦 Réception" : pré-remplit `productName` + `fournisseur`, stocke `receptionId`.
- DLC auto : J+`dlcDays` depuis date fabrication (configurable dans catalogue).

---

### Cuisine — Livraison (départ)

- Lots non livrés (`sent!=true`). Température obligatoire pour lots soumis GEP.
- Lots sans temp → case à cocher côté corner à l'arrivée.
- Lots sélectionnés → `sent=true`.

---

### Corner — Dashboard

- **Filtre livraisons pending** : `receptionTempC == null && !receptionAt && !returned && departAt >= todayStart`.
- ⚠️ Ce filtre doit être **identique** dans `corner/Dashboard.tsx` et `corner/Livraison.tsx`.
- **Commandes** : même filtre `STATUTS_ACTIFS` que cuisine.

---

### Corner — Livraison (arrivée)

- Lots AVEC `departTempC` en premier, SANS `departTempC` ensuite.
- Avec temp → saisie temp arrivée + photo → résultat GEP. Dépassement `maxTol` → email patron + FCM.
- Sans temp → checkbox groupée "Livraison reçue ✓" → `result: 'ACCEPTE'`.
- `pending` : `receptionTempC == null && !receptionAt && !returned`.
- `done` : `(receptionTempC != null || receptionAt != null) && !returned`.
- Bouton "↩ Retour cuisine" : tous rôles. Bouton "🗑 Supprimer" : patron/admin/manager.

---

### Corner — Vitrine

**3 modes d'ajout** :
1. **✏️ Manuel** : catalogue `inVitrine==true`, multi-sélection.
2. **📦 Lot cuisine** : `lots_cuisine where sent==true && inVitrine!=false`. Sélection → `addDoc corner_stock` + archive `lots_cuisine`.
3. **🧊 Frigo** : `stockage_frigo`. Sélection → `addDoc corner_stock` + `deleteDoc stockage_frigo`.

---

### Corner — Ruptures

- Best-sellers depuis `settings/ruptures.produits[]` (noms exacts catalogue).
- Catalogue depuis `catalogue` (active==true), ordre fixe : Mezze→Salades→Tiropitas→Plats→Bowl→Desserts→Autre→Boissons.
- 3 états : null → 🔴 urgent → 🟠 moins-urgent → null. ✕ dans panel = null direct.
- Chaque envoi = **nouveau doc** `ruptures_actives`, jamais d'archivage des précédents.
- `ruptures[]` = urgent, `presqueRuptures[]` = moins-urgent.

---

### Corner — Hygiène

- Quotidien (13 items) / Hebdo (5 items) / Mensuel (1 item).
- Doc IDs : `{date}_quotidien` / `{YYYY-WXX}_hebdo` / `{YYYY-MM}_mensuel`.

---

### Corner — Pertes

- Produits depuis `catalogue`. Guards null impératifs sur tous les champs.

---

### Livraisons coursier (Twilio)

- CF `incomingSms` → parse SMS → écrit dans `deliveries`.
- Page `/livraisons` : `onSnapshot deliveries where status=='in_progress'`.
- iPad Corner : enregistre `devices/{uid}` au login, son + WakeLock sur nouvelle livraison.

---

### Planning — barèmes

- **CA progressif** → `/admin/settings` → `settings/primes_ca`
- **Comportement/ponctualité** → `src/modules/planning/utils/primes.ts`, constante `BAREME`
- **Prime hygiène** → même fichier, `HYGIENE_BONUS = 50`
- **Montants custom par employé** → `/planning` → 👥 Employés
- **Avenants contrat** → même UI

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
