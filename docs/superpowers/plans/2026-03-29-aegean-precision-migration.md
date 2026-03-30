# Aegean Precision — Migration UI/UX (toutes les pages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrer les 18 pages restantes de la PWA Matias du dark iOS vers le design system Aegean Precision (light mode éditorial), sans toucher à la logique métier ni Firebase.

**Architecture:** Chaque page est refaite indépendamment — même logique métier/Firebase, seul le HTML/CSS change. Le design system est déjà en place dans `src/index.css`. Les pages terminées (Dashboard Corner, Températures Corner, Hygiène) servent de modèle structurel.

**Tech Stack:** React 18, TypeScript, Vite, CSS variables Aegean (src/index.css), classes utilitaires `.page .card .btn-primary .chip-ok .nav-tabs .section-label`

---

## Règles globales (s'appliquent à TOUTES les tâches)

1. **LIRE le screen.png AVANT de coder** — utiliser l'outil `Read` sur le fichier image
2. **LIRE le fichier actuel** pour extraire toute la logique (state, hooks, Firebase, handlers)
3. **NE PAS modifier** la logique métier, Firebase, TypeScript types, routing, cloud function calls
4. **Utiliser les classes CSS** du design system : `.page`, `.card`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-icon`, `.input`, `.input-filled`, `.chip-ok`, `.chip-danger`, `.chip-warn`, `.section-title`, `.section-label`, `.nav-tabs`, `.nav-tab`, `.glass`, `.skeleton`, `.spinner`, `.temp-display`
5. **Pas de couleurs dark** : aucun `#000`, `#1c1c1e`, `#2c2c2e`, `rgba(0,0,0,*)` — utiliser `var(--surface)`, `var(--on-surface)`, `var(--primary)`, etc.
6. **Tap targets min 4rem** (64px) pour tous les boutons/liens
7. **No-Line rule** : pas de `border: 1px solid` — séparation par `background` shift uniquement
8. **Modèle de référence** : lire `src/modules/corner/pages/Dashboard.tsx` pour la structure JSX Aegean

---

## VAGUE 1 — BATCH A : Cuisine (4 pages)

### Tâche 1 : Dashboard Cuisine

**Fichiers :**
- Modifier : `src/modules/cuisine/pages/Dashboard.tsx`
- Référence : `reference/UI UX/stitch_r_ception_marchandises 1ere partie/cockpit_dashboard_aegean_edition/screen.png`

- [ ] **Lire le screenshot de référence**
  ```
  Read: reference/UI UX/stitch_r_ception_marchandises 1ere partie/cockpit_dashboard_aegean_edition/screen.png
  ```

- [ ] **Lire le fichier actuel** et noter toute la logique (state, Firebase queries, handlers)
  ```
  Read: src/modules/cuisine/pages/Dashboard.tsx
  ```

- [ ] **Lire le modèle Aegean terminé**
  ```
  Read: src/modules/corner/pages/Dashboard.tsx (lignes 185-250 pour la structure JSX)
  ```

- [ ] **Réécrire Dashboard.tsx** — structure Aegean :
  - Header : titre "Cuisine" en Epilogue h1, sous-titre date du jour en `var(--on-surface-2)`
  - Cards frigos : `.card` avec `.chip-ok`/`.chip-danger` selon température
  - Lots en cours : `.card` avec liste `.section-label` + rows `var(--surface-low)`
  - Dernière réception : `.card` compact
  - Livraisons en attente : `.card` avec `.chip-warn` si température hors seuil
  - Loading state : `<div className="page"><SkeletonList count={4} /></div>`
  - Conserver 100% de la logique Firebase et des calculs existants

- [ ] **Vérifier** : aucun `#000`, `#1c1c1e`, `#E8760A`, `background: 'black'` dans le fichier
  ```bash
  grep -n "#000\|#1c1c1e\|#2c2c2e\|E8760A\|background.*black" src/modules/cuisine/pages/Dashboard.tsx
  ```
  Attendu : aucun résultat

- [ ] **Commit**
  ```bash
  git add src/modules/cuisine/pages/Dashboard.tsx
  git commit -m "feat: migrate Dashboard Cuisine to Aegean Precision design"
  ```

---

### Tâche 2 : Températures Cuisine

