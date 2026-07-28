# Items des checklists d'hygiène modifiables : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à patron, administrateur et manager d'ajouter, renommer, réordonner et désactiver les items des trois checklists d'hygiène depuis Paramètres, sans qu'une modification puisse jamais rendre l'historique incomplet.

**Architecture:** Les items vivent dans `settings/hygiene_items`. Un item ne s'applique qu'aux périodes commençant après sa création (`creeLe < début de période`). Chaque checklist enregistre à sa première sauvegarde la liste qui lui était demandée (`itemsAttendus`), qui devient la référence de complétude — de sorte que le Dashboard et les fonctions Cloud n'ont aucune lecture supplémentaire à faire. Les 19 items d'origine restent dans le code, gelés, comme unique repli pour les documents antérieurs.

**Tech Stack:** React 18 + TypeScript + Vite · Firebase Firestore (DB `test`) + Cloud Functions Node 22 · vitest

## Global Constraints

- Projet Firebase unique `cuisine-yorgios`, base Firestore `test`. Imports client uniquement depuis `src/firebase/config.ts`.
- **Tout trigger Firestore doit porter `database: 'test'`** — sans lui il écoute `(default)`, qui n'existe pas.
- **Jamais de valeur `undefined` envoyée à Firestore** — omettre la clé.
- **Toute écriture Firestore côté client a un `catch` qui affiche l'erreur à l'écran.**
- Design system Aegean Precision **light mode uniquement**. Variables : `--surface`, `--surface-low`, `--surface-mid`, `--primary` (`#004275`), `--on-surface`, `--on-surface-2`, `--on-surface-3`, `--success`, `--warning`, `--danger`, `--border`, `--border-soft`. Polices Epilogue (titres) + Manrope (corps). **Cibles tactiles 44×44px minimum.**
- Duplication client / fonctions assumée (aucun import cross-package) : tests miroirs des deux côtés sur les littéraux partagés.
- **Aucun déploiement par les implémenteurs** : ni `firebase deploy`, ni `npm run dev`, ni `npx gitnexus analyze`.
- Spec de référence : `docs/superpowers/specs/2026-07-28-hygiene-items-editables-design.md`

---

## État de départ

Les items sont codés en dur à quatre endroits, avec des libellés qui ont déjà divergé :

| Fichier | Contenu | Devient |
|---|---|---|
| `src/modules/corner/pages/Hygiene.tsx` | `ITEMS` (id + label) | lit les réglages |
| `src/modules/corner/pages/Controle.tsx` | `HYGIENE_ITEMS` (id + label) | lit les réglages |
| `src/modules/corner/utils/hygiene.ts` | `QUOTIDIEN_IDS`, `HEBDO_IDS`, `MENSUEL_IDS` | renommés, **gelés**, repli uniquement |
| `functions/src/hygiene/periods.ts` | idem | idem |

`HygieneKind` ne couvre aujourd'hui que `'hebdo' | 'mensuel'`. Les items concernent aussi le quotidien : un type plus large est nécessaire.

---

## Structure des fichiers

**Créés**

| Fichier | Responsabilité |
|---|---|
| `src/utils/hygieneItems.ts` | Types, items d'origine, fusion, éligibilité, sélection, slug |
| `src/utils/hygieneItems.test.ts` | Tests de ce module |
| `src/components/settings/HygieneItemsSection.tsx` | Section d'édition des items |

**Modifiés**

| Fichier | Changement |
|---|---|
| `src/modules/corner/utils/hygiene.ts` | Listes renommées et gelées, `estComplete(doc, kind)` |
| `functions/src/hygiene/periods.ts` | Idem côté serveur |
| `functions/src/hygiene/periods.test.ts` | Tests de `estComplete` |
| `functions/src/index.ts` | Consomme `estComplete` |
| `src/modules/corner/pages/Dashboard.tsx` | Consomme `estComplete` |
| `src/modules/corner/pages/Hygiene.tsx` | Lit les réglages, écrit `itemsAttendus` |
| `src/modules/corner/pages/Controle.tsx` | Lit les réglages |
| `src/pages/AdminSettings.tsx` | Charge, sauvegarde et affiche la nouvelle section |
| `firestore.rules` | Aucun changement — `settings/*` est déjà couvert |

---

## Tâche 1 : Modèle des items

**Files:**
- Create: `src/utils/hygieneItems.ts`
- Test: `src/utils/hygieneItems.test.ts`

