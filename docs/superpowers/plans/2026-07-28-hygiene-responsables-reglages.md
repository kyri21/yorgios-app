# Hygiène responsables — réglages configurables : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre réglables depuis l'interface trois choses aujourd'hui figées dans le code : le jour et l'heure de chaque rappel d'hygiène, les canaux de notification par type d'événement, et le droit de désigner un responsable.

**Architecture:** Le document `settings/hygiene_responsables` s'étend de deux à cinq champs. Toute lecture le fusionne champ par champ avec des valeurs par défaut, de sorte qu'un document absent ou partiel reproduise exactement le comportement actuel. `resolveJalon` reste une fonction pure mais reçoit désormais la configuration en paramètre. Le droit de désigner rejoint le système de permissions existant du projet plutôt que d'en créer un second.

**Tech Stack:** React 18 + TypeScript + Vite · Firebase Firestore (DB `test`) + Cloud Functions Node 22 (europe-west1) · vitest

## Global Constraints

- Projet Firebase unique `cuisine-yorgios`, base Firestore `test`. Jamais d'`initializeApp()` hors de `src/firebase/config.ts`.
- Imports client uniquement depuis `src/firebase/config.ts`.
- Rôle `administrateur` = alias de `patron` : partout où `patron` est vérifié, inclure `administrateur`.
- **Jamais de valeur `undefined` envoyée à Firestore** — omettre la clé.
- **Toute écriture Firestore côté client a un `catch` qui affiche l'erreur à l'écran.**
- Design system Aegean Precision **light mode uniquement**. Variables CSS : `--surface`, `--surface-low`, `--surface-mid`, `--surface-high`, `--primary` (`#004275`), `--on-surface`, `--on-surface-2`, `--on-surface-3`, `--success`, `--warning`, `--danger`, `--border`, `--border-soft`. Polices Epilogue (titres) + Manrope (corps). Cibles tactiles 44×44px minimum.
- Cloud Functions : région `europe-west1`, fuseau `Europe/Paris`.
- Build fonctions obligatoire avant déploiement : `cd functions && npm run build`.
- **Aucun déploiement par les implémenteurs** : ni `firebase deploy`, ni `npm run dev`. Validation locale puis déploiement pilotés séparément.
- Spec de référence : `docs/superpowers/specs/2026-07-28-hygiene-responsables-design.md`, révision 2.

---

## État de départ

La branche `feat/hygiene-responsables` contient déjà la fonctionnalité complète, avec ces réglages **figés** :

| Aujourd'hui | Où |
|---|---|
| `Jalon = 'j-3' \| 'j-1' \| 'escalade'` | `functions/src/hygiene/periods.ts` |
| `resolveJalon(kind, now)` — jours et heures en dur | idem |
| Cron `0 10,18 * * *` | `functions/src/index.ts`, `hygieneRappelsResponsables` |
| Email et push toujours envoyés | `functions/src/index.ts` |
| `['patron','administrateur','manager'].includes(user?.role ?? '')` | `src/modules/corner/pages/Hygiene.tsx:106` |
| `{ rappelsEnabled, escaladeDestinataires }` | `src/pages/AdminSettings.tsx:68-71` et `:106-109` |

Le système de permissions du projet est déjà en place et réutilisable : `settings/permissions`, structure `{ rôle: { clé: bool } }`, `PermissionsContext.tsx` côté client avec `can(role, key)`, `permAllows(key)` côté règles, `AdminPermissions.tsx` pour l'édition. `PermissionsProvider` est monté dans `src/App.tsx` — `usePermissions()` est donc disponible partout.

---

## Structure des fichiers

**Créés**

| Fichier | Responsabilité |
|---|---|
| `src/utils/hygieneSettings.ts` | Types, défauts, fusion et détection de collision — côté client |
| `src/utils/hygieneSettings.test.ts` | Tests de ce module |
| `src/components/settings/HygieneResponsablesSection.tsx` | La section de réglages, en quatre blocs repliables |

**Modifiés**

| Fichier | Changement |
|---|---|
| `functions/src/hygiene/periods.ts` | Types de configuration, défauts, fusion, `resolveJalon` piloté |
| `functions/src/hygiene/periods.test.ts` | Tests de la configuration |
| `functions/src/index.ts` | Lecture de la configuration, canaux, cron horaire |
| `src/contexts/PermissionsContext.tsx` | Clé `action_designer_responsable_hygiene` |
| `src/pages/AdminPermissions.tsx` | Ligne correspondante dans le groupe « Actions » |
| `src/modules/corner/pages/Hygiene.tsx` | `can()` au lieu du tableau de rôles en dur |
| `src/pages/AdminSettings.tsx` | Délègue la section au nouveau composant |
| `firestore.rules` | `permAllows` sur `hygiene_responsables` |

**Pourquoi extraire la section dans son propre composant.** `AdminSettings.tsx` fait déjà 1250 lignes et gère une douzaine de sections. Cette section passe de 90 à environ 300 lignes : l'y laisser rendrait le fichier difficile à tenir en tête, pour un humain comme pour un agent. Le composant reçoit sa valeur et son `onChange`, `AdminSettings` garde la responsabilité du chargement et de la sauvegarde.

---

## ⚠️ La duplication client / fonctions s'étend

Les types de configuration, les valeurs par défaut et la fusion existent des **deux** côtés :
`src/utils/hygieneSettings.ts` et `functions/src/hygiene/periods.ts`. C'est la décision d'architecture déjà arbitrée pour ce projet — aucun mécanisme d'import n'existe entre les deux packages npm.

Le risque nouveau est réel : si les **valeurs par défaut** divergeaient, l'interface afficherait « jeudi 10h » pendant que la fonction Cloud enverrait le rappel un autre jour, sans qu'aucune erreur ne le signale.

La parade est dans les tests : chaque côté a un test qui assert les valeurs par défaut **littérales** (jour 4, heure 10, etc.). Les deux fichiers de test tournent dans la même exécution de `npm test`. Une divergence casse un test, immédiatement.

---

## Tâche 1 : Configuration des jalons côté fonctions

**Files:**
- Modify: `functions/src/hygiene/periods.ts`
- Test: `functions/src/hygiene/periods.test.ts`

**Interfaces:**
- Consumes: `HygieneKind`, `lastDayOfMonth` (interne, déjà présent)
- Produces:
  - `type JalonKey = 'rappel1' | 'rappel2' | 'escalade'` (remplace `Jalon`)
  - `type JalonHebdo = { actif: boolean; jour: number; heure: number }`
  - `type JalonMensuel = { actif: boolean; joursAvantFin: number; heure: number }`
  - `type Canal = { email: boolean; push: boolean }`
  - `type HygieneSettings` (voir code)
  - `DEFAULT_HYGIENE_SETTINGS: HygieneSettings`
  - `mergeHygieneSettings(data: any): HygieneSettings`
  - `resolveJalon(kind: HygieneKind, now: Date, config: HygieneSettings): JalonKey | null`

- [ ] **Step 1 : Écrire les tests qui échouent**

Dans `functions/src/hygiene/periods.test.ts`, remplacer l'import du haut par :

```ts
import { describe, it, expect } from 'vitest'
import {
  getPeriodId, resolveJalon, isHygieneDone,
  mergeHygieneSettings, DEFAULT_HYGIENE_SETTINGS,
  HEBDO_IDS, MENSUEL_IDS, QUOTIDIEN_IDS,
} from './periods'
```

Conserver tous les blocs `describe` existants **sauf** `resolveJalon — hebdo` et
`resolveJalon — mensuel`, qu'il faut remplacer par ce qui suit. Ajouter aussi les
deux nouveaux blocs.

