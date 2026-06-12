# Audit Matias — Phase 3 : UX & Architecture — 2026-06-12

> Synthèse UX/archi à partir des phases 0-2 + connaissance complète de l'app. Réf produit : `PRODUCT.md`.
> **Rien n'est corrigé.** Chaque item attend le GO d'Arthur (colonne Décision). Un passage visuel fin (impeccable, écran par écran) reste à faire en session dédiée.

## Priorité produit n°1 — la vitesse perçue (objectif PRODUCT.md #2)
| # | Problème | Pourquoi ça compte | Piste | Décision |
|---|----------|--------------------|-------|----------|
| U1 | **Bundle JS ≈ 1 Mo** (`index-*.js` 1 005 KB) chargé au démarrage | C'est un outil terrain en 4G faible : 1 Mo = plusieurs secondes avant le premier rendu utile | Analyser le bundle (rollup-plugin-visualizer), lazy-load XLSX/jspdf/html5-qrcode (exports & scanner ne servent qu'à 2-3 écrans), vérifier le code-split par route | ☐ |
| U2 | **Skeletons qui durent ~30 s** sur le planning mobile (connexion lente) → ressemble à un écran cassé (j'ai moi-même douté) | Un employé pense que « ça bug » et recharge/abandonne | États de chargement honnêtes : message « Chargement du planning… » + timeout visible + bouton réessayer ; idéalement afficher les données en cache d'abord | ☐ |
| U3 | Requêtes lourdes par écran (Dashboard corner: ~200 livraisons + 200 stock + 13 getDoc ; N+1 ACs ; Controle full-scan ; catalogue full-scan ×3) — cf. 01-statique §F | Latence + coût Firestore | Filtres date + limit + cache catalogue partagé | ☐ |

## Fiabilité perçue — échecs silencieux qui trompent l'utilisateur (objectif PRODUCT.md #1)
| # | Problème | Décision |
|---|----------|----------|
| U4 | **Manager ouvre /admin/settings, modifie, sauvegarde → permission-denied silencieux** (W5) : il croit avoir réglé un paramètre, rien n'est écrit, aucun message | ☐ |
| U5 | Sauvegarde planning sans try/catch, AnnonceGate/useAuth/DailyPointageGate catch muets, Hygiene via `alert()` (01-statique §D) | ☐ |
| U6 | Plusieurs `alert()` natifs (Livraisons cuisine ×4, Controle) au lieu de toasts cohérents Aegean | ☐ |

## Architecture / cohérence
| # | Problème | Décision |
|---|----------|----------|
| U7 | **Permissions cosmétiques** (01-statique §C) : `AdminPermissions` + `settings/permissions` masquent des boutons mais les rules Firestore ne les lisent pas → décision d'architecture à prendre (brancher action_*/field_* + refléter dans les rules, OU assumer « affichage only » et le documenter) | ☐ |
| U8 | **Trois « livraisons » dans la nav** : coursier `/livraisons` (Twilio), `corner/livraison` (réception), `cuisine/livraisons` (départ) → confusion de vocabulaire | Renommer : « Coursier », « Réception corner », « Départs cuisine » | ☐ |
| U9 | `AdminDocuments.tsx` orphelin (fusionné dans Documents.tsx) — supprimer le fichier | ☐ |
| U10 | Table équipe + table des routes du CLAUDE.md périmées (Oreline absente ; /ca, /admin/allergenes élargis) | ☐ |
| U11 | Rules orphelines (`notifications_log`, `corner_commandes`, `hygiene_cuisine`) + `ruptures_actives` jamais nettoyé | ☐ |

## UX mobile / responsive
| # | Problème | Décision |
|---|----------|----------|
| U12 | **Boutons d'en-tête sans `aria-label`** (M2) → VoiceOver muet | ☐ |
| U13 | Desktop 1280px : sidebar **+** bottom-nav mobile affichées ensemble (W2) ; vérifier que la bottom-nav ne recouvre pas le contenu scrollé (W3) | ☐ |
| U14 | Consentement RGPD : bouton « Lisez l'intégralité pour continuer » resté désactivé après scroll (M4 — à reproduire) ; si réel, blocage au 1er lancement | ☐ |

## Conformité
| # | Problème | Décision |
|---|----------|----------|
| U15 | **RGPD à deux vitesses** (M5) : gate de consentement géoloc complet pour les employés, mais `/commande` public collecte nom/tél/email/adresse **sans consentement** ni `consentAt` | ☐ |
| U16 | Sécurité backend P0 (01-statique §A) : secret fallback, `sendPasswordReset` sans auth, anti-spam contournable — relève aussi de la confiance produit | ☐ |

## Flux métier à revoir (signal terrain)
| # | Observation | Décision |
|---|-------------|----------|
| U17 | **12 produits périmés encore en vitrine** + 37 alertes DLC en prod (vu sur le dashboard corner réel) : soit le retrait DLC a une friction, soit le flux n'est pas fait. À étudier (parcours retrait vitrine sur device) | ☐ |

## Reste pour une vraie passe visuelle (session dédiée)
Lancer `/impeccable` écran par écran (hiérarchie, espacement, typographie, motion, états vides/erreur) sur les écrans à plus fort trafic : Dashboard corner, Températures, Vitrine, Livraison corner, Planning mobile. Nécessite le navigateur + captures avant/après.