**Interfaces:**
- Consumes: rien
- Produces:
  - `type ChecklistKind = 'quotidien' | 'hebdo' | 'mensuel'`
  - `type HygieneItem = { id: string; label: string; actif: boolean; ordre: number; creeLe?: any }`
  - `type HygieneItemsSettings = Record<ChecklistKind, HygieneItem[]>`
  - `ITEMS_ORIGINE: HygieneItemsSettings`
  - `CHECKLIST_KINDS: ChecklistKind[]`
  - `mergeHygieneItems(data: any): HygieneItemsSettings`
  - `debutPeriode(kind: ChecklistKind, ref: Date): Date`
  - `itemsPourPeriode(settings, kind, ref, itemsAttendus?): HygieneItem[]`
  - `idsAttendus(settings, kind, ref, itemsAttendus?): string[]`
  - `slugPourLabel(label: string, idsExistants: string[]): string`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `src/utils/hygieneItems.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import {
  ITEMS_ORIGINE, CHECKLIST_KINDS, mergeHygieneItems,
  debutPeriode, itemsPourPeriode, idsAttendus, slugPourLabel,
} from './hygieneItems'

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0)

describe('items d’origine', () => {
  it('compte 13 quotidiens, 5 hebdo, 1 mensuel', () => {
    expect(ITEMS_ORIGINE.quotidien).toHaveLength(13)
    expect(ITEMS_ORIGINE.hebdo).toHaveLength(5)
    expect(ITEMS_ORIGINE.mensuel).toHaveLength(1)
  })

  it('n’ont pas de date de création — ils précèdent toute modification', () => {
    for (const k of CHECKLIST_KINDS) {
      for (const item of ITEMS_ORIGINE[k]) expect(item.creeLe).toBeUndefined()
    }
  })

  it('sont tous actifs et ordonnés sans trou', () => {
    for (const k of CHECKLIST_KINDS) {
      ITEMS_ORIGINE[k].forEach((item, i) => {
        expect(item.actif).toBe(true)
        expect(item.ordre).toBe(i)
      })
    }
  })

  it('portent les identifiants historiques exacts', () => {
    expect(ITEMS_ORIGINE.quotidien[0].id).toBe('plats_service')
    expect(ITEMS_ORIGINE.hebdo[0].id).toBe('int_frigos')
    expect(ITEMS_ORIGINE.mensuel[0].id).toBe('placard_rangement')
  })
})

describe('mergeHygieneItems', () => {
  it('rend les items d’origine sur un document absent', () => {
    expect(mergeHygieneItems(undefined)).toEqual(ITEMS_ORIGINE)
    expect(mergeHygieneItems({})).toEqual(ITEMS_ORIGINE)
  })

  it('remplace entièrement une liste fournie', () => {
    const perso = [{ id: 'a', label: 'A', actif: true, ordre: 0 }]
    const merged = mergeHygieneItems({ quotidien: perso })
    expect(merged.quotidien).toEqual(perso)
    // Les listes non fournies gardent leurs items d'origine.
    expect(merged.hebdo).toEqual(ITEMS_ORIGINE.hebdo)
  })

  it('ignore une liste qui n’est pas un tableau', () => {
    expect(mergeHygieneItems({ hebdo: 'nope' }).hebdo).toEqual(ITEMS_ORIGINE.hebdo)
  })

  it('trie par ordre croissant', () => {
    const merged = mergeHygieneItems({ mensuel: [
      { id: 'b', label: 'B', actif: true, ordre: 5 },
      { id: 'a', label: 'A', actif: true, ordre: 1 },
    ] })
    expect(merged.mensuel.map(i => i.id)).toEqual(['a', 'b'])
  })
})

describe('debutPeriode', () => {
  it('rend le jour même à minuit pour le quotidien', () => {
    const d = debutPeriode('quotidien', at(2026, 7, 29, 18))
    expect(d.getDate()).toBe(29)
    expect(d.getHours()).toBe(0)
  })

  it('rend le lundi de la semaine ISO pour l’hebdo', () => {
    const d = debutPeriode('hebdo', at(2026, 7, 30)) // jeudi
    expect(d.getDate()).toBe(27)                     // lundi
    expect(d.getHours()).toBe(0)
  })

  it('rend le 1er du mois pour le mensuel', () => {
    const d = debutPeriode('mensuel', at(2026, 7, 29))
    expect(d.getDate()).toBe(1)
    expect(d.getMonth()).toBe(6)
  })
})

describe('itemsPourPeriode — la garantie centrale', () => {
  const nouveau = (creeLe: Date) => ({
    quotidien: [
      ...ITEMS_ORIGINE.quotidien,
      { id: 'nouveau', label: 'Nouveau', actif: true, ordre: 13, creeLe },
    ],
    hebdo: [
      ...ITEMS_ORIGINE.hebdo,
      { id: 'neuf_hebdo', label: 'Neuf', actif: true, ordre: 5, creeLe },
    ],
    mensuel: [
      ...ITEMS_ORIGINE.mensuel,
      { id: 'neuf_mensuel', label: 'Neuf', actif: true, ordre: 1, creeLe },
    ],
  })

  // Le besoin exprimé mot pour mot : « je ne veux pas que si j'ajoute un item
  // le 29 ça me mette le mois passé en incomplet ».
  it('un item créé le 29 ne compte pas pour le mois en cours', () => {
    const s = nouveau(at(2026, 7, 29))
    const ids = idsAttendus(s, 'mensuel', at(2026, 7, 31))
    expect(ids).not.toContain('neuf_mensuel')
    expect(ids).toHaveLength(1)
  })

  it('mais compte pour le mois suivant', () => {
    const s = nouveau(at(2026, 7, 29))
    expect(idsAttendus(s, 'mensuel', at(2026, 8, 3))).toContain('neuf_mensuel')
  })

  // « Idem pour un item hebdo entré le mercredi, la semaine ne doit pas être
  // affichée incomplète ».
  it('un item hebdo créé le mercredi ne compte pas pour la semaine en cours', () => {
    const s = nouveau(at(2026, 7, 29))             // mercredi
    const ids = idsAttendus(s, 'hebdo', at(2026, 7, 31)) // vendredi, même semaine
    expect(ids).not.toContain('neuf_hebdo')
  })

  it('mais compte pour la semaine suivante', () => {
    const s = nouveau(at(2026, 7, 29))
    expect(idsAttendus(s, 'hebdo', at(2026, 8, 5))).toContain('neuf_hebdo')
  })

  it('un item quotidien créé aujourd’hui compte à partir de demain', () => {
    const s = nouveau(at(2026, 7, 29, 14))
    expect(idsAttendus(s, 'quotidien', at(2026, 7, 29, 18))).not.toContain('nouveau')
    expect(idsAttendus(s, 'quotidien', at(2026, 7, 30, 9))).toContain('nouveau')
  })

  it('exclut les items désactivés', () => {
    const s = { ...ITEMS_ORIGINE, mensuel: [
      { ...ITEMS_ORIGINE.mensuel[0], actif: false },
    ] }
    expect(idsAttendus(s, 'mensuel', at(2026, 7, 15))).toEqual([])
  })

  it('inclut les items d’origine quelle que soit la période', () => {
    expect(idsAttendus(ITEMS_ORIGINE, 'quotidien', at(2020, 1, 1))).toHaveLength(13)
  })
})

describe('itemsPourPeriode — période déjà sauvegardée', () => {
  // Deuxième protection : une resauvegarde ne rebat pas les cartes.
  it('respecte itemsAttendus quand il existe, sans le recalculer', () => {
    const s = mergeHygieneItems({})
    const fige = ['plats_service', 'ustensiles']
    const items = itemsPourPeriode(s, 'quotidien', new Date(), fige)
    expect(items.map(i => i.id)).toEqual(fige)
  })

  it('affiche un identifiant inconnu plutôt que de le faire disparaître', () => {
    const s = mergeHygieneItems({})
    const items = itemsPourPeriode(s, 'quotidien', new Date(), ['inconnu_xyz'])
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('inconnu_xyz')
    expect(items[0].label).toBe('inconnu_xyz')
  })

  it('rend un item désactivé s’il figure dans itemsAttendus', () => {
    const s = { ...ITEMS_ORIGINE, mensuel: [{ ...ITEMS_ORIGINE.mensuel[0], actif: false }] }
    const items = itemsPourPeriode(s, 'mensuel', new Date(), ['placard_rangement'])
    expect(items.map(i => i.id)).toEqual(['placard_rangement'])
  })
})

describe('slugPourLabel', () => {
  it('produit un identifiant lisible', () => {
    expect(slugPourLabel('Plan de travail', [])).toBe('plan_de_travail')
  })

  it('retire les accents et la ponctuation', () => {
    expect(slugPourLabel('Évier / Distributeur papier', [])).toBe('evier_distributeur_papier')
  })

  it('suffixe en cas de collision', () => {
    expect(slugPourLabel('Vitres', ['vitres'])).toBe('vitres_2')
    expect(slugPourLabel('Vitres', ['vitres', 'vitres_2'])).toBe('vitres_3')
  })

  it('rend un identifiant utilisable même pour un libellé vide', () => {
    expect(slugPourLabel('   ', []).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./hygieneItems"`

