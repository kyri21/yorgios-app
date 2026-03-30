import {
  doc, getDoc, setDoc, collection, getDocs,
  writeBatch, serverTimestamp
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import type { WeekDraft, DayDraft, HoursMap, WeekEvents, DayEvent } from '../types'
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

export async function loadWeek(monday: Date): Promise<WeekDraft> {
  const wid = weekId(monday)
  const draft = emptyWeekDraft()
  for (let i = 0; i < 7; i++) {
    const ref = doc(db, 'planningWeeks', wid, 'days', String(i))
    const snap = await getDoc(ref)
    if (snap.exists()) {
      const data = snap.data()
      const hours: HoursMap = {}
      HOURS.forEach(h => {
        hours[String(h)] = data.hours?.[String(h)] ?? []
      })
      draft[i] = { dayIndex: i, hours }
    }
  }
  return draft
}

export async function saveWeek(monday: Date, draft: WeekDraft, uid: string) {
  const wid = weekId(monday)
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
  await batch.commit()
}

export async function duplicateWeek(srcMonday: Date, dstMonday: Date, uid: string) {
  const src = await loadWeek(srcMonday)
  await saveWeek(dstMonday, src, uid)
}

export async function loadWeekEvents(monday: Date): Promise<WeekEvents> {
  const wid = weekId(monday)
  const events: WeekEvents = {}
  for (let i = 0; i < 7; i++) {
    const dateISO = toLocalISO(addDays(monday, i))
    events[dateISO] = []
    const ref = doc(db, 'planningWeeks', wid, 'events', dateISO)
    const snap = await getDoc(ref)
    if (snap.exists()) {
      events[dateISO] = snap.data().events ?? []
    }
  }
  return events
}

export async function saveWeekEvents(monday: Date, events: WeekEvents, uid: string) {
  const wid = weekId(monday)
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
  await batch.commit()
}

export async function clearWeek(monday: Date, uid: string) {
  const emptyEvents: WeekEvents = {}
  for (let i = 0; i < 7; i++) {
    emptyEvents[toLocalISO(addDays(monday, i))] = []
  }
  await saveWeek(monday, emptyWeekDraft(), uid)
  await saveWeekEvents(monday, emptyEvents, uid)
}
