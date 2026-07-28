# Items des checklists d'hygiène — modifiables depuis Paramètres

**Date** : 2026-07-28
**Statut** : spec validée, prêt pour plan d'implémentation
**Prérequis** : la fonctionnalité « responsable désigné » est en production (`2026-07-28-hygiene-responsables-design.md`, révision 2)

---

## 1. Problème

Les items des trois checklists d'hygiène du corner — 13 quotidiens, 5 hebdomadaires, 1 mensuel — sont codés en dur. Les faire évoluer demande une intervention de développeur.

Ils sont même codés en dur à **quatre endroits** :

| Fichier | Ce qu'il contient |
|---|---|
| `src/modules/corner/pages/Hygiene.tsx` | `ITEMS` — identifiants et libellés, pour la checklist |
| `src/modules/corner/utils/hygiene.ts` | listes d'identifiants, pour la complétude côté client |
| `src/modules/corner/pages/Controle.tsx` | `HYGIENE_ITEMS` — identifiants et libellés, pour le rapport |
| `functions/src/hygiene/periods.ts` | listes d'identifiants, pour la complétude côté serveur |

Les libellés ont déjà divergé : « Intérieur vitrines libre service » dans la checklist, « Int. vitrines » dans le rapport. Ce n'est pas un défaut cosmétique — le rapport sert de preuve devant un contrôleur, et il ne nomme pas les points comme l'équipe les a cochés.

---

## 2. Décisions

| Sujet | Décision |
|---|---|
| Emplacement de l'édition | Paramètres (`/admin/settings`), section dédiée |
| Accès | patron, administrateur, manager — **déjà garanti par la route**, aucune permission à créer |
| Opérations | ajouter, renommer, réordonner, désactiver. **Pas de suppression définitive** |
| Effet sur l'historique | **aucun, jamais** — voir la règle d'éligibilité en section 4 |
| Portée | checklists corner uniquement (quotidien, hebdo, mensuel) |

### La contrainte fondatrice

Arthur, explicitement : *« Je ne veux pas que si j'ajoute un item le 29 ça me mette le mois passé en incomplet. Idem pour un item hebdo entré le mercredi, la semaine ne doit pas être affichée incomplète. »*

Tout le design découle de là. Sur un registre sanitaire, une modification de la liste ne doit **jamais** pouvoir transformer rétroactivement du travail fait en travail non fait.

---

## 3. Modèle de données

### Nouveau document `settings/hygiene_items`

```ts
type HygieneItem = {
  id: string              // immuable, généré à la création — c'est lui qui rattache l'historique
  label: string           // renommable librement
  actif: boolean          // false = retiré des futures checklists, conservé dans l'historique
  ordre: number           // ordre d'affichage, suit le parcours physique du corner
  creeLe?: Timestamp      // posé automatiquement — pilote l'éligibilité, jamais saisi
  desactiveLe?: Timestamp // posé au retrait, effacé à la réactivation
}

{
  quotidien: HygieneItem[],
  hebdo:     HygieneItem[],
  mensuel:   HygieneItem[],
}
```

`id` est un slug du libellé initial, suffixé en cas de collision. **Renommer ne le touche jamais** : c'est ce qui garantit qu'une case cochée en juin reste rattachée à son point de contrôle même si le libellé change en septembre.

Document absent ou partiel → repli sur les 19 items d'origine, codés en dur comme valeurs par défaut. Même stratégie que `settings/hygiene_responsables`.

### Champ ajouté sur `hygiene_corner/{periodId}`

```ts
{
  items: { plats_service: true, … },    // existant
  itemsAttendus: ['plats_service', …],  // NOUVEAU
}
```

`itemsAttendus` enregistre ce qui était demandé pour cette période. C'est la trace HACCP : un contrôleur voit exactement ce qui était exigé à chaque date, sans dépendre de l'état courant des réglages.

**Écrit à la première sauvegarde de la période, jamais modifié ensuite.** Rouvrir et resauvegarder une checklist ne fait pas bouger sa liste attendue.

---

## 4. La règle d'éligibilité

**Un item ne s'applique qu'aux périodes qui commencent après sa création.**

```
item éligible pour la période P  ⟺  il était actif au début de P
                                 ⟺  creeLe < P.début
                                     ET (actif  OU  desactiveLe ≥ P.début)
```

**Une date illisible n'est jamais rétroactive.** `creeLe` absent signifie « item d'origine, antérieur à tout » et reste éligible partout. Une valeur corrompue — édition manuelle, migration ratée, sérialisation inattendue — est en revanche traitée comme une création à l'instant présent : elle ne peut donc apparaître dans aucune période passée. En cas de doute sur une date, le doute profite à l'historique.

Le début de période, selon le type :

| Type | Début |
|---|---|
| quotidien | le jour même à 00:00 |
| hebdo | lundi 00:00 de la semaine ISO |
| mensuel | 1er du mois à 00:00 |

Conséquences, dans les termes exacts du besoin :

- Item ajouté le **29 juillet** → compte à partir du **1er août**. Juillet et tous les mois antérieurs sont intouchés.
- Item hebdo ajouté un **mercredi** → compte à partir du **lundi suivant**. La semaine en cours garde ses items, qu'elle soit déjà sauvegardée ou non.
- Item quotidien ajouté **aujourd'hui** → compte à partir de **demain**.

Les 19 items d'origine n'ont pas de `creeLe` : absent = toujours éligible. Ils précèdent toute modification.

### Trois protections superposées

C'est volontairement redondant, parce qu'une seule de ces protections laisserait un trou :

