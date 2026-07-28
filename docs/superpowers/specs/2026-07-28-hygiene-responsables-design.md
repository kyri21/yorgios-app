# Hygiène corner — responsable désigné par période

**Date** : 2026-07-28
**Statut** : spec validée, prêt pour plan d'implémentation

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
| Droit de désigner | patron, administrateur, manager |
| Canaux | Email **et** push **et** affichage Dashboard |
| Rappels | 2 rappels ciblés, puis escalade patron + manager |
| Stockage | Collection dédiée `hygiene_responsables` |
| Complétude | Tâche faite = **tous** les items cochés |

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
  remindersSent: string[]       // ['j-3', 'j-1', 'escalade']
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

**`remindersSent`** : la fonction de rappel tourne deux fois par jour. Sans marqueur de jalon,
chaque rappel partirait en double. Même mécanique d'idempotence que `pointages_noshow`.

### Réglages — `settings/hygiene_responsables`

```ts
{
  rappelsEnabled: boolean          // défaut true si le document est absent
  escaladeDestinataires: string[]  // emails
}
```

Si `escaladeDestinataires` est vide ou le document absent, repli sur
`settings/alert_emails.responsables` — même stratégie que les autres alertes du projet, et
garantit qu'une escalade n'est jamais envoyée dans le vide.

Les horaires des jalons restent dans le code : les rendre configurables demanderait une UI de
cron pour un réglage modifié une fois.

### Calcul des identifiants de période

Réutiliser `getISOWeek()` et `getDocId()` de `Hygiene.tsx:79-92`, qui produisent déjà
`2026-W31_hebdo` et `2026-07_mensuel`. Les fonctions Cloud recalculent la même chose côté
serveur — `notifHygieneHebdo` contient déjà ce calcul ISO.

---

## 4. Interface

### 4.1 Onglet Nettoyage — Hebdo et Mensuel (`Hygiene.tsx`)

Bloc « Responsable » au-dessus de la barre de progression, dans ces deux onglets uniquement.
Le quotidien reste collectif.

- **Encadrant** (patron / administrateur / manager) : `<select>` des comptes `users` de rôle
  `corner` + bouton *Désigner*. Si déjà désigné : nom affiché + bouton *Changer*.
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

---

## 5. Fonctions Cloud

### 5.1 `onHygieneResponsableAssigned`

Trigger : écriture sur `hygiene_responsables/{periodId}`.

```
si before.assigneeUid === after.assigneeUid  → return
sinon → email + push au nouveau responsable, écrire notifiedAt
```

Ce garde est indispensable : la fonction écrit dans le document qui la déclenche. Sans lui,
elle se rappellerait en boucle à chaque mise à jour de `remindersSent`.

Push : `notifyUids([assigneeUid], titre, corps, '/corner/hygiene')` — helper existant
(`functions/src/index.ts:1107`), avec `data.link` pour que le tap ouvre la bonne page.

Email : nodemailer via `GMAIL_USER` / `GMAIL_APP_PASSWORD`, même pattern que les autres.

### 5.2 `hygieneRappelsResponsables`

Planifiée `0 10,18 * * *`, `Europe/Paris`, `europe-west1`.

| Jalon | Hebdo | Mensuel | Destinataire |
|---|---|---|---|
| `j-3` | jeudi 10h | 7 jours avant la fin du mois, 10h | responsable |
| `j-1` | samedi 10h | 2 jours avant la fin du mois, 10h | responsable |
| `escalade` | dimanche 18h | dernier jour du mois, 18h | `escaladeDestinataires`, responsable en `cc` |

Pour le mensuel, « J » désigne le dernier jour du mois : J-7 tombe le 24 en juillet, le 21 en
février, le 22 en février bissextile. Le calcul se fait par soustraction depuis la fin du
mois, jamais sur un numéro de jour fixe.

Une seule fonction pour les six cas : elle calcule les périodes courantes, lit les deux
documents responsable et les deux documents `hygiene_corner`, et décide du jalon applicable.

Conditions de sortie, dans cet ordre :

1. `settings/hygiene_responsables.rappelsEnabled === false` → sortie immédiate.
2. Aucun jalon ne correspond à la date et l'heure courantes → sortie.
3. La checklist de la période est **complète** au sens de la section 6 → aucun rappel pour
   cette période, y compris l'escalade.
4. Le jalon figure déjà dans `remindersSent` → ignoré.

**Aucun responsable désigné** : au jalon `j-3` uniquement, email à `escaladeDestinataires` —
« Aucun responsable désigné pour l'hygiène hebdo — semaine 31 ». Sans cela, une période non
attribuée serait entièrement silencieuse.

Dans ce cas il n'existe aucun document où inscrire le jalon. L'idempotence repose alors sur
la correspondance exacte date + heure : un seul passage de la fonction peut déclencher ce
message. Un réessai du scheduler après échec pourrait le dupliquer — un mail en double aux
encadrants, conséquence jugée acceptable au regard du coût d'un document supplémentaire.

### 5.3 `notifHygieneHebdo` / `notifHygieneMensuel` (existantes)

Conservées, mais conditionnées à **l'absence de responsable désigné** pour la période. Filet
collectif quand le nouveau système n'est pas alimenté, silence quand il l'est. Sinon le
responsable recevrait son rappel ciblé et le broadcast général le même samedi.

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
  allow create, update: if isPatronOrManager();
  allow delete:        if false;
}
```

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

---

## 10. Risques

| Risque | Traitement |
|---|---|
| CF en boucle sur son propre document | Garde `before.assigneeUid === after.assigneeUid` |
| Rappels en double (CF 2×/jour) | Jalons dans `remindersSent` |
| Double alerte ciblée + broadcast | CF existantes conditionnées à l'absence de responsable |
| Écriture client écrasant les champs CF | `setDoc(..., { merge: true })` |
| `undefined` envoyé à Firestore | Omettre les clés vides ; `catch` affichant l'erreur |
| Périodes passées basculant ✅ → ❌ | Attendu ; prévenir l'équipe |
| Push iOS non reçu | L'email est le canal garanti, le push est un bonus |
