# Audit Matias — Phase 4 : SYNTHÈSE & REGISTRE DE DÉCISIONS — 2026-06-12

> Tout l'audit converge ici. Chaque ligne = une décision pour Arthur : **GO** (je corrige), **NO-GO** (on laisse), **PLUS TARD**.
> Statut rempli au fur et à mesure de la validation. Détails dans 00→03b.

## Bilan global
App **saine sur le fond** : 0 erreur console en prod, design Aegean uniforme, cloisonnement de rôle (routing) correct pour les 5 rôles, planning éditable mobile fonctionnel. Les problèmes sont concentrés sur **4 axes** : (1) sécurité backend, (2) échecs silencieux, (3) vitesse perçue mobile, (4) permissions cosmétiques. Plus un lot de polish UX.

---

## LOT A — Sécurité backend (P0) — recommandation : GO rapide
| # | Décision | Effort | Reco | Statut |
|---|----------|--------|------|--------|
| A1 | Supprimer le fallback `'matias-fallback-secret'` → throw si env absent (index.ts:52) | XS | GO | ☐ |
| A2 | `sendPasswordReset` : exiger auth + rôle patron/admin (index.ts:877) | S | GO | ☐ |
| A3 | Token HMAC : utiliser 64 chars au lieu de `.slice(0,32)` (index.ts:53) | XS | GO | ☐ |
| A4 | Anti-spam commandes : refuser tél. vide + corriger seuil `>3` (index.ts:189) | S | GO | ☐ |
| A5 | Changer le mot de passe admin d'Arthur (faible « arthur ») | XS | GO (toi) | ☐ |

## LOT B — Fiabilité / échecs silencieux (P1) — recommandation : GO
| # | Décision | Effort | Reco | Statut |
|---|----------|--------|------|--------|
| B1 | `usePlanning.save()`/load : try/catch + bandeau d'erreur (desktop+mobile) | S | GO | ☐ |
| B2 | AnnonceGate / useAuth / DailyPointageGate : remplacer les catch muets par une surface d'erreur | S | GO | ☐ |
| B3 | Hygiene corner + AdminSettings : remplacer `alert()`/catch muet par toasts cohérents | M | GO | ☐ |
| B4 | **U4/W5** Manager + /admin/settings : soit retirer l'accès, soit ouvrir l'écriture aux managers, soit surfacer le permission-denied | S | À TRANCHER (voir question) | ☐ |
| B5 | Écritures non atomiques cuisine/Livraisons (lot+livraison) → `writeBatch` | M | GO | ☐ |

## LOT C — Vitesse perçue mobile (P1) — recommandation : GO (gros impact terrain)
| # | Décision | Effort | Reco | Statut |
|---|----------|--------|------|--------|
| C1 | Analyser + alléger le bundle 1 Mo (lazy XLSX/jspdf/scanner, code-split) | M | GO | ☐ |
| C2 | États de chargement honnêtes (le skeleton 30s ressemble à un bug) + cache-first si possible | M | GO | ☐ |
| C3 | Requêtes lourdes : N+1 ACs livraison, Controle full-scan, catalogue cache, limites date | M-L | GO par étapes | ☐ |

## LOT D — Permissions / architecture (P1) — DÉCISION STRUCTURANTE
| # | Décision | Reco | Statut |
|---|----------|------|--------|
| D1 | **Permissions cosmétiques (U7)** : (a) brancher vraiment action_*/field_* + refléter dans les rules Firestore, (b) garder « affichage only » et le documenter clairement, (c) abandonner le chantier AdminPermissions | À TRANCHER (voir question) | ☐ |

## LOT E — UX / polish (P2) — recommandation : GO sélectif
| # | Décision | Reco | Statut |
|---|----------|------|--------|
| E1 | **Vitrine : section « Périmés » + bouton « Tout retirer »** (V3/U17 — 12 périmés en prod) | GO | ☐ |
| E2 | Boutons header sans `aria-label` (M2/U12) | GO | ☐ |
| E3 | Bottom-nav : padding-bottom du scroll + masquer en desktop (V1/W2/U13) | GO | ☐ |
| E4 | Renommer les 3 « livraisons » (Coursier / Réception corner / Départs cuisine) (U8) | GO | ☐ |
| E5 | Inputs file stylés Aegean (V5) ; densité vitrine (V4) | PLUS TARD | ☐ |
| E6 | Reproduire/corriger friction consentement RGPD scroll (M4/U14) | À VÉRIFIER | ☐ |

## LOT F — Nettoyage / dette (P3) — recommandation : GO groupé
| # | Décision | Reco | Statut |
|---|----------|------|--------|
| F1 | Supprimer `AdminDocuments.tsx` orphelin (U9) | GO | ☐ |
| F2 | Purger rules orphelines (notifications_log, corner_commandes, hygiene_cuisine) + cleanup scheduled ruptures_actives (U11) | GO | ☐ |
| F3 | MAJ tables équipe + routes dans CLAUDE.md (U10) | GO | ☐ |
| F4 | Centraliser emails destinataires hardcodés dans settings (cf. cartographie-backend) | PLUS TARD | ☐ |

## LOT G — Conformité (P1) — DÉCISION
| # | Décision | Reco | Statut |
|---|----------|------|--------|
| G1 | **RGPD `/commande` public (U15/M5)** : ajouter checkbox de consentement + `consentAt` + lien /rgpd, et exiger en rules | À TRANCHER (voir question) | ☐ |

---

## Nettoyage de fin d'audit
- Supprimer les 3 comptes test : `audit.corner@`, `audit.cuisine@`, `audit.manager@yorgios.fr`.

## Décisions à poser à Arthur en priorité
1. Lot A (sécurité P0) : GO global ?
2. B4 — manager/settings : quelle option ?
3. D1 — permissions cosmétiques : quelle direction ?
4. G1 — RGPD formulaire public : on ajoute le consentement ?
(Le reste — B,C,E,F — recommandé GO ; à confirmer en bloc.)
