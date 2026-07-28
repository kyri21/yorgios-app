# Hygiène corner — responsable désigné : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à un encadrant de désigner un salarié corner responsable de la checklist d'hygiène hebdomadaire et mensuelle, le notifier par email et push, afficher sa tâche sur son tableau de bord, le relancer s'il ne l'a pas faite, et conserver l'historique des désignations.

**Architecture:** Une collection Firestore dédiée `hygiene_responsables` (un document par période) stocke la désignation sans toucher à la convention existante « le document `hygiene_corner` existe = la tâche est faite ». Toute la date math (identifiants de période, bornes, jalons de rappel) est extraite dans des modules purs testés par vitest, dupliqués côté client et côté fonctions Cloud car ce projet n'a pas d'import cross-package.

**Tech Stack:** React 18 + TypeScript + Vite · Firebase Firestore (DB `test`) + Cloud Functions Node 22 (europe-west1) · nodemailer + FCM · vitest (ajouté par ce plan)

## Global Constraints

- Projet Firebase unique `cuisine-yorgios`, base Firestore `test`. Jamais d'`initializeApp()` hors de `src/firebase/config.ts`.
- Imports client uniquement depuis `src/firebase/config.ts` (`db`, `auth`, `functions`).
- Rôle `administrateur` = alias de `patron` : partout où `patron` est vérifié, inclure `administrateur`.
- **Jamais de valeur `undefined` envoyée à Firestore** — `src/firebase/config.ts` n'active pas `ignoreUndefinedProperties`. Omettre la clé.
- **Toute écriture Firestore côté client a un `catch` qui affiche l'erreur à l'écran.** Un `try/finally` sans `catch` produit un bouton qui « ne marche pas ».
- `setDoc` sur `hygiene_responsables` toujours avec `{ merge: true }` : les fonctions Cloud écrivent d'autres champs du même document.
- Design system Aegean Precision **light mode uniquement**. Variables CSS : `--surface`, `--surface-low`, `--surface-mid`, `--primary` (`#004275`), `--on-surface`, `--on-surface-2`, `--on-surface-3`, `--success`, `--warning`, `--danger`, `--border`, `--border-soft`. Polices Epilogue (titres) + Manrope (corps). Cibles tactiles 44×44px minimum. Zéro fond sombre.
- Fonctions Cloud : région `europe-west1`, fuseau `Europe/Paris`.
- Build fonctions obligatoire avant déploiement : `cd functions && npm run build`.
- Ordre de déploiement : `firestore:rules` et `firestore:indexes` **avant** `hosting`.
- Spec de référence : `docs/superpowers/specs/2026-07-28-hygiene-responsables-design.md`

---

## Structure des fichiers

**Créés**

| Fichier | Responsabilité |
|---|---|
| `vitest.config.ts` | Configuration des tests, couvre `src/` et `functions/src/` |
| `src/modules/corner/utils/hygiene.ts` | Logique pure client : identifiants d'items, identifiants et bornes de période, test de complétude |
| `src/modules/corner/utils/hygiene.test.ts` | Tests de la logique pure client |
| `src/modules/corner/firebase/hygieneResponsables.ts` | Accès Firestore à `hygiene_responsables` : lecture, désignation, historique |
| `src/modules/corner/components/ResponsableSelector.tsx` | Bloc UI « Responsable » des onglets Hebdo et Mensuel |
| `functions/src/hygiene/periods.ts` | Logique pure serveur : identifiants de période, résolution des jalons, complétude |
| `functions/src/hygiene/periods.test.ts` | Tests de la logique pure serveur |

**Modifiés**

| Fichier | Changement |
|---|---|
| `package.json` | Dépendance `vitest` + scripts `test` / `test:watch` |
| `functions/tsconfig.json` | Exclure les fichiers `*.test.ts` de la compilation |
| `firestore.rules` | Règles de `hygiene_responsables` |
| `firestore.indexes.json` | Index `kind ASC + periodStart DESC` |
| `src/modules/corner/pages/Hygiene.tsx` | Utilise les utils partagés, insère le sélecteur, section historique |
| `src/modules/corner/pages/Dashboard.tsx` | Complétude au lieu d'existence, noms des responsables sur les lignes |
| `src/pages/AdminSettings.tsx` | Section « Nettoyage — responsables » |
| `functions/src/index.ts` | 2 nouvelles fonctions, 2 fonctions existantes conditionnées |

---

## ⚠️ Bug préexistant corrigé par la Tâche 1

`Hygiene.tsx:86-92` construit l'identifiant de la semaine avec `d.getFullYear()`, c'est-à-dire l'année **civile** de la date consultée, alors que le numéro de semaine renvoyé par `getISOWeek()` est une semaine **ISO**. Les deux divergent aux frontières d'année.

Exemple concret, semaine ISO 53 de 2026 (du lundi 28 décembre 2026 au dimanche 3 janvier 2027) :

| Jour consulté | Identifiant produit aujourd'hui |
|---|---|
| jeudi 31 décembre 2026 | `2026-W53_hebdo` |
| vendredi 1er janvier 2027 | `2027-W53_hebdo` |

La même semaine de travail s'écrit donc dans **deux documents différents** selon le jour où l'on ouvre l'application : la checklist paraît vide le 1er janvier, et les rappels partent alors qu'elle a été faite.

La Tâche 1 introduit `getISOWeekYear()`, qui prend l'année du jeudi de la semaine ISO. Nouvel identifiant unique : `2026-W53_hebdo` toute la semaine.

**Impact sur les données existantes** : seules les semaines à cheval sur un 31 décembre sont concernées. L'application est en production depuis 2026 et n'a pas encore franchi de fin d'année — aucun document existant n'est orphelinisé. La correction est donc gratuite si elle est faite maintenant, et coûteuse plus tard.

---

## Tâche 1 : Logique pure client + vitest

**Files:**
- Create: `vitest.config.ts`
- Create: `src/modules/corner/utils/hygiene.ts`
- Test: `src/modules/corner/utils/hygiene.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: rien (première tâche)
- Produces:
  - `type HygieneKind = 'hebdo' | 'mensuel'`
  - `QUOTIDIEN_IDS: string[]`, `HEBDO_IDS: string[]`, `MENSUEL_IDS: string[]`
  - `itemIdsFor(kind: HygieneKind): string[]`
  - `getISOWeek(d: Date): number`
  - `getISOWeekYear(d: Date): number`
  - `getPeriodId(kind: HygieneKind, ref: Date): string`
  - `getPeriodBounds(kind: HygieneKind, ref: Date): { start: Date; end: Date }`
  - `isHygieneDone(items: Record<string, boolean> | undefined | null, ids: string[]): boolean`

- [ ] **Step 1 : Installer vitest**

```bash
npm install --save-dev vitest@^2.1.0
```

- [ ] **Step 2 : Créer la configuration vitest**

Créer `vitest.config.ts` :

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Couvre le client ET les fonctions Cloud : la date math est dupliquée
    // des deux côtés (pas d'import cross-package dans ce projet) et les deux
    // copies doivent rester d'accord.
    include: ['src/**/*.test.ts', 'functions/src/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 3 : Ajouter les scripts npm**

Dans `package.json`, section `scripts`, ajouter après `"preview"` :

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

- [ ] **Step 4 : Écrire les tests qui échouent**

Créer `src/modules/corner/utils/hygiene.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import {
  QUOTIDIEN_IDS, HEBDO_IDS, MENSUEL_IDS,
  itemIdsFor, getISOWeek, getISOWeekYear,
  getPeriodId, getPeriodBounds, isHygieneDone,
} from './hygiene'

// Construit une date locale à midi : évite qu'un décalage de fuseau
// fasse basculer la date d'un jour.
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0)

describe('listes d’items', () => {
  it('contient 13 items quotidiens, 5 hebdo, 1 mensuel', () => {
    expect(QUOTIDIEN_IDS).toHaveLength(13)
    expect(HEBDO_IDS).toHaveLength(5)
    expect(MENSUEL_IDS).toHaveLength(1)
  })

  it('itemIdsFor renvoie la bonne liste', () => {
    expect(itemIdsFor('hebdo')).toEqual(HEBDO_IDS)
    expect(itemIdsFor('mensuel')).toEqual(MENSUEL_IDS)
  })
})

describe('getISOWeek', () => {
  it('numérote la première semaine de 2026', () => {
    expect(getISOWeek(at(2026, 1, 1))).toBe(1)
  })

  it('numérote le 28 juillet 2026 en semaine 31', () => {
    expect(getISOWeek(at(2026, 7, 28))).toBe(31)
  })

  it('rattache le 1er janvier 2027 à la semaine 53 de 2026', () => {
    expect(getISOWeek(at(2027, 1, 1))).toBe(53)
  })
})

describe('getISOWeekYear', () => {
  it('rend l’année civile en milieu d’année', () => {
    expect(getISOWeekYear(at(2026, 7, 28))).toBe(2026)
  })

  it('rend 2026 pour le 1er janvier 2027 (semaine ISO 53 de 2026)', () => {
    expect(getISOWeekYear(at(2027, 1, 1))).toBe(2026)
  })

  it('rend 2026 pour le 31 décembre 2026', () => {
    expect(getISOWeekYear(at(2026, 12, 31))).toBe(2026)
  })
})

