# Hygiène corner — responsable désigné par période

**Date** : 2026-07-28
**Statut** : spec validée, révision 2

**Révision 2 (2026-07-28)** — À la demande d'Arthur, ce qui était figé dans le code devient
réglable dans les Paramètres : jours et heures de chaque rappel, canaux de notification par
type d'événement, et droit de désigner un responsable. La révision 1 laissait ces trois points
en dur au nom du YAGNI ; c'était un mauvais arbitrage sur un projet dont le propriétaire pilote
ses fonctionnalités depuis l'interface. Les sections 2, 3, 4, 5, 7 et 9 sont mises à jour en
conséquence, et les paragraphes concernés portent la mention **(rév. 2)**.

---

## 1. Problème

Les checklists d'hygiène **hebdomadaire** et **mensuelle** du corner ne sont attribuées à
personne. Quand elles ne sont pas faites, le rappel part à tout le corner plus le patron et
le manager — une alerte que personne ne se sent tenu de traiter.

Trois manques :

1. Aucun moyen de désigner un responsable pour une semaine ou un mois donné.
2. Le salarié concerné n'est pas prévenu et ne voit pas la tâche dans son tableau de bord.
3. Aucune trace de qui était responsable quand, ni de qui a été relancé.

Un quatrième défaut est apparu à l'analyse et est corrigé ici : une checklist **partiellement**
cochée compte aujourd'hui comme faite.

---

## 2. Décisions

| Sujet | Décision |
|---|---|
| Liste des responsables | Comptes `users` de rôle `corner` |
| Périodicité | Une désignation par période, remise à zéro à chaque nouvelle semaine / mois |
| Droit de désigner | patron et administrateur toujours ; manager **réglable** (rév. 2) |
| Canaux | Email, push et affichage Dashboard — email et push **réglables par type d'événement** (rév. 2) |
| Rappels | 2 rappels ciblés puis escalade — **jour et heure de chacun réglables** (rév. 2) |
| Stockage | Collection dédiée `hygiene_responsables` |
| Complétude | Tâche faite = **tous** les items cochés, quotidien inclus (arbitré par Arthur) |

### Pourquoi les comptes `users` et non les fiches `employees`

Seuls les documents `users` portent un email et un `fcmToken`. Une fiche `employees` non liée
à un compte (`users.employeeId`) ne peut recevoir ni mail ni notification — la désigner
responsable produirait une attribution muette.

### Pourquoi une collection dédiée

La convention **« le document `hygiene_corner/{periodId}` existe = la tâche est faite »** est
câblée dans au moins quatre endroits : `Dashboard.tsx:200-201`, `notifHygieneHebdo`,
`notifHygieneMensuel`, `weeklyHygieneRecap`.

Stocker le responsable dans ce document le ferait exister **avant** que la checklist soit
faite : le Dashboard afficherait ✅ et les deux fonctions de rappel se tairaient. La
désignation vit donc dans sa propre collection, sans contact avec cette logique.

---

## 3. Modèle de données

### Collection `hygiene_responsables`

Un document par période. ID lisible et stable :
`2026-W31_hebdo`, `2026-07_mensuel`.

```ts
type HygieneResponsable = {
  periodId:     string          // '2026-W31_hebdo'
  kind:         'hebdo' | 'mensuel'
  periodStart:  Timestamp       // lundi 00:00 / 1er du mois 00:00
  periodEnd:    Timestamp       // dimanche 23:59 / dernier jour 23:59

  assigneeUid:   string
  assigneeName:  string         // dénormalisé
  assigneeEmail: string         // dénormalisé

  assignedBy:     string        // uid
  assignedByName: string
  assignedAt:     Timestamp

  previousAssignees: Array<{ uid: string; name: string; until: Timestamp }>

  notifiedAt:    Timestamp | null
  remindersSent: string[]       // ['rappel1', 'rappel2', 'escalade']
  escalatedAt:   Timestamp | null
}
```

