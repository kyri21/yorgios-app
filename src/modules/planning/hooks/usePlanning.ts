import { useState, useCallback, useRef } from 'react'
import {
  loadWeek, saveWeek, emptyWeekDraft, weekId, mondayOf,
  loadWeekEvents, saveWeekEvents, addDays, clearWeek
} from '../firebase/planning'
import type { WeekDraft, WeekEvents, DayEvent, EmpWeekCounter, AbsenceType, Employee } from '../types'

export function computeWeekCounters(
  draft: WeekDraft,
  weekEvents: WeekEvents,
  employees: Employee[]
): EmpWeekCounter[] {
  return employees.map(emp => {
    let heuresTravaillees = 0
    for (let i = 0; i < 7; i++) {
      const hours = draft[i]?.hours ?? {}
      Object.values(hours).forEach(emps => {
        if (emps.includes(emp.id)) heuresTravaillees++
      })
    }
    let conges = 0, sansSolde = 0, absences = 0, retardMinutes = 0, joursOff = 0
    Object.values(weekEvents).forEach(dayEvents => {
      dayEvents.filter(e => e.empId === emp.id).forEach(e => {
        if (e.type === 'conge') conges++
        else if (e.type === 'sans_solde') sansSolde++
        else if (e.type === 'absence') absences++
        else if (e.type === 'retard') retardMinutes += e.minutes ?? 0
        else if (e.type === 'jour_off') joursOff++
      })
    })
    return {
      empId: emp.id,
      heuresTravaillees,
      heuresContrat: emp.weeklyCapHours,
      heuresSupp: Math.max(0, heuresTravaillees - emp.weeklyCapHours),
      conges, sansSolde, absences, retardMinutes, joursOff,
    }
  })
}

function toLocalISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface HistoryEntry {
  id: string
  label: string
  timestamp: Date
  monday: Date
  draft: WeekDraft
  weekEvents: WeekEvents
}

