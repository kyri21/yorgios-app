# Cartographie — Backend Firebase : rules + Cloud Functions (audit Phase 0, 2026-06-12, commit 9cc9137)

## Helpers rules (firestore.rules:5-26)
`isPatron()` = patron/admin · `isPatronOrManager()` = +manager · `isCuisine()` = patron/admin/manager/cuisine · `isCorner()` = patron/admin/manager/corner · `isAnyRole()` = les 5 rôles

## Règles par collection (extrait — voir firestore.rules pour le détail)
| Collection | read | create | update | delete |
|---|---|---|---|---|
| users | self ou P/M | ✓ | self ou P/M | — |
| employees / planningWeeks | anyRole | P/M | P/M | P/M |
| receptions, lot_counters, archives, hygiene_cuisine | isCuisine | idem | idem | idem |
| lots_cuisine | anyRole | cuisine | **anyRole** | **anyRole** |
| livraisons | anyRole | cuisine | **isCorner** | isCuisine |
| temperatures | anyRole | anyRole | anyRole | P/M |
| hygiene_corner, corner_stock, corner_commandes, stockage_frigo, pertes_corner | isCorner | idem | idem | idem |
| non_conformites | anyRole | corner | corner | P/M |
| ruptures_actives | isAuth | corner | cuisine | **DENY (jamais nettoyé)** |
| conges_demandes | P/M ou self | anyRole | P/M | — |
| messages | anyRole ×4 | | | |
| commandes_externes | corner | **PUBLIC (true)** | corner | — |
| pointages | self ou P/M | **DENY (CF only)** | — | — |
| settings/* | anyRole | patron/admin write (primes_ca: P/M) | | |
| annonces | anyRole | P/M | **P/M OU anyRole (redondant→anyRole)** | P/M |
| primes_mois / primes_employe | P/M ×4 | | | |
| customers, crm_sync_log, deliveries | read P/M ou anyRole, write DENY (admin SDK) | | | |
| documents_a_signer | anyRole | patron | patron OU uid∈targetUids | patron |
| gmao_demandes | anyRole | P/M | P/M | patron |
| creta_gel_docs | anyRole | P/M ×3 | | |
| actions_correctives | anyRole | anyRole | P/M | P/M |
| notifications_log | self | self | self | self |

## Collections orphelines (rules sans usage client trouvé)
`notifications_log`, `corner_commandes`, `hygiene_cuisine`, `objectifs_ca`(?? — utilisée par CA.tsx, faux positif probable), `lot_counters` (utilisée par Fabrication via runTransaction — faux positif), `employees` (utilisée par planning — faux positif).
→ **À re-vérifier en Phase 1 : seuls `notifications_log`, `corner_commandes`, `hygiene_cuisine` semblent réellement orphelines.**

## Cloud Functions — vérifications de rôle
### ✅ Avec check rôle correct
createUser, deleteUser, updateUserEmail, setUserDisabled (patron/admin) ; updateUserPassword (admin only) ; sendNightlyRupturesNow, previewNightlyRuptures (patron/admin) ; createPointage (rôle ≠ manager, GPS haversine)

### ⚠️ Callables avec auth faible ou absente
| Fonction | Check | Risque |
|----------|-------|--------|
| **sendPasswordReset** (877-915) | **AUCUN — ni auth ni rôle** ✅ confirmé manuellement | spam reset vers n'importe quel email |
| onCommandePrete (630) | isAuth seul | faible |
| sendGmaoEmail (1783) | isAuth seul | email externe par tout employé |
| syncContactToBrevo (2090) | isAuth seul | écriture CRM par tout employé |
| validatePromoCode (2103) | isAuth seul | révèle infos fidélité |

### Endpoints HTTP publics
| Endpoint | Protection | Risque |
|----------|-----------|--------|
| updateCommandeStatus (676-732) | token HMAC-SHA256 **tronqué à 32 chars** (index.ts:53) basé sur YORGIOS_WP_SECRET | moyen |
| validatePromoCodePublic (2116) | header X-Yorgios-Secret, secret déclaré dans secrets[] ✅, check strict ligne 2120 | moyen (rate-limit absent) |
| incomingSms (Twilio webhook) | à vérifier Phase 1 (validation signature Twilio ?) | — |

## 🔴 Trouvailles sécurité confirmées
1. **index.ts:52 : `process.env.YORGIOS_WP_SECRET || 'matias-fallback-secret'`** — si l'env manque au déploiement, tous les tokens HMAC des liens d'action emails deviennent prédictibles. Fix : throw si absent.
2. **sendPasswordReset sans `request.auth` ni rôle** — confirmé en lisant le code.
3. Token HMAC `.slice(0, 32)` — troncature, à corriger en même temps que #1.

## 🟠 Autres trouvailles
4. Emails destinataires hardcodés en fallback (a.cozzika@, kyriazis@, sebastien.coenca@, ytimour86@) dans ~8 fonctions au lieu de tout centraliser settings (index.ts:275, 462, 618, 838, 1285, 1400, 1470, 1533, 1858, 2030)
5. commandes_externes : create public + anti-spam basé sur `cmd.telephone || ''` → contournable avec tél. vide (192)
6. RGPD : collecte PII publique — vérifier checkbox consentement dans CommandePublique (la page /rgpd existe)
7. annonces update `isPatronOrManager() || isAnyRole()` ≡ isAnyRole — règle floue (nécessaire pour readBy mais autorise tout champ)
8. livraisons update isCorner sans restriction de champs (corner peut modifier departTempC)
9. ruptures_actives : delete DENY + aucun cleanup scheduled → accumulation infinie
10. phoneToDocId : `+33…` vs `33…` → doublons clients possibles (crm/index.ts:55-58)

## Index Firestore
Déclarés : lots_cuisine ×3 (archived+archivedAt/createdAt/fabricatedAt), ruptures_actives (viewed+createdAt), deliveries (status+createdAt), annonces (actif+createdAt)
Manquants probables : commandes_externes (dateLivraison+statut), pointages (date+userId+type+statut) → vérifier les erreurs console en Phase 2

## ~40 Cloud Functions inventoriées
Triggers Firestore : onNewMessage, onNewCommande, onCommandeUpdated, onPointageLate, onLivraisonTemperature, onLivraisonReception, onNonConformiteCreated, (onCongesStatutChange — cité CLAUDE.md, à confirmer)
Schedulers : purgeOldMessages, relanceCommandes, notifCommandesJ2/JJ/J7, notifTemperatures(+Evening), notifTooGoodToGo, notifCartonsChambrefroide, notifPlatsJour, notifUrgences, notifHygieneHebdo/Mensuel, notifCostas, weeklyHygieneRecap, gmaoWeeklyReminder, notifNightlyRuptures, autoCheckoutSortie
Callables : voir tableaux ci-dessus + generateMonthlyArchives
HTTP : updateCommandeStatus, validatePromoCodePublic, incomingSms