**Nom et email dénormalisés** : si un compte est supprimé, l'historique doit continuer
d'afficher « Layal ». Même principe que `creatorName` sur `lots_cuisine` et `authorName` sur
`planning_audit`.

**`periodStart` en plus de `periodId`** : trier par ID mélangerait `2026-07_mensuel` et
`2026-W31_hebdo`. Le champ date permet tri fiable et filtre par `kind`.

**`previousAssignees`** : une réaffectation en cours de période écrase `assigneeUid`. Le
tableau conserve le passage de témoin — le document reste unique par période. C'est le client
qui l'alimente, dans la même écriture que la réaffectation : il pousse l'ancien
`{ assigneeUid, assigneeName }` avec `until = now` via `arrayUnion`, puis écrit le nouveau
titulaire. Réaffecter remet aussi `remindersSent` à `[]`, pour que le nouveau responsable
reçoive bien les rappels restants de la période.

**`remindersSent`** : la fonction de rappel tourne toutes les heures (rév. 2). Sans marqueur de
jalon, chaque rappel partirait en double. Même mécanique d'idempotence que `pointages_noshow`.
Les valeurs stockées sont `rappel1`, `rappel2`, `escalade` (rév. 2 — voir le renommage plus bas).

### Réglages — `settings/hygiene_responsables` (rév. 2)

```ts
{
  rappelsEnabled: boolean           // interrupteur général, défaut true
  escaladeDestinataires: string[]   // emails

  hebdo: {
    rappel1:  { actif: boolean, jour: number, heure: number },  // défaut jeudi(4) 10h
    rappel2:  { actif: boolean, jour: number, heure: number },  // défaut samedi(6) 10h
    escalade: { actif: boolean, jour: number, heure: number },  // défaut dimanche(0) 18h
  },
  mensuel: {
    rappel1:  { actif: boolean, joursAvantFin: number, heure: number },  // défaut 7, 10h
    rappel2:  { actif: boolean, joursAvantFin: number, heure: number },  // défaut 2, 10h
    escalade: { actif: boolean, joursAvantFin: number, heure: number },  // défaut 0, 18h
  },

  canaux: {
    designation: { email: boolean, push: boolean },  // défaut true / true
    rappel:      { email: boolean, push: boolean },  // défaut true / true
    escalade:    { email: boolean, push: boolean },  // défaut true / false
  },
}
```

`jour` suit la convention JavaScript : 0 = dimanche, 6 = samedi. `joursAvantFin` compte les
jours restants avant la fin du mois, 0 désignant le dernier jour. `heure` va de 0 à 23.

Si `escaladeDestinataires` est vide ou le document absent, repli sur
`settings/alert_emails.responsables` puis sur une liste en dur — une escalade ne doit jamais
partir dans le vide.

**Défauts appliqués champ par champ.** Toute lecture fusionne le document avec les valeurs par
défaut, à la manière de `mergeWithDefaults` dans `PermissionsContext.tsx`. Un document absent,
partiel, ou écrit par une version antérieure doit produire exactement le comportement de la
révision 1 — c'est ce qui garantit que cette souplesse ne casse rien pour qui n'y touche jamais.

**Renommage `j-3` / `j-1` → `rappel1` / `rappel2`.** Ces noms décrivaient un délai qui devient
réglable : appeler « j-3 » un rappel placé à J-5 serait trompeur. Rien n'étant déployé, aucune
donnée n'est à migrer — c'est le seul moment où ce renommage est gratuit.

**Collision de deux jalons sur le même créneau.** Le plus grave l'emporte : escalade, puis
rappel2, puis rappel1. Un seul message part. La section Paramètres avertit en orange dès que
deux jalons partagent un créneau, pour que le conflit se voie au réglage et non à l'usage.

**Aucune contrainte croisée entre jalons.** Rien n'empêche de placer le rappel 1 après le
rappel 2. C'est délibéré : une validation croisée compliquerait l'interface pour empêcher une
erreur sans conséquence — le pire cas produit deux rappels dans un ordre inhabituel.