```ts
const CFG = DEFAULT_HYGIENE_SETTINGS

describe('valeurs par défaut', () => {
  // Ce test verrouille l'accord avec src/utils/hygieneSettings.ts, qui
  // duplique volontairement ces valeurs. Toute divergence casse ici.
  it('reproduit les horaires de la révision 1', () => {
    expect(CFG.hebdo.rappel1).toEqual({ actif: true, jour: 4, heure: 10 })
    expect(CFG.hebdo.rappel2).toEqual({ actif: true, jour: 6, heure: 10 })
    expect(CFG.hebdo.escalade).toEqual({ actif: true, jour: 0, heure: 18 })
    expect(CFG.mensuel.rappel1).toEqual({ actif: true, joursAvantFin: 7, heure: 10 })
    expect(CFG.mensuel.rappel2).toEqual({ actif: true, joursAvantFin: 2, heure: 10 })
    expect(CFG.mensuel.escalade).toEqual({ actif: true, joursAvantFin: 0, heure: 18 })
  })

  it('active email et push sauf le push d’escalade', () => {
    expect(CFG.canaux.designation).toEqual({ email: true, push: true })
    expect(CFG.canaux.rappel).toEqual({ email: true, push: true })
    expect(CFG.canaux.escalade).toEqual({ email: true, push: false })
  })

  it('considère les rappels actifs par défaut', () => {
    expect(CFG.rappelsEnabled).toBe(true)
  })
})

describe('mergeHygieneSettings', () => {
  it('rend les défauts sur un document absent', () => {
    expect(mergeHygieneSettings(undefined)).toEqual(DEFAULT_HYGIENE_SETTINGS)
    expect(mergeHygieneSettings(null)).toEqual(DEFAULT_HYGIENE_SETTINGS)
    expect(mergeHygieneSettings({})).toEqual(DEFAULT_HYGIENE_SETTINGS)
  })

  // Le cas réel : un document écrit par la révision 1, qui ne connaissait
  // que deux champs. Il doit produire le comportement d'origine.
  it('complète un document de la révision 1', () => {
    const r1 = { rappelsEnabled: true, escaladeDestinataires: ['a@b.fr'] }
    const merged = mergeHygieneSettings(r1)
    expect(merged.escaladeDestinataires).toEqual(['a@b.fr'])
    expect(merged.hebdo).toEqual(DEFAULT_HYGIENE_SETTINGS.hebdo)
    expect(merged.canaux).toEqual(DEFAULT_HYGIENE_SETTINGS.canaux)
  })

  it('fusionne champ par champ, sans écraser les voisins', () => {
    const merged = mergeHygieneSettings({ hebdo: { rappel1: { heure: 8 } } })
    expect(merged.hebdo.rappel1).toEqual({ actif: true, jour: 4, heure: 8 })
    expect(merged.hebdo.rappel2).toEqual(DEFAULT_HYGIENE_SETTINGS.hebdo.rappel2)
  })

  it('traite rappelsEnabled absent comme actif, false comme inactif', () => {
    expect(mergeHygieneSettings({}).rappelsEnabled).toBe(true)
    expect(mergeHygieneSettings({ rappelsEnabled: false }).rappelsEnabled).toBe(false)
  })

  it('ignore un escaladeDestinataires qui n’est pas un tableau', () => {
    expect(mergeHygieneSettings({ escaladeDestinataires: 'a@b.fr' }).escaladeDestinataires).toEqual([])
  })
})

describe('resolveJalon — hebdo, configuration par défaut', () => {
  it('rend rappel1 le jeudi à 10h', () => {
    expect(resolveJalon('hebdo', at(2026, 7, 30, 10), CFG)).toBe('rappel1')
  })

  it('ne rend rien le jeudi à 18h', () => {
    expect(resolveJalon('hebdo', at(2026, 7, 30, 18), CFG)).toBeNull()
  })

  it('rend rappel2 le samedi à 10h', () => {
    expect(resolveJalon('hebdo', at(2026, 8, 1, 10), CFG)).toBe('rappel2')
  })

  it('rend escalade le dimanche à 18h', () => {
    expect(resolveJalon('hebdo', at(2026, 8, 2, 18), CFG)).toBe('escalade')
  })

  it('ne rend rien un lundi', () => {
    expect(resolveJalon('hebdo', at(2026, 7, 27, 10), CFG)).toBeNull()
  })
})

describe('resolveJalon — mensuel, configuration par défaut', () => {
  it('rend rappel1 sept jours avant la fin de juillet (le 24)', () => {
    expect(resolveJalon('mensuel', at(2026, 7, 24, 10), CFG)).toBe('rappel1')
  })

  // Février 2026 compte 28 jours : sept jours avant la fin, c'est le 21.
  it('rend rappel1 le 21 février 2026', () => {
    expect(resolveJalon('mensuel', at(2026, 2, 21, 10), CFG)).toBe('rappel1')
    expect(resolveJalon('mensuel', at(2026, 2, 24, 10), CFG)).toBeNull()
  })

  it('rend rappel1 le 22 février 2028 (année bissextile)', () => {
    expect(resolveJalon('mensuel', at(2028, 2, 22, 10), CFG)).toBe('rappel1')
  })

  it('rend escalade le dernier jour à 18h', () => {
    expect(resolveJalon('mensuel', at(2026, 7, 31, 18), CFG)).toBe('escalade')
    expect(resolveJalon('mensuel', at(2026, 2, 28, 18), CFG)).toBe('escalade')
  })
})

describe('resolveJalon — configuration personnalisée', () => {
  it('suit un jour et une heure déplacés', () => {
    const cfg = mergeHygieneSettings({ hebdo: { rappel1: { jour: 2, heure: 8 } } })
    expect(resolveJalon('hebdo', at(2026, 7, 28, 8), cfg)).toBe('rappel1')   // mardi 8h
    expect(resolveJalon('hebdo', at(2026, 7, 30, 10), cfg)).toBeNull()       // ancien créneau
  })

  it('ignore un jalon désactivé', () => {
    const cfg = mergeHygieneSettings({ hebdo: { rappel1: { actif: false } } })
    expect(resolveJalon('hebdo', at(2026, 7, 30, 10), cfg)).toBeNull()
  })

  // Règle de collision : le plus grave l'emporte, un seul message part.
  it('donne l’escalade quand deux jalons partagent un créneau', () => {
    const cfg = mergeHygieneSettings({
      hebdo: { rappel2: { jour: 0, heure: 18 } },   // même créneau que l'escalade
    })
    expect(resolveJalon('hebdo', at(2026, 8, 2, 18), cfg)).toBe('escalade')
  })

  it('donne rappel2 quand il entre en collision avec rappel1', () => {
    const cfg = mergeHygieneSettings({
      hebdo: { rappel1: { jour: 6, heure: 10 } },   // même créneau que rappel2
    })
    expect(resolveJalon('hebdo', at(2026, 8, 1, 10), cfg)).toBe('rappel2')
  })

  it('accepte un rappel mensuel le dernier jour', () => {
    const cfg = mergeHygieneSettings({ mensuel: { rappel2: { joursAvantFin: 0, heure: 9 } } })
    expect(resolveJalon('mensuel', at(2026, 7, 31, 9), cfg)).toBe('rappel2')
  })
})
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected: FAIL — `mergeHygieneSettings` et `DEFAULT_HYGIENE_SETTINGS` n'existent pas, et `resolveJalon` n'accepte que deux arguments

- [ ] **Step 3 : Écrire l'implémentation**

Dans `functions/src/hygiene/periods.ts`, remplacer la ligne `export type Jalon = 'j-3' | 'j-1' | 'escalade'` par :

```ts
/** Les jalons ne portent plus un délai dans leur nom : ce délai est réglable.
 *  Appeler « j-3 » un rappel placé à J-5 serait trompeur. */