- [ ] **Step 3 : Écrire l'implémentation**

Créer `src/utils/hygieneItems.ts` :

```ts
/** Items des checklists d'hygiène — définition, éligibilité, sélection.
 *
 *  Règle centrale : un item ne s'applique qu'aux périodes qui COMMENCENT
 *  après sa création. Ajouter un item ne peut donc jamais rendre incomplète
 *  une période passée ou en cours — c'est la garantie demandée sur un
 *  registre sanitaire, où réécrire le passé n'est pas acceptable. */

export type ChecklistKind = 'quotidien' | 'hebdo' | 'mensuel'

export type HygieneItem = {
  id: string        // immuable — c'est lui qui rattache l'historique
  label: string     // renommable librement
  actif: boolean
  ordre: number
  /** Timestamp Firestore ou Date. Absent = item d'origine, toujours éligible. */
  creeLe?: any
}

export type HygieneItemsSettings = Record<ChecklistKind, HygieneItem[]>

export const CHECKLIST_KINDS: ChecklistKind[] = ['quotidien', 'hebdo', 'mensuel']

const item = (id: string, label: string, ordre: number): HygieneItem =>
  ({ id, label, actif: true, ordre })

/** Les 19 items d'origine, GELÉS.
 *
 *  Ils ne doivent plus jamais être modifiés : toute évolution passe désormais
 *  par `settings/hygiene_items`. Leur seul rôle résiduel est de servir de
 *  repli pour les documents `hygiene_corner` antérieurs à cette évolution —
 *  c'est ce qui met l'historique existant définitivement à l'abri. */
export const ITEMS_ORIGINE: HygieneItemsSettings = {
  quotidien: [
    item('plats_service',    'Plats de service',                    0),
    item('int_vitrines',     'Intérieur vitrines libre service',    1),
    item('ustensiles',       'Ustensiles',                          2),
    item('meuble_vente',     'Meuble de vente',                     3),
    item('comptoir_balance', 'Comptoir / balance',                  4),
    item('micro_ondes',      'Micro-ondes',                         5),
    item('evier_papier',     'Évier / Distributeur papier',         6),
    item('etiquettes',       'Étiquettes',                          7),
    item('plan_travail',     'Plan de travail',                     8),
    item('ext_placards',     'Extérieur placards rangement',        9),
    item('ext_frigo',        'Extérieur frigo',                    10),
    item('poubelle',         'Poubelle',                           11),
    item('vitres',           'Vitres',                             12),
  ],
  hebdo: [
    item('int_frigos',         'Intérieur frigos',        0),
    item('etageres_materiels', 'Étagères porte matériels', 1),
    item('support_papier',     'Support rouleau papier',   2),
    item('placard_hygiene',    'Placard hygiène',          3),
    item('machine_glacon',     'Machine à Glaçons',        4),
  ],
  mensuel: [
    item('placard_rangement', 'Placard rangement', 0),
  ],
}

export function mergeHygieneItems(data: any): HygieneItemsSettings {
  const d = data ?? {}
  const out = {} as HygieneItemsSettings
  for (const kind of CHECKLIST_KINDS) {
    const brut = d[kind]
    // Une liste fournie REMPLACE celle d'origine — on ne fusionne pas item par
    // item : retirer un item doit être possible, une fusion le ferait revenir.
    out[kind] = Array.isArray(brut) && brut.length
      ? [...brut].sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0))
      : ITEMS_ORIGINE[kind]
  }
  return out
}

/** Début de la période contenant `ref`. C'est la borne comparée à `creeLe`. */
export function debutPeriode(kind: ChecklistKind, ref: Date): Date {
  const d = new Date(ref)
  d.setHours(0, 0, 0, 0)
  if (kind === 'quotidien') return d
  if (kind === 'hebdo') {
    const dow = d.getDay() === 0 ? 6 : d.getDay() - 1 // lundi = 0
    d.setDate(d.getDate() - dow)
    return d
  }
  d.setDate(1)
  return d
}

/** Millisecondes d'un `creeLe`, qu'il soit Date, Timestamp Firestore, ou absent. */
function creeLeMs(creeLe: any): number | null {
  if (creeLe == null) return null
  if (typeof creeLe?.toMillis === 'function') return creeLe.toMillis()
  if (creeLe instanceof Date) return creeLe.getTime()
  if (typeof creeLe?.seconds === 'number') return creeLe.seconds * 1000
  const n = new Date(creeLe).getTime()
  return Number.isFinite(n) ? n : null
}

/**
 * Les items d'une période.
 *
 * Si `itemsAttendus` est fourni — la période a déjà été sauvegardée — c'est
 * lui qui fait foi, tel quel : ce qui est affiché est ce qui est jugé, et une
 * resauvegarde ne rebat pas les cartes.
 *
 * Sinon, les items actifs créés avant le début de la période.
 */
export function itemsPourPeriode(
  settings: HygieneItemsSettings,
  kind: ChecklistKind,
  ref: Date,
  itemsAttendus?: string[] | null,
): HygieneItem[] {
  const liste = settings[kind] ?? []

  if (itemsAttendus?.length) {
    const parId = new Map(liste.map(i => [i.id, i]))
    // Un identifiant absent des réglages s'affiche brut plutôt que de
    // disparaître : une case cochée qui s'évapore d'un registre HACCP est
    // pire qu'un libellé disgracieux.
    return itemsAttendus.map((id, i) =>
      parId.get(id) ?? { id, label: id, actif: false, ordre: i })
  }

  const debut = debutPeriode(kind, ref).getTime()
  return liste
    .filter(i => i.actif)
    .filter(i => {
      const ms = creeLeMs(i.creeLe)
      return ms === null || ms < debut
    })
}

export function idsAttendus(
  settings: HygieneItemsSettings,
  kind: ChecklistKind,
  ref: Date,
  itemsAttendus?: string[] | null,
): string[] {
  return itemsPourPeriode(settings, kind, ref, itemsAttendus).map(i => i.id)
}

/** Identifiant stable dérivé du libellé, unique parmi `idsExistants`. */
export function slugPourLabel(label: string, idsExistants: string[]): string {
  const base = label
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // retire les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    || `item_${idsExistants.length + 1}`

  if (!idsExistants.includes(base)) return base
  let n = 2
  while (idsExistants.includes(`${base}_${n}`)) n++
  return `${base}_${n}`
}
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run: `npm test`
Expected: PASS — tous les tests, y compris les 74 existants

- [ ] **Step 5 : Vérifier le typage**

Run: `npm run build`
Expected: build réussi

- [ ] **Step 6 : Commit**

```bash
git add src/utils/hygieneItems.ts src/utils/hygieneItems.test.ts
git commit -m "feat(hygiene): modèle des items de checklist