1. **L'éligibilité par date** empêche un nouvel item de toucher une période déjà commencée.
2. **`itemsAttendus` figé à la première sauvegarde** empêche une resauvegarde de rebattre les cartes en cours de période.
3. **Le repli des documents anciens sur les 19 items d'origine** — et non sur la liste courante — met tout l'historique existant définitivement à l'abri. C'est la protection la plus importante : sans elle, le premier ajout d'item aurait basculé d'un coup tout le passé en incomplet.

### La contrepartie, assumée

Un item ajouté ne peut pas s'appliquer immédiatement, même si on le voulait. C'est le prix de la garantie demandée, et il est juste : un point de nettoyage qui apparaît en cours de semaine n'a pas pu être fait en début de semaine.

La désactivation suit la même logique — retirer un item n'allège pas une période déjà commencée.

---

## 5. Interface — section Paramètres

Nouvelle section « **Nettoyage — items des checklists** », en trois blocs repliables (Quotidien, Hebdo, Mensuel), reprenant le pattern de la section « Nettoyage — responsables ».

Chaque item sur une ligne :
```
↑ ↓   [ Plats de service                    ]   ☑ actif
```
- `↑ ↓` pour l'ordre, `minHeight: 44`
- champ de libellé éditable en place
- interrupteur actif

Un bouton « **+ Ajouter un item** » en bas de chaque bloc. Les items désactivés descendent dans un sous-groupe grisé « Retirés », avec un bouton « Réactiver ».

**Boutons `↑ ↓` plutôt que glisser-déposer** : le glisser-déposer dans une page qui défile, sur iPhone, est une source constante de frustration, pour une liste réordonnée trois fois par an.

**Mention sous chaque bloc** : « Un item ajouté aujourd'hui comptera à partir de la prochaine période. Les périodes en cours et passées ne changent pas. » La règle doit se lire au moment du réglage, pas se découvrir à l'usage.

**Accès** : la route `/admin/settings` est déjà réservée à patron, administrateur et manager. Aucune permission à créer.

---

## 6. Qui lit quoi

| Écran | Lecture supplémentaire |
|---|---|
| Checklist (`Hygiene.tsx`) | `settings/hygiene_items` — affiche les items ; écrit `itemsAttendus` à la première sauvegarde |
| Dashboard corner | **aucune** — juge chaque période sur l'`itemsAttendus` de son propre document |
| Fonctions Cloud | **aucune** — même mécanisme |
| Rapport de contrôle (`Controle.tsx`) | `settings/hygiene_items` pour les libellés ; l'`itemsAttendus` de chaque document pour ce qui était exigé |

Deux consommateurs sur quatre n'ont **aucune lecture supplémentaire**, y compris la fonction planifiée qui s'exécute toutes les heures. C'est la conséquence directe du choix de la section 3 : le document de checklist se suffit à lui-même.

### Ce que la checklist affiche

- Période **déjà sauvegardée** (le document porte `itemsAttendus`) → afficher exactement ces items, dans l'ordre des réglages, libellés courants. Ce qui est affiché est ce qui est jugé.
- Période **non encore sauvegardée** → afficher les items actifs et éligibles pour cette période.

Les libellés des items retirés restent disponibles : la désactivation les conserve dans le document de réglages. C'est pourquoi il n'y a pas de suppression définitive.

**Identifiant introuvable.** Si un `itemsAttendus` référence un identifiant absent des réglages — édition manuelle du document dans la console, restauration partielle — la ligne s'affiche avec l'identifiant brut plutôt que de disparaître. Une case cochée qui s'évapore d'un registre HACCP est pire qu'un libellé disgracieux.

---

## 7. Ce que ça supprime

`Controle.tsx` et `Hygiene.tsx` cessent de définir leurs propres listes : ils lisent les réglages.

`utils/hygiene.ts` et `functions/src/hygiene/periods.ts` **conservent** les 19 items d'origine, mais leur rôle change et leur nom doit le dire : ce ne sont plus « les items », ce sont **les items d'origine, gelés**, servant uniquement de repli pour les documents antérieurs à cette évolution. Renommer `QUOTIDIEN_IDS` en `ITEMS_ORIGINE_QUOTIDIEN` (et de même pour les deux autres) empêche qu'on les reprenne un jour pour autre chose. Ils ne doivent plus jamais être modifiés : toute évolution passe désormais par les réglages.

La duplication client / fonctions reste celle déjà assumée sur ce projet, et devient inoffensive : une liste gelée ne peut plus diverger.

La divergence de libellés entre la checklist et le rapport de contrôle disparaît mécaniquement : les deux lisent la même source.

---

## 8. Hors périmètre

- Checklists cuisine — seul le corner a des checklists d'hygiène structurées.
- Suppression définitive d'un item : volontairement impossible, l'historique doit rester lisible.
- Date d'entrée en vigueur saisie à la main : elle est calculée, jamais choisie. Un réglage de moins à comprendre.
- Items conditionnels (saisonniers, par jour de semaine) : aucun besoin exprimé.
- Réordonnancement par glisser-déposer.

---

## 9. Risques

| Risque | Traitement |
|---|---|
| Un ajout rend l'historique incomplet | Éligibilité par date + `itemsAttendus` figé + repli sur les 19 items d'origine |
| Une resauvegarde rebat les cartes en cours de période | `itemsAttendus` écrit une seule fois, à la première sauvegarde |
| Un renommage détache l'historique | L'`id` est immuable ; seul le `label` change |
| Un libellé devient introuvable pour une période passée | Pas de suppression définitive — les items retirés restent dans les réglages |
| Collision d'identifiants à la création | Slug suffixé, unicité vérifiée sur les trois listes |
| `undefined` envoyé à Firestore | Champs toujours renseignés à la création d'un item |
| Item ajouté juste avant la fin d'une période | Ne s'applique qu'à la période suivante — le cas ne peut pas se produire |
