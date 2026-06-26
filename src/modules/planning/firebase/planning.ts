import {
  doc, getDoc, getDocFromCache, setDoc, collection, getDocs,
  writeBatch, serverTimestamp, query, where, orderBy, limit, Timestamp
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import type { WeekDraft, DayDraft, HoursMap, WeekEvents, DayEvent, AuditEntry, AuditKind, HoursSnapshot } from '../types'
import { HOURS } from '../types'

export function mondayOf(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

export function weekId(monday: Date): string {
  return toLocalISO(monday)
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function toLocalISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function emptyWeekDraft(): WeekDraft {
  const draft: WeekDraft = {}
  for (let i = 0; i < 7; i++) {
    const hours: HoursMap = {}
    HOURS.forEach(h => { hours[String(h)] = [] })
    draft[i] = { dayIndex: i, hours }
  }
  return draft
}

// fromCache=true → getDocFromCache : rejette si la semaine n'est pas en cache local
// (le hook catch et tombe sur le serveur). Sinon getDoc (server-first, fallback offline).
// Les 7 jours sont lus en PARALLÈLE (avant : 7 allers-retours en série = ~lenteur 4G).
export async function loadWeek(monday: Date, fromCache = false): Promise<WeekDraft> {
  const wid = weekId(monday)
  const draft = emptyWeekDraft()
  const read = (ref: ReturnType<typeof doc>) => fromCache ? getDocFromCache(ref) : getDoc(ref)
  const snaps = await Promise.all(
    Array.from({ length: 7 }, (_, i) => read(doc(db, 'planningWeeks', wid, 'days', String(i))))
  )
  snaps.forEach((snap, i) => {
    if (snap.exists()) {
      const data = snap.data()
      const hours: HoursMap = {}
      HOURS.forEach(h => {
        hours[String(h)] = data.hours?.[String(h)] ?? []
      })
      draft[i] = { dayIndex: i, hours }
    }
  })
  return draft
}

// ─── Journal d'audit ──────────────────────────────────────────────
// Snapshot des horaires des 7 jours d'une semaine sous forme { "0": HoursMap, ... }.
function hoursSnapshot(draft: WeekDraft): HoursSnapshot {
  const out: HoursSnapshot = {}
  for (let i = 0; i < 7; i++) out[String(i)] = draft[i]?.hours ?? {}
  return out
}

// Ajoute une entrée d'audit AU MÊME writeBatch que la modification : la trace et la donnée
// commitent ensemble ou pas du tout (impossible d'avoir une modif sans sa preuve, ou l'inverse).
// N'écrit RIEN si l'état avant == après (évite le bruit sur un "Enregistrer" sans changement réel).
function appendAudit(
  batch: ReturnType<typeof writeBatch>,
  wid: string, mondayISO: string, kind: AuditKind,
  before: HoursSnapshot | WeekEvents, after: HoursSnapshot | WeekEvents,
  uid: string, authorName: string,
) {
  if (JSON.stringify(before) === JSON.stringify(after)) return
  const ref = doc(collection(db, 'planning_audit'))
  batch.set(ref, {
    weekId: wid,
    mondayDate: mondayISO,
    kind,
    authorUid: uid,
    authorName: authorName || '',
    at: serverTimestamp(),
    before,
    after,
  })
}

export async function saveWeek(monday: Date, draft: WeekDraft, uid: string, authorName = '') {
  const wid = weekId(monday)
  // État courant lu AVANT l'écriture, pour journaliser le before → after.
  const before = await loadWeek(monday)
  const batch = writeBatch(db)
  const weekRef = doc(db, 'planningWeeks', wid)
  batch.set(weekRef, {
    weekId: wid,
    mondayDate: monday.toISOString().slice(0, 10),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    locked: false
  }, { merge: true })
  for (let i = 0; i < 7; i++) {
    const dayRef = doc(db, 'planningWeeks', wid, 'days', String(i))
    batch.set(dayRef, {
      dayIndex: i,
      hours: draft[i]?.hours ?? {},
      updatedAt: serverTimestamp(),
      updatedBy: uid
    })
  }
  appendAudit(batch, wid, monday.toISOString().slice(0, 10), 'hours',
    hoursSnapshot(before), hoursSnapshot(draft), uid, authorName)
  await batch.commit()
}

export async function duplicateWeek(srcMonday: Date, dstMonday: Date, uid: string, authorName = '') {
  const src = await loadWeek(srcMonday)
  await saveWeek(dstMonday, src, uid, authorName)
}

export async function loadWeekEvents(monday: Date, fromCache = false): Promise<WeekEvents> {
  const wid = weekId(monday)
  const events: WeekEvents = {}
  const read = (ref: ReturnType<typeof doc>) => fromCache ? getDocFromCache(ref) : getDoc(ref)
  const dateISOs = Array.from({ length: 7 }, (_, i) => toLocalISO(addDays(monday, i)))
  const snaps = await Promise.all(
    dateISOs.map(dateISO => read(doc(db, 'planningWeeks', wid, 'events', dateISO)))
  )
  dateISOs.forEach((dateISO, i) => {
    events[dateISO] = snaps[i].exists() ? (snaps[i].data()!.events ?? []) : []
  })
  return events
}

export async function saveWeekEvents(monday: Date, events: WeekEvents, uid: string, authorName = '') {
  const wid = weekId(monday)
  // État courant lu AVANT l'écriture, pour journaliser le before → after.
  const before = await loadWeekEvents(monday)
  const batch = writeBatch(db)
  for (let i = 0; i < 7; i++) {
    const dateISO = toLocalISO(addDays(monday, i))
    const ref = doc(db, 'planningWeeks', wid, 'events', dateISO)
    batch.set(ref, {
      date: dateISO,
      events: events[dateISO] ?? [],
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    })
  }
  appendAudit(batch, wid, monday.toISOString().slice(0, 10), 'events', before, events, uid, authorName)
  await batch.commit()
}

export async function clearWeek(monday: Date, uid: string, authorName = '') {
  const emptyEvents: WeekEvents = {}
  for (let i = 0; i < 7; i++) {
    emptyEvents[toLocalISO(addDays(monday, i))] = []
  }
  await saveWeek(monday, emptyWeekDraft(), uid, authorName)
  await saveWeekEvents(monday, emptyEvents, uid, authorName)
}

// Lit le journal d'audit d'une semaine, le plus récent en premier.
// Nécessite l'index composite planning_audit (weekId ASC, at DESC).
export async function loadAuditEntries(monday: Date, maxEntries = 100): Promise<AuditEntry[]> {
  const wid = weekId(monday)
  const q = query(
    collection(db, 'planning_audit'),
    where('weekId', '==', wid),
    orderBy('at', 'desc'),
    limit(maxEntries),
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => {
    const data = d.data()
    return {
      id: d.id,
      weekId: data.weekId,
      mondayDate: data.mondayDate,
      kind: data.kind as AuditKind,
      authorUid: data.authorUid,
      authorName: data.authorName ?? '',
      at: data.at instanceof Timestamp ? data.at.toDate() : null,
      before: data.before ?? {},
      after: data.after ?? {},
    }
  })
}