describe('getPeriodId', () => {
  it('produit un identifiant hebdo lisible', () => {
    expect(getPeriodId('hebdo', at(2026, 7, 28))).toBe('2026-W31_hebdo')
  })

  it('produit un identifiant mensuel lisible', () => {
    expect(getPeriodId('mensuel', at(2026, 7, 28))).toBe('2026-07_mensuel')
  })

  // Le cœur de la correction : la même semaine ISO doit produire le même
  // identifiant des deux côtés du 31 décembre.
  it('donne le même identifiant hebdo de part et d’autre du nouvel an', () => {
    const avant = getPeriodId('hebdo', at(2026, 12, 31))
    const apres = getPeriodId('hebdo', at(2027, 1, 1))
    expect(avant).toBe('2026-W53_hebdo')
    expect(apres).toBe(avant)
  })

  it('remplit le numéro de semaine sur deux chiffres', () => {
    expect(getPeriodId('hebdo', at(2026, 1, 8))).toBe('2026-W02_hebdo')
  })
})

describe('getPeriodBounds', () => {
  it('borne la semaine du lundi au dimanche', () => {
    const { start, end } = getPeriodBounds('hebdo', at(2026, 7, 30)) // un jeudi
    expect(start.getDate()).toBe(27)   // lundi 27 juillet
    expect(start.getHours()).toBe(0)
    expect(end.getDate()).toBe(2)      // dimanche 2 août
    expect(end.getMonth()).toBe(7)     // août = index 7
    expect(end.getHours()).toBe(23)
  })

  it('borne le mois du 1er au dernier jour', () => {
    const { start, end } = getPeriodBounds('mensuel', at(2026, 2, 15))
    expect(start.getDate()).toBe(1)
    expect(end.getDate()).toBe(28)     // février 2026 : 28 jours
  })

  it('gère février bissextile', () => {
    const { end } = getPeriodBounds('mensuel', at(2028, 2, 15))
    expect(end.getDate()).toBe(29)
  })
})

describe('isHygieneDone', () => {
  it('est faux si aucun item', () => {
    expect(isHygieneDone(undefined, HEBDO_IDS)).toBe(false)
    expect(isHygieneDone(null, HEBDO_IDS)).toBe(false)
  })

  it('est faux si la checklist est partielle', () => {
    const items = { int_frigos: true, support_papier: true }
    expect(isHygieneDone(items, HEBDO_IDS)).toBe(false)
  })

  it('est vrai si tous les items sont cochés', () => {
    const items = Object.fromEntries(HEBDO_IDS.map(id => [id, true]))
    expect(isHygieneDone(items, HEBDO_IDS)).toBe(true)
  })

  it('ignore les items décochés explicitement', () => {
    const items = Object.fromEntries(HEBDO_IDS.map(id => [id, true]))
    items[HEBDO_IDS[0]] = false
    expect(isHygieneDone(items, HEBDO_IDS)).toBe(false)
  })

  it('ignore les clés étrangères à la liste', () => {
    const items = Object.fromEntries(HEBDO_IDS.map(id => [id, true]))
    items.item_inconnu = false
    expect(isHygieneDone(items, HEBDO_IDS)).toBe(true)
  })
})
```

- [ ] **Step 5 : Lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./hygiene"`

- [ ] **Step 6 : Écrire l'implémentation**

Créer `src/modules/corner/utils/hygiene.ts` :

```ts
export type HygieneKind = 'hebdo' | 'mensuel'

export const QUOTIDIEN_IDS = [
  'plats_service', 'int_vitrines', 'ustensiles', 'meuble_vente',
  'comptoir_balance', 'micro_ondes', 'evier_papier', 'etiquettes',
  'plan_travail', 'ext_placards', 'ext_frigo', 'poubelle', 'vitres',
]

export const HEBDO_IDS = [
  'int_frigos', 'etageres_materiels', 'support_papier',
  'placard_hygiene', 'machine_glacon',
]

export const MENSUEL_IDS = ['placard_rangement']

export function itemIdsFor(kind: HygieneKind): string[] {
  return kind === 'hebdo' ? HEBDO_IDS : MENSUEL_IDS
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Décale une date sur le jeudi de sa semaine ISO — la semaine ISO est
 *  définie par le jeudi qu'elle contient. */
function thursdayOfISOWeek(d: Date): Date {
  const date = new Date(d)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7))
  return date
}

export function getISOWeek(d: Date): number {
  const thursday = thursdayOfISOWeek(d)
  const week1 = new Date(thursday.getFullYear(), 0, 4)
  return 1 + Math.round(
    ((thursday.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7
  )
}

/** Année ISO : celle du jeudi de la semaine, pas celle du jour consulté.
 *  Sans ça, le 1er janvier 2027 produirait « 2027-W53 » alors qu'il
 *  appartient à la semaine 53 de 2026. */
export function getISOWeekYear(d: Date): number {
  return thursdayOfISOWeek(d).getFullYear()
}

export function getPeriodId(kind: HygieneKind, ref: Date): string {
  if (kind === 'hebdo') {
    return `${getISOWeekYear(ref)}-W${pad(getISOWeek(ref))}_hebdo`
  }
  return `${ref.getFullYear()}-${pad(ref.getMonth() + 1)}_mensuel`
}

export function getPeriodBounds(kind: HygieneKind, ref: Date): { start: Date; end: Date } {
  if (kind === 'hebdo') {
    const dow = ref.getDay() === 0 ? 6 : ref.getDay() - 1 // lundi = 0
    const start = new Date(ref)
    start.setDate(ref.getDate() - dow)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    end.setHours(23, 59, 59, 999)
    return { start, end }
  }
  const start = new Date(ref.getFullYear(), ref.getMonth(), 1, 0, 0, 0, 0)
  // Jour 0 du mois suivant = dernier jour du mois courant.
  const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59, 999)
  return { start, end }
}

/** Une période est faite quand TOUS ses items sont cochés.
 *  L'ancienne convention « le document existe » comptait une checklist
 *  remplie à 2/5 comme terminée. */
export function isHygieneDone(
  items: Record<string, boolean> | undefined | null,
  ids: string[],
): boolean {
  if (!items) return false
  return ids.every(id => items[id] === true)
}
```

- [ ] **Step 7 : Lancer les tests pour vérifier qu'ils passent**

Run: `npm test`
Expected: PASS — 17 tests passés

- [ ] **Step 8 : Vérifier que le typage global reste correct**

Run: `npm run build`
Expected: build réussi, aucune erreur TypeScript

- [ ] **Step 9 : Commit**

```bash
git add vitest.config.ts package.json package-lock.json src/modules/corner/utils/hygiene.ts src/modules/corner/utils/hygiene.test.ts
git commit -m "feat(hygiene): logique pure de période + vitest

Extrait la date math des checklists hygiène dans un module testé.
Corrige au passage l'identifiant de semaine ISO : l'année était prise
sur le jour consulté, ce qui coupait en deux la semaine à cheval sur
le 31 décembre."
```

---

## Tâche 2 : Collection Firestore, règles et index

**Files:**
- Create: `src/modules/corner/firebase/hygieneResponsables.ts`
- Modify: `firestore.rules`
- Modify: `firestore.indexes.json`

**Interfaces:**
- Consumes: `HygieneKind`, `getPeriodId`, `getPeriodBounds` (Tâche 1)
- Produces:
  - `type HygieneResponsable` (voir code ci-dessous)
  - `loadResponsable(kind: HygieneKind, ref: Date): Promise<HygieneResponsable | null>`
  - `assignResponsable(args: AssignArgs): Promise<void>`
  - `loadResponsableHistory(kind: HygieneKind, max?: number): Promise<HygieneResponsable[]>`
  - `loadCornerUsers(): Promise<CornerUser[]>` avec `type CornerUser = { uid: string; displayName: string; email: string }`

- [ ] **Step 1 : Créer la couche d'accès Firestore**

Créer `src/modules/corner/firebase/hygieneResponsables.ts` :