export function usePlanning(user: { uid: string } | null) {
  const [monday, setMondayState] = useState<Date>(() => mondayOf(new Date()))
  const setMonday = (d: Date) => { mondayRef.current = d; setMondayState(d) }
  const [draft, setDraft] = useState<WeekDraft>(emptyWeekDraft)
  const [weekEvents, setWeekEvents] = useState<WeekEvents>({})
  const [savedWeekId, setSavedWeekId] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])

  const loadCurrentWeek = useCallback(async (mon: Date) => {
    setLoading(true)
    setDirty(false)
    try {
      const wid = weekId(mon)
      const [loaded, events] = await Promise.all([loadWeek(mon), loadWeekEvents(mon)])
      setDraft(loaded)
      setWeekEvents(events)
      setSavedWeekId(wid)
    } finally {
      setLoading(false)
    }
  }, [])

  const goToWeek = useCallback((mon: Date) => {
    setMonday(mon)
    loadCurrentWeek(mon)
  }, [loadCurrentWeek])

  const toggleCell = useCallback((dayIndex: number, hour: number, empId: string) => {
    setDraft(prev => {
      const day = prev[dayIndex]
      const h = String(hour)
      const current = day.hours[h] ?? []
      const newList = current.includes(empId)
        ? current.filter(id => id !== empId)
        : [...current, empId]
      return {
        ...prev,
        [dayIndex]: { ...day, hours: { ...day.hours, [h]: newList } }
      }
    })
    setDirty(true)
  }, [])

  const paintCell = useCallback((dayIndex: number, hour: number, empId: string, paintMode: 'add' | 'remove') => {
    setDraft(prev => {
      const day = prev[dayIndex]
      const h = String(hour)
      const current = day.hours[h] ?? []
      const newList = paintMode === 'add'
        ? current.includes(empId) ? current : [...current, empId]
        : current.filter(id => id !== empId)
      return {
        ...prev,
        [dayIndex]: { ...day, hours: { ...day.hours, [h]: newList } }
      }
    })
    setDirty(true)
  }, [])

  const setDayEvent = useCallback((dateISO: string, event: DayEvent) => {
    setWeekEvents(prev => {
      const dayEvents = prev[dateISO] ?? []
      const filtered = dayEvents.filter(e => !(e.empId === event.empId && e.type === event.type))
      return { ...prev, [dateISO]: [...filtered, event] }
    })
    setDirty(true)
  }, [])

  const removeDayEvent = useCallback((dateISO: string, empId: string, type?: string) => {
    setWeekEvents(prev => {
      const dayEvents = prev[dateISO] ?? []
      const filtered = type
        ? dayEvents.filter(e => !(e.empId === empId && e.type === type))
        : dayEvents.filter(e => e.empId !== empId)
      return { ...prev, [dateISO]: filtered }
    })
    setDirty(true)
  }, [])

  const mondayRef = useRef(mondayOf(new Date()))

  function groupDatesByWeek(dates: string[]) {
    const map = new Map<string, { mon: Date; dates: string[] }>()
    dates.forEach(dateISO => {
      const [y, m, d] = dateISO.split('-').map(Number)
      const mon = mondayOf(new Date(y, m - 1, d))
      const wid = weekId(mon)
      if (!map.has(wid)) map.set(wid, { mon, dates: [] })
      map.get(wid)!.dates.push(dateISO)
    })
    return map
  }

  const setEventRange = useCallback(async (
    startISO: string, endISO: string, empId: string, type: AbsenceType, minutes?: number
  ) => {
    if (!user) return
    const event: DayEvent = minutes !== undefined ? { empId, type, minutes } : { empId, type }
    const dates: string[] = []
    const d = new Date(startISO + 'T12:00:00')
    const end = new Date(endISO + 'T12:00:00')
    while (d <= end) { dates.push(toLocalISO(d)); d.setDate(d.getDate() + 1) }
    const currentWid = weekId(mondayRef.current)
    const weekMap = groupDatesByWeek(dates)
    const curEntry = weekMap.get(currentWid)
    if (curEntry) {
      setWeekEvents(prev => {
        const next = { ...prev }
        curEntry.dates.forEach(iso => {
          const existing = next[iso] ?? []
          next[iso] = [...existing.filter(e => !(e.empId === empId && e.type === type)), event]
        })
        return next
      })
      setDirty(true)
    }
    for (const [wid, { mon, dates: wDates }] of weekMap) {
      if (wid === currentWid) continue
      const events = await loadWeekEvents(mon)
      wDates.forEach(iso => {
        events[iso] = [...(events[iso] ?? []).filter(e => !(e.empId === empId && e.type === type)), event]
      })
      await saveWeekEvents(mon, events, user.uid)
    }
  }, [user])

  const removeEventRange = useCallback(async (startISO: string, endISO: string, empId: string) => {
    if (!user) return
    const dates: string[] = []
    const d = new Date(startISO + 'T12:00:00')
    const end = new Date(endISO + 'T12:00:00')
    while (d <= end) { dates.push(toLocalISO(d)); d.setDate(d.getDate() + 1) }
    const currentWid = weekId(mondayRef.current)
    const weekMap = groupDatesByWeek(dates)
    const curEntry = weekMap.get(currentWid)
    if (curEntry) {
      setWeekEvents(prev => {
        const next = { ...prev }
        curEntry.dates.forEach(iso => { next[iso] = (next[iso] ?? []).filter(e => e.empId !== empId) })
        return next
      })
      setDirty(true)
    }
    for (const [wid, { mon, dates: wDates }] of weekMap) {
      if (wid === currentWid) continue
      const events = await loadWeekEvents(mon)
      wDates.forEach(iso => { events[iso] = (events[iso] ?? []).filter(e => e.empId !== empId) })
      await saveWeekEvents(mon, events, user.uid)
    }
  }, [user])

  const save = useCallback(async () => {
    if (!user) return
    setSaving(true)
    const snap: HistoryEntry = {
      id: Date.now().toString(),
      label: new Date().toLocaleString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
      timestamp: new Date(),
      monday: new Date(mondayRef.current),
      draft: JSON.parse(JSON.stringify(draft)),
      weekEvents: JSON.parse(JSON.stringify(weekEvents)),
    }
    await Promise.all([saveWeek(monday, draft, user.uid), saveWeekEvents(monday, weekEvents, user.uid)])
    setHistory(prev => [snap, ...prev].slice(0, 10))
    setSaving(false)
    setDirty(false)
  }, [user, monday, draft, weekEvents])

  const undoTo = useCallback(async (entry: HistoryEntry) => {
    if (!user) return
    setSaving(true)
    setMondayState(entry.monday)
    mondayRef.current = entry.monday
    setDraft(entry.draft)
    setWeekEvents(entry.weekEvents)
    await Promise.all([saveWeek(entry.monday, entry.draft, user.uid), saveWeekEvents(entry.monday, entry.weekEvents, user.uid)])
    setHistory(prev => prev.filter(h => h.timestamp < entry.timestamp))
    setSaving(false)
    setDirty(false)
  }, [user])

  const clearCurrentWeek = useCallback(async () => {
    if (!user) return
    setSaving(true)
    try {
      const empty = emptyWeekDraft()
      const emptyEvents: WeekEvents = {}
      for (let i = 0; i < 7; i++) {
        emptyEvents[toLocalISO(addDays(mondayRef.current, i))] = []
      }
      setDraft(empty)
      setWeekEvents(emptyEvents)
      await clearWeek(mondayRef.current, user.uid)
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }, [user])

  function weeklyHours(empId: string): number {
    let total = 0
    for (let i = 0; i < 7; i++) {
      Object.values(draft[i]?.hours ?? {}).forEach(emps => { if (emps.includes(empId)) total++ })
    }
    return total
  }

  const clearDay = useCallback((dayIndex: number) => {
    setDraft(prev => {
      const hours: Record<string, string[]> = {}
      Object.keys(prev[dayIndex]?.hours ?? {}).forEach(h => { hours[h] = [] })
      return { ...prev, [dayIndex]: { dayIndex, hours } }
    })
    setDirty(true)
  }, [])

  const copyDay = useCallback((srcIndex: number, dstIndexes: number[]) => {
    setDraft(prev => {
      const srcHours = prev[srcIndex]?.hours ?? {}
      const next = { ...prev }
      dstIndexes.forEach(di => {
        next[di] = { dayIndex: di, hours: JSON.parse(JSON.stringify(srcHours)) }
      })
      return next
    })
    setDirty(true)
  }, [])

  function dayDateISO(dayIndex: number): string {
    return toLocalISO(addDays(monday, dayIndex))
  }

  return {
    monday, goToWeek,
    draft,
    weekEvents, setDayEvent, removeDayEvent, setEventRange, removeEventRange,
    loading, saving, dirty,
    toggleCell, paintCell,
    save, history, undoTo,
    weeklyHours,
    clearDay, copyDay,
    dayDateISO,
    clearCurrentWeek,
  }
}