**Fichiers :**
- Modifier : `src/modules/cuisine/pages/Temperatures.tsx`
- Référence : `reference/UI UX/stitch_r_ception_marchandises 1ere partie/saisie_temp_ratures_aegean_precision/screen.png`

- [ ] **Lire le screenshot de référence**
  ```
  Read: reference/UI UX/stitch_r_ception_marchandises 1ere partie/saisie_temp_ratures_aegean_precision/screen.png
  ```

- [ ] **Lire le fichier actuel**
  ```
  Read: src/modules/cuisine/pages/Temperatures.tsx
  ```

- [ ] **Lire le modèle Aegean terminé** (même design que corner températures)
  ```
  Read: src/modules/corner/pages/Temperatures.tsx
  ```

- [ ] **Réécrire Temperatures.tsx** — s'inspirer de `Temperatures.tsx` corner comme base structurelle :
  - Tabs matin/soir : `.nav-tabs` + `.nav-tab`
  - Onglet semaine : grille heatmap avec `var(--haccp-ok-bg)` / `var(--haccp-danger-bg)`
  - Inputs température : `.input` underlined, valeur numérique centré
  - Chips statut : `.chip-ok` (OK) / `.chip-danger` (ALERTE)
  - Bouton save : `.btn-primary` large
  - Header date picker : compact, `var(--on-surface-2)`
  - Conserver les 5 frigos cuisine (`FRIGO_1_ENTREE`, `GRAND_FRIGO_INOX`, `GRAND_FRIGO_VERRE`, `FRIGO_2_MILIEU`, `FRIGO_FOUR`)

- [ ] **Vérifier** absence couleurs dark
  ```bash
  grep -n "#000\|#1c1c1e\|#2c2c2e\|E8760A" src/modules/cuisine/pages/Temperatures.tsx
  ```

- [ ] **Commit**
  ```bash
  git add src/modules/cuisine/pages/Temperatures.tsx
  git commit -m "feat: migrate Températures Cuisine to Aegean Precision design"
  ```

---

### Tâche 3 : Réception Cuisine

**Fichiers :**
- Modifier : `src/modules/cuisine/pages/Reception.tsx`
- Référence : `reference/UI UX/stitch_r_ception_marchandises 1ere partie/r_ception_marchandises_aegean_precision/screen.png`

- [ ] **Lire le screenshot de référence**
  ```
  Read: reference/UI UX/stitch_r_ception_marchandises 1ere partie/r_ception_marchandises_aegean_precision/screen.png
  ```

- [ ] **Lire le fichier actuel**
  ```
  Read: src/modules/cuisine/pages/Reception.tsx
  ```

- [ ] **Réécrire Reception.tsx** — structure Aegean :
  - Header : "Réception marchandises" h1 Epilogue + date
  - Sélection fournisseur : `.card` avec liste de boutons `var(--surface-low)` → `var(--primary)` sélectionné
  - Champ fournisseur libre "Autre" : `.input`
  - Sélection produit : `.card`, liste scrollable avec badges allergènes `.chip-warn`
  - Champs temp/quantité : `.input` underlined
  - Résultat HACCP : `.chip-ok` / `.chip-danger` — chip large, 2rem hauteur min
  - Bouton valider réception : `.btn-primary` full-width
  - Conserver logique allergènes, fournisseurs Firestore, validation températures GEP

- [ ] **Vérifier** absence couleurs dark
  ```bash
  grep -n "#000\|#1c1c1e\|#2c2c2e\|E8760A" src/modules/cuisine/pages/Reception.tsx
  ```

- [ ] **Commit**
  ```bash
  git add src/modules/cuisine/pages/Reception.tsx
  git commit -m "feat: migrate Réception Cuisine to Aegean Precision design"
  ```

---

### Tâche 4 : Fabrication Cuisine

**Fichiers :**
- Modifier : `src/modules/cuisine/pages/Fabrication.tsx`
- Référence lots en cours : `reference/UI UX/stitch_r_ception_marchandises 1ere partie/lots_en_cours_aegean_precision/screen.png`
- Référence nouveau lot : `reference/UI UX/stitch_r_ception_marchandises 1ere partie/nouveau_lot_aegean_precision/screen.png`