```ts
import {
  Timestamp, arrayUnion, collection, doc, getDoc, getDocs,
  limit as fsLimit, orderBy, query, setDoc, where,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { getPeriodBounds, getPeriodId, type HygieneKind } from '../utils/hygiene'

export type PreviousAssignee = { uid: string; name: string; until: Timestamp }

export type HygieneResponsable = {
  periodId: string
  kind: HygieneKind
  periodStart: Timestamp
  periodEnd: Timestamp
  assigneeUid: string
  assigneeName: string
  assigneeEmail: string
  assignedBy: string
  assignedByName: string
  assignedAt: Timestamp
  previousAssignees?: PreviousAssignee[]
  notifiedAt?: Timestamp | null
  remindersSent?: string[]
  escalatedAt?: Timestamp | null
}

export type CornerUser = { uid: string; displayName: string; email: string }

const COL = 'hygiene_responsables'

export async function loadResponsable(
  kind: HygieneKind,
  ref: Date,
): Promise<HygieneResponsable | null> {
  const snap = await getDoc(doc(db, COL, getPeriodId(kind, ref)))
  return snap.exists() ? (snap.data() as HygieneResponsable) : null
}

export type AssignArgs = {
  kind: HygieneKind
  ref: Date
  assignee: CornerUser
  assignedBy: string
  assignedByName: string
  /** Titulaire actuel, s'il y en a un — archivé dans previousAssignees. */
  current?: HygieneResponsable | null
}

export async function assignResponsable(args: AssignArgs): Promise<void> {
  const { kind, ref, assignee, assignedBy, assignedByName, current } = args
  const periodId = getPeriodId(kind, ref)
  const { start, end } = getPeriodBounds(kind, ref)

  // Aucune valeur undefined : Firestore n'a pas ignoreUndefinedProperties ici.
  const payload: Record<string, unknown> = {
    periodId,
    kind,
    periodStart: Timestamp.fromDate(start),
    periodEnd: Timestamp.fromDate(end),
    assigneeUid: assignee.uid,
    assigneeName: assignee.displayName,
    assigneeEmail: assignee.email,
    assignedBy,
    assignedByName,
    assignedAt: Timestamp.now(),
  }

  // Réaffectation : on archive l'ancien titulaire et on remet les rappels
  // à zéro, pour que le nouveau reçoive bien ceux qui restent.
  if (current && current.assigneeUid && current.assigneeUid !== assignee.uid) {
    payload.previousAssignees = arrayUnion({
      uid: current.assigneeUid,
      name: current.assigneeName,
      until: Timestamp.now(),
    })
    payload.remindersSent = []
    payload.escalatedAt = null
  }

  await setDoc(doc(db, COL, periodId), payload, { merge: true })
}

export async function loadResponsableHistory(
  kind: HygieneKind,
  max = 12,
): Promise<HygieneResponsable[]> {
  const snap = await getDocs(query(
    collection(db, COL),
    where('kind', '==', kind),
    orderBy('periodStart', 'desc'),
    fsLimit(max),
  ))
  return snap.docs.map(d => d.data() as HygieneResponsable)
}

/** Comptes pouvant être désignés responsables : rôle corner uniquement.
 *  Les comptes techniques iPad et planning sont exclus — ce sont des
 *  appareils partagés, pas des personnes joignables. */
const COMPTES_TECHNIQUES = ['ipad@yorgios.fr', 'ipad.cuisine@yorgios.fr', 'planning@yorgios.fr']

export async function loadCornerUsers(): Promise<CornerUser[]> {
  const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'corner')))
  return snap.docs
    .map(d => {
      const data = d.data() as any
      return {
        uid: d.id,
        displayName: data.displayName || data.email || '—',
        email: data.email || '',
      }
    })
    .filter(u => u.email && !COMPTES_TECHNIQUES.includes(u.email))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'))
}
```

- [ ] **Step 2 : Ajouter les règles Firestore**

Dans `firestore.rules`, section `// ─── Corner ───`, juste après le bloc `match /hygiene_corner/{doc}` (ligne 124-126) :

```
    match /hygiene_responsables/{doc} {
      // Lecture ouverte : le salarié doit voir qui est responsable
      // depuis son tableau de bord.
      allow read: if isAnyRole();
      allow create, update: if isPatronOrManager();
      // Historique inviolable, même pour le patron — comme planning_audit.
      allow delete: if false;
    }
```

- [ ] **Step 3 : Ajouter l'index composite**

Dans `firestore.indexes.json`, ajouter dans le tableau `indexes` :

```json
    {
      "collectionGroup": "hygiene_responsables",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "kind", "order": "ASCENDING" },
        { "fieldPath": "periodStart", "order": "DESCENDING" }
      ]
    }
```

- [ ] **Step 4 : Vérifier le typage**

Run: `npm run build`
Expected: build réussi

- [ ] **Step 5 : Déployer règles et index**

Les règles doivent précéder tout code qui écrit dans la collection, sinon la
désignation sera refusée.

```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

Expected: `Deploy complete!` pour les deux. L'index passe en statut *Building*
dans la console — quelques minutes avant d'être interrogeable.

- [ ] **Step 6 : Commit**

```bash
git add src/modules/corner/firebase/hygieneResponsables.ts firestore.rules firestore.indexes.json
git commit -m "feat(hygiene): collection hygiene_responsables, règles et index

Un document par période, delete interdit — l'historique des
désignations est inviolable."
```

---

## Tâche 3 : Sélecteur de responsable dans l'onglet Nettoyage

**Files:**
- Create: `src/modules/corner/components/ResponsableSelector.tsx`
- Modify: `src/modules/corner/pages/Hygiene.tsx`

**Interfaces:**
- Consumes: `HygieneKind`, `itemIdsFor` (Tâche 1) · `loadResponsable`, `assignResponsable`, `loadCornerUsers`, `HygieneResponsable`, `CornerUser` (Tâche 2)
- Produces: composant `<ResponsableSelector kind date canEdit onAssigned />`

- [ ] **Step 1 : Créer le composant**

Créer `src/modules/corner/components/ResponsableSelector.tsx` :

```tsx
import { useEffect, useState } from 'react'
import { auth } from '../../../firebase/config'
import type { HygieneKind } from '../utils/hygiene'
import {
  assignResponsable, loadCornerUsers, loadResponsable,
  type CornerUser, type HygieneResponsable,
} from '../firebase/hygieneResponsables'

type Props = {
  kind: HygieneKind
  /** Date de référence de la période affichée (suit le sélecteur de date). */
  date: Date
  /** patron / administrateur / manager */
  canEdit: boolean
  /** Nom affiché de l'utilisateur courant, pour tracer qui a désigné. */
  currentUserName: string
  onAssigned?: () => void
}