export type JalonKey = 'rappel1' | 'rappel2' | 'escalade'

export type JalonHebdo   = { actif: boolean; jour: number; heure: number }
export type JalonMensuel = { actif: boolean; joursAvantFin: number; heure: number }
export type Canal        = { email: boolean; push: boolean }

export type HygieneSettings = {
  rappelsEnabled: boolean
  escaladeDestinataires: string[]
  hebdo:   Record<JalonKey, JalonHebdo>
  mensuel: Record<JalonKey, JalonMensuel>
  canaux:  { designation: Canal; rappel: Canal; escalade: Canal }
}

/** Ces valeurs reproduisent exactement le comportement figé de la révision 1.
 *  Elles sont dupliquées dans src/utils/hygieneSettings.ts — les tests des
 *  deux côtés assertent les mêmes littéraux pour verrouiller cet accord. */
export const DEFAULT_HYGIENE_SETTINGS: HygieneSettings = {
  rappelsEnabled: true,
  escaladeDestinataires: [],
  hebdo: {
    rappel1:  { actif: true, jour: 4, heure: 10 },  // jeudi
    rappel2:  { actif: true, jour: 6, heure: 10 },  // samedi
    escalade: { actif: true, jour: 0, heure: 18 },  // dimanche
  },
  mensuel: {
    rappel1:  { actif: true, joursAvantFin: 7, heure: 10 },
    rappel2:  { actif: true, joursAvantFin: 2, heure: 10 },
    escalade: { actif: true, joursAvantFin: 0, heure: 18 },
  },
  canaux: {
    designation: { email: true, push: true },
    rappel:      { email: true, push: true },
    escalade:    { email: true, push: false },
  },
}

const JALONS: JalonKey[] = ['rappel1', 'rappel2', 'escalade']

/** Fusion champ par champ avec les défauts. Un document absent, partiel, ou
 *  écrit par la révision 1 doit produire le comportement d'origine — c'est ce
 *  qui garantit que rendre ces réglages configurables ne casse rien pour qui
 *  n'y touche jamais. */
export function mergeHygieneSettings(data: any): HygieneSettings {
  const d = data ?? {}
  const hebdo   = {} as Record<JalonKey, JalonHebdo>
  const mensuel = {} as Record<JalonKey, JalonMensuel>
  for (const cle of JALONS) {
    hebdo[cle]   = { ...DEFAULT_HYGIENE_SETTINGS.hebdo[cle],   ...(d.hebdo?.[cle] ?? {}) }
    mensuel[cle] = { ...DEFAULT_HYGIENE_SETTINGS.mensuel[cle], ...(d.mensuel?.[cle] ?? {}) }
  }
  return {
    // Absent = actif : ne jamais éteindre des rappels par omission.
    rappelsEnabled: d.rappelsEnabled !== false,
    escaladeDestinataires: Array.isArray(d.escaladeDestinataires) ? d.escaladeDestinataires : [],
    hebdo,
    mensuel,
    canaux: {
      designation: { ...DEFAULT_HYGIENE_SETTINGS.canaux.designation, ...(d.canaux?.designation ?? {}) },
      rappel:      { ...DEFAULT_HYGIENE_SETTINGS.canaux.rappel,      ...(d.canaux?.rappel ?? {}) },
      escalade:    { ...DEFAULT_HYGIENE_SETTINGS.canaux.escalade,    ...(d.canaux?.escalade ?? {}) },
    },
  }
}
```

Puis remplacer entièrement `resolveJalon` par :

```ts
/**
 * Quel jalon correspond à cet instant, selon la configuration.
 * `now` doit être une date exprimée en heure murale de Paris.
 *
 * Collision : si deux jalons partagent le même créneau, le plus grave
 * l'emporte et un seul message part. L'interface avertit au réglage.
 */
export function resolveJalon(
  kind: HygieneKind,
  now: Date,
  config: HygieneSettings,
): JalonKey | null {
  const heure = now.getHours()
  const parGravite: JalonKey[] = ['escalade', 'rappel2', 'rappel1']

  if (kind === 'hebdo') {
    const jour = now.getDay() // 0 = dimanche
    for (const cle of parGravite) {
      const j = config.hebdo[cle]
      if (j.actif && j.jour === jour && j.heure === heure) return cle
    }
    return null
  }

  const restants = lastDayOfMonth(now) - now.getDate()
  for (const cle of parGravite) {
    const j = config.mensuel[cle]
    if (j.actif && j.joursAvantFin === restants && j.heure === heure) return cle
  }
  return null
}
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run: `npm test`
Expected: PASS — tous les tests, client et fonctions

- [ ] **Step 5 : Vérifier la compilation des fonctions**

```bash
cd functions && npm run build && cd ..
```
Expected: `tsc` échoue sur `functions/src/index.ts`, qui appelle encore `resolveJalon` avec deux arguments et importe le type `Jalon`. **C'est attendu** : la Tâche 5 corrige les appelants. Ne modifie pas `index.ts` dans cette tâche.

Note l'erreur dans ton rapport et poursuis.

- [ ] **Step 6 : Commit**

```bash
git add functions/src/hygiene/periods.ts functions/src/hygiene/periods.test.ts
git commit -m "feat(hygiene): jalons de rappel pilotés par la configuration

Jours, heures et activation de chaque rappel deviennent des données.
Les défauts reproduisent le comportement figé précédent, et la fusion
champ par champ garantit qu'un document absent ou partiel ne change
rien. Renomme j-3/j-1 en rappel1/rappel2 : le délai n'est plus fixe."
```

---

## Tâche 2 : Configuration côté client

**Files:**
- Create: `src/utils/hygieneSettings.ts`
- Test: `src/utils/hygieneSettings.test.ts`

**Interfaces:**
- Consumes: rien
- Produces:
  - `type JalonKey = 'rappel1' | 'rappel2' | 'escalade'`
  - `type JalonHebdo`, `type JalonMensuel`, `type Canal`, `type HygieneSettings` — mêmes formes que Tâche 1
  - `DEFAULT_HYGIENE_SETTINGS: HygieneSettings`
  - `mergeHygieneSettings(data: any): HygieneSettings`
  - `JALON_LABELS: Record<JalonKey, string>`
  - `JOURS: { valeur: number; label: string }[]`
  - `collisionsHebdo(config: HygieneSettings): JalonKey[][]`
  - `collisionsMensuel(config: HygieneSettings): JalonKey[][]`

