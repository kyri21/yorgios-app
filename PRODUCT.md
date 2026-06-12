# PRODUCT.md — Matias (PWA Yorgios)

> Référentiel produit pour les revues UX/design. Créé 2026-06-12 (Phase 3 de l'audit).

## En une phrase
Matias est la PWA opérationnelle interne du restaurant grec **Yorgios** : elle pilote le planning des employés, l'hygiène/HACCP (températures, réceptions, livraisons cuisine→corner), la vitrine, les ruptures, les commandes clients et les pointages géolocalisés.

## Utilisateurs réels (≈17 comptes)
- **Patron / Administrateur** (Alexandre, Arthur) : accès total, surtout planning + paramètres + supervision.
- **Manager** (Sébastien) : planning, validation congés, annonces, pointages, lecture CA.
- **Corner** (équipe de vente, ~6 pers + iPad partagé) : températures, hygiène, vitrine, ruptures, livraisons reçues, commandes. **Souvent sur iPad/mobile, en service, vite.**
- **Cuisine** (~6 pers + iPad) : réceptions, fabrication de lots, livraisons vers le corner, températures.
- Comptes spéciaux : `planning@` (lecture seule), `ipad@` / `ipad.cuisine@` (tablettes partagées).

## Contexte d'usage (déterminant pour l'UX)
- **Mobile-first réel** : la majorité des employés utilisent l'app sur téléphone/iPad, debout, en plein service, parfois en 4G faible. La rapidité perçue et la lisibilité priment sur la densité.
- **Tâches répétitives quotidiennes** : saisir une température, cocher l'hygiène, signaler une rupture, réceptionner une livraison. Chaque friction se paie ×plusieurs/jour.
- **Conformité HACCP** : la traçabilité (températures, DLC, actions correctives) a une valeur légale → fiabilité > esthétique, mais les deux comptent.

## Objectifs produit
1. **Fiabilité** : une action lancée doit aboutir ou afficher clairement pourquoi elle échoue (le contraire — l'échec silencieux — est le défaut récurrent identifié à l'audit).
2. **Vitesse perçue** : ouvrir un écran et agir en < 3 s sur mobile.
3. **Zéro ambiguïté de rôle** : chacun voit ses écrans, rien de plus.
4. **Traçabilité HACCP complète et exportable**.

## Design system (existant — à respecter)
**Aegean Precision (light only)** : surface `#fcf9f3`, primaire bleu grec `#004275`, danger `#c0392b`, succès `#2d7a4f`, warning `#b45309`. Fonts **Epilogue** (titres) + **Manrope** (corps). Tap targets ≥ 44px. Aucun fond sombre.

## Anti-objectifs
- Pas d'usage grand public (le seul écran public est `/commande` + `/rgpd`).
- Pas de densité « dashboard analytique » : c'est un outil terrain, pas un BI.

## Tensions UX connues (à arbitrer en Phase 3)
- Vitesse perçue vs poids du bundle (1 Mo) et états de chargement (skeletons qui durent → ressemblent à un bug).
- Cloisonnement de rôle côté affichage vs côté serveur (permissions cosmétiques).
- Cohérence RGPD interne (gate strict) vs publique (`/commande` sans consentement).
