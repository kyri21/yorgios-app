# Audit Matias — Phase 2 (volet WEB) — 2026-06-12, app live cuisine-yorgios.web.app

> Smoke test live **en lecture seule** (compte Arthur, admin). Aucune action à effet réel déclenchée.
> Volet MOBILE (MobAI/iPhone) NON fait — voir prompt de reprise.

## Ce qui a été testé
Login → /planning (home admin) → /corner, en desktop 1280px puis mobile 390×844.

## Résultats

### ✅ Points sains (infirment des craintes Phase 0/1)
| Vérif | Résultat |
|-------|----------|
| Chargement app | 200, redirige /login, **0 erreur console** |
| Login `kyriazis@outlook.fr` | ✅ fonctionne → /planning |
| Console /planning et /corner | **0 erreur, 0 warning** |
| Requêtes Firestore en échec / index manquants | **aucune détectée** dans cette session → l'hypothèse « index composites manquants » (Phase 1 §F) est **dégradée** : rien ne casse avec les données actuelles. À reconfirmer si une requête date+statut est exercée. |
| Rendu Aegean (planning + corner) | propre, cohérent, light theme OK desktop ET mobile |

### ⚠️ Trouvailles dynamiques
| # | Trouvaille | Gravité | Détail |
|---|-----------|---------|--------|
| W1 | **Bundle JS principal ≈ 1,0 Mo** (`index-0ai7TV2_.js` = 1 005 083 B) | 🟠 perf | Rapide en filaire (load 221-435 ms) mais c'est LE coût ressenti sur iPhone en 4G. Piste : analyser le bundle (`vite build --mode analyze` / rollup-plugin-visualizer), code-split les gros modules (XLSX, jspdf, html5-qrcode déjà lazy ?), vérifier que les exports Excel/PDF ne sont pas dans le bundle initial. |
| W2 | **Double navigation en desktop** : à 1280px la sidebar gauche ET la bottom-nav mobile s'affichent ensemble | 🟡 UX | Le breakpoint d'affichage de la bottom-nav ne masque pas à partir du desktop. Vérifier la media-query dans Layout.tsx. |
| W3 | Bottom-nav mobile : vérifier qu'elle ne recouvre pas le contenu scrollé (carte « Températures NON SAISIS » passait sous la barre) | 🟡 UX | Ajouter `padding-bottom` au conteneur scroll = hauteur bottom-nav. À confirmer sur device réel. |
| W4 | **Signal métier** (pas un bug) : corner a 37 alertes DLC dont 12 produits **périmés** encore en vitrine | ℹ️ | Soit l'équipe ne retire pas les produits périmés, soit le flux de retrait DLC a une friction. À creuser en Phase 3 (UX retrait vitrine). |

### Comptes de test créés (2026-06-12, via /admin/users → CF createUser)
- `audit.corner@yorgios.fr` (rôle corner) et `audit.cuisine@yorgios.fr` (rôle cuisine). Mots de passe communiqués à Arthur en privé (non versionnés). **À supprimer en fin d'audit.**
- Note : la CF `createUser` n'envoie aucun email (vérifié, pas d'effet externe).

### ✅ Cloisonnement de rôle (corner) — testé
Compte corner → atterrit sur `/corner`. `/admin/users` et `/cuisine` redirigent vers `/corner` (AuthGuard côté client OK). Confirme le §B de 01-statique au niveau routing. ⚠️ rappel : c'est le garde **client** ; la sécurité réelle reste les rules Firestore (cf. 01-statique §B/C — permissions cosmétiques). Reste à tester l'isolation du compte **cuisine** + manager.

### Cloisonnement de rôle MANAGER — testé (compte audit.manager, 2026-06-12)
Manager → atterrit sur `/planning`. Matrice vérifiée :
- **Bloquées (redirigent vers /planning)** ✅ : `/admin/users`, `/admin/produits`, `/admin/permissions`.
- **Accessibles (restent)** ✅ : `/admin/settings`, `/admin/conges`, `/admin/annonces`, `/admin/pointages`.
Conforme au router pour les 3 rôles testés (corner, cuisine, manager). Routing client-side solide.

### 🔴 Trouvaille W5 — manager + AdminSettings = échec silencieux garanti
Le router laisse le **manager ouvrir `/admin/settings`** (et éditer les champs), MAIS la règle Firestore `settings/{doc}` n'autorise l'écriture qu'à `patron`/`administrateur` (pas manager — cf. cartographie-backend). Donc un manager qui modifie un réglage et sauvegarde → **`permission-denied` côté Firestore**, et comme `AdminSettings` a un catch silencieux (01-statique §D), **le manager ne voit aucune erreur** : il croit avoir sauvegardé, rien n'est écrit. C'est l'intersection concrète de deux findings (permissions cosmétiques §C + AdminSettings silent catch §D). **À trancher** : soit retirer `/admin/settings` aux managers (router), soit ouvrir l'écriture settings aux managers (rules), soit au minimum surfacer l'erreur. ☐

### Note annexe (liste users)
Compte `oreline.bouteiller@gmail.com` (corner) présent en prod mais absent de la table équipe du CLAUDE.md → doc périmée, à rafraîchir.

### Non testé ce tour (à faire)
- Autres rôles (corner, cuisine, manager, planning@) — vérifier que chaque rôle voit bien ses écrans et **rien de plus** (croisement avec Phase 1 §B/C).
- Parcours d'écriture (création employé, saisie température, etc.) — délicat en prod : risque emails/FCM réels. **À faire sur device avec MobAI**, ou en lecture stricte.
- **Mobile/PWA** : planning éditable iPhone (jamais testé sur device réel — cf. CLAUDE.md), FCM, géoloc pointage, bannière « Nouvelle version » service worker.

## Statut
Phase 2-web : **partielle/DONE_WITH_CONCERNS**. Socle sain (pas d'erreurs runtime), 1 vraie cible perf (bundle 1 Mo) + 2 retouches UX responsive. Le gros du dynamique restant est **mobile** → MobAI.