Ce module duplique volontairement les types, défauts et fusion de
`functions/src/hygiene/periods.ts` — aucun import n'existe entre les deux packages.
Il n'inclut **pas** `resolveJalon`, qui n'a de sens que côté serveur.

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `src/utils/hygieneSettings.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_HYGIENE_SETTINGS, mergeHygieneSettings,
  collisionsHebdo, collisionsMensuel, JOURS, JALON_LABELS,
} from './hygieneSettings'

describe('valeurs par défaut', () => {
  // Ces littéraux doivent être identiques à ceux de
  // functions/src/hygiene/periods.test.ts. Une divergence ferait afficher
  // « jeudi 10h » dans l'interface pendant que la fonction Cloud enverrait
  // le rappel un autre jour, sans aucune erreur visible.
  it('reproduit les horaires de la révision 1', () => {
    const c = DEFAULT_HYGIENE_SETTINGS
    expect(c.hebdo.rappel1).toEqual({ actif: true, jour: 4, heure: 10 })
    expect(c.hebdo.rappel2).toEqual({ actif: true, jour: 6, heure: 10 })
    expect(c.hebdo.escalade).toEqual({ actif: true, jour: 0, heure: 18 })
    expect(c.mensuel.rappel1).toEqual({ actif: true, joursAvantFin: 7, heure: 10 })
    expect(c.mensuel.rappel2).toEqual({ actif: true, joursAvantFin: 2, heure: 10 })
    expect(c.mensuel.escalade).toEqual({ actif: true, joursAvantFin: 0, heure: 18 })
    expect(c.canaux.designation).toEqual({ email: true, push: true })
    expect(c.canaux.rappel).toEqual({ email: true, push: true })
    expect(c.canaux.escalade).toEqual({ email: true, push: false })
    expect(c.rappelsEnabled).toBe(true)
  })
})

describe('mergeHygieneSettings', () => {
  it('rend les défauts sur un document absent', () => {
    expect(mergeHygieneSettings(undefined)).toEqual(DEFAULT_HYGIENE_SETTINGS)
    expect(mergeHygieneSettings({})).toEqual(DEFAULT_HYGIENE_SETTINGS)
  })

  it('complète un document de la révision 1', () => {
    const merged = mergeHygieneSettings({ rappelsEnabled: true, escaladeDestinataires: ['a@b.fr'] })
    expect(merged.escaladeDestinataires).toEqual(['a@b.fr'])
    expect(merged.hebdo).toEqual(DEFAULT_HYGIENE_SETTINGS.hebdo)
  })

  it('fusionne champ par champ', () => {
    const merged = mergeHygieneSettings({ hebdo: { rappel1: { heure: 8 } } })
    expect(merged.hebdo.rappel1).toEqual({ actif: true, jour: 4, heure: 8 })
    expect(merged.hebdo.rappel2).toEqual(DEFAULT_HYGIENE_SETTINGS.hebdo.rappel2)
  })
})

describe('détection de collision', () => {
  it('ne signale rien sur la configuration par défaut', () => {
    expect(collisionsHebdo(DEFAULT_HYGIENE_SETTINGS)).toEqual([])
    expect(collisionsMensuel(DEFAULT_HYGIENE_SETTINGS)).toEqual([])
  })

  it('signale deux jalons hebdo sur le même créneau', () => {
    const cfg = mergeHygieneSettings({ hebdo: { rappel2: { jour: 0, heure: 18 } } })
    expect(collisionsHebdo(cfg)).toEqual([['rappel2', 'escalade']])
  })

  it('signale deux jalons mensuels sur le même créneau', () => {
    const cfg = mergeHygieneSettings({ mensuel: { rappel1: { joursAvantFin: 2, heure: 10 } } })
    expect(collisionsMensuel(cfg)).toEqual([['rappel1', 'rappel2']])
  })

  // Un jalon désactivé n'enverra rien : il ne peut entrer en collision
  // avec personne, et le signaler serait un faux avertissement.
  it('ignore les jalons désactivés', () => {
    const cfg = mergeHygieneSettings({
      hebdo: { rappel2: { jour: 0, heure: 18, actif: false } },
    })
    expect(collisionsHebdo(cfg)).toEqual([])
  })

  it('regroupe trois jalons sur un même créneau', () => {
    const cfg = mergeHygieneSettings({
      hebdo: { rappel1: { jour: 0, heure: 18 }, rappel2: { jour: 0, heure: 18 } },
    })
    expect(collisionsHebdo(cfg)).toEqual([['rappel1', 'rappel2', 'escalade']])
  })
})

describe('libellés', () => {
  it('couvre les sept jours, dimanche en premier', () => {
    expect(JOURS).toHaveLength(7)
    expect(JOURS[0]).toEqual({ valeur: 0, label: 'Dimanche' })
    expect(JOURS[6]).toEqual({ valeur: 6, label: 'Samedi' })
  })

  it('nomme les trois jalons', () => {
    expect(JALON_LABELS.rappel1).toBe('1er rappel')
    expect(JALON_LABELS.rappel2).toBe('2e rappel')
    expect(JALON_LABELS.escalade).toBe('Escalade')
  })
})
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./hygieneSettings"`

- [ ] **Step 3 : Écrire l'implémentation**

Créer `src/utils/hygieneSettings.ts` :

```ts
/** Réglages des rappels d'hygiène — côté client.
 *
 *  Duplique volontairement functions/src/hygiene/periods.ts : ce projet n'a
 *  aucun mécanisme d'import entre le code client et les Cloud Functions.
 *  Les tests des deux côtés assertent les mêmes valeurs par défaut littérales,
 *  de sorte qu'une divergence casse immédiatement. */

export type JalonKey = 'rappel1' | 'rappel2' | 'escalade'

export type JalonHebdo   = { actif: boolean; jour: number; heure: number }
export type JalonMensuel = { actif: boolean; joursAvantFin: number; heure: number }
export type Canal        = { email: boolean; push: boolean }

export type HygieneSettings = {
  rappelsEnabled: boolean
  escaladeDestinataires: string[]
  hebdo:   Record<JalonKey, JalonHebdo>
  mensuel: Record<JalonKey, JalonMensuel>
  canaux:  { designation: Canal; rappel: Canal; escalade: Canal }
}

export const DEFAULT_HYGIENE_SETTINGS: HygieneSettings = {
  rappelsEnabled: true,
  escaladeDestinataires: [],
  hebdo: {
    rappel1:  { actif: true, jour: 4, heure: 10 },  // jeudi
    rappel2:  { actif: true, jour: 6, heure: 10 },  // samedi
    escalade: { actif: true, jour: 0, heure: 18 },  // dimanche
  },
  mensuel: {
    rappel1:  { actif: true, joursAvantFin: 7, heure: 10 },
    rappel2:  { actif: true, joursAvantFin: 2, heure: 10 },
    escalade: { actif: true, joursAvantFin: 0, heure: 18 },
  },
  canaux: {
    designation: { email: true, push: true },
    rappel:      { email: true, push: true },
    escalade:    { email: true, push: false },
  },
}

export const JALONS: JalonKey[] = ['rappel1', 'rappel2', 'escalade']

export const JALON_LABELS: Record<JalonKey, string> = {
  rappel1:  '1er rappel',
  rappel2:  '2e rappel',
  escalade: 'Escalade',
}

/** Dimanche en premier : convention JavaScript de Date.getDay(). */
export const JOURS = [
  { valeur: 0, label: 'Dimanche' },
  { valeur: 1, label: 'Lundi' },
  { valeur: 2, label: 'Mardi' },
  { valeur: 3, label: 'Mercredi' },
  { valeur: 4, label: 'Jeudi' },
  { valeur: 5, label: 'Vendredi' },
  { valeur: 6, label: 'Samedi' },
]

export function mergeHygieneSettings(data: any): HygieneSettings {
  const d = data ?? {}
  const hebdo   = {} as Record<JalonKey, JalonHebdo>
  const mensuel = {} as Record<JalonKey, JalonMensuel>
  for (const cle of JALONS) {
    hebdo[cle]   = { ...DEFAULT_HYGIENE_SETTINGS.hebdo[cle],   ...(d.hebdo?.[cle] ?? {}) }
    mensuel[cle] = { ...DEFAULT_HYGIENE_SETTINGS.mensuel[cle], ...(d.mensuel?.[cle] ?? {}) }
  }
  return {
    // Absent = actif : ne jamais éteindre des rappels par omission.
    rappelsEnabled: d.rappelsEnabled !== false,
    escaladeDestinataires: Array.isArray(d.escaladeDestinataires) ? d.escaladeDestinataires : [],
    hebdo,
    mensuel,
    canaux: {
      designation: { ...DEFAULT_HYGIENE_SETTINGS.canaux.designation, ...(d.canaux?.designation ?? {}) },
      rappel:      { ...DEFAULT_HYGIENE_SETTINGS.canaux.rappel,      ...(d.canaux?.rappel ?? {}) },
      escalade:    { ...DEFAULT_HYGIENE_SETTINGS.canaux.escalade,    ...(d.canaux?.escalade ?? {}) },
    },
  }
}

/** Regroupe les jalons actifs qui partagent un même créneau. Un seul message
 *  partira (le plus grave) : l'interface doit le dire au réglage plutôt que
 *  de laisser le conflit se découvrir à l'usage. */
function grouperParCreneau(entrees: { cle: JalonKey; actif: boolean; creneau: string }[]): JalonKey[][] {
  const parCreneau = new Map<string, JalonKey[]>()
  for (const e of entrees) {
    if (!e.actif) continue
    parCreneau.set(e.creneau, [...(parCreneau.get(e.creneau) ?? []), e.cle])
  }
  return [...parCreneau.values()].filter(groupe => groupe.length > 1)
}

export function collisionsHebdo(config: HygieneSettings): JalonKey[][] {
  return grouperParCreneau(JALONS.map(cle => {
    const j = config.hebdo[cle]
    return { cle, actif: j.actif, creneau: `${j.jour}-${j.heure}` }
  }))
}

export function collisionsMensuel(config: HygieneSettings): JalonKey[][] {
  return grouperParCreneau(JALONS.map(cle => {
    const j = config.mensuel[cle]
    return { cle, actif: j.actif, creneau: `${j.joursAvantFin}-${j.heure}` }
  }))
}
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run: `npm test`
Expected: PASS — y compris les tests de la Tâche 1, qui assertent les mêmes défauts

- [ ] **Step 5 : Vérifier le typage**

Run: `npm run build`
Expected: build réussi

- [ ] **Step 6 : Commit**

```bash
git add src/utils/hygieneSettings.ts src/utils/hygieneSettings.test.ts
git commit -m "feat(hygiene): types et défauts des réglages côté client