### Calcul des identifiants de période

Réutiliser `getISOWeek()` et `getDocId()` de `Hygiene.tsx:79-92`, qui produisent déjà
`2026-W31_hebdo` et `2026-07_mensuel`. Les fonctions Cloud recalculent la même chose côté
serveur — `notifHygieneHebdo` contient déjà ce calcul ISO.

---

## 4. Interface

### 4.1 Onglet Nettoyage — Hebdo et Mensuel (`Hygiene.tsx`)

Bloc « Responsable » au-dessus de la barre de progression, dans ces deux onglets uniquement.
Le quotidien reste collectif.

- **Encadrant** : `<select>` des comptes `users` de rôle `corner` + bouton *Désigner*. Si déjà
  désigné : nom affiché + bouton *Changer*. Le droit est porté par la permission
  `action_designer_responsable_hygiene` (rév. 2) : patron et administrateur l'ont toujours,
  le manager est réglable dans `/admin/permissions`, corner et cuisine ne l'ont jamais.
- **Salarié corner** : lecture seule — « Responsable : Markella », ou encadré discret
  « Aucun responsable désigné ».

Le bloc suit le sélecteur de date existant : naviguer sur une semaine passée affiche le
responsable de cette semaine, en lecture seule.

Chargement : `getDoc(hygiene_responsables/{periodId})` dans `loadTab()`, qui tourne déjà à
chaque changement d'onglet ou de date.

Écriture : `setDoc(..., { merge: true })` pour ne pas écraser les champs écrits par les
fonctions Cloud. `catch` obligatoire affichant l'erreur à l'écran.

### 4.2 Dashboard corner (`Dashboard.tsx`)

Les lignes `Dashboard.tsx:288-289` passent de conditionnelles à permanentes dès qu'un
responsable est désigné :

```
✅ Hygiène hebdomadaire — Markella
❌ Hygiène mensuelle — Elena          ← toi
```

| Cas | Affichage |
|---|---|
| Responsable désigné | Ligne toujours visible, ✅ / ❌ selon complétude |
| Aucun responsable, période non faite | « Hygiène hebdomadaire — non attribuée », ❌ |
| Aucun responsable, période faite | Ligne masquée (comportement actuel) |

Quand l'utilisateur connecté est le responsable, la ligne porte un accent visuel (pastille +
mention « toi »).

Le cas « non attribuée » est ce qui empêche un oubli de désignation de passer inaperçu.

### 4.3 Historique (onglet Historique existant)

- Les cards Hebdo et Mensuel affichent le nom du responsable sous le compteur.
- Section dépliable **« Historique des responsables »**, 12 dernières périodes :

```
S31  2026  Hebdo    Markella    ✅ 5/5     désigné par Sébastien
S30  2026  Hebdo    Wahib       ❌ 2/5     rappelé J-3, J-1 · escaladé
S29  2026  Hebdo    Elena       ✅ 5/5
```

Requête : `where('kind','==','hebdo').orderBy('periodStart','desc').limit(12)`, puis lecture
des documents `hygiene_corner` correspondants pour le statut.

Pattern `PreviewTable` de `Controle.tsx` (*Afficher tout* / *Rétracter*) plutôt qu'un
cinquième onglet — la barre est déjà à quatre et serrée sur mobile.

La colonne « rappelé / escaladé » transforme l'historique en preuve : elle montre que le
salarié a été prévenu, pas seulement qu'il était désigné.

### 4.4 Section Paramètres — « Nettoyage — responsables » (rév. 2)

La section devient la plus dense de `/admin/settings`. Elle est structurée en quatre blocs
repliables, chacun affichant son réglage courant en résumé lorsqu'il est replié :

```
Nettoyage — responsables
├─ ☑ Rappels automatiques activés            (toujours visible)
├─ ▸ Rappels hebdomadaires            jeu 10h · sam 10h · dim 18h
├─ ▸ Rappels mensuels                 J-7 10h · J-2 10h · dernier jour 18h
├─ ▸ Canaux de notification           email+push · email+push · email
└─ ▸ Destinataires de l'escalade      2 personnes
```

