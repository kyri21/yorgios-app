# Audit Matias — Phase 3b : passe visuelle fine — 2026-06-12

> Captures en viewport mobile 390px (usage réel), compte Arthur. Écrans à plus fort trafic corner.

## Constat transversal positif ✅
Le **design system Aegean Precision (light) est appliqué uniformément** sur les écrans internes (surface crème, primaire `#004275`, chips conforme/danger, fonts Epilogue/Manrope, gros chiffres colorés). La note de mémoire « pages internes encore dark iOS » est **périmée** — la refonte est faite. Hiérarchie claire, tap targets corrects.

## Températures (`/corner/temperatures`) — bon, retouches mineures
- Lisible : gros relevés colorés (vert = conforme), chips CONFORME, split Matin/Soir, date picker, gros bouton « Enregistrer tous les relevés ».
- 🟡 V1 — **la bottom-nav recouvre une carte en milieu de scroll** (Vitrine 2 passe sous la barre) → confirme U13. Ajouter un `padding-bottom` = hauteur bottom-nav au conteneur scrollable.
- 🟡 V2 — 5 frigos × matin/soir = beaucoup de scroll vertical ; envisageable : replier les frigos déjà conformes, ou un mode compact.

## Vitrine (`/corner/vitrine`) — écran le plus chargé, vraie friction
- 🔴 V3 — **liste très longue et bruitée** : des dizaines de produits empilés avec badges DLC rouges « DÉPASSÉ » et un bouton « Retirer » par ligne. Pour retirer les 12 produits périmés (vus en prod), il faut scroller toute la liste et taper « Retirer » 12 fois. **Aucune action groupée « retirer tous les périmés »**. → C'est la cause concrète de U17 (12 périmés qui restent en vitrine). Proposer : section « Périmés (12) » en tête + bouton « Tout retirer ».
- 🟡 V4 — densité visuelle : trop de rouge simultané, petit texte. Hiérarchiser (périmés vs à venir), aérer.

## Livraison réception (`/corner/livraison`) — fonctionnel, dense
- ✅ Bonne pratique : section « Sans température (21) » avec **action groupée « Valider réception (21 produits) »** (évite 21 clics).
- 🟡 V5 — les champs photo affichent le label brut du `<input type=file>` (« Choisir Fichier / Aucun fichier choisi ») non stylé Aegean → petit polish (bouton custom).
- 🟡 V6 — longue liste sans regroupement ; ok grâce au bouton bulk, mais un compteur/tri aiderait.

## À faire (passe complète, session dédiée navigateur)
Reste à passer au crible visuel : Dashboard corner (états vides/erreur), Ruptures, Commandes, Réception/Fabrication cuisine, et les **états d'erreur/chargement** (cf. U2 skeleton 30s). Idéalement via `/impeccable` écran par écran avec captures avant/après.

## Récap items visuels (ajout au pool de décisions)
V1 bottom-nav overlap · V2 densité températures · **V3 vitrine sans action groupée de retrait (🔴 lié U17)** · V4 bruit visuel vitrine · V5 inputs file non stylés · V6 tri/compteur livraison.
