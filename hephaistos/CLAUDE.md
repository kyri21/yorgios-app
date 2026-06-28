# CLAUDE.md — Hephaistos Platform

> Le dieu forgeron qui fabrique les outils des dieux.
> Hephaistos est la plateforme SaaS de fabrication et d'administration d'applications Matias.

---

## Vision

Hephaistos est un **cockpit super admin** qui permet de :
- **Creer** des instances Matias sur mesure pour chaque client (restaurant, commerce, etc.)
- **Assembler** chaque app a partir de briques modulaires (planning, HACCP, stock, RH...)
- **Controler** les acces : activer, suspendre, couper un client en 1 clic (kill-switch)
- **Facturer** automatiquement via Stripe avec coupure auto sur impaye
- **Administrer** sans jamais toucher a Google Cloud Console

Matias (l'app client) reste un **produit unique** deploye une seule fois. C'est la config du tenant dans Hephaistos qui determine ce que chaque client voit et peut faire.

---

## Decisions architecturales fondamentales

| Decision | Choix | Justification |
|----------|-------|---------------|
| Nom | **Hephaistos** | Forge d'applications |
| Stack | **100% Firebase** | Maitrise existante, pas de nouveau backend a apprendre |
| Repo | **Separe** de yorgios-app | Decouplage total, cycle de vie independant |
| V1 | **Cockpit seul** | Dashboard super admin d'abord, sans toucher a Matias |
| Deploiement clients | **Build unique** | 1 seul deploiement Matias, config runtime par tenant |
| Domaines | **Custom par client** | Chaque client a son domaine (app.yorgios.fr, matias.restaurant-paul.fr) |
| Utilisateurs plateforme | **Multi-roles** | Owner + futurs associes/commerciaux/support |
| Multi-tenancy | **Named databases Firebase** | 1 DB par tenant, isolation physique des donnees |
| Secteur | **Restauration d'abord** | Briques de base generiques, extensions metier sectorielles |

---

## Architecture globale

```
HEPHAISTOS (repo separe)                    MATIAS (yorgios-app)
================================            ================================
Cockpit super admin                         App client PWA unique
  - Gestion tenants                           - Routeur dynamique (config tenant)
  - Module builder                            - Modules activables par config
  - Billing Stripe                            - Branding custom par tenant
  - Monitoring                                - Kill-switch cote client
  - Impersonation                             - Resolution tenant au login

         |                                             |
         |        Firebase (projet unique)              |
         +--------- cuisine-yorgios -------------------+
                        |
            +-----------+-----------+
            |           |           |
        DB platform   DB yorgios   DB client-N
        (meta)        (1er tenant) (Nth tenant)
```

### Principe des 4 couches

```
+--------------------------------------------------+
|         COUCHE 1 — COCKPIT (Hephaistos)          |
|  App separee, repo separe                         |
|  Super admin uniquement                           |
|  Lit/ecrit dans DB "platform"                     |
+---------------------------+----------------------+
                            |
+---------------------------v----------------------+
|         COUCHE 2 — RESOLVEUR TENANT              |
|  Middleware au login dans Matias                  |
|  Email -> tenant -> config -> DB                 |
|  Custom claims Firebase Auth                     |
+---------------------------+----------------------+
                            |
            +---------------+---------------+
            |               |               |
+-----------v--+  +---------v----+  +-------v------+
| DB "yorgios" |  | DB "paul"    |  | DB "client-N"|
| (named DB)   |  | (named DB)   |  | (named DB)   |
| Collections  |  | Collections  |  | Collections  |
| Matias std   |  | Matias std   |  | Matias std   |
+--------------+  +--------------+  +--------------+

+--------------------------------------------------+
|         COUCHE 4 — MODULE REGISTRY               |
|  Config JSON dans DB platform                     |
|  Quelles briques actives par tenant               |
|  Routes, onglets, permissions par brique          |
|  Routeur React de Matias lit cette config au boot |
+--------------------------------------------------+
```

---

## Projet Firebase

- **Project ID** : `cuisine-yorgios` (projet existant, partage avec Matias)
- **DB Hephaistos** : `platform` (named database — meta-donnees cross-tenant)
- **DB Yorgios** : `yorgios` (renommage de l'actuelle `test` lors de la migration)
- **DB clients** : `{tenantId}` (une named database par client)
- **Region Functions** : `europe-west1`
- **Auth** : pool unique partage (1 Firebase Auth pour tous les tenants)
- **Hosting Hephaistos** : domaine dedie (ex: `admin.matias.app` ou `hephaistos.matias.app`)
- **Hosting Matias** : domaine unique + custom domains par client

---

## Stack technique

| Composant | Technologie | Notes |
|-----------|-------------|-------|
| Frontend cockpit | React + Vite + TypeScript | Meme stack que Matias |
| Design system | Aegean Precision (partage) | Variables CSS communes |
| Base de donnees | Firestore (named databases) | 1 DB `platform` + 1 DB par tenant |
| Auth | Firebase Auth (pool unique) | Custom claims `{ tenantId, role, platformRole }` |
| Functions | Cloud Functions v2 (Node) | Region europe-west1 |
| Billing | Stripe (Checkout + Webhooks) | Plans, factures, kill-switch auto |
| Hosting | Firebase Hosting | Multi-site (hephaistos + matias) |
| Storage | Firebase Storage | Prefixe `{tenantId}/` par tenant |
| Monitoring | Firebase Performance + custom | Metriques par tenant |

---

## Roles plateforme (Hephaistos)

| Role | Acces | Description |
|------|-------|-------------|
| `owner` | Tout | Proprietaire de la plateforme (toi). Cree/supprime des super admins |
| `admin` | Tout sauf gestion des owners | Administration complete des tenants, billing, modules |
| `commercial` | Lecture tenants + creation tenant + billing | Vend et onboard de nouveaux clients |
| `support` | Lecture tenants + impersonation | Diagnostique les problemes clients sans modifier la config |

### Utilisateurs initiaux
| Nom | Role | Email |
|-----|------|-------|
| Arthur Kyriazis | `owner` | kyriarthur@gmail.com |

---

## Collections Firestore — DB `platform`

### `tenants/{tenantId}`
```
{
  id: string                    // ex: "yorgios"
  name: string                  // ex: "Yorgios"
  legalName?: string            // raison sociale
  active: boolean               // KILL-SWITCH — false = app bloquee
  suspendedAt?: Timestamp       // date de suspension
  suspendReason?: string        // "impaye" | "manual" | "trial_expired"
  createdAt: Timestamp
  createdBy: string             // UID du super admin qui a cree
  
  // Branding
  branding: {
    appName: string             // nom affiche dans l'app (ex: "Matias")
    logo?: string               // URL Storage
    primaryColor: string        // ex: "#004275"
    secondaryColor?: string
    fonts?: { heading, body }
  }
  
  // Domaine
  domain: {
    custom?: string             // ex: "app.yorgios.fr"
    subdomain: string           // ex: "yorgios" (.matias.app)
    verified: boolean           // DNS verifie
  }
  
  // Billing
  billing: {
    stripeCustomerId: string
    stripeSubscriptionId?: string
    plan: string                // "starter" | "pro" | "premium" | "custom"
    status: string              // "active" | "past_due" | "canceled" | "trialing"
    trialEnd?: Timestamp
    currentPeriodEnd?: Timestamp
    monthlyPrice?: number       // en centimes
  }
  
  // Config Firebase
  firebase: {
    dbName: string              // nom de la named database
    storagePath: string         // prefixe Storage
  }
  
  // Limites
  limits: {
    maxUsers: number            // max utilisateurs dans le tenant
    maxEmployees: number        // max employes planning
    storageQuotaMb: number      // quota Storage
  }
  
  // Contact
  contact: {
    email: string               // email principal du tenant admin
    phone?: string
    address?: string
  }
}
```

### `tenants/{tenantId}/modules/{moduleId}`
```
{
  enabled: boolean
  enabledAt?: Timestamp
  enabledBy?: string            // UID super admin
  config: {                     // config specifique au module pour ce tenant
    tabs?: string[]             // onglets actifs (subset du module)
    features?: Record<string, boolean>  // feature flags par module
    limits?: Record<string, number>     // limites specifiques
  }
}
```

### `tenants/{tenantId}/admins/{uid}`
```
{
  email: string
  displayName: string
  role: string                  // role DANS le tenant (patron, admin, manager...)
  addedAt: Timestamp
  addedBy: string
}
```

### `tenants/{tenantId}/billing_events/{eventId}`
```
{
  type: string                  // "invoice.paid" | "invoice.failed" | "subscription.updated" ...
  stripeEventId: string
  data: object                  // payload Stripe
  processedAt: Timestamp
  action?: string               // "none" | "suspended" | "reactivated"
}
```

### `superadmins/{uid}`
```
{
  email: string
  displayName: string
  role: string                  // "owner" | "admin" | "commercial" | "support"
  createdAt: Timestamp
  createdBy?: string            // UID (absent pour le premier owner)
  lastLoginAt?: Timestamp
}
```

### `modules/{moduleId}` (registre global des briques)
```
{
  id: string                    // ex: "planning"
  name: string                  // ex: "Planning"
  description: string
  icon: string                  // emoji ou icon name
  category: string              // "core" | "metier" | "addon"
  sector?: string               // null = generique, "restauration" = specifique
  
  routes: string[]              // ["/planning", "/planning/*"]
  
  dependencies: string[]        // modules requis (ex: planning necessite "employees")
  
  tabs: [
    { id: string, label: string, component: string, default?: boolean }
  ]
  
  features: [
    { id: string, label: string, description: string, default: boolean }
  ]
  
  plans: string[]               // dans quels plans le module est inclus
  
  // Permissions par defaut du module
  defaultPermissions: {
    roles: Record<string, string[]>  // ex: { patron: ["read","write"], corner: ["read"] }
  }
}
```

### `user_tenants/{email}`
```
{
  tenants: [
    { tenantId: string, role: string, dbName: string }
  ]
  // Un meme email peut appartenir a plusieurs tenants
  // Le login propose un selecteur si > 1
}
```

### `platform_audit/{id}`
```
{
  action: string                // "tenant.created" | "tenant.suspended" | "module.enabled" ...
  performedBy: string           // UID super admin
  performedByName: string
  tenantId?: string
  details: object               // payload variable selon l'action
  at: Timestamp
}
```

---

## Module Registry — briques Matias

### Briques generiques (tout secteur)

| Module ID | Nom | Categorie | Dependances | Plans |
|-----------|-----|-----------|-------------|-------|
| `employees` | Employes | core | - | tous |
| `planning` | Planning | core | employees | tous |
| `pointages` | Pointages | core | employees, planning | starter+ |
| `rh_docs` | Documents RH | core | employees | pro+ |
| `rh_conges` | Conges | core | employees | pro+ |
| `annonces` | Annonces | core | - | tous |
| `messaging` | Messagerie | core | - | tous |
| `notifications` | Notifications push | core | - | tous |

### Briques metier restauration

| Module ID | Nom | Categorie | Dependances | Plans |
|-----------|-----|-----------|-------------|-------|
| `catalogue` | Catalogue produits | metier | - | pro+ |
| `reception` | Reception HACCP | metier | catalogue | pro+ |
| `fabrication` | Fabrication | metier | catalogue, reception | pro+ |
| `livraisons` | Livraisons | metier | fabrication | pro+ |
| `vitrine` | Vitrine | metier | catalogue | pro+ |
| `stock_frigo` | Stockage frigo | metier | catalogue | pro+ |
| `temperatures` | Temperatures | metier | - | pro+ |
| `hygiene` | Hygiene | metier | - | pro+ |
| `ruptures` | Ruptures | metier | catalogue | pro+ |
| `pertes` | Pertes | metier | catalogue | pro+ |
| `controle` | Controle qualite | metier | temperatures, hygiene | premium |
| `commandes_ext` | Commandes clients | metier | catalogue | pro+ |
| `gmao` | GMAO | addon | - | premium |
| `creta_gel` | CRETA GEL | addon | - | premium |
| `crm` | CRM / Fidelite | addon | - | premium |

### Config par module — exemple Planning

```json
{
  "enabled": true,
  "config": {
    "tabs": ["week", "month", "employees", "primes"],
    "features": {
      "extras": true,
      "events": true,
      "mobileEdit": true,
      "audit": true,
      "export_excel": true,
      "export_pdf": false,
      "no_show_detection": true
    },
    "limits": {
      "maxEmployees": 50,
      "auditRetentionDays": 90
    }
  }
}
```

---

## Plans tarifaires

| Plan | Modules inclus | Prix suggere | Limites |
|------|---------------|-------------|---------|
| **Starter** | Planning + Pointages + Messagerie + Annonces | 49-79 EUR/mois | 15 employes, 5 users |
| **Pro** | Starter + HACCP complet + Stock + RH | 149-199 EUR/mois | 50 employes, 15 users |
| **Premium** | Tout | 249-349 EUR/mois | Illimite |
| **Custom** | A la carte | Sur devis | Sur devis |

### Modele Stripe
- Subscription mensuelle ou annuelle (-15% annuel)
- `trial_days: 14` pour les nouveaux clients
- Webhook `invoice.payment_failed` -> grace 7j -> suspension auto
- Webhook `customer.subscription.deleted` -> kill-switch immediat
- Metered billing possible pour le stockage (future)

---

## Kill-switch — mecanisme technique

### Double verrou

**Verrou 1 — UI (Matias cote client)** :
```
onSnapshot(tenant config) -> si active === false :
  -> Modal fullscreen non-dismissable
  -> "Votre acces a ete suspendu. Contactez votre administrateur."
  -> Aucune action possible
```

**Verrou 2 — Backend (Security Rules)** :
```
// Dans les rules de chaque named database tenant
function isTenantActive() {
  return request.auth.token.tenantActive == true;
}
match /{document=**} {
  allow read, write: if isTenantActive();
}
```

### Flux suspension
```
Super admin clique "Suspendre"
  OR Stripe webhook invoice.payment_failed + 7j grace
    |
    v
1. platform/tenants/{id}.active = false
2. Cloud Function revoque custom claims (tenantActive = false)
3. Force refresh token cote client (prochain appel API = denied)
4. Email automatique au tenant admin avec raison + lien paiement
```

### Flux reactivation
```
Super admin clique "Reactiver"
  OR Stripe webhook invoice.paid (apres suspension)
    |
    v
1. platform/tenants/{id}.active = true, suspendedAt = null
2. Cloud Function met a jour custom claims (tenantActive = true)
3. Email automatique au tenant admin "Acces retabli"
```

---

## Cloud Functions Hephaistos

| Fonction | Declencheur | Role |
|----------|------------|------|
| `onTenantCreated` | Firestore create `tenants/{id}` | Cree la named DB, seed les collections de base, log audit |
| `onTenantSuspended` | Firestore update `tenants/{id}` (active: false) | Revoque claims, email tenant admin |
| `onTenantReactivated` | Firestore update `tenants/{id}` (active: true) | Restaure claims, email tenant admin |
| `resolveTenant` | httpsCallable | Login : email -> tenantId + config. Set custom claims |
| `impersonateTenant` | httpsCallable (owner/admin/support) | Genere un token d'acces temporaire pour debug client |
| `onStripeWebhook` | onRequest (webhook Stripe) | Traite paiements, suspensions, reactivations |
| `provisionTenant` | httpsCallable (owner/admin/commercial) | Creation complete d'un tenant : DB + admin + modules + Stripe customer |
| `deleteTenant` | httpsCallable (owner uniquement) | Supprime DB + donnees + Stripe. Irreversible, double confirmation |
| `syncModuleConfig` | httpsCallable | Propage les changements de modules vers les custom claims client |
| `tenantHealthCheck` | Scheduler quotidien | Verifie l'etat de tous les tenants : billing, usage, alertes |
| `usageMetrics` | Scheduler quotidien | Calcule metriques par tenant : users actifs, docs, storage |

---

## Cockpit — pages V1

### Dashboard
- Nombre de tenants actifs / suspendus / en trial
- Revenus MRR (Monthly Recurring Revenue) depuis Stripe
- Alertes : impay es, trials expirant, quotas proches
- Derniere activite par tenant (dernier login d'un user)

### Tenants
- Liste avec filtres (actif/suspendu/trial, plan, date creation)
- Fiche tenant : infos, modules actifs, users, billing, logs audit
- Actions : suspendre, reactiver, modifier plan, impersonation
- Creation tenant : wizard step-by-step

### Modules
- Registre global des briques disponibles
- Par tenant : activation/desactivation, config features/tabs
- Visualisation des dependances (graphe)

### Billing
- Vue Stripe embeddee ou custom
- Factures par tenant, statut paiement
- Historique des events Stripe
- Config plans et pricing

### Audit
- Journal de toutes les actions super admin
- Filtres : par tenant, par action, par super admin, par date
- Export CSV

### Parametres
- Gestion des super admins (inviter, revoquer, changer role)
- Config globale (domaines, emails, Stripe keys)
- Maintenance mode (suspendre TOUS les tenants temporairement)

---

## Resolution tenant au login — flux detaille

```
1. User ouvre matias.app (ou app.yorgios.fr)

2. Ecran login — saisit email + password

3. Firebase Auth authentifie (pool unique)

4. Post-login hook : appel CF "resolveTenant"
   |
   +-- Lookup platform/user_tenants/{email}
   |     -> Liste des tenants associes a cet email
   |
   +-- Si 0 tenant : "Aucun compte associe. Contactez votre administrateur."
   |
   +-- Si 1 tenant :
   |     -> Check tenant.active
   |     -> Set custom claims { tenantId, dbName, role, modules[], tenantActive }
   |     -> Return tenant config (branding, modules, features)
   |
   +-- Si N tenants :
   |     -> Ecran selecteur : "Choisissez votre espace"
   |     -> User choisit -> meme flow que 1 tenant
   |
   v
5. App Matias demarre :
   - db = getFirestore(app, claims.dbName)
   - Charge branding (logo, couleurs, nom)
   - Routeur filtre les routes selon claims.modules[]
   - Sidebar/nav generee dynamiquement
```

---

## Domaine custom — implementation

```
1. Super admin saisit le domaine custom dans la fiche tenant
   ex: "app.yorgios.fr"

2. Hephaistos genere les instructions DNS :
   CNAME app.yorgios.fr -> matias-client.web.app
   (ou A record si apex domain)

3. Super admin envoie les instructions au client
   (ou le client les configure lui-meme)

4. Firebase Hosting : ajouter le domaine custom via Admin SDK
   admin.hosting().addDomain("app.yorgios.fr")

5. Firebase provisionne le certificat SSL (automatique)

6. Matias app : au chargement, detecte le hostname
   -> Lookup platform/tenant_domains/{hostname} -> tenantId
   -> Pre-charge la config tenant AVANT le login
   -> Affiche le branding du tenant sur l'ecran de login
```

### Collection supplementaire
```
platform/tenant_domains/{hostname}
{
  tenantId: string      // ex: "yorgios"
  addedAt: Timestamp
  sslReady: boolean
}
```

---

## Impersonation — mode debug super admin

Le super admin peut "entrer" dans n'importe quel tenant pour diagnostiquer un probleme :

```
1. Cockpit -> fiche tenant -> bouton "Impersonation"
2. CF genere un custom token avec claims du tenant
   (tenantId, role=patron, modules=all, impersonating=true)
3. Redirect vers Matias avec ce token
4. Bandeau rouge permanent en haut : "MODE ADMIN — Vous etes connecte en tant que [tenant]"
5. Toutes les actions sont loguees dans platform_audit avec tag "impersonation"
6. Session limitee a 1h (expiration du token)
```

---

## Migration Yorgios — plan

Yorgios est le premier tenant. La migration doit etre transparente (zero downtime pour les utilisateurs).

### Etapes
1. Creer la DB `platform` (named database)
2. Seed le registre des modules (`modules/*`)
3. Creer le tenant `yorgios` dans `platform/tenants/yorgios`
4. **Renommer la DB `test` en `yorgios`** (ou creer `yorgios` et migrer les donnees)
5. Creer les `user_tenants/{email}` pour tous les users Yorgios existants
6. Modifier `config.ts` de Matias : `getFirestore(app, 'test')` -> `getFirestore(app, tenantConfig.dbName)`
7. Ajouter le resolveur tenant au flux de login
8. Deployer Matias avec le nouveau flux
9. Verifier que tout fonctionne pour Yorgios
10. Le cockpit Hephaistos est alors operationnel pour gerer Yorgios + futurs clients

### Risque principal
La DB `test` ne peut pas etre renommee dans Firebase. Deux options :
- **Option A** : garder `test` comme dbName pour le tenant Yorgios (pragmatique, zero migration)
- **Option B** : exporter/reimporter vers une nouvelle DB `yorgios` (propre, mais temps d'arret)

Recommandation : **Option A** pour la V1. Le dbName est une config, pas un nom visible.

---

## Securite

### Regles absolues
1. **Isolation tenant** : un user ne peut JAMAIS lire/ecrire dans la DB d'un autre tenant. Les custom claims determinent la DB, les security rules verifient le claim.
2. **Super admin != tenant admin** : les super admins n'apparaissent PAS dans la DB des tenants. Ils existent uniquement dans `platform`.
3. **Audit inviolable** : `platform_audit` est append-only (create only, no update/delete). Meme pattern que `planning_audit` dans Matias.
4. **Stripe webhook signature** : toujours verifier `stripe.webhooks.constructEvent()` avec le signing secret.
5. **Impersonation loguee** : chaque seconde en mode impersonation est tracee.
6. **Pas de donnees client dans platform** : la DB platform contient UNIQUEMENT des metadonnees (nom, plan, config). Jamais de donnees metier (planning, temperatures...).
7. **Custom claims refresh** : apres suspension, forcer un token refresh cote client dans les 60s (via onSnapshot sur un doc sentinelle).

### Security Rules — DB platform
```
rules_version = '2';
service cloud.firestore {
  match /databases/platform/documents {
    
    function isSuperAdmin() {
      return request.auth != null 
        && request.auth.token.platformRole in ['owner', 'admin', 'commercial', 'support'];
    }
    
    function isOwner() {
      return request.auth != null && request.auth.token.platformRole == 'owner';
    }
    
    match /tenants/{tenantId} {
      allow read: if isSuperAdmin();
      allow create: if request.auth.token.platformRole in ['owner', 'admin', 'commercial'];
      allow update: if request.auth.token.platformRole in ['owner', 'admin'];
      allow delete: if isOwner();
    }
    
    match /superadmins/{uid} {
      allow read: if isSuperAdmin();
      allow write: if isOwner();
    }
    
    match /modules/{moduleId} {
      allow read: if isSuperAdmin();
      allow write: if isOwner();
    }
    
    match /platform_audit/{id} {
      allow read: if isSuperAdmin();
      allow create: if isSuperAdmin();
      allow update, delete: if false;  // INVIOLABLE
    }
    
    match /user_tenants/{email} {
      allow read: if isSuperAdmin();
      allow write: if request.auth.token.platformRole in ['owner', 'admin'];
    }
    
    match /tenant_domains/{hostname} {
      allow read: if true;  // lookup public au chargement
      allow write: if request.auth.token.platformRole in ['owner', 'admin'];
    }
  }
}
```

---

## Structure dossiers (repo hephaistos)

```
hephaistos/
  src/
    firebase/
      config.ts           — initializeApp + getFirestore(app, 'platform')
    auth/
      useAuth.ts          — hook auth avec verification platformRole
      AuthGuard.tsx        — gate super admin
    router/
      index.tsx           — routes cockpit
    pages/
      Dashboard.tsx       — vue d'ensemble
      Tenants.tsx         — liste + CRUD tenants
      TenantDetail.tsx    — fiche tenant (modules, billing, users, audit)
      TenantCreate.tsx    — wizard creation tenant
      Modules.tsx         — registre global des briques
      Billing.tsx         — vue Stripe, factures, plans
      Audit.tsx           — journal d'audit
      Settings.tsx        — config plateforme, super admins
      Login.tsx           — login super admin
    components/
      Layout.tsx          — sidebar cockpit
      TenantCard.tsx      — card tenant dans la liste
      ModuleToggle.tsx    — switch activation module
      KillSwitch.tsx      — bouton suspendre/reactiver avec confirmation
      ImpersonateButton.tsx — bouton debug
      BillingStatus.tsx   — badge statut paiement
      AuditLog.tsx        — timeline audit
    hooks/
      useTenants.ts       — CRUD tenants + realtime
      useModules.ts       — registre modules
      useBilling.ts       — integration Stripe
      useAudit.ts         — lecture audit logs
      useImpersonate.ts   — generation token impersonation
  functions/
    src/
      index.ts            — exports CF
      tenants/            — provisionTenant, deleteTenant, onTenantCreated/Suspended/Reactivated
      auth/               — resolveTenant, impersonateTenant, syncModuleConfig
      billing/            — onStripeWebhook, tenantHealthCheck
      metrics/            — usageMetrics
  firestore.rules         — rules DB platform
  firestore.indexes.json  — index DB platform
  firebase.json           — config hosting + functions
  package.json
  vite.config.ts
  tsconfig.json
  .env                    — STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, VITE_FIREBASE_*
```

---

## Variables d'environnement

### `.env` (frontend cockpit)
```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=cuisine-yorgios
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

### `functions/.env`
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
PLATFORM_OWNER_EMAIL=kyriarthur@gmail.com
GMAIL_USER=...          # pour emails de suspension/reactivation
GMAIL_APP_PASSWORD=...
```

---

## Feuille de route

### Phase 0 — Fondations (semaine 1-2)
- [ ] Creer le repo `hephaistos`
- [ ] Setup Vite + React + TypeScript + Tailwind/CSS Aegean
- [ ] Firebase config (DB `platform`)
- [ ] Auth super admin (login + guard + custom claims)
- [ ] Layout cockpit (sidebar, routing)
- [ ] Seed premier super admin (toi)

### Phase 1 — Cockpit V1 (semaine 3-5)
- [ ] Dashboard (stats mock d'abord, puis reelles)
- [ ] CRUD tenants (liste, fiche, creation, suspension)
- [ ] Kill-switch fonctionnel (UI + claims + rules)
- [ ] Audit log (append-only, lecture cockpit)
- [ ] Module registry (seed des briques existantes de Matias)
- [ ] Activation/desactivation modules par tenant

### Phase 2 — Resolution tenant dans Matias (semaine 6-8)
- [ ] CF `resolveTenant` (email -> tenant -> claims)
- [ ] Modifier Matias : `config.ts` dynamique (dbName depuis claims)
- [ ] Modifier Matias : routeur dynamique (modules depuis claims)
- [ ] Modifier Matias : Layout dynamique (nav depuis config)
- [ ] Modifier Matias : branding runtime (logo, couleurs, nom)
- [ ] Migrer Yorgios comme premier tenant (option A : garder DB `test`)
- [ ] Test complet : Yorgios fonctionne identiquement via le nouveau flux

### Phase 3 — Billing Stripe (semaine 9-11)
- [ ] Integration Stripe : customers, subscriptions, checkout
- [ ] Webhook handler (paiements, echecs, annulations)
- [ ] Kill-switch automatique sur impaye (grace 7j)
- [ ] Reactivation automatique sur paiement
- [ ] UI billing dans le cockpit (factures, plans, statuts)
- [ ] Portail client Stripe (lien dans l'app Matias)

### Phase 4 — Domaines custom (semaine 12-13)
- [ ] Firebase Hosting multi-site
- [ ] Provisioning domaine custom via Admin SDK
- [ ] Resolution hostname -> tenant au chargement
- [ ] Branding sur ecran de login (logo + couleurs du tenant)
- [ ] Instructions DNS automatiques

### Phase 5 — Production ready (semaine 14-16)
- [ ] Impersonation
- [ ] Monitoring / metriques par tenant
- [ ] Onboarding wizard client (creation compte, choix modules, paiement)
- [ ] Documentation client (guide d'utilisation)
- [ ] Stress test multi-tenant
- [ ] Deuxieme client pilote

---

## Points durs identifies

### 1. Cloud Functions multi-tenant
Les triggers Firestore (`onCreate`, `onUpdate`) sont lies a une DB specifique. Avec N tenants = N named databases, il faut :
- **Option A** : 1 trigger par tenant par event (ne scale pas au-dela de ~10 tenants)
- **Option B** : 1 trigger generique qui itere sur les tenants (scheduler-based)
- **Option C** : Eventarc + Cloud Functions v2 avec wildcard database (si supporte)
- **Recommandation** : Option B pour les schedulers (1 CF qui boucle sur tous les tenants actifs), Option A pour les triggers critiques des premiers clients, migration vers C quand disponible.

### 2. Quota named databases
Firebase a une limite de named databases par projet (actuellement ~100). Au-dela, il faudrait :
- Passer a des projets Firebase multiples (perd l'avantage du pool unique)
- Ou repenser vers un modele pool (tenantId sur chaque doc)
- Pour les premiers 50-100 clients, le modele named DB tient.

### 3. Custom claims size
Firebase custom claims sont limites a **1000 bytes**. Avec `tenantId + role + modules[]`, ca peut devenir serre si beaucoup de modules. Solution : stocker les modules actifs dans un doc Firestore lu au boot, pas dans les claims.

### 4. Cold start Functions
Avec 1 projet partage, les CF sont deployees une seule fois mais doivent gerer N tenants. Le cold start est le meme que maintenant (~1-3s). Pas de degradation avec le nombre de tenants.

---

## Regles absolues Hephaistos

1. **Jamais de donnees metier dans la DB platform.** Platform = meta uniquement.
2. **Audit append-only.** Aucune suppression, aucune modification. Jamais.
3. **Kill-switch = double verrou.** UI + backend. Toujours les deux.
4. **Un seul `initializeApp()`** dans le cockpit, un seul dans Matias. Jamais deux.
5. **Super admin invisible pour les tenants.** Les users du tenant ne savent pas que la plateforme existe.
6. **Migration Yorgios = zero downtime.** Aucune interruption de service pour les users actuels.
7. **Chaque action super admin est loguee.** Pas d'exception.
8. **Stripe est la source de verite pour le billing.** La DB platform est un miroir, pas le master.
9. **Les modules sont du code existant active par config, pas du code genere.** Pas de no-code builder.
10. **Le repo Hephaistos ne depend JAMAIS de yorgios-app a build time.** Communication uniquement via Firebase (DB, Auth, claims).

---

## Design System

Reutilise **Aegean Precision** de Matias avec des extensions pour le cockpit :

| Token | Valeur | Usage cockpit |
|-------|--------|---------------|
| `--platform-bg` | `#f8fafc` | Fond cockpit (plus neutre que Matias) |
| `--platform-sidebar` | `#1e293b` | Sidebar sombre (distinction visuelle) |
| `--platform-accent` | `#6366f1` | Indigo — actions plateforme (different du bleu Matias) |
| `--tenant-active` | `#22c55e` | Badge tenant actif |
| `--tenant-suspended` | `#ef4444` | Badge tenant suspendu |
| `--tenant-trial` | `#f59e0b` | Badge tenant en trial |

Le cockpit a une identite visuelle **distincte** de Matias pour eviter toute confusion.

---

## Commandes utiles (futures)

```bash
# Dev cockpit
npm run dev

# Build + deploy cockpit
npm run build && firebase deploy --only hosting:hephaistos

# Deploy functions platform
cd functions && npm run build && cd .. && firebase deploy --only functions:provisionTenant,functions:resolveTenant,...

# Deploy rules DB platform
firebase deploy --only firestore:rules --database platform

# Seed module registry
node scripts/seed-modules.js

# Seed premier tenant (Yorgios)
node scripts/seed-yorgios-tenant.js
```