Un item ne s'applique qu'aux périodes commençant après sa création, et
une période déjà sauvegardée garde la liste qui lui était demandée.
Ajouter un item ne peut donc jamais rendre incomplet du travail déjà
fait. Les 19 items d'origine sont gelés comme unique repli."
```

---

## Tâche 2 : Complétude fondée sur `itemsAttendus`

**Files:**
- Modify: `src/modules/corner/utils/hygiene.ts`
- Modify: `functions/src/hygiene/periods.ts`
- Modify: `functions/src/hygiene/periods.test.ts`
- Modify: `functions/src/index.ts`
- Modify: `src/modules/corner/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: rien de la Tâche 1 (duplication assumée — voir ci-dessous)
- Produces, des deux côtés :
  - `ITEMS_ORIGINE_IDS: Record<'quotidien' | 'hebdo' | 'mensuel', string[]>` (remplace `QUOTIDIEN_IDS` / `HEBDO_IDS` / `MENSUEL_IDS`)
  - `estComplete(docData: any, kind: 'quotidien' | 'hebdo' | 'mensuel'): boolean`

⚠️ **Ne pas importer `src/utils/hygieneItems.ts` depuis `functions/`** : aucun import n'existe entre les deux packages. Les identifiants d'origine y sont redéclarés, comme le reste de la logique partagée de ce projet.

- [ ] **Step 1 : Écrire les tests côté fonctions**

Dans `functions/src/hygiene/periods.test.ts`, remplacer le bloc
`describe('isHygieneDone (serveur)', …)` par :

```ts
describe('estComplete', () => {
  const tousCoches = (ids: string[]) => Object.fromEntries(ids.map(id => [id, true]))

  it('est faux sur un document absent', () => {
    expect(estComplete(undefined, 'hebdo')).toBe(false)
    expect(estComplete(null, 'hebdo')).toBe(false)
  })

  // La protection décisive : un document antérieur à l'édition des items
  // se juge sur les items d'ORIGINE, jamais sur une liste courante qui aurait
  // pu s'allonger depuis. Sans ça, le premier ajout d'item aurait basculé
  // tout l'historique en incomplet.
  it('juge un document sans itemsAttendus sur les items d’origine', () => {
    const doc = { items: tousCoches(ITEMS_ORIGINE_IDS.hebdo) }
    expect(estComplete(doc, 'hebdo')).toBe(true)
  })

  it('est faux si un item d’origine manque', () => {
    const items = tousCoches(ITEMS_ORIGINE_IDS.hebdo)
    delete items[ITEMS_ORIGINE_IDS.hebdo[0]]
    expect(estComplete({ items }, 'hebdo')).toBe(false)
  })

  it('juge sur itemsAttendus quand il est présent', () => {
    const doc = { items: { a: true, b: true }, itemsAttendus: ['a', 'b'] }
    expect(estComplete(doc, 'hebdo')).toBe(true)
  })

  it('ignore les items cochés hors de itemsAttendus', () => {
    const doc = { items: { a: true, vieux: true }, itemsAttendus: ['a'] }
    expect(estComplete(doc, 'hebdo')).toBe(true)
  })

  it('est faux si un item attendu manque', () => {
    const doc = { items: { a: true }, itemsAttendus: ['a', 'b'] }
    expect(estComplete(doc, 'hebdo')).toBe(false)
  })

  it('couvre le quotidien', () => {
    const doc = { items: tousCoches(ITEMS_ORIGINE_IDS.quotidien) }
    expect(estComplete(doc, 'quotidien')).toBe(true)
    expect(ITEMS_ORIGINE_IDS.quotidien).toHaveLength(13)
  })
})
```

Mettre à jour l'import du haut du fichier : remplacer `isHygieneDone, HEBDO_IDS, MENSUEL_IDS, QUOTIDIEN_IDS` par `estComplete, ITEMS_ORIGINE_IDS`. Conserver le reste.

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected: FAIL — `estComplete` et `ITEMS_ORIGINE_IDS` n'existent pas

- [ ] **Step 3 : Implémenter côté fonctions**

Dans `functions/src/hygiene/periods.ts`, remplacer les trois constantes
`QUOTIDIEN_IDS`, `HEBDO_IDS`, `MENSUEL_IDS` et la fonction `isHygieneDone` par :

```ts
/** Identifiants des items d'ORIGINE, GELÉS.
 *
 *  Ne jamais les modifier : les items évoluent désormais dans
 *  `settings/hygiene_items`. Ils servent uniquement de repli pour les
 *  documents `hygiene_corner` antérieurs, qui ne portent pas `itemsAttendus`.
 *  Les juger sur la liste courante rendrait tout l'historique incomplet au
 *  premier ajout d'item. */
export const ITEMS_ORIGINE_IDS: Record<'quotidien' | 'hebdo' | 'mensuel', string[]> = {
  quotidien: [
    'plats_service', 'int_vitrines', 'ustensiles', 'meuble_vente',
    'comptoir_balance', 'micro_ondes', 'evier_papier', 'etiquettes',
    'plan_travail', 'ext_placards', 'ext_frigo', 'poubelle', 'vitres',
  ],
  hebdo: [
    'int_frigos', 'etageres_materiels', 'support_papier',
    'placard_hygiene', 'machine_glacon',
  ],
  mensuel: ['placard_rangement'],
}

/** Une période est faite quand tous les items QUI LUI ÉTAIENT DEMANDÉS sont
 *  cochés. Le document porte lui-même sa référence (`itemsAttendus`), donc
 *  aucune lecture supplémentaire n'est nécessaire ici. */
export function estComplete(
  docData: any,
  kind: 'quotidien' | 'hebdo' | 'mensuel',
): boolean {
  if (!docData) return false
  const attendus: string[] = Array.isArray(docData.itemsAttendus) && docData.itemsAttendus.length
    ? docData.itemsAttendus
    : ITEMS_ORIGINE_IDS[kind]
  const items = docData.items ?? {}
  return attendus.every(id => items[id] === true)
}
```

Supprimer `itemIdsFor` si plus aucun appelant ne subsiste — le vérifier par
`grep -rn "itemIdsFor" functions/src`.

- [ ] **Step 4 : Migrer les appelants dans `functions/src/index.ts`**

Remplacer l'import : `isHygieneDone, itemIdsFor, QUOTIDIEN_IDS` deviennent
`estComplete`. Conserver le reste de la ligne.

Puis les quatre appels :