Repliée, la section ne fait que cinq lignes ; c'est ce qui rend acceptable qu'une
fonctionnalité portant sur deux checklists occupe autant de place que le reste de la page.

**Bloc hebdomadaire** — trois lignes : case d'activation, `<select>` du jour (dimanche à
samedi), `<select>` de l'heure (0 à 23).

**Bloc mensuel** — même structure, le jour devenant un nombre de jours avant la fin du mois,
avec la mention « 0 = le dernier jour du mois » sous le bloc : c'est la seule valeur dont le
sens n'est pas évident.

**Bloc canaux** — grille de trois lignes (désignation, rappels, escalade) sur deux colonnes
(email, push).

**Avertissement de collision** — en orange sous le bloc concerné, avec le créneau en cause :
« ⚠️ 2e rappel et Escalade sont tous deux réglés sur dimanche 18h — seule l'escalade partira. »
Le conflit doit se voir au moment du réglage, pas se découvrir à l'usage.

---

## 5. Fonctions Cloud

### 5.1 `onHygieneResponsableAssigned`

Trigger : écriture sur `hygiene_responsables/{periodId}`.

```
si before.assigneeUid === after.assigneeUid  → return
sinon → push si canaux.designation.push, email si canaux.designation.email,
        puis écrire notifiedAt
```

Ce garde est indispensable : la fonction écrit dans le document qui la déclenche. Sans lui,
elle se rappellerait en boucle à chaque mise à jour de `remindersSent`.

Push : `notifyUids([assigneeUid], titre, corps, '/corner/hygiene')` — helper existant, avec
`data.link` pour que le tap ouvre la bonne page. **L'échec du push ne doit jamais empêcher
l'email** : il est isolé dans son propre `catch`, sans quoi une panne FCM priverait le salarié
du seul canal garanti (voir section 10).

Email : nodemailer via `GMAIL_USER` / `GMAIL_APP_PASSWORD`, même pattern que les autres.

`notifiedAt` est écrit même si les deux canaux sont désactivés : le champ trace la prise en
compte de la désignation par le système, pas la réception effective d'un message.

### 5.2 `hygieneRappelsResponsables`

Planifiée `0 * * * *` — **toutes les heures** (rév. 2), `Europe/Paris`, `europe-west1`.

Le passage d'un cron à deux créneaux fixes à un cron horaire est la conséquence directe de
rendre l'heure réglable : la fonction doit pouvoir se réveiller à n'importe quelle heure pour
vérifier si un jalon correspond. 24 exécutions par jour, environ 720 par mois, contre un quota
gratuit de 2 millions — coût réel nul.

| Jalon | Défaut hebdo | Défaut mensuel | Destinataire |
|---|---|---|---|
| `rappel1` | jeudi 10h | 7 jours avant la fin du mois, 10h | responsable |
| `rappel2` | samedi 10h | 2 jours avant la fin du mois, 10h | responsable |
| `escalade` | dimanche 18h | dernier jour du mois, 18h | `escaladeDestinataires`, responsable en `cc` |

Ces valeurs ne sont que les **défauts** : jour, heure et activation de chacun se règlent dans
les Paramètres (section 3).

Pour le mensuel, « J » désigne le dernier jour du mois : `joursAvantFin: 7` tombe le 24 en
juillet, le 21 en février, le 22 en février bissextile. Le calcul se fait par soustraction
depuis la fin du mois, jamais sur un numéro de jour fixe.

Une seule fonction pour les six cas : elle calcule les périodes courantes, lit les deux
documents responsable et les deux documents `hygiene_corner`, et décide du jalon applicable.

`resolveJalon(kind, now, config)` reste une **fonction pure** (rév. 2) : la configuration lui
est passée en paramètre, jamais lue depuis Firestore. C'est ce qui permet de continuer à la
tester de façon déterministe sur février, les années bissextiles et le passage du nouvel an.

