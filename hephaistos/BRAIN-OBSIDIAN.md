# Hephaistos — Plateforme SaaS Matias

> Fichier Brain Obsidian — projet lie a [[Matias — Yorgios Restaurant App]]

---

## Identite

- **Nom** : Hephaistos (le dieu forgeron qui fabrique les outils des dieux)
- **Nature** : Plateforme SaaS de fabrication et d'administration d'applications Matias
- **Owner** : Arthur Kyriazis (kyriarthur@gmail.com)
- **Repo** : `hephaistos` (separe de `yorgios-app`)
- **Projet Firebase** : `cuisine-yorgios` (partage avec Matias)
- **DB** : `platform` (named database Firestore)

---

## Concept cle

Matias est une **PWA de gestion pour la restauration** (planning, HACCP, stock, RH, etc.).
Aujourd'hui elle est **single-tenant** : 1 deploiement = 1 client (Yorgios).

Hephaistos transforme Matias en **produit SaaS multi-tenant** :
- 1 seul build Matias deploye une fois
- Chaque client a sa propre config (modules, branding, domaine)
- Le super admin (moi) controle tout depuis un cockpit separe
- Facturation automatique via Stripe
- Kill-switch instantane si impaye

---

## Architecture

```
Hephaistos (cockpit)          Matias (app client)
      |                              |
      +------ Firebase (1 projet) ---+
                    |
        +-----------+-----------+
        |           |           |
    DB platform   DB yorgios   DB client-N
    (meta)        (1er tenant)  (Nth tenant)
```

### Decisions cles
- **Stack** : 100% Firebase (Firestore named DB, Auth, Functions, Hosting)
- **Isolation** : 1 named database par tenant (pas de tenantId sur chaque doc)
- **Deploy** : build unique Matias, config runtime par tenant
- **Domaines** : custom par client (app.yorgios.fr, etc.)
- **Roles plateforme** : owner, admin, commercial, support

---

## Les briques (modules)

Matias est decomposee en briques activables par client :

### Generiques
- `employees` — Gestion employes
- `planning` — Planning (grille, mobile, extras, events, audit, export)
- `pointages` — Pointages GPS
- `rh_docs` — Documents RH (charte, livret, signatures)
- `rh_conges` — Conges
- `annonces` — Annonces obligatoires
- `messaging` — Messagerie interne
- `notifications` — Push + email

### Metier restauration
- `catalogue` — Catalogue produits
- `reception` — Reception HACCP
- `fabrication` — Fabrication lots
- `livraisons` — Livraisons cuisine-corner
- `vitrine` — Vitrine produits
- `stock_frigo` — Stockage frigo
- `temperatures` — Releves temperatures
- `hygiene` — Checklists hygiene
- `ruptures` — Ruptures de stock
- `pertes` — Pertes
- `controle` — Controle qualite
- `commandes_ext` — Commandes clients externes
- `gmao` — GMAO
- `creta_gel` — CRETA GEL
- `crm` — CRM / Fidelite

---

## Plans tarifaires

| Plan | Prix | Modules |
|------|------|---------|
| Starter | 49-79 EUR/mois | Planning + Pointages + Messagerie + Annonces |
| Pro | 149-199 EUR/mois | + HACCP + Stock + RH |
| Premium | 249-349 EUR/mois | Tout |
| Custom | Sur devis | A la carte |

---

## Kill-switch

Double verrou :
1. **UI** : modal fullscreen non-dismissable "Acces suspendu"
2. **Backend** : security rules refusent toute operation si `tenantActive == false` dans les custom claims

Declencheurs :
- Manuel (super admin clique Suspendre)
- Automatique (Stripe webhook apres 7j de grace sur impaye)

---

## Feuille de route

| Phase | Contenu | Duree |
|-------|---------|-------|
| **Phase 0** | Fondations repo + auth + layout cockpit | 2 sem |
| **Phase 1** | Cockpit V1 : CRUD tenants, kill-switch, modules, audit | 3 sem |
| **Phase 2** | Resolution tenant dans Matias, routeur dynamique, migration Yorgios | 3 sem |
| **Phase 3** | Billing Stripe (webhooks, kill-switch auto, factures) | 3 sem |
| **Phase 4** | Domaines custom (Firebase Hosting multi-site, DNS) | 2 sem |
| **Phase 5** | Production ready (impersonation, monitoring, 2e client) | 3 sem |

---

## Points d'attention

- **Named DB limit** : ~100 par projet Firebase. OK pour les 100 premiers clients.
- **Custom claims** : 1000 bytes max. Stocker modules dans Firestore, pas dans claims.
- **CF triggers** : lies a une DB specifique. Schedulers = iterer sur tous tenants actifs.
- **Migration Yorgios** : garder DB `test` comme dbName (zero downtime, option A).
- **Super admin invisible** : les users du tenant ne savent pas que la plateforme existe.

---

## Liens

- [[Matias — Yorgios Restaurant App]] — le produit client
- Repo Matias : `yorgios-app`
- Repo Hephaistos : `hephaistos` (a creer)
- CLAUDE.md complet : `hephaistos/CLAUDE.md` dans le repo

---

## Tags

#projet #saas #hephaistos #matias #firebase #multi-tenant #restauration
