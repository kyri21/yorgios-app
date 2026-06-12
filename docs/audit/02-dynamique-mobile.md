# Audit Matias — Phase 2 (volet MOBILE) — 2026-06-12, iPhone 13 Pro / iOS 26.5 via MobAI

> Testé sur l'iPhone réel d'Arthur (Safari), connecté en Arthur (patron). Écritures réversibles autorisées.
> **Aucune écriture effectuée** : test du planning éditable mené sans jamais appliquer ni sauvegarder (vérifié « ✅ Sauvegardé » resté désactivé).

## Planning éditable mobile — VALIDÉ ✅ (clôt l'inconnue du CLAUDE.md)
Le CLAUDE.md notait « MobilePlanningView jamais testé sur device réel ». C'est fait :
- Login Safari iPhone → /planning OK.
- Vue jour : sélecteur LUN→DIM, liste employés avec horaires (Alexandre 8h-15h/7h, Oreline 18h-21h/3h, Sébastien 12h-21h/9h, Greg 10h-15h/5h) + section « EN REPOS — TOUCHEZ POUR PLANIFIER » (Layal, Mellina, Wahib).
- Tap employé → bottom sheet : « Actuel : 8h-15h », sélecteurs **DÉBUT → FIN** (HTML select, options 9h-21h pour FIN avec borne fin>début respectée), bouton **Appliquer** réactif (passé à « Appliquer 8h – 17h » après changement du select), bouton **Repos**, bouton **🤒 Ajouter une absence / un événement**.
- Rendu Aegean propre, sheet bien dimensionné sur 390px.

## ⚠️ Trouvailles mobile
| # | Trouvaille | Gravité | Détail |
|---|-----------|---------|--------|
| M1 | **Chargement lent sur cellulaire** : à l'ouverture du planning (connexion 2/4 barres), les cartes employés sont restées en **skeleton gris vide ~30 s** avant de se remplir | 🟠 perf | Combiné au bundle ~1 Mo (W1), c'est LA cause de « l'app est lente » sur le terrain. Cibles : code-splitting du bundle, et afficher un état de chargement plus explicite (un skeleton qui dure 30 s ressemble à un bug — cf. mes propres faux doutes pendant le test). |
| M2 | **Boutons d'en-tête sans label d'accessibilité** : 2-3 icônes de la bannière (entre 🏖 et 📋, après 📋) n'ont aucun nom accessible (MobAI a signalé « 2-3 buttons have no accessibility labels » à chaque observe) | 🟡 a11y | VoiceOver ne peut pas les annoncer. Ajouter `aria-label` sur ces `<button>` icônes dans Layout.tsx. |
| M3 | **Hygiène mot de passe device partagé** (pas un bug applicatif) : Safari a proposé en autofill le mot de passe enregistré d'un autre employé (`lay.berkous@gmail.com`), et Dashlane celui d'Arthur | ℹ️ ops | Sur un téléphone/iPad partagé, les mots de passe d'employés traînent dans le trousseau. À nettoyer côté device. Renforce la reco de changer le mot de passe d'Arthur. |

## Reste à tester (mobile)
- Pointage géoloc (DailyPointageGate) + FAB sortie — non testé (créerait un pointage réel).
- Bannière service-worker « Nouvelle version disponible ».
- Push FCM.
- Isolation rôle **cuisine** (compte audit.cuisine) + **manager** sur device.
- Ajout d'absence via le bouton 🤒 du bottom sheet (EventModal mobile).

## Statut
Phase 2-mobile : **partielle/DONE_WITH_CONCERNS**. Le cœur — planning éditable mobile — fonctionne et est conforme. 1 vraie cible perf (M1, rejoint W1 bundle), 1 a11y (M2). Reste pointage/PWA/FCM + isolation cuisine/manager.