export default function ResponsableSelector({
  kind, date, canEdit, currentUserName, onAssigned,
}: Props) {
  const [resp, setResp]         = useState<HygieneResponsable | null>(null)
  const [users, setUsers]       = useState<CornerUser[]>([])
  const [choix, setChoix]       = useState('')
  const [editing, setEditing]   = useState(false)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  const dateKey = date.toISOString().slice(0, 10)

  useEffect(() => {
    let annule = false
    setLoading(true); setError(''); setEditing(false)
    loadResponsable(kind, date)
      .then(r => { if (!annule) { setResp(r); setChoix(r?.assigneeUid ?? '') } })
      .catch(e => { if (!annule) setError(e?.message || 'Chargement impossible') })
      .finally(() => { if (!annule) setLoading(false) })
    return () => { annule = true }
  }, [kind, dateKey])

  useEffect(() => {
    if (!canEdit) return
    loadCornerUsers().then(setUsers).catch(e => setError(e?.message || ''))
  }, [canEdit])

  async function handleAssign() {
    const assignee = users.find(u => u.uid === choix)
    if (!assignee) { setError('Sélectionnez un salarié'); return }
    setSaving(true); setError('')
    try {
      await assignResponsable({
        kind, ref: date, assignee,
        assignedBy: auth.currentUser?.uid || '',
        assignedByName: currentUserName,
        current: resp,
      })
      const frais = await loadResponsable(kind, date)
      setResp(frais); setEditing(false)
      onAssigned?.()
    } catch (e: any) {
      // Jamais d'échec silencieux : le bandeau rouge est la seule preuve
      // visible qu'une écriture Firestore a été refusée.
      setError(e?.message || 'Enregistrement impossible')
    } finally {
      setSaving(false)
    }
  }

  const estMoi = resp?.assigneeUid && resp.assigneeUid === auth.currentUser?.uid

  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <p className="section-label" style={{ marginBottom: 8 }}>Responsable</p>

      {loading ? (
        <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: 0 }}>Chargement…</p>
      ) : resp && !editing ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--on-surface)', margin: 0 }}>
              {resp.assigneeName}
              {estMoi && (
                <span style={{
                  marginLeft: 8, fontSize: 11, fontWeight: 700, color: 'var(--primary)',
                  background: 'rgba(0,66,117,0.10)', padding: '2px 8px', borderRadius: 99,
                }}>toi</span>
              )}
            </p>
            <p style={{ fontSize: 11, color: 'var(--on-surface-3)', margin: '3px 0 0' }}>
              Désigné par {resp.assignedByName}
            </p>
          </div>
          {canEdit && (
            <button
              onClick={() => setEditing(true)}
              style={{
                minHeight: 44, padding: '0 14px', borderRadius: 10, border: 'none',
                background: 'var(--surface-mid)', color: 'var(--primary)',
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
                fontFamily: 'Manrope, sans-serif', whiteSpace: 'nowrap',
              }}
            >
              Changer
            </button>
          )}
        </div>
      ) : canEdit ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <select
            className="input-filled"
            value={choix}
            onChange={e => setChoix(e.target.value)}
            style={{ minHeight: 44 }}
          >
            <option value="">— Choisir un salarié —</option>
            {users.map(u => (
              <option key={u.uid} value={u.uid}>{u.displayName}</option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleAssign} disabled={saving || !choix} className="btn-primary" style={{ flex: 1 }}>
              {saving ? 'Enregistrement…' : 'Désigner'}
            </button>
            {resp && (
              <button
                onClick={() => { setEditing(false); setChoix(resp.assigneeUid) }}
                className="btn-secondary"
                style={{ minHeight: 44 }}
              >
                Annuler
              </button>
            )}
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: 0 }}>
          Aucun responsable désigné
        </p>
      )}

      {error && (
        <div style={{
          marginTop: 10, padding: '10px 12px', borderRadius: 10,
          background: 'rgba(192,57,43,0.08)', color: 'var(--danger)',
          fontSize: 12, fontWeight: 600,
        }}>
          ⚠️ {error}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2 : Brancher le composant dans Hygiene.tsx**

Dans `src/modules/corner/pages/Hygiene.tsx` :

Remplacer les imports du haut du fichier (lignes 1-4) par :

```tsx
import { useEffect, useState } from 'react'
import { Timestamp, doc, getDoc, setDoc } from 'firebase/firestore'
import { db, auth } from '../../../firebase/config'
import { useToast } from '../../../hooks/useToast'
import { useAuth } from '../../../auth/useAuth'
import ResponsableSelector from '../components/ResponsableSelector'
```

Supprimer les déclarations locales devenues redondantes — `getISOWeek` (lignes 79-84) et les constantes `QUOTIDIEN_IDS` / `HEBDO_IDS` / `MENSUEL_IDS` (lignes 68-70) — et les importer depuis les utils partagés :

```tsx
import {
  QUOTIDIEN_IDS, HEBDO_IDS, MENSUEL_IDS,
  getISOWeek, getISOWeekYear,
} from '../utils/hygiene'
```

Remplacer `getDocId` (lignes 86-92) pour utiliser l'année ISO :

```tsx
function getDocId(type: CheckType, dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const p = (n: number) => String(n).padStart(2, '0')
  if (type === 'quotidien') return `${dateStr}_quotidien`
  if (type === 'hebdo') return `${getISOWeekYear(d)}-W${p(getISOWeek(d))}_hebdo`
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}_mensuel`
}
```

Dans le composant `Hygiene()`, après `const { show } = useToast()` :

```tsx
  const { user } = useAuth()
  const canEditResponsable = ['patron', 'administrateur', 'manager'].includes(user?.role ?? '')
  const currentUserName = user?.displayName || user?.email || '—'
```

Insérer le sélecteur **juste avant** le bloc « Barre de progression »
(actuellement ligne 356, `{/* ── Barre de progression ─── */}`) :

```tsx
          {(tab === 'hebdo' || tab === 'mensuel') && (
            <ResponsableSelector
              kind={tab}
              date={new Date(selectedDate + 'T12:00:00')}
              canEdit={canEditResponsable}
              currentUserName={currentUserName}
            />
          )}
```

- [ ] **Step 3 : Vérifier le typage**

Run: `npm run build`
Expected: build réussi.

`useAuth()` renvoie `{ user: UserProfile | null; loading: boolean }` — la
déstructuration `const { user } = useAuth()` et les accès `user?.role`,
`user?.displayName`, `user?.email` sont corrects tels quels.

- [ ] **Step 4 : Vérifier dans le navigateur**

```bash
npm run dev
```

Se connecter avec un compte patron, aller sur `/corner/hygiene`, onglet **Hebdo**.

Attendu :
1. Bloc « Responsable » visible au-dessus de la barre de progression, avec un menu déroulant listant les salariés corner (sans les comptes iPad ni planning).
2. Choisir un salarié, cliquer *Désigner* → le nom s'affiche avec « Désigné par … ».
3. Recharger la page → le nom persiste.
4. Onglet **Quotidien** → aucun bloc Responsable.
5. Onglet **Mensuel** → bloc présent, désignation indépendante de l'hebdo.
6. Reculer la date d'une semaine → le bloc redevient vide (autre période).

- [ ] **Step 5 : Vérifier le mode lecture seule**

Se connecter avec un compte de rôle `corner`, retourner sur l'onglet Hebdo.

Attendu : le nom du responsable s'affiche, **aucun** menu déroulant ni bouton
*Changer*. Si le compte connecté est le responsable, le badge « toi » apparaît.

- [ ] **Step 6 : Commit**

```bash
git add src/modules/corner/components/ResponsableSelector.tsx src/modules/corner/pages/Hygiene.tsx
git commit -m "feat(hygiene): sélecteur de responsable sur les onglets hebdo et mensuel

Encadrants seuls peuvent désigner ; les salariés voient le nom en
lecture seule. Hygiene.tsx consomme désormais les utils partagés."
```

---

## Tâche 4 : Dashboard corner — complétude et noms

**Files:**
- Modify: `src/modules/corner/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: `QUOTIDIEN_IDS`, `HEBDO_IDS`, `MENSUEL_IDS`, `isHygieneDone`, `getPeriodId` (Tâche 1) · `loadResponsable`, `HygieneResponsable` (Tâche 2)
- Produces: rien pour les tâches suivantes

- [ ] **Step 1 : Importer les utils et supprimer la date math dupliquée**

`Dashboard.tsx` embarque sa **propre copie** de `getISOWeek` et construit les
identifiants de période avec `d.getFullYear()` (lignes 67-74) — le même bug
d'année ISO que `Hygiene.tsx`. Corriger l'un sans l'autre ferait lire deux
documents différents à la même semaine fin décembre.

Ajouter aux imports :

```tsx
import { QUOTIDIEN_IDS, HEBDO_IDS, MENSUEL_IDS, isHygieneDone, getPeriodId } from '../utils/hygiene'
import { loadResponsable, type HygieneResponsable } from '../firebase/hygieneResponsables'
```

Supprimer la fonction locale `getISOWeek` ainsi que `hygieneHebdoId()` et
`hygieneMensuelId()` (lignes 67-74), puis remplacer leurs deux appels
(lignes 176-177) :

```tsx
        getDocFromServer(doc(db, 'hygiene_corner', getPeriodId('hebdo', new Date()))),
        getDocFromServer(doc(db, 'hygiene_corner', getPeriodId('mensuel', new Date()))),
```

Vérifier avec `grep -n "getISOWeek" src/modules/corner/pages/Dashboard.tsx`
qu'il ne reste aucune occurrence.

Ajouter deux états à côté de `hygieneHebdoOk` (ligne 141) :

```tsx
  const [respHebdo, setRespHebdo]     = useState<HygieneResponsable | null>(null)
  const [respMensuel, setRespMensuel] = useState<HygieneResponsable | null>(null)
```

- [ ] **Step 2 : Remplacer le test d'existence par un test de complétude**

Remplacer les lignes 199-201 :

```tsx
      setHygieneOk(hygieneSnap.exists())
      setHygieneHebdoOk(hygieneHebdoSnap.exists())
      setHygieneMensuelOk(hygieneMensuelSnap.exists())
```

par :

```tsx
      // Complétude et non existence : une checklist sauvegardée à 2/5
      // ne doit plus compter comme faite.
      setHygieneOk(isHygieneDone(hygieneSnap.data()?.items, QUOTIDIEN_IDS))
      setHygieneHebdoOk(isHygieneDone(hygieneHebdoSnap.data()?.items, HEBDO_IDS))
      setHygieneMensuelOk(isHygieneDone(hygieneMensuelSnap.data()?.items, MENSUEL_IDS))
```

- [ ] **Step 3 : Charger les responsables dans le même passage**

Toujours dans `loadAll()`, après le bloc `Promise.all` existant (après la ligne 184) :

```tsx
      const maintenant = new Date()
      const [rHebdo, rMensuel] = await Promise.all([
        loadResponsable('hebdo', maintenant),
        loadResponsable('mensuel', maintenant),
      ])
      setRespHebdo(rHebdo)
      setRespMensuel(rMensuel)
```

- [ ] **Step 4 : Afficher les lignes avec le nom du responsable**

Remplacer les deux lignes conditionnelles (lignes 288-289) :

```tsx
    ...(hygieneHebdoOk === false   ? [{ label: 'Hygiène hebdomadaire', status: 'ko', nav: 'hygiene', checkKey: null } as TaskItem] : []),
    ...(hygieneMensuelOk === false ? [{ label: 'Hygiène mensuelle',    status: 'ko', nav: 'hygiene', checkKey: null } as TaskItem] : []),
```

par un helper déclaré juste au-dessus de `const taskItems` :

```tsx
  const uid = auth.currentUser?.uid

  /** Une ligne d'hygiène périodique n'apparaît que si elle est attribuée
   *  ou en retard : attribuée et faite, elle reste visible pour montrer
   *  qui s'en est chargé ; ni attribuée ni faite, elle signale l'oubli
   *  de désignation. */
  function ligneHygiene(
    libelle: string,
    fait: boolean | null,
    resp: HygieneResponsable | null,
  ): TaskItem[] {
    if (fait !== false && !resp) return []
    const estMoi = !!resp && resp.assigneeUid === uid
    const suffixe = resp ? ` — ${resp.assigneeName}${estMoi ? ' · toi' : ''}` : ' — non attribuée'
    return [{
      label: `${libelle}${suffixe}`,
      status: fait ? 'ok' : 'ko',
      nav: 'hygiene',
      checkKey: null,
    } as TaskItem]
  }
```

et les deux lignes deviennent :

```tsx
    ...ligneHygiene('Hygiène hebdomadaire', hygieneHebdoOk, respHebdo),
    ...ligneHygiene('Hygiène mensuelle',    hygieneMensuelOk, respMensuel),
```

Vérifier que `auth` est bien importé depuis `../../../firebase/config` en haut
du fichier ; l'ajouter à l'import existant sinon.

- [ ] **Step 5 : Vérifier le typage**

Run: `npm run build`
Expected: build réussi

- [ ] **Step 6 : Vérifier dans le navigateur**

```bash
npm run dev
```

Aller sur `/corner`, avec le responsable hebdo désigné à la Tâche 3.

Attendu :
1. Ligne « Hygiène hebdomadaire — <nom> » visible, en ❌ tant que la checklist n'est pas complète.
2. Aller cocher **tous** les items hebdo, sauvegarder, revenir au Dashboard et cliquer *↺ Actualiser* → la ligne passe en ✅ et reste visible.
3. Décocher un seul item, sauvegarder, actualiser → la ligne repasse en ❌. C'est le comportement corrigé : avant, elle serait restée ✅.
4. Se connecter avec le compte du responsable → la ligne affiche « · toi ».
5. Sur une période sans responsable et non faite → « Hygiène mensuelle — non attribuée » en ❌.

- [ ] **Step 7 : Commit**

```bash
git add src/modules/corner/pages/Dashboard.tsx
git commit -m "feat(hygiene): responsable affiché au dashboard, complétude réelle

La tâche n'est plus considérée faite parce que le document existe mais
parce que tous ses items sont cochés. Une période attribuée reste
visible même une fois faite, pour montrer qui s'en est chargé."
```

---

## Tâche 5 : Historique des responsables

**Files:**
- Modify: `src/modules/corner/pages/Hygiene.tsx`

**Interfaces:**
- Consumes: `loadResponsableHistory`, `HygieneResponsable` (Tâche 2) · `HEBDO_IDS`, `MENSUEL_IDS`, `isHygieneDone` (Tâche 1)
- Produces: rien pour les tâches suivantes

- [ ] **Step 1 : Charger l'historique dans l'onglet Historique**

Dans `src/modules/corner/pages/Hygiene.tsx`, ajouter une ligne d'import :

```tsx
import { loadResponsableHistory, type HygieneResponsable } from '../firebase/hygieneResponsables'
```

Ne pas créer un second import depuis `../utils/hygiene` : `HEBDO_IDS` et
`MENSUEL_IDS` y sont déjà importés par la Tâche 3, et cette tâche n'a besoin de
rien d'autre — le statut se calcule directement par comptage, pas via
`isHygieneDone`.

Ajouter les états à côté des états d'historique existants (lignes 118-122) :

```tsx
  const [respHist, setRespHist]       = useState<HygieneResponsable[]>([])
  const [respHistOpen, setRespHistOpen] = useState(false)
  const [respHistDone, setRespHistDone] = useState<Record<string, { done: number; total: number }>>({})
```

Dans `loadHistorique(offset)`, après le chargement du mensuel (après la ligne 179) :

```tsx
      // Historique des responsables : indépendant de la semaine affichée,
      // on charge les 12 dernières périodes des deux types.
      const [histH, histM] = await Promise.all([
        loadResponsableHistory('hebdo', 12),
        loadResponsableHistory('mensuel', 12),
      ])
      const toutes = [...histH, ...histM].sort(
        (a, b) => b.periodStart.toMillis() - a.periodStart.toMillis()
      )
      setRespHist(toutes)

      // Statut de chaque période : lecture des documents hygiene_corner
      // correspondants, bornée aux périodes affichées.
      const statuts: Record<string, { done: number; total: number }> = {}
      await Promise.all(toutes.map(async r => {
        const ids = r.kind === 'hebdo' ? HEBDO_IDS : MENSUEL_IDS
        const snap = await getDoc(doc(db, 'hygiene_corner', r.periodId))
        const items = snap.exists() ? (snap.data() as SavedCheck).items : undefined
        statuts[r.periodId] = {
          done: ids.filter(id => items?.[id]).length,
          total: ids.length,
        }
      }))
      setRespHistDone(statuts)
```

- [ ] **Step 2 : Afficher le nom du responsable sur les cards Hebdo et Mensuel**

Dans le bloc « Hebdo + Mensuel » de l'onglet Historique (lignes 324-343), ajouter
sous chaque compteur. Pour la card Hebdo, après la div `{histHebdo.done}/{histHebdo.total}` :

```tsx
                    {(() => {
                      const r = respHist.find(x => x.kind === 'hebdo' && x.periodId === getDocId('hebdo', histWeekDates[0]))
                      return r ? (
                        <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 4 }}>{r.assigneeName}</div>
                      ) : null
                    })()}
```

Idem pour la card Mensuel, en remplaçant `'hebdo'` par `'mensuel'` aux deux endroits.

- [ ] **Step 3 : Ajouter la section dépliable**

Après le bloc « Hebdo + Mensuel », toujours dans `tab === 'historique'` :

```tsx
            <div className="card" style={{ padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <p className="section-label" style={{ margin: 0 }}>Historique des responsables</p>
                <button
                  onClick={() => setRespHistOpen(o => !o)}
                  style={{
                    minHeight: 44, padding: '0 12px', border: 'none', background: 'transparent',
                    color: 'var(--primary)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    fontFamily: 'Manrope, sans-serif',
                  }}
                >
                  {respHistOpen ? '▲ Rétracter' : `▼ Afficher (${respHist.length})`}
                </button>
              </div>

              {respHistOpen && (
                respHist.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--on-surface-3)', margin: '8px 0 0' }}>
                    Aucune désignation enregistrée.
                  </p>
                ) : (
                  <div style={{ overflowX: 'auto', marginTop: 10 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ color: 'var(--on-surface-3)', textAlign: 'left' }}>
                          <th style={{ padding: '6px 8px', fontWeight: 700 }}>Période</th>
                          <th style={{ padding: '6px 8px', fontWeight: 700 }}>Responsable</th>
                          <th style={{ padding: '6px 8px', fontWeight: 700 }}>Statut</th>
                          <th style={{ padding: '6px 8px', fontWeight: 700 }}>Suivi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {respHist.map(r => {
                          const s = respHistDone[r.periodId]
                          const complet = !!s && s.done === s.total
                          const rappels = r.remindersSent ?? []
                          return (
                            <tr key={r.periodId} style={{ borderTop: '1px solid var(--border-soft)' }}>
                              <td style={{ padding: '8px', color: 'var(--on-surface-2)', whiteSpace: 'nowrap' }}>
                                {r.periodId.replace('_hebdo', '').replace('_mensuel', '')}
                                <span style={{ color: 'var(--on-surface-3)', marginLeft: 4 }}>
                                  {r.kind === 'hebdo' ? 'hebdo' : 'mensuel'}
                                </span>
                              </td>
                              <td style={{ padding: '8px', color: 'var(--on-surface)', fontWeight: 600 }}>
                                {r.assigneeName}
                                {(r.previousAssignees?.length ?? 0) > 0 && (
                                  <span style={{ fontSize: 10, color: 'var(--on-surface-3)', marginLeft: 5 }}>
                                    (réaffecté)
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                                {complet ? '✅' : '❌'}{s ? ` ${s.done}/${s.total}` : ''}
                              </td>
                              <td style={{ padding: '8px', color: 'var(--on-surface-3)' }}>
                                {rappels.length === 0 ? '—' : rappels.join(', ')}
                                {r.escalatedAt ? ' · escaladé' : ''}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </div>
```

- [ ] **Step 4 : Vérifier le typage**

Run: `npm run build`
Expected: build réussi

- [ ] **Step 5 : Vérifier dans le navigateur**

```bash
npm run dev
```

Aller sur `/corner/hygiene`, onglet **Historique**.

Attendu :
1. Section « Historique des responsables » repliée par défaut, avec le nombre d'entrées.
2. Cliquer *Afficher* → tableau listant les désignations, la plus récente en haut.
3. La colonne Statut reflète la complétude réelle (✅ 5/5, ❌ 2/5).
4. Le nom du responsable apparaît aussi sous les compteurs des cards Hebdo et Mensuel.
5. Sur mobile (largeur 390px), le tableau défile horizontalement sans faire déborder la page.

- [ ] **Step 6 : Commit**

```bash
git add src/modules/corner/pages/Hygiene.tsx
git commit -m "feat(hygiene): historique des responsables dans l'onglet Historique

Section dépliable listant les 12 dernières périodes avec responsable,
complétude réelle et suivi des rappels envoyés."
```

---

## Tâche 6 : Logique pure des fonctions Cloud

**Files:**
- Create: `functions/src/hygiene/periods.ts`
- Test: `functions/src/hygiene/periods.test.ts`
- Modify: `functions/tsconfig.json`

**Interfaces:**
- Consumes: rien (module autonome, aucun import firebase — c'est ce qui le rend testable)
- Produces:
  - `type HygieneKind = 'hebdo' | 'mensuel'`
  - `type Jalon = 'j-3' | 'j-1' | 'escalade'`
  - `HEBDO_IDS`, `MENSUEL_IDS`, `itemIdsFor(kind)`
  - `getPeriodId(kind: HygieneKind, ref: Date): string`
  - `resolveJalon(kind: HygieneKind, now: Date): Jalon | null`
  - `isHygieneDone(items, ids): boolean`
  - `parisNow(): Date`

- [ ] **Step 1 : Exclure les tests de la compilation des fonctions**

Dans `functions/tsconfig.json`, ajouter (ou compléter) la clé `exclude` au
même niveau que `compilerOptions` :

```json
  "exclude": ["node_modules", "src/**/*.test.ts"]
```

Sans cela, `npm run build` compilerait les tests dans `lib/` et Firebase les
déploierait avec les fonctions.

- [ ] **Step 2 : Écrire les tests qui échouent**

Créer `functions/src/hygiene/periods.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { getPeriodId, resolveJalon, isHygieneDone, HEBDO_IDS, MENSUEL_IDS } from './periods'

const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h, 0, 0)

describe('getPeriodId (serveur)', () => {
  it('produit les mêmes identifiants que le client', () => {
    expect(getPeriodId('hebdo', at(2026, 7, 28))).toBe('2026-W31_hebdo')
    expect(getPeriodId('mensuel', at(2026, 7, 28))).toBe('2026-07_mensuel')
  })

  it('utilise l’année ISO au passage du nouvel an', () => {
    expect(getPeriodId('hebdo', at(2027, 1, 1))).toBe('2026-W53_hebdo')
  })
})

describe('resolveJalon — hebdo', () => {
  // Semaine du lundi 27 juillet au dimanche 2 août 2026.
  it('rend j-3 le jeudi à 10h', () => {
    expect(resolveJalon('hebdo', at(2026, 7, 30, 10))).toBe('j-3')
  })

  it('ne rend rien le jeudi à 18h', () => {
    expect(resolveJalon('hebdo', at(2026, 7, 30, 18))).toBeNull()
  })

  it('rend j-1 le samedi à 10h', () => {
    expect(resolveJalon('hebdo', at(2026, 8, 1, 10))).toBe('j-1')
  })

  it('rend escalade le dimanche à 18h', () => {
    expect(resolveJalon('hebdo', at(2026, 8, 2, 18))).toBe('escalade')
  })

  it('ne rend rien le dimanche à 10h', () => {
    expect(resolveJalon('hebdo', at(2026, 8, 2, 10))).toBeNull()
  })

  it('ne rend rien un lundi', () => {
    expect(resolveJalon('hebdo', at(2026, 7, 27, 10))).toBeNull()
  })
})

describe('resolveJalon — mensuel', () => {
  it('rend j-3 sept jours avant la fin de juillet (le 24)', () => {
    expect(resolveJalon('mensuel', at(2026, 7, 24, 10))).toBe('j-3')
  })

  // Février 2026 compte 28 jours : J-7 tombe le 21, pas le 24.
  it('rend j-3 le 21 février 2026', () => {
    expect(resolveJalon('mensuel', at(2026, 2, 21, 10))).toBe('j-3')
    expect(resolveJalon('mensuel', at(2026, 2, 24, 10))).toBeNull()
  })

  it('rend j-3 le 22 février 2028 (année bissextile)', () => {
    expect(resolveJalon('mensuel', at(2028, 2, 22, 10))).toBe('j-3')
  })

  it('rend j-1 deux jours avant la fin du mois', () => {
    expect(resolveJalon('mensuel', at(2026, 7, 29, 10))).toBe('j-1')
  })

  it('rend escalade le dernier jour à 18h', () => {
    expect(resolveJalon('mensuel', at(2026, 7, 31, 18))).toBe('escalade')
    expect(resolveJalon('mensuel', at(2026, 2, 28, 18))).toBe('escalade')
  })

  it('ne rend rien le dernier jour à 10h', () => {
    expect(resolveJalon('mensuel', at(2026, 7, 31, 10))).toBeNull()
  })
})

describe('isHygieneDone (serveur)', () => {
  it('exige tous les items', () => {
    expect(isHygieneDone({ int_frigos: true }, HEBDO_IDS)).toBe(false)
    expect(isHygieneDone(
      Object.fromEntries(HEBDO_IDS.map(id => [id, true])), HEBDO_IDS,
    )).toBe(true)
    expect(isHygieneDone({ placard_rangement: true }, MENSUEL_IDS)).toBe(true)
  })
})
```

- [ ] **Step 3 : Lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./periods"`

- [ ] **Step 4 : Écrire l'implémentation**

Créer `functions/src/hygiene/periods.ts` :

```ts
/** Logique pure des périodes d'hygiène — aucun import firebase, pour
 *  rester testable. Duplique volontairement src/modules/corner/utils/hygiene.ts :
 *  ce projet n'a pas d'import cross-package entre le client et les fonctions.
 *  Les tests des deux côtés vérifient les mêmes identifiants. */

export type HygieneKind = 'hebdo' | 'mensuel'
export type Jalon = 'j-3' | 'j-1' | 'escalade'

export const HEBDO_IDS = [
  'int_frigos', 'etageres_materiels', 'support_papier',
  'placard_hygiene', 'machine_glacon',
]

export const MENSUEL_IDS = ['placard_rangement']

export function itemIdsFor(kind: HygieneKind): string[] {
  return kind === 'hebdo' ? HEBDO_IDS : MENSUEL_IDS
}

const pad = (n: number) => String(n).padStart(2, '0')

function thursdayOfISOWeek(d: Date): Date {
  const date = new Date(d)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7))
  return date
}

function isoWeek(d: Date): number {
  const thursday = thursdayOfISOWeek(d)
  const week1 = new Date(thursday.getFullYear(), 0, 4)
  return 1 + Math.round(
    ((thursday.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7
  )
}

export function getPeriodId(kind: HygieneKind, ref: Date): string {
  if (kind === 'hebdo') {
    return `${thursdayOfISOWeek(ref).getFullYear()}-W${pad(isoWeek(ref))}_hebdo`
  }
  return `${ref.getFullYear()}-${pad(ref.getMonth() + 1)}_mensuel`
}

/** Dernier jour du mois de `d`. Jour 0 du mois suivant = dernier jour du mois courant. */
function lastDayOfMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

/**
 * Quel jalon de rappel correspond à cet instant, s'il y en a un.
 * `now` doit être une date exprimée en heure murale de Paris.
 *
 * Hebdo   : jeudi 10h · samedi 10h · dimanche 18h
 * Mensuel : J-7 10h · J-2 10h · dernier jour 18h — J étant la fin du
 *           mois, calculée par soustraction et jamais sur un numéro fixe.
 */
export function resolveJalon(kind: HygieneKind, now: Date): Jalon | null {
  const heure = now.getHours()

  if (kind === 'hebdo') {
    const jour = now.getDay() // 0 = dimanche
    if (jour === 4 && heure === 10) return 'j-3'
    if (jour === 6 && heure === 10) return 'j-1'
    if (jour === 0 && heure === 18) return 'escalade'
    return null
  }

  const restants = lastDayOfMonth(now) - now.getDate()
  if (restants === 7 && heure === 10) return 'j-3'
  if (restants === 2 && heure === 10) return 'j-1'
  if (restants === 0 && heure === 18) return 'escalade'
  return null
}

export function isHygieneDone(
  items: Record<string, boolean> | undefined | null,
  ids: string[],
): boolean {
  if (!items) return false
  return ids.every(id => items[id] === true)
}

/** Heure murale de Paris, quel que soit le fuseau du conteneur.
 *  Même approche que les fonctions planifiées déjà en place. */
export function parisNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }))
}
```

- [ ] **Step 5 : Lancer les tests pour vérifier qu'ils passent**

Run: `npm test`
Expected: PASS — tous les tests client et serveur passent

- [ ] **Step 6 : Vérifier la compilation des fonctions**

```bash
cd functions && npm run build && cd ..
ls functions/lib/hygiene/
```

Expected: `periods.js` et `periods.js.map` présents, **pas** de `periods.test.js`.

- [ ] **Step 7 : Commit**

```bash
git add functions/src/hygiene/periods.ts functions/src/hygiene/periods.test.ts functions/tsconfig.json
git commit -m "feat(hygiene): logique pure des périodes côté fonctions

Résolution des jalons de rappel testée sur février, année bissextile
et passage du nouvel an. Tests exclus de la compilation déployée."
```

---

## Tâche 7 : Fonctions Cloud de notification et de rappel

**Files:**
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: `getPeriodId`, `resolveJalon`, `isHygieneDone`, `itemIdsFor`, `parisNow`, `HygieneKind` (Tâche 6) · helper existant `notifyUids` (`functions/src/index.ts:1107`)
- Produces: fonctions déployables `onHygieneResponsableAssigned`, `hygieneRappelsResponsables`

- [ ] **Step 1 : Ajouter les imports et les helpers**

En haut de `functions/src/index.ts`, ajouter aux imports existants :

```ts
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import {
  getPeriodId, resolveJalon, isHygieneDone, itemIdsFor, parisNow,
  type HygieneKind,
} from './hygiene/periods'
```

Si `onDocumentWritten` est déjà importé, ne pas dupliquer la ligne.

Ajouter, à proximité des autres helpers (après `notifyUids`, ligne 1124) :

```ts
/** Destinataires de l'escalade hygiène.
 *  Repli sur settings/alert_emails.responsables puis sur la liste par
 *  défaut : une escalade ne doit jamais partir dans le vide. */
async function getHygieneEscaladeEmails(): Promise<string[]> {
  const snap = await db.doc('settings/hygiene_responsables').get()
  const configures = (snap.data()?.escaladeDestinataires ?? []) as string[]
  if (configures.length) return configures

  const alertSnap = await db.doc('settings/alert_emails').get()
  const repli = (alertSnap.data()?.responsables ?? []) as string[]
  if (repli.length) return repli

  return ['a.cozzika@gmail.com', 'kyriazis@outlook.fr']
}

async function hygieneRappelsActifs(): Promise<boolean> {
  const snap = await db.doc('settings/hygiene_responsables').get()
  return snap.data()?.rappelsEnabled !== false
}

async function sendHygieneMail(to: string[], cc: string[], subject: string, html: string) {
  if (!to.length) return
  const gmailUser = process.env.GMAIL_USER
  const gmailPass = process.env.GMAIL_APP_PASSWORD
  if (!gmailUser || !gmailPass) {
    console.error('[hygiene] GMAIL_USER ou GMAIL_APP_PASSWORD absent — email non envoyé')
    return
  }
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailUser, pass: gmailPass },
  })
  await transporter.sendMail({
    from: `Yorgios <${gmailUser}>`,
    to: to.join(','),
    cc: cc.length ? cc.join(',') : undefined,
    subject,
    html,
  })
}

const LIBELLE_KIND: Record<HygieneKind, string> = {
  hebdo: 'hebdomadaire',
  mensuel: 'mensuelle',
}
```

- [ ] **Step 2 : Ajouter la fonction de notification de désignation**

À la suite dans `functions/src/index.ts` :

```ts
/** Notifie le salarié qui vient d'être désigné responsable d'une checklist. */
export const onHygieneResponsableAssigned = onDocumentWritten(
  { document: 'hygiene_responsables/{periodId}', region: 'europe-west1' },
  async (event) => {
    const avant = event.data?.before.data()
    const apres = event.data?.after.data()
    if (!apres) return

    // GARDE INDISPENSABLE : cette fonction écrit notifiedAt dans le document
    // qui la déclenche. Sans cette sortie, elle se rappellerait en boucle à
    // chaque mise à jour de remindersSent.
    if (avant?.assigneeUid === apres.assigneeUid) return

    const kind = apres.kind as HygieneKind
    const libelle = LIBELLE_KIND[kind] ?? kind
    const periode = String(apres.periodId ?? '').replace(/_hebdo|_mensuel/, '')

    const titre = `🧼 Tu es responsable de l'hygiène ${libelle}`
    const corps = `Période ${periode} — checklist à compléter avant la fin de la période.`

    await notifyUids([apres.assigneeUid], titre, corps, '/corner/hygiene')

    if (apres.assigneeEmail) {
      await sendHygieneMail(
        [apres.assigneeEmail],
        [],
        titre,
        `<p>Bonjour ${apres.assigneeName},</p>
         <p>Tu as été désigné(e) responsable de la <strong>checklist d'hygiène ${libelle}</strong>
         pour la période <strong>${periode}</strong>, par ${apres.assignedByName}.</p>
         <p>Elle est à compléter dans l'application, onglet Nettoyage :
         <a href="https://cuisine-yorgios.web.app/corner/hygiene">ouvrir la checklist</a>.</p>
         <p>Merci !</p>`,
      )
    }

    await event.data!.after.ref.set({ notifiedAt: new Date() }, { merge: true })
    console.log(`[hygiene] Désignation notifiée : ${apres.assigneeName} — ${apres.periodId}`)
  }
)
```

- [ ] **Step 3 : Ajouter la fonction de rappel planifiée**

```ts
/** 10h et 18h — rappels ciblés au responsable, puis escalade. */
export const hygieneRappelsResponsables = onSchedule(
  { schedule: '0 10,18 * * *', timeZone: 'Europe/Paris', region: 'europe-west1' },
  async () => {
    if (!(await hygieneRappelsActifs())) {
      console.log('[hygiene] Rappels désactivés dans les paramètres.')
      return
    }

    const now = parisNow()

    for (const kind of ['hebdo', 'mensuel'] as HygieneKind[]) {
      const jalon = resolveJalon(kind, now)
      if (!jalon) continue

      const periodId = getPeriodId(kind, now)
      const libelle = LIBELLE_KIND[kind]
      const periode = periodId.replace(/_hebdo|_mensuel/, '')

      // La checklist est-elle complète ? Si oui, aucun rappel, escalade comprise.
      const checkSnap = await db.doc(`hygiene_corner/${periodId}`).get()
      if (isHygieneDone(checkSnap.data()?.items, itemIdsFor(kind))) {
        console.log(`[hygiene] ${periodId} complète — pas de rappel.`)
        continue
      }

      const respRef = db.doc(`hygiene_responsables/${periodId}`)
      const respSnap = await respRef.get()

      // Aucun responsable désigné : on alerte les encadrants, une seule fois,
      // au premier jalon. Pas de document où inscrire le jalon, l'unicité
      // repose sur la correspondance exacte jour + heure.
      if (!respSnap.exists) {
        if (jalon !== 'j-3') continue
        const emails = await getHygieneEscaladeEmails()
        await sendHygieneMail(
          emails, [],
          `⚠️ Aucun responsable désigné — hygiène ${libelle} ${periode}`,
          `<p>La checklist d'hygiène <strong>${libelle}</strong> de la période
           <strong>${periode}</strong> n'a aucun responsable désigné et n'est pas faite.</p>
           <p><a href="https://cuisine-yorgios.web.app/corner/hygiene">Désigner un responsable</a></p>`,
        )
        console.log(`[hygiene] ${periodId} sans responsable — encadrants alertés.`)
        continue
      }

      const resp = respSnap.data()!
      const dejaEnvoyes = (resp.remindersSent ?? []) as string[]
      if (dejaEnvoyes.includes(jalon)) {
        console.log(`[hygiene] ${periodId} jalon ${jalon} déjà envoyé.`)
        continue
      }

      if (jalon === 'escalade') {
        const emails = await getHygieneEscaladeEmails()
        await sendHygieneMail(
          emails,
          resp.assigneeEmail ? [resp.assigneeEmail] : [],
          `🚨 Hygiène ${libelle} non faite — ${periode}`,
          `<p>La checklist d'hygiène <strong>${libelle}</strong> de la période
           <strong>${periode}</strong> n'a pas été complétée.</p>
           <p>Responsable désigné : <strong>${resp.assigneeName}</strong>
           (désigné par ${resp.assignedByName}).</p>
           <p>Rappels déjà envoyés : ${dejaEnvoyes.length ? dejaEnvoyes.join(', ') : 'aucun'}.</p>`,
        )
        await respRef.set({
          remindersSent: [...dejaEnvoyes, jalon],
          escalatedAt: new Date(),
        }, { merge: true })
        console.log(`[hygiene] ${periodId} escaladé.`)
        continue
      }

      const titre = `🧼 Rappel — hygiène ${libelle}`
      const corps = `La checklist ${periode} n'est pas terminée.`
      await notifyUids([resp.assigneeUid], titre, corps, '/corner/hygiene')
      if (resp.assigneeEmail) {
        await sendHygieneMail(
          [resp.assigneeEmail], [], titre,
          `<p>Bonjour ${resp.assigneeName},</p>
           <p>La <strong>checklist d'hygiène ${libelle}</strong> de la période
           <strong>${periode}</strong> n'est pas encore terminée.</p>
           <p><a href="https://cuisine-yorgios.web.app/corner/hygiene">Compléter la checklist</a></p>`,
        )
      }
      await respRef.set({ remindersSent: [...dejaEnvoyes, jalon] }, { merge: true })
      console.log(`[hygiene] ${periodId} rappel ${jalon} envoyé à ${resp.assigneeName}.`)
    }
  }
)
```

- [ ] **Step 4 : Conditionner les deux fonctions existantes**

Dans `notifHygieneHebdo` (ligne 1823), remplacer le bloc de test :

```ts
    const snap = await db.doc(`hygiene_corner/${weekId}`).get()
    if (snap.exists) {
      console.log('[hebdo] Hygiène hebdo déjà faite, pas de notif.')
      return
    }
