import { addDays, format, parseISO, startOfWeek, getISOWeek } from 'date-fns'
import { de } from 'date-fns/locale'
import type { DayOfWeek } from '@/types/api'

/** Parses a DateOnly string ("yyyy-MM-dd") as a local calendar date. */
export function parseDate(d: string): Date {
  return parseISO(d)
}

export function toDateString(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

export function todayString(): string {
  return toDateString(new Date())
}

export function mondayOf(d: Date | string): string {
  const date = typeof d === 'string' ? parseDate(d) : d
  return toDateString(startOfWeek(date, { weekStartsOn: 1 }))
}

export function addDaysTo(d: string, days: number): string {
  return toDateString(addDays(parseDate(d), days))
}

export const fmt = {
  /** 12.10.2026 */
  date: (d: string) => format(parseDate(d), 'dd.MM.yyyy', { locale: de }),
  /** Mo., 12.10. */
  dayShort: (d: string) => format(parseDate(d), 'EEEEEE, dd.MM.', { locale: de }),
  /** Montag, 12. Oktober */
  dayLong: (d: string) => format(parseDate(d), 'EEEE, d. MMMM', { locale: de }),
  /** Mo */
  weekday: (d: string) => format(parseDate(d), 'EEEEEE', { locale: de }),
  /** 12.10. */
  dayMonth: (d: string) => format(parseDate(d), 'dd.MM.', { locale: de }),
  /** Montag, 12. Oktober 2026 */
  full: (d: Date) => format(d, 'EEEE, d. MMMM yyyy', { locale: de }),
  /** 12.10.2026, 14:05 Uhr (local browser time for UTC timestamps) */
  dateTime: (iso: string) => `${format(new Date(iso), 'dd.MM.yyyy, HH:mm', { locale: de })} Uhr`,
  relative: (iso: string) => relativeTime(iso),
  time: (t: string) => t.slice(0, 5),
  timeRange: (start: string, end: string) => `${start.slice(0, 5)}–${end.slice(0, 5)}`,
  hours: (h: number) => `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(h)} Std.`,
  number: (n: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(n),
  euro: (n: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n),
  week: (weekStart: string) => {
    const start = parseDate(weekStart)
    const end = addDays(start, 6)
    return `KW ${getISOWeek(start)} · ${format(start, 'dd.MM.', { locale: de })}–${format(end, 'dd.MM.yyyy', { locale: de })}`
  },
}

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  const rtf = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' })
  if (diff < 60) return 'gerade eben'
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute')
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour')
  if (diff < 7 * 86400) return rtf.format(-Math.round(diff / 86400), 'day')
  return format(new Date(iso), 'dd.MM.yyyy', { locale: de })
}

/** German pluralisation for simple count nouns. */
export function plural(n: number, one: string, many: string): string {
  return `${new Intl.NumberFormat('de-DE').format(n)} ${n === 1 ? one : many}`
}

export const WEEKDAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export const WEEKDAY_LABEL: Record<DayOfWeek, string> = {
  Monday: 'Montag',
  Tuesday: 'Dienstag',
  Wednesday: 'Mittwoch',
  Thursday: 'Donnerstag',
  Friday: 'Freitag',
  Saturday: 'Samstag',
  Sunday: 'Sonntag',
}

export const WEEKDAY_SHORT: Record<DayOfWeek, string> = {
  Monday: 'Mo',
  Tuesday: 'Di',
  Wednesday: 'Mi',
  Thursday: 'Do',
  Friday: 'Fr',
  Saturday: 'Sa',
  Sunday: 'So',
}

/** "17:30" -> minutes since midnight. */
export function minutes(t: string): number {
  const [h = '0', m = '0'] = t.split(':')
  return Number(h) * 60 + Number(m)
}
