import { addDays, format, parseISO, startOfWeek } from 'date-fns'
import { de } from 'date-fns/locale'

export const toDateString = (d: Date) => format(d, 'yyyy-MM-dd')
export const todayString = () => toDateString(new Date())
export const addDaysTo = (d: string, n: number) => toDateString(addDays(parseISO(d), n))
export const mondayOf = (d: string) => toDateString(startOfWeek(parseISO(d), { weekStartsOn: 1 }))

export const fmt = {
  date: (d: string) => format(parseISO(d), 'dd.MM.yyyy', { locale: de }),
  dayLong: (d: string) => format(parseISO(d), 'EEEE, d. MMMM', { locale: de }),
  dayShort: (d: string) => format(parseISO(d), 'EEEEEE, dd.MM.', { locale: de }),
  weekday: (d: string) => format(parseISO(d), 'EEEEEE', { locale: de }),
  timeRange: (a: string, b: string) => `${a.slice(0, 5)}–${b.slice(0, 5)}`,
  hours: (h: number) => `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(h)} Std.`,
  dateTime: (iso: string) => `${format(new Date(iso), 'dd.MM.yyyy, HH:mm', { locale: de })} Uhr`,
}

/** Parses "TT.MM.JJJJ" (German input) to "yyyy-MM-dd", or null if invalid. */
export function parseGermanDate(input: string): string | null {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(input.trim())
  if (!m) return null
  const [, d, mo, y] = m
  const iso = `${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}`
  const date = parseISO(iso)
  return Number.isNaN(date.getTime()) || toDateString(date) !== iso ? null : iso
}

export function isTime(v: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
}

export function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}
