import { DAYS_LABELS } from '../types'
import { addDays, mondayOf } from '../firebase/planning'

export function formatDate(date: Date): string {
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}

export function dayLabel(monday: Date, dayIndex: number): string {
  return `${DAYS_LABELS[dayIndex]} ${formatDate(addDays(monday, dayIndex))}`
}

export function formatHour(h: number): string {
  return `${h.toString().padStart(2, '0')}h`
}

export function prevMonday(monday: Date): Date {
  const d = new Date(monday); d.setDate(d.getDate() - 7); return d
}

export function nextMonday(monday: Date): Date {
  const d = new Date(monday); d.setDate(d.getDate() + 7); return d
}

export function weekLabel(monday: Date): string {
  return `Semaine du ${formatDate(monday)} au ${formatDate(addDays(monday, 6))}`
}

export function prevMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() - 1, 1)
}

export function nextMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1)
}

export function monthLabel(date: Date): string {
  return date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

export function weeksInMonth(monthDate: Date): Date[] {
  const year = monthDate.getFullYear()
  const month = monthDate.getMonth()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const weeks: Date[] = []
  let mon = mondayOf(firstDay)
  while (mon <= lastDay) {
    weeks.push(new Date(mon))
    mon = new Date(mon)
    mon.setDate(mon.getDate() + 7)
  }
  return weeks
}