Conditions de sortie, dans cet ordre :

1. `settings/hygiene_responsables.rappelsEnabled === false` → sortie immédiate.
2. Aucun jalon **actif** ne correspond à la date et l'heure courantes → sortie.
3. La checklist de la période est **complète** au sens de la section 6 → aucun rappel pour
   cette période, y compris l'escalade.
4. Le jalon figure déjà dans `remindersSent` → ignoré.

Chaque envoi est en outre conditionné par son canal (rév. 2) : `canaux.designation`,
`canaux.rappel`, `canaux.escalade`, chacun avec ses drapeaux `email` et `push`. Le mail
« aucun responsable désigné » suit `canaux.escalade.email` — même public, même registre.

**Aucun responsable désigné** : au jalon `rappel1` uniquement, email à `escaladeDestinataires` —
« Aucun responsable désigné pour l'hygiène hebdo — semaine 31 ». Sans cela, une période non
attribuée serait entièrement silencieuse.

Dans ce cas il n'existe aucun document où inscrire le jalon. L'idempotence repose alors sur
la correspondance exacte date + heure : un seul passage de la fonction peut déclencher ce
message. Un réessai du scheduler après échec pourrait le dupliquer — un mail en double aux
encadrants, conséquence jugée acceptable au regard du coût d'un document supplémentaire.

### 5.3 `notifHygieneHebdo` / `notifHygieneMensuel` (existantes)

Conservées, mais conditionnées à **l'absence de responsable désigné pour la période, ou à des
rappels ciblés désactivés**. Filet collectif quand le nouveau système ne prend pas le relais,
silence quand il le prend. Sinon le responsable recevrait son rappel ciblé et le broadcast
général le même samedi.

La double condition est essentielle : conditionner le silence à la seule existence d'un
responsable ferait qu'un encadrant décochant « Rappels automatiques activés » — en croyant
simplement cesser de solliciter le salarié — supprimerait **tous** les rappels d'hygiène, par
tous les canaux, sans que rien à l'écran ne l'indique. Le broadcast collectif ne doit s'effacer
que devant un dispositif ciblé réellement actif.

Sans responsable, une période non faite déclenche donc deux messages distincts : le mail
« aucun responsable désigné » aux encadrants le jeudi (5.2), et le push collectif au corner le
samedi 18h. Ce n'est pas un doublon — publics et intentions différents : corriger l'oubli
d'attribution d'un côté, faire exécuter la tâche de l'autre.

Leur test `snap.exists` passe également à un test de complétude (section 6).

---

## 6. Changement de comportement — complétude

Aujourd'hui, « tâche faite » = le document `hygiene_corner/{periodId}` existe. Cocher 2 items
sur 5 et sauvegarder éteint les rappels et affiche ✅.

Nouvelle définition : **tous les items de la période sont cochés**.

```ts
const HEBDO_IDS   = ['int_frigos','etageres_materiels','support_papier','placard_hygiene','machine_glacon']
const MENSUEL_IDS = ['placard_rangement']

const isDone = (data, ids) => !!data && ids.every(id => data.items?.[id] === true)
```

Points d'appel à migrer :

- `Dashboard.tsx:200-201` — `setHygieneHebdoOk` / `setHygieneMensuelOk`
- `notifHygieneHebdo`, `notifHygieneMensuel`
- nouvelle CF `hygieneRappelsResponsables`