Duplique volontairement la configuration des fonctions Cloud, avec des
tests qui assertent les mêmes littéraux des deux côtés — une divergence
ferait afficher un horaire différent de celui réellement appliqué.
Ajoute la détection de collision entre jalons."
```

---

## Tâche 3 : Section de réglages en quatre blocs repliables

**Files:**
- Create: `src/components/settings/HygieneResponsablesSection.tsx`
- Modify: `src/pages/AdminSettings.tsx`

**Interfaces:**
- Consumes: `HygieneSettings`, `JalonKey`, `JALONS`, `JALON_LABELS`, `JOURS`, `collisionsHebdo`, `collisionsMensuel` (Tâche 2)
- Produces: composant `<HygieneResponsablesSection value onChange managers />` avec
  `type ManagerUser = { email: string; displayName: string; role: string }`

- [ ] **Step 1 : Créer le composant**

Créer `src/components/settings/HygieneResponsablesSection.tsx` :

```tsx
import { useState, type ReactNode } from 'react'
import {
  JALONS, JALON_LABELS, JOURS,
  collisionsHebdo, collisionsMensuel,
  type HygieneSettings, type JalonKey,
} from '../../utils/hygieneSettings'

type ManagerUser = { email: string; displayName: string; role: string }

type Props = {
  value: HygieneSettings
  onChange: (next: HygieneSettings) => void
  managers: ManagerUser[]
}

const HEURES = Array.from({ length: 24 }, (_, h) => h)
const CANAUX: { cle: 'designation' | 'rappel' | 'escalade'; label: string }[] = [
  { cle: 'designation', label: 'Désignation' },
  { cle: 'rappel',      label: 'Rappels' },
  { cle: 'escalade',    label: 'Escalade' },
]

/** Bloc repliable affichant son réglage courant en résumé quand il est fermé.
 *  Replié, l'ensemble de la section ne fait que cinq lignes — c'est ce qui rend
 *  acceptable qu'elle soit la plus dense de la page. */
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
          <span style={{
            fontSize: 11, color: 'var(--on-surface-3)', textAlign: 'right',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {resume}
          </span>
        )}
      </button>
      {ouvert && <div style={{ paddingBottom: 12 }}>{children}</div>}
    </div>
  )
}

function Avertissement({ groupes }: { groupes: JalonKey[][] }) {
  if (!groupes.length) return null
  return (
    <>
      {groupes.map((groupe, i) => (
        <p key={i} style={{ fontSize: 11, color: 'var(--warning)', margin: '10px 0 0' }}>
          ⚠️ {groupe.map(c => JALON_LABELS[c]).join(' et ')} sont réglés sur le même créneau —
          seul « {JALON_LABELS[groupe[groupe.length - 1]]} » partira.
        </p>
      ))}
    </>
  )
}

const selectStyle = { minHeight: 44, padding: '0 8px', flex: 1 } as const
const ligneStyle = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } as const