```ts
// hygieneRappelsResponsables — remplacer
//   if (isHygieneDone(checkSnap.data()?.items, itemIdsFor(kind))) {
if (estComplete(checkSnap.data(), kind)) {

// notifHygieneHebdo — remplacer
//   if (isHygieneDone(snap.data()?.items, itemIdsFor('hebdo'))) {
if (estComplete(snap.data(), 'hebdo')) {

// notifHygieneMensuel — idem avec 'mensuel'
if (estComplete(snap.data(), 'mensuel')) {
```

Dans `weeklyHygieneRecap`, remplacer les deux tests et les décomptes :

```ts
// quotidien
const snap = await db.doc(`hygiene_corner/${day}_quotidien`).get()
if (!estComplete(snap.data(), 'quotidien')) {
  const attendus = snap.data()?.itemsAttendus ?? ITEMS_ORIGINE_IDS.quotidien
  const coches = attendus.filter((id: string) => snap.data()?.items?.[id] === true).length
  missingHygiene.push(`  ${day} — ${coches}/${attendus.length} coché(s)`)
}

// hebdo
const missingHebdo = !estComplete(hebdoSnap.data(), 'hebdo') ? `  ${weekId}_hebdo` : null
```

Ajouter `ITEMS_ORIGINE_IDS` à l'import si le décompte l'utilise.

- [ ] **Step 5 : Implémenter côté client**

Côté client, **ne pas redéclarer les items d'origine** : `src/utils/hygieneItems.ts`
(Tâche 1) les porte déjà, et les deux fichiers sont dans le même package npm —
l'import est donc possible, contrairement au cas des fonctions Cloud.

Dans `src/modules/corner/utils/hygiene.ts` :

```ts
import { ITEMS_ORIGINE, type ChecklistKind } from '../../../utils/hygieneItems'

/** Identifiants des items d'origine, dérivés de la définition unique du
 *  client. Côté fonctions Cloud ils sont redéclarés — aucun import n'existe
 *  entre les deux packages — mais côté client une seule source suffit. */
export const ITEMS_ORIGINE_IDS: Record<ChecklistKind, string[]> = {
  quotidien: ITEMS_ORIGINE.quotidien.map(i => i.id),
  hebdo:     ITEMS_ORIGINE.hebdo.map(i => i.id),
  mensuel:   ITEMS_ORIGINE.mensuel.map(i => i.id),
}

/** Une période est faite quand tous les items QUI LUI ÉTAIENT DEMANDÉS sont
 *  cochés. Le document porte lui-même sa référence (`itemsAttendus`), donc
 *  aucune lecture supplémentaire n'est nécessaire ici. */
export function estComplete(docData: any, kind: ChecklistKind): boolean {
  if (!docData) return false
  const attendus: string[] = Array.isArray(docData.itemsAttendus) && docData.itemsAttendus.length
    ? docData.itemsAttendus
    : ITEMS_ORIGINE_IDS[kind]
  const items = docData.items ?? {}
  return attendus.every(id => items[id] === true)
}
```

Supprimer les trois anciennes constantes, `isHygieneDone` et `itemIdsFor` si
plus aucun appelant ne subsiste.

Dans `src/modules/corner/pages/Dashboard.tsx`, remplacer l'import et les trois
appels :

```tsx
import { estComplete, getPeriodId } from '../utils/hygiene'
…
      setHygieneOk(estComplete(hygieneSnap.data(), 'quotidien'))
      setHygieneHebdoOk(estComplete(hygieneHebdoSnap.data(), 'hebdo'))
      setHygieneMensuelOk(estComplete(hygieneMensuelSnap.data(), 'mensuel'))
```

- [ ] **Step 6 : Traiter les appelants restants dans `Hygiene.tsx`**

`Hygiene.tsx` utilise encore `QUOTIDIEN_IDS`, `HEBDO_IDS` et `MENSUEL_IDS` dans
`loadHistorique` pour les décomptes. Les remplacer temporairement par
`ITEMS_ORIGINE_IDS.quotidien` etc. — la Tâche 4 les fera lire les vrais
`itemsAttendus`. Le but ici est seulement que le fichier compile.

Vérifier ensuite : `grep -rn "QUOTIDIEN_IDS\|HEBDO_IDS\|MENSUEL_IDS\|isHygieneDone" src/ functions/src` ne doit plus rien renvoyer hors fichiers de test à jour.

- [ ] **Step 7 : Vérifier**

```bash
npm test
npm run build
cd functions && npm run build && cd ..
```
Expected: les trois réussissent

- [ ] **Step 8 : Commit**

```bash
git add src/modules/corner/utils/hygiene.ts src/modules/corner/pages/Dashboard.tsx src/modules/corner/pages/Hygiene.tsx functions/src/hygiene/periods.ts functions/src/hygiene/periods.test.ts functions/src/index.ts functions/lib
git commit -m "feat(hygiene): complétude jugée sur itemsAttendus du document

Chaque checklist portera sa propre liste de référence, ce qui permet au
Dashboard et aux fonctions Cloud de juger une période sans lecture
supplémentaire. Les documents antérieurs retombent sur les items
d'origine, gelés — jamais sur la liste courante, qui rendrait tout
l'historique incomplet au premier ajout."
```

---

## Tâche 3 : Section d'édition dans Paramètres

**Files:**
- Create: `src/components/settings/HygieneItemsSection.tsx`
- Modify: `src/pages/AdminSettings.tsx`

**Interfaces:**
- Consumes: `HygieneItemsSettings`, `HygieneItem`, `ChecklistKind`, `CHECKLIST_KINDS`, `ITEMS_ORIGINE`, `mergeHygieneItems`, `slugPourLabel` (Tâche 1)
- Produces: composant `<HygieneItemsSection value onChange />`

- [ ] **Step 1 : Créer le composant**

Créer `src/components/settings/HygieneItemsSection.tsx` :

