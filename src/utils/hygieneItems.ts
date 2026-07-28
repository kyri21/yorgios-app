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