- [ ] **Lire les screenshots de référence** (les deux)
  ```
  Read: reference/UI UX/stitch_r_ception_marchandises 1ere partie/lots_en_cours_aegean_precision/screen.png
  Read: reference/UI UX/stitch_r_ception_marchandises 1ere partie/nouveau_lot_aegean_precision/screen.png
  ```

- [ ] **Lire le fichier actuel**
  ```
  Read: src/modules/cuisine/pages/Fabrication.tsx
  ```

- [ ] **Réécrire Fabrication.tsx** — structure Aegean :
  - Header : "Fabrication" h1 + bouton "+ Nouveau lot" `.btn-primary`
  - Liste lots : cards `.card` avec lotCode bold, produit, fab/DLC, quantité
  - Actions lot : boutons `.btn-icon` (✏️ modifier, ✓ livrer, 🗑 supprimer, ⬛ QR)
  - Formulaire nouveau lot : `.card` avec `.input` pour chaque champ
  - Modal QR code : `.glass` overlay + iframe API QRServer
  - Onglet archives : même structure, chips `.chip-ok` "Archivé"
  - Conserver logique lot_counters, lots_cuisine, archivage

- [ ] **Vérifier** absence couleurs dark
  ```bash
  grep -n "#000\|#1c1c1e\|#2c2c2e\|E8760A" src/modules/cuisine/pages/Fabrication.tsx
  ```

- [ ] **Commit**
  ```bash
  git add src/modules/cuisine/pages/Fabrication.tsx
  git commit -m "feat: migrate Fabrication Cuisine to Aegean Precision design"
  ```

---

## VAGUE 1 — BATCH B : Corner transactionnel (4 pages)

### Tâche 5 : Livraison Corner

**Fichiers :**
- Modifier : `src/modules/corner/pages/Livraison.tsx`
- Référence : `reference/UI UX/stitch_r_ception_marchandises 1ere partie/r_ception_livraisons_aegean_precision/screen.png`

- [ ] **Lire le screenshot de référence**
  ```
  Read: reference/UI UX/stitch_r_ception_marchandises 1ere partie/r_ception_livraisons_aegean_precision/screen.png
  ```

- [ ] **Lire le fichier actuel**
  ```
  Read: src/modules/corner/pages/Livraison.tsx
  ```

- [ ] **Réécrire Livraison.tsx** — structure Aegean :
  - Tabs : `.nav-tabs` "En attente" / "Historique" / "Galerie"
  - Livraisons en attente : `.card` par livraison, temp départ `.chip-ok/.chip-danger`, bouton réception `.btn-primary`
  - Formulaire réception : `.input` pour tempC + photo upload bouton `.btn-secondary`
  - Non-conformité : `.card` fond `var(--haccp-danger-bg)`, champ décision `.input`
  - Historique : date picker `.input`, tableau `.card` avec colonnes
  - Galerie : grille photos 2col, miniatures cliquables, modal plein écran `.glass`
  - Conserver logique livraisons, non_conformites, photos Storage

- [ ] **Vérifier** absence couleurs dark
  ```bash
  grep -n "#000\|#1c1c1e\|#2c2c2e\|E8760A" src/modules/corner/pages/Livraison.tsx
  ```

- [ ] **Commit**
  ```bash
  git add src/modules/corner/pages/Livraison.tsx
  git commit -m "feat: migrate Livraison Corner to Aegean Precision design"
  ```

---

### Tâche 6 : Vitrine Corner

**Fichiers :**
- Modifier : `src/modules/corner/pages/Vitrine.tsx`
- Référence : `reference/UI UX/stitch_r_ception_marchandises 1ere partie/photos_vitrine_aegean_precision/screen.png`

- [ ] **Lire le screenshot de référence**
  ```
  Read: reference/UI UX/stitch_r_ception_marchandises 1ere partie/photos_vitrine_aegean_precision/screen.png
  ```

- [ ] **Lire le fichier actuel**
  ```
  Read: src/modules/corner/pages/Vitrine.tsx
  ```