```

par :

```ts
    const snap = await db.doc(`hygiene_corner/${weekId}`).get()
    if (isHygieneDone(snap.data()?.items, itemIdsFor('hebdo'))) {
      console.log('[hebdo] Hygiène hebdo complète, pas de notif.')
      return
    }
    // Un responsable désigné reçoit déjà ses rappels ciblés : le broadcast
    // collectif ne sert que de filet quand personne n'est désigné.
    const respSnap = await db.doc(`hygiene_responsables/${weekId}`).get()
    if (respSnap.exists) {
      console.log('[hebdo] Responsable désigné, rappel ciblé — pas de broadcast.')
      return
    }
```

Attention : `weekId` est construit ligne 1832 avec `date.getFullYear()` après le
décalage sur le jeudi — cette variable `date` **est** déjà le jeudi de la semaine
ISO, donc l'identifiant est correct côté fonctions. Ne pas y toucher.

Dans `notifHygieneMensuel` (ligne 1849), remplacer de même :

```ts
    const snap = await db.doc(`hygiene_corner/${monthId}`).get()
    if (isHygieneDone(snap.data()?.items, itemIdsFor('mensuel'))) {
      console.log('[mensuel] Hygiène mensuelle complète, pas de notif.')
      return
    }
    const respSnap = await db.doc(`hygiene_responsables/${monthId}`).get()
    if (respSnap.exists) {
      console.log('[mensuel] Responsable désigné, rappel ciblé — pas de broadcast.')
      return
    }
