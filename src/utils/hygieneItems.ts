/** Items des checklists d'hygiène — définition, éligibilité, sélection.
 *
 *  Règle centrale : un item ne s'applique qu'aux périodes qui COMMENCENT
 *  après sa création. Ajouter un item ne peut donc jamais rendre incomplète
 *  une période passée ou en cours — c'est la garantie demandée sur un
 *  registre sanitaire, où réécrire le passé n'est pas acceptable.
 *
 *  La désactivation suit la même logique, symétriquement : retirer un item
 *  n'allège jamais une période déjà commencée. */

export type ChecklistKind = 'quotidien' | 'hebdo' | 'mensuel'

export type HygieneItem = {
  id: string        // immuable — c'est lui qui rattache l'historique
  label: string     // renommable librement
  actif: boolean
  ordre: number
  /** Timestamp Firestore, Date, ou objet sérialisé `{ seconds }`.
   *  Absent = item d'origine, précède toute modification, toujours éligible. */
  creeLe?: any
  /** Posée quand l'item est retiré, effacée quand il est réactivé. Mêmes
   *  formes que `creeLe`. Absent = jamais désactivé (ou réactivé). */
  desactiveLe?: any
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
    // On teste l'EXISTENCE du tableau, pas sa longueur : une liste que
    // l'utilisateur a explicitement vidée doit rester vide, pas revenir aux
    // items d'origine comme si son geste n'avait pas eu lieu.
    out[kind] = Array.isArray(brut)
      ? [...brut].sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0))
      : ITEMS_ORIGINE[kind]
  }
  return out
}

/** Début de la période contenant `ref`. C'est la borne comparée à `creeLe`
 *  et à `desactiveLe`. */
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

/**
 * Résout un champ date (`creeLe` ou `desactiveLe`) en millisecondes.
 *
 * - absent (`null`/`undefined`) → `null` : ce champ ne porte aucune restriction.
 * - illisible (objet vide, chaîne invalide, format inattendu après une
 *   migration ou une édition manuelle) → `refMs`, l'instant de référence.
 *   Une date corrompue ne doit jamais permettre d'appliquer une règle
 *   rétroactivement — ni pour compter un item plus tôt que prévu (création),
 *   ni pour cesser de le compter plus tôt que prévu (désactivation). La
 *   traiter comme survenue « maintenant » (au sens de la période qu'on est
 *   en train d'évaluer) est la seule lecture qui ne triche jamais dans un
 *   sens ou dans l'autre.
 * - valide (Timestamp Firestore via `toMillis()`, `Date`, objet sérialisé
 *   `{ seconds }`, ou toute valeur parsable) → sa valeur réelle.
 */
function resoudreDateMs(valeur: any, refMs: number): number | null {
  if (valeur == null) return null
  if (typeof valeur?.toMillis === 'function') {
    const ms = valeur.toMillis()
    return Number.isFinite(ms) ? ms : refMs
  }
  if (valeur instanceof Date) {
    const ms = valeur.getTime()
    return Number.isFinite(ms) ? ms : refMs
  }
  if (typeof valeur?.seconds === 'number') {
    return Number.isFinite(valeur.seconds) ? valeur.seconds * 1000 : refMs
  }
  const ms = new Date(valeur).getTime()
  return Number.isFinite(ms) ? ms : refMs
}

/**
 * Un item était-il actif au tout début de la période (`debut`) ?
 *
 * - Créé pendant ou après le début de la période → pas encore éligible :
 *   l'ajout ne s'applique qu'aux périodes qui COMMENCENT après la création.
 * - Actuellement actif → rien d'autre à vérifier ; `desactiveLe` est effacé
 *   à la réactivation, sa seule présence ne devrait donc jamais se produire
 *   en même temps que `actif: true`, mais on ne la consulte de toute façon
 *   pas dans ce cas.
 * - Actuellement inactif, avec une date de désactivation connue → compte
 *   encore pour cette période si la désactivation est survenue pendant ou
 *   après son début (retirer un item n'allège pas une période déjà commencée).
 * - Actuellement inactif SANS date de désactivation connue (donnée
 *   antérieure à l'introduction de ce champ, ou éditée à la main) → exclu
 *   sans condition, comportement historique préservé.
 */
function actifAuDebut(item: HygieneItem, debut: number, refMs: number): boolean {
  const creeMs = resoudreDateMs(item.creeLe, refMs)
  if (creeMs !== null && !(creeMs < debut)) return false

  if (item.actif) return true

  const desactiveMs = resoudreDateMs(item.desactiveLe, refMs)
  if (desactiveMs === null) return false
  return desactiveMs >= debut
}

/**
 * Les items d'une période.
 *
 * Si `itemsAttendus` est fourni — la période a déjà été sauvegardée — c'est
 * lui qui fait foi, tel quel : ce qui est affiché est ce qui est jugé, et une
 * resauvegarde ne rebat pas les cartes. On teste l'EXISTENCE du tableau, pas
 * sa longueur : une période dont la liste attendue est légitimement vide
 * (tous les items retirés avant la première sauvegarde) doit rester vide,
 * pas retomber sur un recalcul par date.
 *
 * Sinon, les items actifs au début de la période (voir `actifAuDebut`).
 */
export function itemsPourPeriode(
  settings: HygieneItemsSettings,
  kind: ChecklistKind,
  ref: Date,
  itemsAttendus?: string[] | null,
): HygieneItem[] {
  const liste = settings[kind] ?? []

  if (itemsAttendus != null) {
    const parId = new Map(liste.map(i => [i.id, i]))
    // Un identifiant absent des réglages s'affiche brut plutôt que de
    // disparaître : une case cochée qui s'évapore d'un registre HACCP est
    // pire qu'un libellé disgracieux.
    return itemsAttendus.map((id, i) =>
      parId.get(id) ?? { id, label: id, actif: false, ordre: i })
  }

  const refMs = ref.getTime()
  const debut = debutPeriode(kind, ref).getTime()
  return liste.filter(i => actifAuDebut(i, debut, refMs))
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
  // La troncature à 40 caractères doit précéder le nettoyage des underscores
  // de bord : sinon la coupe peut retomber en plein milieu d'une suite
  // d'underscores qui n'était pas en bord de chaîne avant troncature, et
  // laisser un identifiant se terminant par `_`.
  const base = label
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // retire les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 40)
    .replace(/^_+|_+$/g, '')
    || `item_${idsExistants.length + 1}`

  if (!idsExistants.includes(base)) return base
  let n = 2
  while (idsExistants.includes(`${base}_${n}`)) n++
  return `${base}_${n}`
}
