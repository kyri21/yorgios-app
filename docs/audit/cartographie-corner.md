# Cartographie — Module CORNER (audit Phase 0, 2026-06-12, commit 9cc9137)

## 1. Dashboard (Dashboard.tsx, 764 l.)
- Boutons : Actualiser, bandeau livraisons en retard→navigate, checkboxes À-faire (hygiène/TGTG≥9h/cartons≥9h30/plats≥11h, localStorage), cartes navigation (températures/vitrine/livraison/hygiène/commandes)
- Lectures : 10× getDocFromServer temperatures + 3× hygiene + livraisons limit200 SANS filtre date + corner_stock limit200 + commandes_externes range semaine + météo Open-Meteo
- Écritures : aucune
- ⚠️ livraisons/corner_stock sans filtre date (177-178) ; loadAll catch console-only (241) ; fetch météo `.catch(() => {})` (261)

## 2. Temperatures (739 l.) — onglets Saisie / Semaine / Actions
- Saisie : input par frigo×session, toggle signe, « Enregistrer tous » → setDoc par doc `{date}_{frigoId}_{session}` ✅ catch→setError
- Actions : ➕ Ajouter AC, ✏️ éditer (isManager), Documenter post-alerte → ActionCorrectiveModal
- ⚠️ useEffect ligne 136 deps `[]` mais dépend de `date` (risque comportement) ; setState dans .then() ligne 158 (anti-pattern règle 14)

## 3. Hygiene (453 l.) — Quotidien(13)/Hebdo(5)/Mensuel(1)/Historique
- Sauvegarde setDoc `hygiene_corner/{docId}` — ⚠️ **erreur via `alert()` seul (197)**, pas de state error
- Dead code : tuple `CheckType` ligne 6

## 4. Livraison (1769 l.) — onglets Aujourd'hui / Historique / Galerie / 🚚 Coursier / ⚠️ AC
- Actions principales : valider réception (temp+photo→updateDoc+GEP), bulk « sans temp », dérogation manager, retour cuisine (livraison+lot), supprimer (isManager), NC modal Gardé/Renvoyé/Détruit → addDoc non_conformites + message, AC inline (➕/✏️), coursier onSnapshot deliveries + « Livraison terminée »
- ✅ try/catch surfacés sur quasi toutes les écritures
- ⚠️ **N+1 : 1 getDocs actions_correctives PAR livraison REFUSE (261-267)** ; load initial limit 200 sans date (193) ; closure `livrId` dans .then() NC (495)

## 5. Vitrine (1457 l.) — Stock / Lots / Historique ; 3 modes d'ajout (Manuel/Lot cuisine/Frigo)
- Écritures toutes ✅ catchées : addDoc corner_stock, archive lots_cuisine, deleteDoc stockage_frigo (transfert), retirer (active:false), retour cuisine (corner_stock inactive + lot sent:false), masquer lot
- ⚠️ auto-repair lots en `Promise.all` sans .catch (257-274) ; `processedLotIdsRef` fragile au re-mount (61)

## 6. Ruptures (791 l.)
- Best-sellers 3 états (null→oui→urgent), catalogue, lignes stock libre, 3 photos obligatoires, envoi → addDoc messages + ruptures_actives + photos Storage, lien WhatsApp Timour
- ⚠️ lignes stock vides envoyables (239) ; compteur `_nextId` module-level (38)

## 7. StockageFrigo (352 l.)
- 5 tabs frigos, ajout (manuel ou « Depuis cuisine » lots archivés limit30), transfert inter-frigo, retrait deleteDoc — tous ✅ catchés
- onSnapshot stockage_frigo temps réel (75-79) — vérifier cleanup unsubscribe

## 8. Pertes (526 l.) — Saisie / Rapport
- addDoc pertes_corner + deleteDoc, erreurs via toast ✅
- ⚠️ pas de check `valeur > 0` (187)

## 9. Controle (679 l.) — générateur rapport contrôleur
- ⚠️ **Charge TOUTES les collections (temperatures, livraisons, non_conformites, corner_stock, hygiene_corner, actions_correctives) SANS limit ni where date, filtre JS ensuite (352-395)** — coût Firestore majeur
- Exports Excel (XLSX multi-feuilles) + PDF (jspdf-autotable) sans try/catch

## 10. PlanningCorner (191 l.) — lecture seule, RAS

## 11. Commandes (1292 l.) — Nouvelle / Gestion
- Formulaire complet client + produits + code promo (`validatePromoCode` CF), addDoc commandes_externes ✅ catché
- Onglet Gestion non entièrement exploré (fichier long) — à compléter Phase 1

## ⚠️ Synthèse anomalies corner
| Sévérité | Anomalie | Réf |
|----------|----------|-----|
| 🔴 | N+1 ACs par livraison | Livraison.tsx:261-267 |
| 🔴 | Controle full-scan toutes collections | Controle.tsx:352-395 |
| 🔴 | Dashboard + Livraison : 200 docs sans filtre date à chaque ouverture | Dashboard:177, Livraison:193 |
| 🟠 | Hygiene save : alert() seul | Hygiene.tsx:197 |
| 🟠 | useEffect deps incorrectes | Temperatures.tsx:136 |
| 🟡 | setState dans .then() (règle 14) | Temperatures:158, Livraison:295 |
| 🟡 | Promise.all sans catch (auto-repair) | Vitrine:257-274 |
| 🟡 | Ruptures : envoi lignes vides possible | Ruptures:239 |