```

- [ ] **Step 5 : Compiler les fonctions**

```bash
cd functions && npm run build && cd ..
```

Expected: compilation réussie, aucune erreur TypeScript

- [ ] **Step 6 : Relancer les tests**

Run: `npm test`
Expected: PASS — la logique pure n'a pas bougé

- [ ] **Step 7 : Déployer les fonctions**

```bash
cd functions && npm run build && cd .. && firebase deploy --only functions:onHygieneResponsableAssigned,functions:hygieneRappelsResponsables,functions:notifHygieneHebdo,functions:notifHygieneMensuel
```

Expected: `Deploy complete!`, les quatre fonctions listées

- [ ] **Step 8 : Vérifier la notification de désignation en conditions réelles**

Sur l'application déployée ou en `npm run dev` (les fonctions sont en production
dans les deux cas), désigner un responsable sur l'onglet Hebdo.

Attendu :
1. Le salarié désigné reçoit un email « Tu es responsable de l'hygiène hebdomadaire ».
2. Dans les logs (`firebase functions:log --only onHygieneResponsableAssigned`) : « Désignation notifiée : … ».
3. Le document porte maintenant `notifiedAt`.
4. **Vérification anti-boucle** : les logs ne montrent qu'**une seule** exécution, pas une cascade. Si plusieurs apparaissent, la garde `avant?.assigneeUid === apres.assigneeUid` est mal placée.

⚠️ Cette étape envoie un vrai email. Se désigner soi-même pour tester, pas un
salarié.

- [ ] **Step 9 : Commit**

```bash
git add functions/src/index.ts functions/lib
git commit -m "feat(hygiene): notification de désignation et rappels ciblés