- [ ] **Réécrire Vitrine.tsx** — structure Aegean :
  - Tabs : `.nav-tabs` "Stock actif" / "Ajouter" / "Historique"
  - Stock actif : cards DLC groupées par statut (DÉPASSÉE fond `haccp-danger-bg`, AUJOURD'HUI `haccp-warn-bg`, OK fond `surface-low`)
  - Formulaire ajout : 2 modes "Saisie manuelle" / "Depuis lot cuisine" avec `.nav-tabs`
  - Sélection produit : liste `.card` scrollable avec toggle actif
  - Champs date fab + DLC calculée : `.input` date native
  - Historique : `.card` avec filtre date + recherche `.input`
  - Conserver logique corner_stock, lots_cuisine archivés

- [ ] **Vérifier** absence couleurs dark
  ```bash
  grep -n "#000\|#1c1c1e\|#2c2c2e\|E8760A" src/modules/corner/pages/Vitrine.tsx
  ```

- [ ] **Commit**
  ```bash
  git add src/modules/corner/pages/Vitrine.tsx
  git commit -m "feat: migrate Vitrine Corner to Aegean Precision design"
  ```

---

### Tâche 7 : Commandes Corner

**Fichiers :**
- Modifier : `src/modules/corner/pages/Commandes.tsx`
- Référence détail : `reference/UI UX/stitch_r_ception_marchandises 1ere partie/d_tail_commande_aegean_precision/screen.png`
- Référence nouvelle : `reference/UI UX/stitch_r_ception_marchandises 1ere partie/nouvelle_commande_aegean_precision/screen.png`

- [ ] **Lire les screenshots de référence**
  ```
  Read: reference/UI UX/stitch_r_ception_marchandises 1ere partie/d_tail_commande_aegean_precision/screen.png
  Read: reference/UI UX/stitch_r_ception_marchandises 1ere partie/nouvelle_commande_aegean_precision/screen.png
  ```

- [ ] **Lire le fichier actuel**
  ```
  Read: src/modules/corner/pages/Commandes.tsx
  ```

- [ ] **Réécrire Commandes.tsx** — structure Aegean :
  - KPIs : row 3 cards `.card` compactes (total, aujourd'hui, semaine)
  - Liste commandes : `.card` par commande, statut `.chip-ok/.chip-warn/.chip-danger`
  - Détail commande : modal `.glass` ou expand inline avec tous les champs
  - Formulaire nouvelle commande : `.card` avec `.input` pour chaque champ (nom, tel, date livraison, typeEvenement, nombreConvives, produits)
  - Code fidélité : `.input` avec badge réduction si valide
  - Boutons Accepter/Refuser : `.btn-primary` / `.btn-danger`
  - Conserver logique commandes_externes, validatePromoCode CF, code fidélité

- [ ] **Vérifier** absence couleurs dark
  ```bash
  grep -n "#000\|#1c1c1e\|#2c2c2e\|E8760A" src/modules/corner/pages/Commandes.tsx
  ```

- [ ] **Commit**
  ```bash
  git add src/modules/corner/pages/Commandes.tsx
  git commit -m "feat: migrate Commandes Corner to Aegean Precision design"
  ```

---

### Tâche 8 : Ruptures Corner

**Fichiers :**
- Modifier : `src/modules/corner/pages/Ruptures.tsx`
- Référence 1 : `reference/UI UX/stitch_r_ception_marchandises 1ere partie/ruptures_commandes_aegean_precision_1/screen.png`
- Référence check stock : `reference/UI UX/stitch_r_ception_marchandises 1ere partie/check_stock_aegean_precision/screen.png`

- [ ] **Lire les screenshots de référence**
  ```
  Read: reference/UI UX/stitch_r_ception_marchandises 1ere partie/ruptures_commandes_aegean_precision_1/screen.png
  Read: reference/UI UX/stitch_r_ception_marchandises 1ere partie/check_stock_aegean_precision/screen.png
  ```

- [ ] **Lire le fichier actuel**
  ```
  Read: src/modules/corner/pages/Ruptures.tsx
  ```

- [ ] **Réécrire Ruptures.tsx** — structure Aegean :
  - Section "Est-ce que j'ai du stock ?" : cards OUI/NON style iOS toggle, fond `var(--primary)` si NON
  - Liste ruptures actives : `.card` par produit, `.chip-danger` "RUPTURE"
  - Formulaire déclaration : `.card` + `.input` pour stock et photo (optionnels)
  - Bouton déclarer : `.btn-danger`
  - Produits depuis AdminSettings (settings/ruptures.produits[])
  - Conserver logique corner_commandes, photos optionnelles

- [ ] **Vérifier** absence couleurs dark
  ```bash
  grep -n "#000\|#1c1c1e\|#2c2c2e\|E8760A" src/modules/corner/pages/Ruptures.tsx
  ```

- [ ] **Commit**
  ```bash
  git add src/modules/corner/pages/Ruptures.tsx
  git commit -m "feat: migrate Ruptures Corner to Aegean Precision design"
  ```

---

## VAGUE 2 — BATCH C : Corner autres + Messagerie (4 pages)

### Tâche 9 : Pertes Corner

**Fichiers :**
- Modifier : `src/modules/corner/pages/Pertes.tsx`
- Référence saisie : `reference/UI UX/stitch_r_ception_marchandises 1ere partie/saisie_des_pertes_aegean_precision/screen.png`
- Référence rapport : `reference/UI UX/stitch_r_ception_marchandises 1ere partie/rapport_de_pertes_aegean_precision/screen.png`

- [ ] **Lire les screenshots de référence**
  ```
  Read: reference/UI UX/stitch_r_ception_marchandises 1ere partie/saisie_des_pertes_aegean_precision/screen.png
  Read: reference/UI UX/stitch_r_ception_marchandises 1ere partie/rapport_de_pertes_aegean_precision/screen.png
  ```

- [ ] **Lire le fichier actuel**
  ```
  Read: src/modules/corner/pages/Pertes.tsx
  ```

- [ ] **Réécrire Pertes.tsx** — structure Aegean :
  - Tabs `.nav-tabs` : "Saisie" / "Rapport jour" / "Rapport semaine" / "Rapport mois"
  - Formulaire saisie : `.card` + `.input` pour produit, type (qté/poids/prix), valeur, note
  - Liste pertes du jour : rows `var(--surface-low)` alternés
  - Rapport : `.card` avec total agrégé, liste détaillée
  - Conserver logique pertes_corner, types (quantite/prix)

- [ ] **Vérifier** absence couleurs dark
  ```bash
  grep -n "#000\|#1c1c1e\|#2c2c2e\|E8760A" src/modules/corner/pages/Pertes.tsx
  ```

- [ ] **Commit**
  ```bash
  git add src/modules/corner/pages/Pertes.tsx
  git commit -m "feat: migrate Pertes Corner to Aegean Precision design"
  ```

---

### Tâche 10 : Contrôle Corner

**Fichiers :**
- Modifier : `src/modules/corner/pages/Controle.tsx`
- Référence : `reference/UI UX/stitch_r_ception_marchandises 1ere partie/contr_le_archives_aegean_precision/screen.png`

- [ ] **Lire le screenshot de référence**
  ```
  Read: reference/UI UX/stitch_r_ception_marchandises 1ere partie/contr_le_archives_aegean_precision/screen.png
  ```

- [ ] **Lire le fichier actuel**
  ```
  Read: src/modules/corner/pages/Controle.tsx
  ```

- [ ] **Réécrire Controle.tsx** — structure Aegean (rapport contrôleur hygiène) :
  - Header : "Contrôle hygiène" h1 + 2 date pickers `.input` (début/fin période)
  - Bouton "Générer le rapport" : `.btn-primary`
  - Rapport généré : sections `.card` séparées :
    1. **Températures frigos** — tableau par frigo/date, `.chip-ok/.chip-danger`
    2. **Températures livraisons** — dept/réception, résultat HACCP
    3. **Entrées/sorties vitrine** — fab, DLC, retrait
    4. **Hygiène** — items cochés/non cochés par type (quotidien/hebdo/mensuel)
  - Bouton export/impression : `.btn-secondary`
  - Conserver les queries Firestore existantes (temperatures, livraisons, corner_stock, hygiene_corner)

- [ ] **Vérifier** absence couleurs dark
  ```bash
  grep -n "#000\|#1c1c1e\|#2c2c2e\|E8760A" src/modules/corner/pages/Controle.tsx
  ```

- [ ] **Commit**
  ```bash
  git add src/modules/corner/pages/Controle.tsx
  git commit -m "feat: migrate Contrôle Corner to Aegean Precision design"
  ```

---

### Tâche 11 : Stockage Frigo Corner

**Fichiers :**
- Modifier : `src/modules/corner/pages/StockageFrigo.tsx`
- Référence : `reference/UI UX/stitch_r_ception_marchandises 1ere partie/stockage_frigo_aegean_precision/screen.png`

- [ ] **Lire le screenshot de référence**
  ```
  Read: reference/UI UX/stitch_r_ception_marchandises 1ere partie/stockage_frigo_aegean_precision/screen.png
  ```

- [ ] **Lire le fichier actuel**
  ```
  Read: src/modules/corner/pages/StockageFrigo.tsx
  ```

- [ ] **Réécrire StockageFrigo.tsx** — structure Aegean :
  - Sélecteur frigo : pills horizontales `.nav-tab` actif = fond `var(--primary)` texte blanc
  - Liste produits par frigo : `.card` avec productName, quantité, DLC chip `.chip-ok/.chip-danger`
  - Bouton "+ Ajouter" : `.btn-primary`
  - Bouton "📦 Depuis cuisine" : `.btn-secondary`
  - Formulaire ajout : `.card` avec `.input` pour chaque champ
  - Conserver logique stockage_frigo, import depuis lots cuisine

- [ ] **Vérifier** absence couleurs dark
  ```bash
  grep -n "#000\|#1c1c1e\|#2c2c2e\|E8760A" src/modules/corner/pages/StockageFrigo.tsx
  ```

- [ ] **Commit**
  ```bash
  git add src/modules/corner/pages/StockageFrigo.tsx
  git commit -m "feat: migrate StockageFrigo Corner to Aegean Precision design"
  ```

---

### Tâche 12 : Messagerie

**Fichiers :**
- Modifier : `src/modules/messagerie/index.tsx`
- Référence : `reference/UI UX/stitch_r_ception_marchandises 1ere partie/messagerie_aegean_precision/screen.png`

- [ ] **Lire le screenshot de référence**
  ```
  Read: reference/UI UX/stitch_r_ception_marchandises 1ere partie/messagerie_aegean_precision/screen.png
  ```

- [ ] **Lire le fichier actuel**
  ```
  Read: src/modules/messagerie/index.tsx
  ```

- [ ] **Réécrire messagerie/index.tsx** — structure Aegean :
  - Fond chat : `var(--surface-low)` (pas de noir)
  - Bulles messages envoyés : fond `var(--primary)` texte blanc, radius xl arrondi droite
  - Bulles messages reçus : fond `var(--surface-mid)` texte `var(--on-surface)`, radius xl arrondi gauche
  - Barre input : `.glass` en bas, `.input` pour le texte, bouton envoi `.btn-primary` rond
  - Header : nom destinataire / "Tous" h2 Epilogue
  - Timestamps : `var(--on-surface-3)` 11px
  - Conserver logique messages Firestore, TTL, FCM

- [ ] **Vérifier** absence couleurs dark
  ```bash
  grep -n "#000\|#1c1c1e\|#2c2c2e\|E8760A" src/modules/messagerie/index.tsx
  ```

- [ ] **Commit**
  ```bash
  git add src/modules/messagerie/index.tsx
  git commit -m "feat: migrate Messagerie to Aegean Precision design"
  ```

---

## VAGUE 2 — BATCH D : Planning + Global (6 pages)

### Tâche 13 : Profil Utilisateur

**Fichiers :**
- Modifier : `src/pages/Profile.tsx`
- Référence : `reference/UI UX/stitch_r_ception_marchandises 1ere partie/profil_utilisateur_aegean_precision/screen.png`

- [ ] **Lire le screenshot de référence**
  ```
  Read: reference/UI UX/stitch_r_ception_marchandises 1ere partie/profil_utilisateur_aegean_precision/screen.png
  ```

- [ ] **Lire le fichier actuel**
  ```
  Read: src/pages/Profile.tsx
  ```

- [ ] **Réécrire Profile.tsx** — structure Aegean :
  - Avatar : cercle `var(--primary)` initiales blanches, 72px
  - Nom + email : h2 Epilogue + `var(--on-surface-2)`
  - Badge rôle : `.chip-ok` ou chip custom
  - Section "Planning lié" : `.card` avec shifts de la semaine
  - Bouton export ICS : `.btn-secondary`
  - Bouton déconnexion : `.btn-danger`
  - Conserver logique planningWeeks, export ICS, logout Firebase Auth

- [ ] **Vérifier** absence couleurs dark
  ```bash
  grep -n "#000\|#1c1c1e\|#2c2c2e\|E8760A" src/pages/Profile.tsx
  ```

- [ ] **Commit**
  ```bash
  git add src/pages/Profile.tsx
  git commit -m "feat: migrate Profile to Aegean Precision design"
  ```

---

### Tâche 14 : Planning Mobile

**Fichiers :**
- Modifier : `src/modules/planning/components/Mobile/MobilePlanningView.tsx`
- Référence : `reference/UI UX/stitch_r_ception_marchandises 1ere partie/planning_hebdomadaire/screen.png`

- [ ] **Lire le screenshot de référence**
  ```
  Read: reference/UI UX/stitch_r_ception_marchandises 1ere partie/planning_hebdomadaire/screen.png
  ```

- [ ] **Lire le fichier actuel**
  ```
  Read: src/modules/planning/components/Mobile/MobilePlanningView.tsx
  ```

- [ ] **Réécrire MobilePlanningView.tsx** — structure Aegean :
  - Pills jours 7 : `.nav-tab` horizontal scroll, point `var(--primary)` si planifiés
  - Navigation semaine : flèches `.btn-icon` + label semaine `var(--on-surface-2)`
  - Cards employé : `.card` avec initiales cercle `var(--primary)`, horaires bold, durée `var(--on-surface-2)`
  - Absences : `.chip-warn` avec emoji
  - Stats jour : row 2 cards compactes (nb employés, total heures) fond `var(--surface-low)`
  - Conserver logique planningWeeks, lecture seule mobile

- [ ] **Vérifier** absence couleurs dark
  ```bash
  grep -n "#000\|#1c1c1e\|#2c2c2e\|E8760A" src/modules/planning/components/Mobile/MobilePlanningView.tsx
  ```

- [ ] **Commit**
  ```bash
  git add src/modules/planning/components/Mobile/MobilePlanningView.tsx
  git commit -m "feat: migrate Planning Mobile to Aegean Precision design"
  ```

---

### Tâche 15 : Planning Desktop

**Fichiers :**
- Modifier : `src/modules/planning/index.tsx`
- Référence : `reference/UI UX/stitch_r_ception_marchandises 1ere partie/planning_hebdomadaire_version_desktop/screen.png`

- [ ] **Lire le screenshot de référence**
  ```
  Read: reference/UI UX/stitch_r_ception_marchandises 1ere partie/planning_hebdomadaire_version_desktop/screen.png
  ```

- [ ] **Lire le fichier actuel**
  ```
  Read: src/modules/planning/index.tsx
  ```

- [ ] **Réécrire planning/index.tsx** — structure Aegean (desktop ≥768px) :
  - Header toolbar : fond `var(--surface)`, semaine label Epilogue h2, boutons `.btn-secondary`
  - Bouton "📊 Export Excel" + "🗑 Vider" : `.btn-icon`
  - Grille planning : fond `var(--surface-low)` pour les cellules, `var(--surface)` header employés
  - Employé card : fond `var(--primary)` initiales, `var(--on-surface)` nom
  - Shifts drag-paint : fond `var(--primary)` à 15% opacité, bordure gauche `var(--primary)` 3px
  - Modal vue mensuelle : `.glass` overlay
  - Conserver logique drag-paint, planningWeeks, export Excel, WeekId timezone fix

- [ ] **Vérifier** absence couleurs dark
  ```bash
  grep -n "#000\|#1c1c1e\|#2c2c2e\|E8760A" src/modules/planning/index.tsx
  ```

- [ ] **Commit**
  ```bash
  git add src/modules/planning/index.tsx
  git commit -m "feat: migrate Planning Desktop to Aegean Precision design"
  ```

---

### Tâche 16 : CA (Chiffre d'affaires)

**Fichiers :**
- Modifier : `src/pages/CA.tsx`
- Pas de référence screenshot — utiliser la palette Aegean

- [ ] **Lire le fichier actuel**
  ```
  Read: src/pages/CA.tsx
  ```

- [ ] **Réécrire CA.tsx** — structure Aegean :
  - Header : "Chiffre d'affaires" h1 Epilogue + sélecteur mois `.input`
  - KPIs : row de cards `.card` compactes (CA réel, objectif, %, prime)
  - Barre de progression : fond `var(--surface-mid)`, fill `var(--primary)` si OK / `var(--danger)` si en dessous
  - Formulaire saisie objectif (patron/admin/manager) : `.input` + `.btn-primary`
  - Lecture seule si role=corner : mêmes cards sans formulaire
  - Conserver logique objectifs_ca

- [ ] **Vérifier** absence couleurs dark
  ```bash
  grep -n "#000\|#1c1c1e\|#2c2c2e\|E8760A" src/pages/CA.tsx
  ```

- [ ] **Commit**
  ```bash
  git add src/pages/CA.tsx
  git commit -m "feat: migrate CA to Aegean Precision design"
  ```

---

### Tâche 17 : Pointage

**Fichiers :**
- Modifier : `src/pages/Pointage.tsx`
- Pas de référence screenshot — utiliser la palette Aegean

- [ ] **Lire le fichier actuel**
  ```
  Read: src/pages/Pointage.tsx
  ```

- [ ] **Réécrire Pointage.tsx** — structure Aegean :
  - Tabs `.nav-tabs` : "Aujourd'hui" / "Historique"
  - Onglet aujourd'hui : `.card` état du jour (arrivée, départ), bouton pointage entrée `.btn-primary` (min 4rem)
  - GPS feedback : `.chip-ok` "Zone validée" / `.chip-danger` "Hors zone"
  - Onglet historique : nav semaine ← →, liste jours `.card`, rows arrivée/départ `var(--surface-low)`
  - Conserver appel CF createPointage, validation GPS serveur

- [ ] **Vérifier** absence couleurs dark
  ```bash
  grep -n "#000\|#1c1c1e\|#2c2c2e\|E8760A" src/pages/Pointage.tsx
  ```

- [ ] **Commit**
  ```bash
  git add src/pages/Pointage.tsx
  git commit -m "feat: migrate Pointage to Aegean Precision design"
  ```

---

### Tâche 18 : ModuleGridPanel (bottom sheet ⣿)

**Fichiers :**
- Modifier : `src/components/ModuleGridPanel.tsx`
- Pas de référence screenshot — adapter le bottom sheet à la palette Aegean

- [ ] **Lire le fichier actuel**
  ```
  Read: src/components/ModuleGridPanel.tsx
  ```

- [ ] **Réécrire ModuleGridPanel.tsx** — structure Aegean :
  - Bottom sheet : `.glass` backdrop-blur 20px, fond `var(--surface)` à 95% opacité
  - Handle bar : `var(--surface-mid)` 4px, centré
  - Titre module (Corner / Cuisine) : h3 Epilogue `var(--on-surface)`
  - Grille 3×3 : icônes colorées iOS, label `var(--on-surface-2)` 11px Manrope
  - Page active : bordure `var(--primary)` 2px, fond `rgba(0,66,117,0.08)`
  - Overlay fond : `rgba(28,28,24,0.4)` au lieu de noir pur
  - Conserver logique navigation, pages Corner/Cuisine

- [ ] **Vérifier** absence couleurs dark
  ```bash
  grep -n "#000\|#1c1c1e\|#2c2c2e\|E8760A" src/components/ModuleGridPanel.tsx
  ```

- [ ] **Commit**
  ```bash
  git add src/components/ModuleGridPanel.tsx
  git commit -m "feat: migrate ModuleGridPanel to Aegean Precision design"
  ```

---

## Vérification finale (après toutes les tâches)

- [ ] **Scan global dark colors**
  ```bash
  grep -rn "#000\b\|#1c1c1e\|#2c2c2e\|rgba(0,0,0\|background.*black" src/modules src/pages src/components --include="*.tsx" | grep -v "//\|node_modules"
  ```
  Attendu : seuls des fichiers légitimes (Layout.tsx overlay, etc.)

- [ ] **Build de vérification**
  ```bash
  npm run build 2>&1 | tail -20
  ```
  Attendu : `✓ built in` sans erreurs TypeScript

- [ ] **Commit final**
  ```bash
  git add -A
  git commit -m "feat: complete Aegean Precision UI migration — all 18 pages"
  ```
