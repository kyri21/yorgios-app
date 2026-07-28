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