export default function HygieneResponsablesSection({ value, onChange, managers }: Props) {
  const set = (patch: Partial<HygieneSettings>) => onChange({ ...value, ...patch })

  const setHebdo = (cle: JalonKey, patch: Partial<HygieneSettings['hebdo'][JalonKey]>) =>
    set({ hebdo: { ...value.hebdo, [cle]: { ...value.hebdo[cle], ...patch } } })

  const setMensuel = (cle: JalonKey, patch: Partial<HygieneSettings['mensuel'][JalonKey]>) =>
    set({ mensuel: { ...value.mensuel, [cle]: { ...value.mensuel[cle], ...patch } } })

  const setCanal = (cle: 'designation' | 'rappel' | 'escalade', patch: Partial<{ email: boolean; push: boolean }>) =>
    set({ canaux: { ...value.canaux, [cle]: { ...value.canaux[cle], ...patch } } })

  const resumeHebdo = JALONS
    .filter(c => value.hebdo[c].actif)
    .map(c => `${JOURS[value.hebdo[c].jour].label.slice(0, 3).toLowerCase()} ${value.hebdo[c].heure}h`)
    .join(' · ') || 'aucun rappel actif'

  const resumeMensuel = JALONS
    .filter(c => value.mensuel[c].actif)
    .map(c => {
      const j = value.mensuel[c]
      return `${j.joursAvantFin === 0 ? 'dernier jour' : `J-${j.joursAvantFin}`} ${j.heure}h`
    })
    .join(' · ') || 'aucun rappel actif'

  const resumeCanaux = CANAUX
    .map(({ cle }) => {
      const c = value.canaux[cle]
      const actifs = [c.email && 'email', c.push && 'push'].filter(Boolean)
      return actifs.length ? actifs.join('+') : 'aucun'
    })
    .join(' · ')

  return (
    <div>
      <p className="section-label" style={{ marginBottom: 8 }}>Nettoyage — responsables</p>
      <div className="card" style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginBottom: 12 }}>
          Rappels envoyés au salarié désigné responsable des checklists d'hygiène
          hebdomadaire et mensuelle, puis escalade s'ils restent sans effet.
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', minHeight: 44 }}>
          <input
            type="checkbox"
            checked={value.rappelsEnabled}
            onChange={e => set({ rappelsEnabled: e.target.checked })}
            style={{ width: 16, height: 16, accentColor: 'var(--primary)', flexShrink: 0 }}
          />
          <span style={{ fontSize: 13, color: 'var(--on-surface)', fontWeight: 600 }}>
            Rappels automatiques activés
          </span>
        </label>

        {/* ── Rappels hebdomadaires ─────────────────────────────── */}
        <Bloc titre="Rappels hebdomadaires" resume={resumeHebdo}>
          {JALONS.map(cle => (
            <div key={cle} style={ligneStyle}>
              <input
                type="checkbox"
                checked={value.hebdo[cle].actif}
                onChange={e => setHebdo(cle, { actif: e.target.checked })}
                style={{ width: 16, height: 16, accentColor: 'var(--primary)', flexShrink: 0 }}
              />
              <span style={{ fontSize: 12, color: 'var(--on-surface)', width: 88, flexShrink: 0 }}>
                {JALON_LABELS[cle]}
              </span>
              <select
                className="input-filled" style={selectStyle}
                value={value.hebdo[cle].jour}
                onChange={e => setHebdo(cle, { jour: Number(e.target.value) })}
              >
                {JOURS.map(j => <option key={j.valeur} value={j.valeur}>{j.label}</option>)}
              </select>
              <select
                className="input-filled" style={{ ...selectStyle, flex: 0, width: 80 }}
                value={value.hebdo[cle].heure}
                onChange={e => setHebdo(cle, { heure: Number(e.target.value) })}
              >
                {HEURES.map(h => <option key={h} value={h}>{h}h</option>)}
              </select>
            </div>
          ))}
          <Avertissement groupes={collisionsHebdo(value)} />
        </Bloc>

        {/* ── Rappels mensuels ──────────────────────────────────── */}
        <Bloc titre="Rappels mensuels" resume={resumeMensuel}>
          {JALONS.map(cle => (
            <div key={cle} style={ligneStyle}>
              <input
                type="checkbox"
                checked={value.mensuel[cle].actif}
                onChange={e => setMensuel(cle, { actif: e.target.checked })}
                style={{ width: 16, height: 16, accentColor: 'var(--primary)', flexShrink: 0 }}
              />
              <span style={{ fontSize: 12, color: 'var(--on-surface)', width: 88, flexShrink: 0 }}>
                {JALON_LABELS[cle]}
              </span>
              <input
                type="number" min={0} max={28}
                className="input-filled" style={{ ...selectStyle, flex: 0, width: 64 }}
                value={value.mensuel[cle].joursAvantFin}
                onChange={e => setMensuel(cle, { joursAvantFin: Math.max(0, Math.min(28, Number(e.target.value) || 0)) })}
              />
              <span style={{ fontSize: 11, color: 'var(--on-surface-3)', flex: 1 }}>
                jours avant la fin
              </span>
              <select
                className="input-filled" style={{ ...selectStyle, flex: 0, width: 80 }}
                value={value.mensuel[cle].heure}
                onChange={e => setMensuel(cle, { heure: Number(e.target.value) })}
              >
                {HEURES.map(h => <option key={h} value={h}>{h}h</option>)}
              </select>
            </div>
          ))}
          <p style={{ fontSize: 11, color: 'var(--on-surface-3)', margin: '4px 0 0' }}>
            0 = le dernier jour du mois.
          </p>
          <Avertissement groupes={collisionsMensuel(value)} />
        </Bloc>

        {/* ── Canaux ────────────────────────────────────────────── */}
        <Bloc titre="Canaux de notification" resume={resumeCanaux}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <span style={{ flex: 1 }} />
            <span style={{ width: 56, fontSize: 11, color: 'var(--on-surface-3)', textAlign: 'center' }}>Email</span>
            <span style={{ width: 56, fontSize: 11, color: 'var(--on-surface-3)', textAlign: 'center' }}>Push</span>
          </div>
          {CANAUX.map(({ cle, label }) => (
            <div key={cle} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
              <span style={{ flex: 1, fontSize: 12, color: 'var(--on-surface)' }}>{label}</span>
              <span style={{ width: 56, textAlign: 'center' }}>
                <input
                  type="checkbox" checked={value.canaux[cle].email}
                  onChange={e => setCanal(cle, { email: e.target.checked })}
                  style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
                />
              </span>
              <span style={{ width: 56, textAlign: 'center' }}>
                <input
                  type="checkbox" checked={value.canaux[cle].push}
                  onChange={e => setCanal(cle, { push: e.target.checked })}
                  style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
                />
              </span>
            </div>
          ))}
          <p style={{ fontSize: 11, color: 'var(--on-surface-3)', margin: '8px 0 0' }}>
            Sur iPhone, le push n'arrive que si l'application est installée sur l'écran
            d'accueil et que la permission a été accordée. L'email arrive toujours.
          </p>
        </Bloc>

        {/* ── Destinataires escalade ────────────────────────────── */}
        <Bloc titre="Destinataires de l'escalade" resume={`${value.escaladeDestinataires.length} personne(s)`}>
          <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginBottom: 10 }}>
            Alertés si la checklist n'est toujours pas faite en fin de période,
            ou si personne n'a été désigné.
          </div>
          {managers.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {managers.map(u => {
                const checked = value.escaladeDestinataires.includes(u.email)
                return (
                  <label key={u.email} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', minHeight: 44 }}>
                    <input
                      type="checkbox" checked={checked}
                      onChange={e => set({
                        escaladeDestinataires: e.target.checked
                          ? [...value.escaladeDestinataires, u.email]
                          : value.escaladeDestinataires.filter(x => x !== u.email),
                      })}
                      style={{ width: 16, height: 16, accentColor: 'var(--primary)', flexShrink: 0 }}
                    />
                    <span style={{ fontSize: 13, color: 'var(--on-surface)' }}>
                      {u.displayName}
                      <span style={{ fontSize: 11, color: 'var(--on-surface-3)', marginLeft: 6 }}>
                        {u.email} · {u.role}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--on-surface-3)', margin: 0 }}>Chargement des utilisateurs…</p>
          )}
          {value.escaladeDestinataires.length === 0 && managers.length > 0 && (
            <p style={{ fontSize: 11, color: 'var(--warning)', marginTop: 10, marginBottom: 0 }}>
              Aucune personne sélectionnée — repli sur les responsables des alertes,
              puis sur la liste par défaut.
            </p>
          )}
        </Bloc>
      </div>
    </div>
  )
}
```

- [ ] **Step 2 : Brancher le composant dans AdminSettings**

Dans `src/pages/AdminSettings.tsx` :

Supprimer le type local `HygieneResponsablesSettings` et la constante
`DEFAULT_HYGIENE_RESP`, puis importer :

```tsx
import HygieneResponsablesSection from '../components/settings/HygieneResponsablesSection'
import {
  DEFAULT_HYGIENE_SETTINGS, mergeHygieneSettings,
  type HygieneSettings,
} from '../utils/hygieneSettings'
```

Changer le type de l'état :

```tsx
  const [hygieneResp, setHygieneResp] = useState<HygieneSettings>(DEFAULT_HYGIENE_SETTINGS)
```

Au chargement, remplacer l'affectation actuelle par une fusion — un document
écrit par la version précédente ne connaît que deux champs :

```tsx
      if (hygieneRespSnap.exists()) {
        setHygieneResp(mergeHygieneSettings(hygieneRespSnap.data()))
      }