onHygieneResponsableAssigned prévient le salarié désigné.
hygieneRappelsResponsables relance deux fois puis escalade.
Les deux broadcasts existants se taisent quand un responsable existe."
```

---

## Tâche 8 : Section Paramètres

**Files:**
- Modify: `src/pages/AdminSettings.tsx`

**Interfaces:**
- Consumes: rien des tâches précédentes (écrit `settings/hygiene_responsables`, lu par la Tâche 7)
- Produces: rien

- [ ] **Step 1 : Ajouter le type et l'état**

Dans `src/pages/AdminSettings.tsx`, à côté des autres types de settings (vers la ligne 54) :

```tsx
type HygieneResponsablesSettings = {
  rappelsEnabled: boolean
  escaladeDestinataires: string[]
}

const DEFAULT_HYGIENE_RESP: HygieneResponsablesSettings = {
  rappelsEnabled: true,
  escaladeDestinataires: [],
}
```

Ajouter l'état à côté de `alertEmails` :

```tsx
  const [hygieneResp, setHygieneResp] = useState<HygieneResponsablesSettings>(DEFAULT_HYGIENE_RESP)
```

- [ ] **Step 2 : Charger et sauvegarder**

Dans le `Promise.all` de chargement (vers la ligne 418), ajouter l'appel **en
dernière position** du tableau :

```tsx
          getDoc(doc(db, 'settings', 'hygiene_responsables')),