```tsx
import { useState, type ReactNode } from 'react'
import { Timestamp } from 'firebase/firestore'
import {
  CHECKLIST_KINDS, slugPourLabel,
  type ChecklistKind, type HygieneItem, type HygieneItemsSettings,
} from '../../utils/hygieneItems'

type Props = {
  value: HygieneItemsSettings
  onChange: (next: HygieneItemsSettings) => void
}

const TITRES: Record<ChecklistKind, string> = {
  quotidien: 'Quotidien',
  hebdo:     'Hebdomadaire',
  mensuel:   'Mensuel',
}

function Bloc({ titre, resume, children }: { titre: string; resume: string; children: ReactNode }) {
  const [ouvert, setOuvert] = useState(false)
  return (
    <div style={{ borderTop: '1px solid var(--border-soft)' }}>
      <button
        onClick={() => setOuvert(o => !o)}
        style={{
          width: '100%', minHeight: 44, padding: '10px 0', border: 'none',
          background: 'transparent', cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between', gap: 12,
          fontFamily: 'Manrope, sans-serif', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface)' }}>
          {ouvert ? '▾' : '▸'} {titre}
        </span>
        {!ouvert && (
          <span style={{ fontSize: 11, color: 'var(--on-surface-3)', whiteSpace: 'nowrap' }}>
            {resume}
          </span>
        )}
      </button>
      {ouvert && <div style={{ paddingBottom: 12 }}>{children}</div>}
    </div>
  )
}

const btnOrdre = {
  width: 32, minHeight: 44, border: 'none', background: 'transparent',
  color: 'var(--primary)', fontSize: 15, cursor: 'pointer', flexShrink: 0,
} as const

export default function HygieneItemsSection({ value, onChange }: Props) {
  const [nouveaux, setNouveaux] = useState<Record<string, string>>({})

  const setListe = (kind: ChecklistKind, liste: HygieneItem[]) =>
    onChange({ ...value, [kind]: liste.map((it, i) => ({ ...it, ordre: i })) })

  const majItem = (kind: ChecklistKind, id: string, patch: Partial<HygieneItem>) =>
    setListe(kind, value[kind].map(it => (it.id === id ? { ...it, ...patch } : it)))

  /** Retirer un item pose sa date de désactivation ; le réactiver l'efface.
   *
   *  Cette date est ce qui fait qu'un item retiré continue de compter pour une
   *  période déjà commencée : retirer un point de contrôle ne doit pas alléger
   *  rétroactivement une semaine en cours, sinon on peut effacer une exigence
   *  après coup sur un registre sanitaire. */
  function basculerActif(kind: ChecklistKind, it: HygieneItem, actif: boolean) {
    if (actif) {
      // Jamais `undefined` dans Firestore : on reconstruit l'objet sans la clé.
      const { desactiveLe, ...reste } = it
      void desactiveLe
      setListe(kind, value[kind].map(x => (x.id === it.id ? { ...reste, actif: true } : x)))
    } else {
      majItem(kind, it.id, { actif: false, desactiveLe: Timestamp.now() })
    }
  }

  function deplacer(kind: ChecklistKind, index: number, delta: number) {
    const actifs = value[kind].filter(i => i.actif)
    const cible = index + delta
    if (cible < 0 || cible >= actifs.length) return
    const reordonne = [...actifs]
    ;[reordonne[index], reordonne[cible]] = [reordonne[cible], reordonne[index]]
    // Les items retirés restent à la fin, hors du réordonnancement.
    setListe(kind, [...reordonne, ...value[kind].filter(i => !i.actif)])
  }

  function ajouter(kind: ChecklistKind) {
    const label = (nouveaux[kind] ?? '').trim()
    if (!label) return
    const tousIds = CHECKLIST_KINDS.flatMap(k => value[k].map(i => i.id))
    const nouvel: HygieneItem = {
      id: slugPourLabel(label, tousIds),
      label,
      actif: true,
      ordre: value[kind].length,
      // Posé automatiquement : c'est lui qui garantit que l'item ne compte
      // qu'à partir de la période suivante.
      creeLe: Timestamp.now(),
    }
    const actifs = value[kind].filter(i => i.actif)
    setListe(kind, [...actifs, nouvel, ...value[kind].filter(i => !i.actif)])
    setNouveaux(n => ({ ...n, [kind]: '' }))
  }

  return (
    <div>
      <p className="section-label" style={{ marginBottom: 8 }}>Nettoyage — items des checklists</p>
      <div className="card" style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginBottom: 4 }}>
          Les points de contrôle affichés dans l'onglet Nettoyage du corner.
        </div>

        {CHECKLIST_KINDS.map(kind => {
          const actifs = value[kind].filter(i => i.actif)
          const retires = value[kind].filter(i => !i.actif)
          return (
            <Bloc
              key={kind}
              titre={TITRES[kind]}
              resume={`${actifs.length} item${actifs.length > 1 ? 's' : ''}`}
            >
              {actifs.map((it, i) => (
                <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                  <button onClick={() => deplacer(kind, i, -1)} disabled={i === 0}
                    style={{ ...btnOrdre, opacity: i === 0 ? 0.25 : 1 }} title="Monter">↑</button>
                  <button onClick={() => deplacer(kind, i, 1)} disabled={i === actifs.length - 1}
                    style={{ ...btnOrdre, opacity: i === actifs.length - 1 ? 0.25 : 1 }} title="Descendre">↓</button>
                  <input
                    className="input-filled"
                    style={{ flex: 1, minHeight: 44 }}
                    value={it.label}
                    onChange={e => majItem(kind, it.id, { label: e.target.value })}
                  />
                  <button
                    onClick={() => basculerActif(kind, it, false)}
                    title="Retirer des prochaines checklists"
                    style={{ ...btnOrdre, width: 36, color: 'var(--danger)' }}
                  >✕</button>
                </div>
              ))}

              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <input
                  className="input-filled"
                  style={{ flex: 1, minHeight: 44 }}
                  placeholder="Nouveau point de contrôle…"
                  value={nouveaux[kind] ?? ''}
                  onChange={e => setNouveaux(n => ({ ...n, [kind]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') ajouter(kind) }}
                />
                <button
                  onClick={() => ajouter(kind)}
                  disabled={!(nouveaux[kind] ?? '').trim()}
                  className="btn-secondary"
                  style={{ minHeight: 44, whiteSpace: 'nowrap' }}
                >+ Ajouter</button>
              </div>

              <p style={{ fontSize: 11, color: 'var(--on-surface-3)', margin: '10px 0 0' }}>
                Un item ajouté aujourd'hui comptera à partir de la prochaine période.
                Les périodes en cours et passées ne changent pas.
              </p>

              {retires.length > 0 && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-soft)' }}>
                  <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginBottom: 6 }}>
                    Retirés — conservés pour rester lisibles dans l'historique
                  </div>
                  {retires.map(it => (
                    <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--on-surface-3)', textDecoration: 'line-through' }}>
                        {it.label}
                      </span>
                      <button
                        onClick={() => basculerActif(kind, it, true)}
                        className="btn-secondary"
                        style={{ minHeight: 44, fontSize: 12 }}
                      >Réactiver</button>
                    </div>
                  ))}
                </div>
              )}
            </Bloc>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2 : Brancher dans AdminSettings**

Dans `src/pages/AdminSettings.tsx` :

```tsx
import HygieneItemsSection from '../components/settings/HygieneItemsSection'
import {
  ITEMS_ORIGINE, mergeHygieneItems, type HygieneItemsSettings,
} from '../utils/hygieneItems'
```

État, à côté de `hygieneResp` :

```tsx
  const [hygieneItems, setHygieneItems] = useState<HygieneItemsSettings>(ITEMS_ORIGINE)