```

Remplacer entièrement le bloc JSX de la section « Nettoyage — responsables »
(repérable par son commentaire `{/* ── Section : Nettoyage — responsables ─── */}`)
par :

```tsx
      <HygieneResponsablesSection
        value={hygieneResp}
        onChange={setHygieneResp}
        managers={managers}
      />
```

Ne pas toucher à l'appel `setDoc(doc(db, 'settings', 'hygiene_responsables'), hygieneResp)`
dans la sauvegarde : la valeur écrite est désormais complète, ce qui est correct.

- [ ] **Step 3 : Vérifier le typage et les tests**

Run: `npm run build && npm test`
Expected: build réussi, tous les tests verts

- [ ] **Step 4 : Vérification statique de l'interface**

`npm run dev` n'est pas autorisé dans cette tâche. Vérifie par relecture :

1. Aucune couleur en dur — uniquement les variables CSS du design system.
2. Tous les éléments cliquables ont `minHeight: 44`.
3. Le résumé de chaque bloc replié tient sur une ligne et tronque proprement.
4. Aucun `undefined` ne peut être écrit : `joursAvantFin` est borné par `Math.max(0, Math.min(28, … || 0))`, les `<select>` renvoient toujours un nombre.

Liste dans ton rapport ce qui reste à vérifier visuellement.

- [ ] **Step 5 : Commit**

```bash
git add src/components/settings/HygieneResponsablesSection.tsx src/pages/AdminSettings.tsx
git commit -m "feat(hygiene): section Paramètres en quatre blocs repliables

Jour, heure et activation de chaque rappel, canaux par type d'événement,
destinataires de l'escalade. Extrait dans son propre composant : la
section triple de taille et AdminSettings.tsx dépassait déjà 1200 lignes.
Avertit quand deux jalons partagent un créneau."
```

---

## Tâche 4 : Droit de désigner via le système de permissions

**Files:**
- Modify: `src/contexts/PermissionsContext.tsx`
- Modify: `src/pages/AdminPermissions.tsx`
- Modify: `src/modules/corner/pages/Hygiene.tsx`
- Modify: `firestore.rules`

**Interfaces:**
- Consumes: `usePermissions()` et `can(role, key)` — existants
- Produces: clé de permission `action_designer_responsable_hygiene`

- [ ] **Step 1 : Déclarer la permission**

Dans `src/contexts/PermissionsContext.tsx`, ajouter la clé au type `PermKey`,
sur la ligne des actions :

```ts
  | 'action_derogation_temp' | 'action_delete_lot' | 'action_delete_livraison' | 'action_delete_ac'
  | 'action_designer_responsable_hygiene'
```

Puis dans `DEFAULT_PERMISSIONS`, ajouter la clé aux **trois** rôles :

```ts
  manager: { …, action_designer_responsable_hygiene: true,  … },
  corner:  { …, action_designer_responsable_hygiene: false, … },
  cuisine: { …, action_designer_responsable_hygiene: false, … },
```

Placer la clé à la suite de `action_delete_ac` dans chaque bloc, pour que
l'ordre des trois rôles reste identique et lisible en diff.

- [ ] **Step 2 : Ajouter la ligne dans l'écran de permissions**

Dans `src/pages/AdminPermissions.tsx`, groupe `Actions`, après
`action_delete_ac` :

```ts
      { key: 'action_designer_responsable_hygiene', label: 'Désigner un responsable d\'hygiène', note: 'checklists hebdo et mensuelle' },
```

- [ ] **Step 3 : Consommer la permission dans la page Hygiène**

Dans `src/modules/corner/pages/Hygiene.tsx`, ajouter l'import :

```tsx
import { usePermissions } from '../../../contexts/PermissionsContext'
```

Puis remplacer la ligne 106 :

```tsx
  const canEditResponsable = ['patron', 'administrateur', 'manager'].includes(user?.role ?? '')
```

par :

```tsx
  const { can } = usePermissions()
  // can() renvoie toujours true pour patron et administrateur ; seul le
  // manager est réglable, et corner/cuisine sont exclus par défaut.
  const canEditResponsable = can(user?.role, 'action_designer_responsable_hygiene')
```

- [ ] **Step 4 : Appliquer la permission côté règles**

Dans `firestore.rules`, bloc `match /hygiene_responsables/{doc}`, remplacer :

```
      allow create, update: if isPatronOrManager();
```

par :

```
      // Le plancher isPatronOrManager() rend le fail-open de permAllows()
      // inoffensif : même si la clé manque dans settings/permissions, corner
      // et cuisine restent bloqués. La permission ne peut que retirer le
      // droit au manager, jamais l'accorder à un salarié.
      allow create, update: if isPatronOrManager()
                            && permAllows('action_designer_responsable_hygiene');
```

- [ ] **Step 5 : Vérifier le typage et les tests**

Run: `npm run build && npm test`
Expected: build réussi. Si `tsc` signale une clé manquante dans un des trois
rôles de `DEFAULT_PERMISSIONS`, c'est que l'ajout du Step 1 est incomplet —
`RolePerms` est un `Record<PermKey, boolean>`, il exige les trois.

- [ ] **Step 6 : Commit**

```bash
git add src/contexts/PermissionsContext.tsx src/pages/AdminPermissions.tsx src/modules/corner/pages/Hygiene.tsx firestore.rules
git commit -m "feat(hygiene): droit de désigner réglable via les permissions

Réutilise settings/permissions plutôt que d'ajouter un second système.
Patron et administrateur gardent le droit en toutes circonstances ; le
manager devient réglable dans /admin/permissions ; corner et cuisine
restent bloqués par le plancher de la règle Firestore."
```

---

## Tâche 5 : Fonctions Cloud pilotées par la configuration

**Files:**
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: `mergeHygieneSettings`, `DEFAULT_HYGIENE_SETTINGS`, `resolveJalon`, `HygieneSettings`, `JalonKey` (Tâche 1)
- Produces: rien

**Convention de notation pour cette tâche.** Les extraits ci-dessous montrent
uniquement ce qui change. Un `sendHygieneMail(…)   // inchangé` signifie :
**conserver l'appel existant tel quel, avec tous ses arguments** — sujet, corps
HTML, destinataires — et n'ajouter que la garde qui l'entoure. Ne réécris aucun
contenu d'email : les textes actuels sont validés. De même, `…` dans une liste
de variables signifie « le code existant à cet endroit reste en place ».

- [ ] **Step 1 : Remplacer les helpers de lecture des réglages**

Dans `functions/src/index.ts`, compléter l'import du module de périodes :

```ts
import {
  getPeriodId, resolveJalon, isHygieneDone, itemIdsFor, parisNow,
  mergeHygieneSettings, QUOTIDIEN_IDS,
  type HygieneKind, type HygieneSettings,
} from './hygiene/periods'
```

Conserver `QUOTIDIEN_IDS` s'il est déjà importé ; ne pas dupliquer la ligne.

Remplacer les deux helpers `getHygieneEscaladeEmails` et `hygieneRappelsActifs`
par un seul, qui lit le document une fois et renvoie la configuration fusionnée :

```ts
/** Lit et complète les réglages d'hygiène. Une lecture, des défauts appliqués
 *  champ par champ : un document absent ou partiel produit exactement le
 *  comportement figé d'avant les réglages. */
async function getHygieneSettings(): Promise<HygieneSettings> {
  const snap = await db.doc('settings/hygiene_responsables').get()
  return mergeHygieneSettings(snap.data())
}

/** Destinataires de l'escalade, avec repli : une escalade ne doit jamais
 *  partir dans le vide. */
async function getHygieneEscaladeEmails(config: HygieneSettings): Promise<string[]> {
  if (config.escaladeDestinataires.length) return config.escaladeDestinataires
  const alertSnap = await db.doc('settings/alert_emails').get()
  const repli = (alertSnap.data()?.responsables ?? []) as string[]
  if (repli.length) return repli
  return ['a.cozzika@gmail.com', 'kyriazis@outlook.fr']
}
```

