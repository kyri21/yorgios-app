# Prochaine session — 3 tâches à implémenter

## 1. AdminSettings — tous les paramètres éditables

**Fichier** : `src/pages/AdminSettings.tsx`

Paramètres déjà présents (notifications, emails, exports, fournisseurs réception).
À ajouter dans la page :
- **Seuil alarme températures** (actuellement hardcodé `ALERT_MIN = -3°C` dans `Temperatures.tsx`) → rendre configurable via `settings/temperatures.alertMinC`
- **Horaires notifications** (heure de déclenchement des schedulers) → lecture seule, affichage informatif
- **Plats disponibilité** (liste des 10 produits dans Ruptures.tsx, actuellement hardcodée `STOCK_PRODUITS`) → rendre éditable via `settings/ruptures.produits[]`
- **Paliers fidélité CRM** (actuellement hardcodés dans `functions/src/domain/loyalty.ts`) → affichage en lecture seule avec note "modifier dans le code"
- **iPad comptes** → affichage informatif des comptes ipad@yorgios.fr et ipad.cuisine@yorgios.fr

Structure Firestore à ajouter :
- `settings/temperatures` : `{ alertMinC: -3 }`
- `settings/ruptures` : `{ produits: ['Briam', 'Moussaka', ...] }`

Dans `Ruptures.tsx` : charger `settings/ruptures.produits` au lieu de `STOCK_PRODUITS` hardcodé.
Dans `Temperatures.tsx` : charger `settings/temperatures.alertMinC` au lieu de `ALERT_MIN = -3`.

---

## 2. Cuisine — Historique photos réceptions (pour inspection hygiène)

**Fichier nouveau** : `src/modules/cuisine/pages/ReceptionHistorique.tsx`
**Route** : `/cuisine/reception-historique`
**Accès** : patron, admin, manager, cuisine

Fonctionnement :
- Charge la collection `receptions` avec orderBy('receivedAt', 'desc')
- Filtre par date (date picker début/fin)
- Filtre par fournisseur (dropdown)
- Affiche une liste de cards : date, fournisseur, produit, temp°C, décision (✅/⚠️/❌), photo miniature cliquable → modal plein écran
- Bouton "Imprimer" → window.print() avec CSS print (tableau A4)
- Champ `photoUrl` est déjà stocké dans les docs `receptions`

Ajouter dans **ModuleGridPanel.tsx** CUISINE_ITEMS :
```typescript
{ path: '/cuisine/reception-historique', label: 'Photos réception', color: '#5AC8FA', icon: <IconPhoto /> }
```

Ajouter dans **router** route `/cuisine/reception-historique`.

---

## 3. Réception cuisine — fournisseur "Autre" + saisie libre

**Fichier** : `src/modules/cuisine/pages/Reception.tsx`

État actuel : `fournisseur` = string sélectionné dans la liste Firestore `settings/reception.fournisseurs`.

Modification :
- Ajouter "Autre" en dernière option dans le sélecteur de fournisseurs
- Si "Autre" sélectionné → afficher un input texte `fournisseurAutre` pour saisir le nom
- Valeur envoyée dans Firestore : `fournisseurAutre.trim()` au lieu de "Autre"
- Validation : si "Autre" sélectionné et champ vide → erreur "Précisez le fournisseur"

---

## Structure Firestore à lire

- `src/pages/AdminSettings.tsx` — page paramètres (déjà lue, structure complète connue)
- `src/modules/cuisine/pages/Reception.tsx` — formulaire réception (déjà lu lignes 1-197)
  - Lire la suite à partir de ligne 197 pour voir le JSX du formulaire
- Vérifier si `receptions` collection a déjà un champ `photoUrl`

## Commandes après modifications
```bash
npx tsc --noEmit   # vérifier TS
npm run deploy     # build + hosting
```
