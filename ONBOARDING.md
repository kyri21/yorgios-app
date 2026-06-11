# Onboarding — Yorgios App (Matias PWA)

PWA restaurant Yorgios — React + TypeScript + Firebase
Hosting : https://cuisine-yorgios.web.app | Firebase project : `cuisine-yorgios` DB `test`

## Docs à lire en priorité

1. **CLAUDE.md** — spec complète : routes, Firestore, règles absolues, design system, équipe
2. **AGENTS.md** — instructions GitNexus (impact analysis obligatoire avant toute édition)
3. **memory/MEMORY.md** — contexte projet, état des fonctionnalités, bugs connus

## Plans en cours

- `.planning/next-session.md` — tâches prochaine session (AdminSettings configurables, historique photos réception, fournisseur Autre)
- `.planning/crm-module-plan.md` — module CRM Brevo (implémenté, secrets à configurer)
- `docs/superpowers/plans/2026-05-06-ac-inline-livraison.md` — AC inline livraison corner

## Règles absolues (extrait CLAUDE.md)

- **Un seul Firebase** : `cuisine-yorgios`, DB `test` — imports uniquement depuis `src/firebase/config.ts`
- **Jamais `initializeApp()`** dans un module ou une page
- **`administrateur` = alias `patron`** — même droits partout
- **React setState async** — stocker en variable locale AVANT `.then()`, ne jamais utiliser la valeur d'état dans le callback
- **`actions_correctives` refId** = ID du parent (pas de l'AC), `editId` = ID de l'AC

## Design system

**Aegean Precision LIGHT** — `--surface: #fcf9f3` · `--primary: #004275` · fonts: Epilogue + Manrope
Zéro fond sombre, zéro `#000`, zéro `bg-gray-9*`.

## Stack

- React 18 + TypeScript + Vite + Tailwind
- Firebase : Firestore, Auth, Storage, Functions (Node 22, europe-west1)
- PWA : vite-plugin-pwa + FCM

## Commandes

```bash
npm run dev
npm run build && firebase deploy --only hosting
cd functions && npm run build && cd .. && firebase deploy --only functions:nomFonction
firebase deploy --only firestore:rules
```