- [ ] **Step 2 : Appliquer les canaux à la notification de désignation**

Dans `onHygieneResponsableAssigned`, après la garde anti-boucle, lire les
réglages et conditionner chaque envoi :

```ts
    const config = await getHygieneSettings()
    const kind = apres.kind as HygieneKind
    …

    if (config.canaux.designation.push) {
      // Isolé : une panne FCM ne doit jamais priver du seul canal garanti.
      try { await notifyUids([apres.assigneeUid], titre, corps, '/corner/hygiene') }
      catch (e) { console.error('[hygiene] push désignation échoué', e) }
    }

    if (config.canaux.designation.email && apres.assigneeEmail) {
      await sendHygieneMail(…)   // inchangé
    }
```

`notifiedAt` continue d'être écrit dans tous les cas, y compris quand les deux
canaux sont coupés : le champ trace la prise en compte par le système, pas la
réception d'un message. Sans cela, rallumer les notifications ferait re-notifier
toutes les désignations passées.

- [ ] **Step 3 : Piloter la fonction de rappel par la configuration**

Dans `hygieneRappelsResponsables` :

Changer la planification :

```ts
  { schedule: '0 * * * *', timeZone: 'Europe/Paris', region: 'europe-west1' },
```

Remplacer l'appel à `hygieneRappelsActifs()` par la lecture de la configuration :

```ts
    const config = await getHygieneSettings()
    if (!config.rappelsEnabled) {
      console.log('[hygiene] Rappels désactivés dans les paramètres.')
      return
    }
```

Passer la configuration au résolveur :

```ts
        const jalon = resolveJalon(kind, now, config)
```

Dans la branche « aucun responsable désigné », remplacer le test `jalon !== 'j-3'`
par `jalon !== 'rappel1'`, conditionner l'envoi au canal d'escalade, et passer la
configuration au helper de destinataires :

```ts
        if (!respSnap.exists) {
          if (jalon !== 'rappel1' || !config.canaux.escalade.email) continue
          const emails = await getHygieneEscaladeEmails(config)
          await sendHygieneMail(…)   // inchangé
          continue
        }
```

Dans la branche d'escalade, conditionner de même :

```ts
        if (jalon === 'escalade') {
          if (config.canaux.escalade.email) {
            const emails = await getHygieneEscaladeEmails(config)
            await sendHygieneMail(…)   // inchangé
          }
          if (config.canaux.escalade.push) {
            try { await notifyUids([resp.assigneeUid], titre, corps, '/corner/hygiene') }
            catch (e) { console.error('[hygiene] push escalade échoué', e) }
          }
          await respRef.set({ remindersSent: [...dejaEnvoyes, jalon], escalatedAt: new Date() }, { merge: true })
          continue
        }
```

Le marqueur `remindersSent` est écrit **même si les deux canaux sont coupés** :
sans cela, une escalade muette se redéclencherait à chaque exécution horaire dès
que le canal serait rallumé.

Dans la branche de rappel ciblé, conditionner les deux envois :

```ts
      if (config.canaux.rappel.push) {
        try { await notifyUids([resp.assigneeUid], titre, corps, '/corner/hygiene') }
        catch (e) { console.error('[hygiene] push rappel échoué', e) }
      }
      if (config.canaux.rappel.email && resp.assigneeEmail) {
        await sendHygieneMail(…)   // inchangé
      }
      await respRef.set({ remindersSent: [...dejaEnvoyes, jalon] }, { merge: true })
```

- [ ] **Step 4 : Adapter les deux fonctions collectives**

`notifHygieneHebdo` et `notifHygieneMensuel` appellent encore `hygieneRappelsActifs()`,
qui n'existe plus. Remplacer, dans chacune :

```ts
    const respSnap = await db.doc(`hygiene_responsables/${weekId}`).get()
    const config = await getHygieneSettings()
    if (respSnap.exists && config.rappelsEnabled) {
      console.log('[hebdo] Responsable désigné et rappels ciblés actifs — pas de broadcast.')
      return
    }
```

(et `monthId` dans la variante mensuelle).

La double condition est essentielle et ne doit pas être simplifiée : se taire
sur la seule existence d'un responsable ferait qu'un encadrant décochant
« Rappels automatiques activés » supprimerait tous les rappels d'hygiène, par
tous les canaux, sans que rien ne l'indique.

- [ ] **Step 5 : Compiler et tester**

```bash
cd functions && npm run build && cd ..
npm test
npm run build
```

Expected: les trois réussissent. La compilation des fonctions, qui échouait à la
fin de la Tâche 1, doit désormais passer — c'est cette tâche qui met les
appelants en accord avec la nouvelle signature.

Vérifier ensuite qu'aucune occurrence obsolète ne subsiste :

```bash
grep -n "hygieneRappelsActifs\|'j-3'\|'j-1'\|0 10,18" functions/src/index.ts
```
Expected: aucun résultat.

- [ ] **Step 6 : Commit**

```bash
git add functions/src/index.ts functions/lib
git commit -m "feat(hygiene): rappels et canaux pilotés par les paramètres

Le cron passe à l'heure — conséquence directe de l'heure réglable. Chaque
envoi suit son canal, le push est isolé pour ne jamais priver de l'email,
et les marqueurs d'idempotence sont écrits même canaux coupés pour qu'un
rallumage ne rejoue pas le passé."
```

---

## Vérification finale

- [ ] `npm test` — tous les tests passent, y compris les deux jeux de valeurs par défaut
- [ ] `npm run build` — aucune erreur TypeScript
- [ ] `cd functions && npm run build` — aucune erreur, pas de `.test.js` dans `lib/`
- [ ] `grep -rn "'j-3'\|'j-1'" functions/src src/` — aucun résultat
- [ ] `grep -n "hygieneRappelsActifs" functions/src/index.ts` — aucun résultat

## À vérifier à la main après déploiement

1. **Section Paramètres** : les quatre blocs se déplient, chaque résumé reflète le réglage courant, l'enregistrement persiste après rechargement.
2. **Avertissement de collision** : régler le 2e rappel sur dimanche 18h → le message orange apparaît et nomme le bon jalon gagnant.
3. **Permissions** : décocher « Désigner un responsable d'hygiène » pour le manager dans `/admin/permissions`, se connecter en manager → le sélecteur disparaît de l'onglet Nettoyage, et une tentative d'écriture est refusée par les règles.
4. **Cron horaire** : vérifier dans les logs que `hygieneRappelsResponsables` s'exécute toutes les heures et sort immédiatement quand aucun jalon ne correspond.
5. **Un rappel déplacé** : régler le 1er rappel hebdo sur le jour et l'heure suivants, attendre le créneau, vérifier l'envoi et l'apparition de `rappel1` dans `remindersSent`.
6. **Canal coupé** : décocher le push des rappels, vérifier que l'email part seul et que le marqueur est bien écrit.
7. **Non-régression du filet collectif** : décocher « Rappels automatiques activés » sur une période **avec** responsable → le broadcast collectif doit repartir, il ne doit pas y avoir de silence total.
8. **Document de réglages absent** : la fonction doit se comporter exactement comme avant cette évolution.
