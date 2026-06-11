# Cartographie — Modules CUISINE + CRM (audit Phase 0, 2026-06-12, commit 9cc9137)

## 1. Dashboard cuisine (Dashboard.tsx, ~750 l.)
- Cards navigation (températures, fabrication, livraisons, réception, /corner/commandes)
- Lectures : 10 getDoc temperatures, lots_cuisine archived==false limit10, receptions limit1, livraisons receptionTempC==null limit20, commandes_externes ×2 ranges, **catalogue getDocsFromServer FULL (225)**, settings/priority_levels, **onSnapshot ruptures_actives** (271-276)
- Écritures : aucune
- ⚠️ chargement principal catch console-only (147-246) ; vérifier unsubscribe onSnapshot (277)

## 2. Reception (1055 l.) — Saisie / Historique
- Saisie : fournisseur pills + Autre, produit (catalogue inReception), scanner code-barres, photo (obligatoire VIANDE), température → décision HACCP auto `computeDecisionV1` → setDoc receptions ✅ catché ; bouton « Documenter AC » si non conforme
- ⚠️ **Historique : `getDocs(receptions)` SANS limit (187)**, catch muet

## 3. ReceptionHistorique (215 l.)
- ⚠️ même problème : getDocs sans limit (44), filtres date/fournisseur **client-side**, `.catch(() => {})` muet

## 4. Fabrication (1417 l.) — Fabrication / Historique ; 4 modes (Catalogue/Réception/Libre/Transformation)
- Création lot : anti-doublon lotCode (check getDocs puis setDoc — **non transactionnel**, race possible 351-360), compteur `lot_counters` via runTransaction ✅, payload complet avec receptionId/fournisseur/isTransformation/ingredientLotCodes/creatorName
- Liste : toggle Archivés, ✏️ edit inline (updateDoc qty/dates ✅), 🗑 deleteDoc ✅, QR code (api qrserver), 🔍 traçabilité (chaîne getDoc lot→réception→ingrédients, **catch muet 404-431**)
- Backfill creatorName : boucle updateDoc potentiellement coûteuse (295-299)
- ⚠️ catalogue getDocsFromServer full (189)

## 5. Livraisons (1175 l.) — modes CUISINE départ / CORNER réception / CONTRÔLE (param ?month)
- Départ : sélection lots + temp, saisies manuelles (lotCode MAN-*), submitAll : **setDoc(livraison) puis updateDoc(lot sent:true) NON atomiques (389-418)** → incohérence si crash entre les deux
- removeDepart : **deleteDoc(livraison) puis updateDoc(lot) NON atomiques (599-611)**
- Réception : temp + photo optionnelle → updateDoc + recompute GEP ✅
- Contrôle : where departAt mois, limit 2000
- ⚠️ **GEP RULES hardcodées (26-35)** — divergence possible avec le barème documenté ; **4 `alert()`** (453, 509, 572, 615) ; livraisons limit200 filtrées client sur today (286)

## 6. Temperatures cuisine (700 l.) — Saisie / Semaine / Actions
- Même pattern que corner : saveAll ✅ catché, AC modal, semaine 7j×5 frigos
- ⚠️ loadWeek catch muet (193) ; loadAcForDate catch muet (126) ; alertMin/Max : -3/+4 partiellement hardcodés vs settings chargés async (race d'affichage)

## 7. Controle cuisine (420 l.) — MOIS / INTERVALLE
- CF `generateMonthlyArchives` (callable), archives metadata getDocs limit120, liens CSV/PDF Storage — try/catch ✅
- ⚠️ alert() succès (182)

## 8. CRM — CaptationPage (314 l.) + useCaptation
- Formulaire identité/contact/consentements → CF `syncContactToBrevo` (payload E.164 normalisé) — erreurs surfacées ✅
- ⚠️ pas de validation email ; pas de rate-limit client ; auto-reset 1800ms

## ⚠️ Cycle de vie des lots — incohérence détectée
- Envoi corner : `lots_cuisine.sent=true` mais **`archived=true` n'est posé que par Vitrine corner** (ajout en vitrine) — un lot envoyé jamais ajouté en vitrine reste `archived=false, sent=true` et pollue les requêtes `archived==false`
- À confirmer en Phase 1 : est-ce le comportement voulu (badge ENVOYÉ) ou une fuite ?

## ⚠️ Synthèse anomalies cuisine/CRM
| Sévérité | Anomalie | Réf |
|----------|----------|-----|
| 🔴 | submitAll / removeDepart non atomiques (2 écritures séquentielles) | Livraisons.tsx:389-418, 599-611 |
| 🔴 | receptions sans limit ×2 | Reception:187, ReceptionHistorique:44 |
| 🟠 | catalogue full scan ×3 (Dashboard 225, Fabrication 189, Livraisons 252) | — |
| 🟠 | anti-doublon lotCode non transactionnel (race) | Fabrication:350-360 |
| 🟠 | GEP rules hardcodées | Livraisons:26-35 |
| 🟡 | catch muets : traçabilité, loadWeek, loadAcForDate, historiques | voir ci-dessus |
| 🟡 | alert() ×6 (Livraisons ×4, Controle, …) | — |