```

Chargement — ajouter l'appel **en dernière position** du `Promise.all` existant
et la variable **en dernière position** de la déstructuration, dans le même
ordre. Puis :

```tsx
      if (hygieneItemsSnap.exists()) {
        setHygieneItems(mergeHygieneItems(hygieneItemsSnap.data()))
      }
```

Sauvegarde — ajouter en dernière position du `Promise.all` de sauvegarde :

```tsx
        setDoc(doc(db, 'settings', 'hygiene_items'), hygieneItems),
```

Rendu — juste après `<HygieneResponsablesSection … />` :

```tsx
      <HygieneItemsSection value={hygieneItems} onChange={setHygieneItems} />
```

⚠️ L'ordre du tableau et celui de la déstructuration doivent correspondre
exactement : les intervertir donnerait des réglages silencieusement mélangés
entre documents Firestore.

- [ ] **Step 3 : Vérifier**

```bash
npm run build && npm test
```
Expected: build réussi, tous les tests verts

- [ ] **Step 4 : Vérification statique**

`npm run dev` n'est pas autorisé. Vérifier par relecture :
1. Aucune couleur en dur — uniquement les variables CSS.
2. Tous les éléments interactifs à `minHeight: 44`.
3. Aucun `undefined` possible : `creeLe` est toujours posé, `label` toujours une chaîne, `ordre` recalculé à chaque écriture.
4. Ajouter un item avec un libellé vide est impossible (bouton désactivé).

Lister dans le rapport ce qui reste à vérifier visuellement.

- [ ] **Step 5 : Commit**

```bash
git add src/components/settings/HygieneItemsSection.tsx src/pages/AdminSettings.tsx
git commit -m "feat(hygiene): édition des items depuis Paramètres

Ajouter, renommer, réordonner et retirer les points de contrôle des
trois checklists. Un item retiré est conservé, jamais supprimé : sans
lui l'historique où il figure deviendrait illisible."
```

---

## Tâche 4 : La checklist lit les réglages

**Files:**
- Modify: `src/modules/corner/pages/Hygiene.tsx`

**Interfaces:**
- Consumes: `itemsPourPeriode`, `idsAttendus`, `mergeHygieneItems`, `ITEMS_ORIGINE`, `HygieneItemsSettings`, `ChecklistKind` (Tâche 1)
- Produces: rien

- [ ] **Step 1 : Charger les réglages**

Ajouter aux imports :

```tsx
import {
  ITEMS_ORIGINE, mergeHygieneItems, itemsPourPeriode, idsAttendus,
  type HygieneItemsSettings, type ChecklistKind,
} from '../../../utils/hygieneItems'
import { ITEMS_ORIGINE_IDS } from '../utils/hygiene'
```

`ITEMS_ORIGINE_IDS` sert de repli dans les décomptes de l'historique (Step 4).

Supprimer la constante locale `ITEMS` et le type `CheckItem` s'il n'a plus
d'usage.

Ajouter un état et son chargement, une seule fois au montage :

```tsx
  const [itemsSettings, setItemsSettings] = useState<HygieneItemsSettings>(ITEMS_ORIGINE)

  useEffect(() => {
    getDoc(doc(db, 'settings', 'hygiene_items'))
      .then(snap => { if (snap.exists()) setItemsSettings(mergeHygieneItems(snap.data())) })
      // Repli silencieux sur les items d'origine : la checklist doit rester
      // utilisable même si les réglages sont illisibles.
      .catch(e => console.error('[hygiene] réglages des items illisibles', e))
  }, [])
```

- [ ] **Step 2 : Construire la liste affichée**

Remplacer la ligne qui calcule `items` :

```tsx
  const items = tab !== 'historique'
    ? itemsPourPeriode(
        itemsSettings,
        tab as ChecklistKind,
        new Date(selectedDate + 'T12:00:00'),
        (saved as any)?.itemsAttendus,
      )
    : []
```

`saved` porte le document déjà chargé par `loadTab` : si la période a déjà été
sauvegardée, c'est sa propre liste qui s'affiche. Ce qui est montré est ce qui
est jugé.

- [ ] **Step 3 : Écrire `itemsAttendus` à la première sauvegarde**

Remplacer `saveCheck` :

```tsx
  async function saveCheck() {
    setSaving(true)
    setSaveError('')
    try {
      const uid = auth.currentUser?.uid || ''
      // Écrit une seule fois, à la première sauvegarde de la période : une
      // resauvegarde ne doit pas rebattre les cartes en cours de semaine.
      const attendus = (saved as any)?.itemsAttendus ?? idsAttendus(
        itemsSettings,
        tab as ChecklistKind,
        new Date(selectedDate + 'T12:00:00'),
      )
      const data = {
        items: checked,
        createdAt: Timestamp.now(),
        createdBy: uid,
        itemsAttendus: attendus,
      }
      await setDoc(doc(db, 'hygiene_corner', getDocId(tab, selectedDate)), data)
      setSaved(data as any)
      show('Checklist sauvegardée')
    } catch (e: any) {
      // Le bandeau rouge est la seule preuve visible qu'une écriture a été
      // refusée — un alert() se perd sur mobile.
      setSaveError(e?.message || 'Enregistrement impossible')
    } finally { setSaving(false) }
  }
```

Ajouter l'état `const [saveError, setSaveError] = useState('')` et, sous le
bouton de sauvegarde, le bandeau correspondant :

```tsx
          {saveError && (
            <div style={{
              padding: '10px 12px', borderRadius: 10,
              background: 'rgba(192,57,43,0.08)', color: 'var(--danger)',
              fontSize: 12, fontWeight: 600,
            }}>
              ⚠️ {saveError}
            </div>
          )}
```

Cela remplace l'`alert(e?.message)` actuel, qui viole la règle projet
« un `catch` qui surface l'erreur à l'écran ».

- [ ] **Step 4 : Les décomptes de l'historique**

Dans `loadHistorique`, remplacer les usages de `ITEMS_ORIGINE_IDS.*` introduits
en Tâche 2 par la liste réellement attendue de chaque document :

```tsx
        const data = snap.exists() ? (snap.data() as any) : null
        const attendus: string[] = data?.itemsAttendus ?? ITEMS_ORIGINE_IDS.quotidien
        dayResults[dateStr] = data
          ? { total: attendus.length, done: attendus.filter(id => data.items?.[id]).length }
          : null
