/** Logique pure des périodes d'hygiène — aucun import firebase, pour
 *  rester testable. Duplique volontairement src/modules/corner/utils/hygiene.ts :
 *  ce projet n'a pas d'import cross-package entre le client et les fonctions.
 *  Les tests des deux côtés vérifient les mêmes identifiants. */

export type HygieneKind = 'hebdo' | 'mensuel'

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
  const attendus: string[] = Array.isArray(docData.itemsAttendus)
    ? docData.itemsAttendus
    : ITEMS_ORIGINE_IDS[kind]
  const items = docData.items ?? {}
  return attendus.every(id => items[id] === true)
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

/** Convertit et borne une valeur numérique lue depuis Firestore.
 *
 *  Le document `settings/hygiene_responsables` peut être édité à la main dans
 *  la console Firebase, ou écrit par un script qui sérialise tout en chaînes.
 *  `heure: "10"` comparé en `===` à un nombre dans `resolveJalon` ne
 *  correspondrait JAMAIS : le rappel ne partirait plus jamais, sans erreur,
 *  sans log, l'interface continuant d'afficher « jeu 10h ». Un simple
 *  étalement d'objets laissait passer cette valeur telle quelle.
 *
 *  ⚠️ Copie rigoureusement identique à src/utils/hygieneSettings.ts. */
function nombreBorne(brut: any, min: number, max: number, defaut: number): number {
  const n = typeof brut === 'string' ? Number(brut.trim()) : brut
  if (typeof n !== 'number' || !Number.isFinite(n)) return defaut
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** Booléen strict. `actif: "false"` sous forme de chaîne est une valeur vraie
 *  en JavaScript : un jalon affiché comme désactivé continuerait d'envoyer.
 *  Convention conservée de `rappelsEnabled` : absent (ou illisible) = actif,
 *  on n'éteint jamais un rappel par omission. */
function booleenStrict(brut: any, defaut: boolean): boolean {
  if (typeof brut === 'boolean') return brut
  if (brut === 'true')  return true
  if (brut === 'false') return false
  return defaut
}

/** Bornes de validation. `joursAvantFin` va jusqu'à 30 : c'est le maximum de
 *  jours restants réellement atteignable dans un mois de 31 jours. La saisie
 *  de la section Paramètres est volontairement plus stricte (0-27, la seule
 *  plage qui se déclenche aussi en février) — son domaine est un sous-ensemble
 *  de celui-ci, jamais l'inverse. */
const BORNES = {
  jour:          { min: 0, max: 6 },
  heure:         { min: 0, max: 23 },
  joursAvantFin: { min: 0, max: 30 },
}

/** Fusion champ par champ avec les défauts, valeurs converties et bornées.
 *  Un document absent, partiel, ou écrit par la révision 1 doit produire le
 *  comportement d'origine — c'est ce qui garantit que rendre ces réglages
 *  configurables ne casse rien pour qui n'y touche jamais. */
export function mergeHygieneSettings(data: any): HygieneSettings {
  const d = data ?? {}
  const hebdo   = {} as Record<JalonKey, JalonHebdo>
  const mensuel = {} as Record<JalonKey, JalonMensuel>
  for (const cle of JALONS) {
    const defH = DEFAULT_HYGIENE_SETTINGS.hebdo[cle]
    const brutH = d.hebdo?.[cle] ?? {}
    hebdo[cle] = {
      actif: booleenStrict(brutH.actif, defH.actif),
      jour:  nombreBorne(brutH.jour,  BORNES.jour.min,  BORNES.jour.max,  defH.jour),
      heure: nombreBorne(brutH.heure, BORNES.heure.min, BORNES.heure.max, defH.heure),
    }
    const defM = DEFAULT_HYGIENE_SETTINGS.mensuel[cle]
    const brutM = d.mensuel?.[cle] ?? {}
    mensuel[cle] = {
      actif: booleenStrict(brutM.actif, defM.actif),
      joursAvantFin: nombreBorne(
        brutM.joursAvantFin, BORNES.joursAvantFin.min, BORNES.joursAvantFin.max, defM.joursAvantFin,
      ),
      heure: nombreBorne(brutM.heure, BORNES.heure.min, BORNES.heure.max, defM.heure),
    }
  }
  const canal = (brut: any, defaut: Canal): Canal => ({
    email: booleenStrict(brut?.email, defaut.email),
    push:  booleenStrict(brut?.push,  defaut.push),
  })
  return {
    // Absent = actif : ne jamais éteindre des rappels par omission.
    rappelsEnabled: booleenStrict(d.rappelsEnabled, true),
    escaladeDestinataires: Array.isArray(d.escaladeDestinataires) ? d.escaladeDestinataires : [],
    hebdo,
    mensuel,
    canaux: {
      designation: canal(d.canaux?.designation, DEFAULT_HYGIENE_SETTINGS.canaux.designation),
      rappel:      canal(d.canaux?.rappel,      DEFAULT_HYGIENE_SETTINGS.canaux.rappel),
      escalade:    canal(d.canaux?.escalade,    DEFAULT_HYGIENE_SETTINGS.canaux.escalade),
    },
  }
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
  // Ordre DÉCROISSANT de gravité : le premier qui correspond gagne, donc en
  // cas de collision sur un même créneau c'est le plus grave qui part.
  // ⚠️ `JALONS` dans src/utils/hygieneSettings.ts porte l'ordre inverse, et
  // l'avertissement de collision de l'interface en dépend pour désigner le
  // bon gagnant. Répercuter toute modification de priorité des deux côtés.
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

/** Heure murale de Paris, quel que soit le fuseau du conteneur.
 *  Même approche que les fonctions planifiées déjà en place. */
export function parisNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }))
}