Les identifiants d'items sont dupliqués entre `Hygiene.tsx:68-70` et les fonctions Cloud. Les
extraire dans un module partagé côté client ; côté fonctions, les redéclarer explicitement
(pas d'import cross-package dans ce projet).

**Effet visible** : des périodes passées sauvegardées à moitié basculeront de ✅ à ❌ dans le
Dashboard et l'historique. C'est la réalité du terrain, mais l'affichage change — à annoncer
à l'équipe.

`weeklyHygieneRecap` est hors périmètre : il produit un récapitulatif de comptages, pas un
verdict fait / pas fait.

---

## 7. Règles Firestore et index

```
match /hygiene_responsables/{doc} {
  allow read:          if isAnyRole();
  allow create, update: if isPatronOrManager()
                        && permAllows('action_designer_responsable_hygiene');
  allow delete:        if false;
}
```

Le plancher `isPatronOrManager()` est ce qui rend le fail-open de `permAllows()` inoffensif
(rév. 2) : même si la clé manque dans `settings/permissions`, corner et cuisine restent bloqués
par la règle elle-même. La permission ne peut que **retirer** le droit au manager, jamais
l'accorder à un salarié — un choix assumé sur un registre HACCP.

`read` ouvert à tous les rôles : le salarié doit voir qui est responsable depuis son
Dashboard. `delete: false` : l'historique est inviolable, comme `planning_audit`.

Les fonctions Cloud écrivent `notifiedAt` et `remindersSent` via l'Admin SDK, qui contourne
les règles — inutile de les ouvrir côté client.

**Index composite** : `hygiene_responsables` — `kind ASC`, `periodStart DESC`.

---

## 8. Ordre de déploiement

1. `firebase deploy --only firestore:rules`
2. `firebase deploy --only firestore:indexes`
3. `cd functions && npm run build && cd .. && firebase deploy --only functions:onHygieneResponsableAssigned,functions:hygieneRappelsResponsables,functions:notifHygieneHebdo,functions:notifHygieneMensuel`
4. `npm run build && firebase deploy --only hosting`

Rules et index **avant** le hosting : si le client tente une écriture que les règles refusent
encore, la désignation échoue. Leçon du journal d'audit planning.

Validation en local avant tout déploiement, revue visuelle par Arthur pour les changements
d'affichage du Dashboard.

---

## 9. Hors périmètre

- Rotation automatique des responsables
- Responsable sur la checklist quotidienne
- Statistiques de complétion par salarié
- Notification de félicitation à la complétion
- Responsable sur les checklists cuisine
- Nombre de rappels variable : il reste fixé à deux plus une escalade, chacun désactivable
  (rév. 2). Ajouter un quatrième jalon supposerait une liste dynamique là où trois blocs fixes
  couvrent le besoin.
- Contrainte croisée entre jalons : rien n'empêche de placer le rappel 1 après le rappel 2
  (rév. 2). Le pire cas produit deux rappels dans un ordre inhabituel, sans conséquence.
- Autorisation de désigner accordée à corner ou cuisine : volontairement impossible, le
  plancher `isPatronOrManager()` est en dur dans les règles (rév. 2).

---

## 10. Risques

| Risque | Traitement |
|---|---|
| CF en boucle sur son propre document | Garde `before.assigneeUid === after.assigneeUid` |
| Rappels en double (CF horaire, rév. 2) | Jalons dans `remindersSent` ; correspondance exacte jour + heure |
| Double alerte ciblée + broadcast | CF existantes conditionnées à l'absence de responsable **et** aux rappels ciblés actifs |
| Réglage coupant tous les rappels sans le dire (rév. 2) | Le broadcast collectif ne s'efface que devant un ciblé actif (5.3) |
| Deux jalons sur le même créneau (rév. 2) | Le plus grave l'emporte ; avertissement orange au réglage |
| Réglages absents ou partiels (rév. 2) | Fusion champ par champ avec les défauts — comportement identique à la rév. 1 |
| Échec du push privant du mail (rév. 2) | Push isolé dans son propre `catch` — l'email est le canal garanti |
| Écriture client écrasant les champs CF | `setDoc(..., { merge: true })` |
| `undefined` envoyé à Firestore | Omettre les clés vides ; `catch` affichant l'erreur |
| Périodes passées basculant ✅ → ❌ | Attendu ; prévenir l'équipe |
| Push iOS non reçu | L'email est le canal garanti, le push est un bonus |