```

Appliquer le même traitement aux blocs hebdo, mensuel, et à la boucle de
statuts de l'historique des responsables — en utilisant à chaque fois la liste
d'origine correspondante en repli.

- [ ] **Step 5 : Vérifier**

```bash
npm run build && npm test
```
Expected: build réussi, tests verts

Vérifier ensuite qu'aucun `alert(` ne subsiste dans le fichier :
`grep -n "alert(" src/modules/corner/pages/Hygiene.tsx`

- [ ] **Step 6 : Commit**

```bash
git add src/modules/corner/pages/Hygiene.tsx
git commit -m "feat(hygiene): la checklist lit les items des réglages

Affiche les items configurés et enregistre à la première sauvegarde la
liste qui était demandée — ce qui est affiché est ce qui sera jugé.
Remplace au passage l'alert() de la sauvegarde par un bandeau, un
alert() se perdant sur mobile."
```

---

## Tâche 5 : Le rapport de contrôle lit les réglages

**Files:**
- Modify: `src/modules/corner/pages/Controle.tsx`

**Interfaces:**
- Consumes: `mergeHygieneItems`, `ITEMS_ORIGINE`, `itemsPourPeriode`, `HygieneItemsSettings` (Tâche 1)
- Produces: rien

- [ ] **Step 1 : Remplacer la constante locale**

Supprimer `HYGIENE_ITEMS` et charger les réglages :

```tsx
import {
  ITEMS_ORIGINE, mergeHygieneItems, itemsPourPeriode,
  type HygieneItemsSettings, type ChecklistKind,
} from '../../../utils/hygieneItems'
```

```tsx
  const [itemsSettings, setItemsSettings] = useState<HygieneItemsSettings>(ITEMS_ORIGINE)

  useEffect(() => {
    getDoc(doc(db, 'settings', 'hygiene_items'))
      .then(snap => { if (snap.exists()) setItemsSettings(mergeHygieneItems(snap.data())) })
      .catch(e => console.error('[controle] réglages des items illisibles', e))
  }, [])
```

- [ ] **Step 2 : Rendre chaque document avec sa propre liste**

`buildHygieneTable` construit un **tableau croisé** : une ligne par date, une
colonne par item. Avec des listes attendues qui varient d'un document à
l'autre, un jeu de colonnes fixe ne convient plus — un item ajouté en cours de
période n'était pas demandé aux dates antérieures, et l'afficher en ✗ serait
un mensonge sur un document qui sert de preuve.

Les colonnes deviennent l'**union** des items attendus sur la période, et une
case indique explicitement « pas demandé ce jour-là ».

Remplacer entièrement la fonction :

```tsx
function buildHygieneTable(
  report: Report,
  type: ChecklistKind,
  itemsSettings: HygieneItemsSettings,
): { head: string[]; rows: string[][] } {
  const docs = report.hygiene
    .filter(h => h.type === type)
    .sort((a, b) => a.id.localeCompare(b.id))

  const origine = ITEMS_ORIGINE[type].map(i => i.id)
  const attendusDe = (h: any): string[] =>
    Array.isArray(h.itemsAttendus) && h.itemsAttendus.length ? h.itemsAttendus : origine

  // Colonnes = union des items attendus sur la période, dans l'ordre des
  // réglages. Les identifiants inconnus des réglages ferment la marche
  // plutôt que de disparaître.
  const vus = new Set<string>()
  for (const h of docs) attendusDe(h).forEach(id => vus.add(id))
  const ordre = itemsSettings[type].map(i => i.id)
  const colonnes = [
    ...ordre.filter(id => vus.has(id)),
    ...[...vus].filter(id => !ordre.includes(id)),
  ]

  const labels = new Map(itemsSettings[type].map(i => [i.id, i.label]))
  const head = ['Période', ...colonnes.map(id => labels.get(id) ?? id)]

  const rows = docs.map(h => {
    const attendus = attendusDe(h)
    return [
      h.id.split('_')[0],
      // « — » distingue « pas demandé ce jour-là » de « demandé et pas fait ».
      ...colonnes.map(id =>
        !attendus.includes(id) ? '—' : (h.items?.[id] ? '✓' : '✗')),
    ]
  })
  return { head, rows }
}
```

Répercuter le troisième paramètre sur tous les appels de `buildHygieneTable` —
les repérer par `grep -n "buildHygieneTable" src/modules/corner/pages/Controle.tsx`
et leur passer `itemsSettings`.

C'est ce qui fait qu'un rapport imprimé aujourd'hui pour le mois de juin
présente les points de contrôle tels qu'ils étaient exigés en juin, avec leurs
libellés actuels.

- [ ] **Step 3 : Vérifier**

```bash
npm run build && npm test
grep -rn "HYGIENE_ITEMS" src/
```
Expected: build réussi, tests verts, aucune occurrence restante

- [ ] **Step 4 : Commit**

```bash
git add src/modules/corner/pages/Controle.tsx
git commit -m "feat(hygiene): le rapport de contrôle lit les items des réglages

Supprime la quatrième définition en dur des items, dont les libellés
avaient déjà divergé de ceux de la checklist. Chaque période est
présentée avec les points qui lui étaient réellement demandés."
```

---

## Vérification finale

- [ ] `npm test` — tous les tests passent
- [ ] `npm run build` — aucune erreur TypeScript
- [ ] `cd functions && npm run build` — aucune erreur, pas de `.test.js` dans `lib/`
- [ ] `grep -rn "QUOTIDIEN_IDS\|HEBDO_IDS\|MENSUEL_IDS\|isHygieneDone\|HYGIENE_ITEMS" src/ functions/src` — aucune occurrence
- [ ] `grep -n "alert(" src/modules/corner/pages/Hygiene.tsx` — aucune occurrence

## À vérifier à la main après déploiement

1. **La garantie centrale.** Ajouter un item quotidien, puis vérifier que la checklist du jour **et** l'historique des jours passés sont inchangés. L'item n'apparaît que le lendemain.
2. **Idem hebdo** : ajouter un item un jour de semaine, vérifier que la semaine en cours garde son décompte, et que le nouvel item apparaît le lundi suivant.
3. **Renommer** un item existant : l'historique doit rester rattaché, les périodes passées afficher le nouveau libellé sans changer de décompte.
4. **Retirer** un item : il disparaît des prochaines checklists, reste visible dans l'historique où il figurait, et peut être réactivé.
5. **Réordonner** puis vérifier que l'ordre est respecté dans la checklist du corner.
6. **Rapport de contrôle** sur une période ancienne : les points affichés doivent être ceux de l'époque, pas ceux d'aujourd'hui.
7. **Cibles tactiles** sur iPhone : flèches d'ordre, champs de libellé, boutons Ajouter et Réactiver.
8. **Bandeau d'erreur** de la checklist : vérifier qu'il apparaît si une écriture est refusée (se déconnecter du réseau et sauvegarder).
