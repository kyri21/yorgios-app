# Spec — Refonte UI/UX Aegean Precision (toutes les pages)

**Date** : 2026-03-29
**Statut** : Approuvé ✅

---

## Contexte

La PWA Matias (cuisine-yorgios) migre du dark iOS vers le design system **Aegean Precision** (light mode éditorial Mediterranean luxury). Le shell (Layout, Login, index.css) et 3 pages (Dashboard Corner, Températures Corner, Hygiène) sont déjà terminés. 18 pages restent à migrer.

## Design System (déjà en place)

- **Fichier** : `src/index.css` — variables CSS complètes, classes utilitaires disponibles
- **Fonts** : Epilogue (titres) + Manrope (body) — chargées via Google Fonts dans `index.html`
- **Palette** : surface `#fcf9f3`, primary `#004275`, on-surface `#1c1c18`
- **Modèles** : `Dashboard.tsx` (corner), `Temperatures.tsx` (corner), `Hygiene.tsx` — à copier comme référence structurelle
- **Screenshots** : `reference/UI UX/stitch_r_ception_marchandises 1ere partie/*/screen.png`

## Règles de migration

1. **Lire le screen.png** correspondant AVANT de coder
2. **Garder toute la logique métier et Firebase** — seul le HTML/CSS change
3. **Utiliser les classes CSS** : `.page`, `.card`, `.btn-primary/.secondary/.danger`, `.input/.input-filled`, `.chip-ok/.chip-danger/.chip-warn`, `.section-title`, `.section-label`, `.nav-tabs/.nav-tab`, `.glass`, `.skeleton`, `.spinner`
4. **Pas de inline styles dark** : pas de `#000`, `#1c1c1e`, `#2c2c2e`, `rgba(0,0,0,*)` — utiliser `var(--surface)`, `var(--on-surface)`, etc.
5. **Tap targets min 4rem** (cuisine = mains gantées)
6. **No-Line rule** : zéro bordure 1px — séparation par shifts de background uniquement

## Approche d'exécution

4 batches de pages indépendantes, lancés en 2 vagues parallèles.

### Vague 1 (simultané)

**Batch 1 — Cuisine**
| Page | Fichier | Référence |
|------|---------|-----------|
| Dashboard Cuisine | `src/modules/cuisine/pages/Dashboard.tsx` | `cockpit_dashboard_aegean_edition/screen.png` |
| Températures Cuisine | `src/modules/cuisine/pages/Temperatures.tsx` | `saisie_temp_ratures_aegean_precision/screen.png` |
| Réception | `src/modules/cuisine/pages/Reception.tsx` | `r_ception_marchandises_aegean_precision/screen.png` |
| Fabrication | `src/modules/cuisine/pages/Fabrication.tsx` | `lots_en_cours_aegean_precision/screen.png` |

**Batch 2 — Corner (pages transactionnelles)**
| Page | Fichier | Référence |
|------|---------|-----------|
| Livraison Corner | `src/modules/corner/pages/Livraison.tsx` | `r_ception_livraisons_aegean_precision/screen.png` |
| Vitrine | `src/modules/corner/pages/Vitrine.tsx` | `photos_vitrine_aegean_precision/screen.png` |
| Commandes | `src/modules/corner/pages/Commandes.tsx` | `d_tail_commande_aegean_precision/screen.png` |
| Ruptures | `src/modules/corner/pages/Ruptures.tsx` | `ruptures_commandes_aegean_precision_1/screen.png` |

### Vague 2 (simultané, après vague 1)

**Batch 3 — Corner (autres) + Messagerie**
| Page | Fichier | Référence |
|------|---------|-----------|
| Pertes | `src/modules/corner/pages/Pertes.tsx` | `saisie_des_pertes_aegean_precision/screen.png` |
| Contrôle | `src/modules/corner/pages/Controle.tsx` | `contr_le_archives_aegean_precision/screen.png` |
| StockageFrigo | `src/modules/corner/pages/StockageFrigo.tsx` | `stockage_frigo_aegean_precision/screen.png` |
| Messagerie | `src/modules/messagerie/index.tsx` | `messagerie_aegean_precision/screen.png` |

**Batch 4 — Planning + Global**
| Page | Fichier | Référence |
|------|---------|-----------|
| Profil | `src/pages/Profile.tsx` | `profil_utilisateur_aegean_precision/screen.png` |
| Planning mobile | `src/modules/planning/components/Mobile/MobilePlanningView.tsx` | `planning_hebdomadaire/screen.png` |
| Planning desktop | `src/modules/planning/index.tsx` | `planning_hebdomadaire_version_desktop/screen.png` |
| CA | `src/pages/CA.tsx` | palette Aegean (pas de référence) |
| Pointage | `src/pages/Pointage.tsx` | palette Aegean (pas de référence) |
| ModuleGridPanel | `src/components/ModuleGridPanel.tsx` | palette Aegean (adapter bottom sheet) |

## Invariants (NE PAS MODIFIER)

- Toute la logique Firebase (listeners, queries, mutations)
- La structure des collections Firestore
- Les types TypeScript
- La logique de routage
- Les cloud function calls
- Les règles de rôle/accès

## Critères de succès

- Aucune couleur dark iOS (`#000`, `#1c1c1e`, `#2c2c2e`) dans les fichiers migrés
- Tous les éléments interactifs ≥ 44px de hauteur
- Structure éditoriale Aegean : header Epilogue, `.page`, `.card`, tabs `.nav-tabs`, `.section-label`
- La logique métier est 100% identique à avant