```

Puis ajouter `hygieneRespSnap` **en dernière position** de la déstructuration
du résultat, dans le même ordre. Exemple de la forme attendue — conserver les
noms existants du fichier et n'ajouter que le dernier :

```tsx
      const [/* … snapshots existants inchangés … */, hygieneRespSnap] = await Promise.all([
        /* … appels existants inchangés … */
        getDoc(doc(db, 'settings', 'hygiene_responsables')),
      ])
```

L'ordre du tableau et celui de la déstructuration doivent correspondre
exactement : les intervertir donnerait des settings silencieusement mélangés.

Après la déstructuration, avec les autres `if (…Snap.exists())` :

```tsx
      if (hygieneRespSnap.exists()) {
        setHygieneResp({ ...DEFAULT_HYGIENE_RESP, ...(hygieneRespSnap.data() as any) })
      }
```

Dans le `Promise.all` de sauvegarde (vers la ligne 466), ajouter :

```tsx
        setDoc(doc(db, 'settings', 'hygiene_responsables'), hygieneResp),
```

- [ ] **Step 3 : Ajouter la section UI**

Après la section « Alertes RH » (qui se termine vers la ligne 600), insérer :

```tsx
      {/* ── Section : Nettoyage — responsables ─────────────────── */}
      <div>
        <p className="section-label" style={{ marginBottom: 8 }}>Nettoyage — responsables</p>
        <div className="card" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginBottom: 12 }}>
            Rappels envoyés au salarié désigné responsable des checklists d'hygiène
            hebdomadaire et mensuelle. Hebdo : jeudi 10h, samedi 10h, puis escalade
            dimanche 18h. Mensuel : 7 jours puis 2 jours avant la fin du mois, escalade
            le dernier jour.
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', minHeight: 44 }}>
            <input
              type="checkbox"
              checked={hygieneResp.rappelsEnabled}
              onChange={e => setHygieneResp(h => ({ ...h, rappelsEnabled: e.target.checked }))}
              style={{ width: 16, height: 16, accentColor: 'var(--primary)', flexShrink: 0 }}
            />
            <span style={{ fontSize: 13, color: 'var(--on-surface)', fontWeight: 600 }}>
              Rappels automatiques activés
            </span>
          </label>

          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-soft)' }}>
            <div style={{ fontSize: 13, color: 'var(--on-surface)', fontWeight: 600, marginBottom: 4 }}>
              Destinataires de l'escalade
            </div>
            <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginBottom: 10 }}>
              Alertés si la checklist n'est toujours pas faite en fin de période,
              ou si personne n'a été désigné.
            </div>
            {managers.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {managers.map(u => {
                  const checked = hygieneResp.escaladeDestinataires.includes(u.email)
                  return (
                    <label key={u.email} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input
                        type="checkbox" checked={checked}
                        onChange={e => {
                          const next = e.target.checked
                            ? [...hygieneResp.escaladeDestinataires, u.email]
                            : hygieneResp.escaladeDestinataires.filter(x => x !== u.email)
                          setHygieneResp(h => ({ ...h, escaladeDestinataires: next }))
                        }}
                        style={{ width: 16, height: 16, accentColor: 'var(--primary)', flexShrink: 0 }}
                      />
                      <span style={{ fontSize: 13, color: 'var(--on-surface)' }}>
                        {u.displayName}
                        <span style={{ fontSize: 11, color: 'var(--on-surface-3)', marginLeft: 6 }}>{u.email} · {u.role}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--on-surface-3)', margin: 0 }}>Chargement des utilisateurs…</p>
            )}
            {hygieneResp.escaladeDestinataires.length === 0 && managers.length > 0 && (
              <p style={{ fontSize: 11, color: 'var(--warning)', marginTop: 10, marginBottom: 0 }}>
                Aucune personne sélectionnée — repli sur les responsables des alertes,
                puis sur la liste par défaut (Alexandre, Arthur).
              </p>
            )}
          </div>
        </div>
      </div>
```

- [ ] **Step 4 : Vérifier le typage**

Run: `npm run build`
Expected: build réussi

- [ ] **Step 5 : Vérifier dans le navigateur**

```bash
npm run dev
```

Aller sur `/admin/settings` avec un compte patron.

Attendu :
1. Section « Nettoyage — responsables » présente après « Alertes RH ».
2. Cocher deux destinataires, décocher « Rappels automatiques activés », enregistrer.
3. Recharger → les valeurs persistent.
4. Vérifier dans la console Firebase que `settings/hygiene_responsables` contient bien `rappelsEnabled: false` et la liste d'emails.
5. Recocher « Rappels automatiques activés » et enregistrer — ne pas laisser les rappels coupés.

- [ ] **Step 6 : Lancer la suite complète et déployer le hosting**

```bash
npm test && npm run build && firebase deploy --only hosting
```

Expected: tests PASS, build réussi, `Deploy complete!`

- [ ] **Step 7 : Commit**

```bash
git add src/pages/AdminSettings.tsx
git commit -m "feat(hygiene): section Paramètres — responsables nettoyage

Interrupteur des rappels et destinataires de l'escalade, en cases à
cocher, même pattern que les alertes RH."
```

---

## Vérification finale

- [ ] `npm test` — tous les tests passent
- [ ] `npm run build` — aucune erreur TypeScript
- [ ] `cd functions && npm run build` — aucune erreur, pas de `.test.js` dans `lib/`
- [ ] Désigner un responsable hebdo → email reçu, nom au Dashboard
- [ ] Cocher tous les items hebdo → ligne Dashboard en ✅, toujours visible
- [ ] Décocher un item → ligne repasse en ❌
- [ ] Onglet Historique → la désignation apparaît dans le tableau
- [ ] `/admin/settings` → section présente, réglages persistés
- [ ] `firebase functions:log --only hygieneRappelsResponsables` après un passage à 10h ou 18h — aucune erreur

## À surveiller après déploiement

**Les périodes passées à moitié cochées basculent de ✅ à ❌** dans le Dashboard et l'historique, immédiatement. C'est la réalité du terrain qui apparaît, pas une régression — mais l'équipe doit en être prévenue avant de le découvrir.

**Le premier rappel réel** part le jeudi suivant à 10h. Vérifier les logs ce jour-là plutôt que d'attendre un signalement.

**Documenter dans `CLAUDE.md`** : nouvelle collection `hygiene_responsables`, nouvelles fonctions Cloud, nouveau document de settings, et la règle « tâche faite = tous les items cochés » qui remplace « le document existe ».
