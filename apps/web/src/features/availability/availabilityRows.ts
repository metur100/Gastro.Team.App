import { WEEKDAYS } from '@/lib/format'
import type { AvailabilityKind, AvailabilitySlot, DayOfWeek } from '@/types/api'

export type DayMode = 'none' | AvailabilityKind
export interface DayRow {
  day: DayOfWeek
  mode: DayMode
  start: string
  end: string
}

export function slotsToRows(slots: AvailabilitySlot[]): DayRow[] {
  return WEEKDAYS.map((day) => {
    const s = slots.find((x) => x.dayOfWeek === day)
    return s ? { day, mode: s.kind, start: s.startTime, end: s.endTime } : { day, mode: 'none', start: '10:00', end: '22:00' }
  })
}

export function rowsToSlots(rows: DayRow[]): AvailabilitySlot[] {
  return rows
    .filter((r) => r.mode !== 'none')
    .map((r) => ({ dayOfWeek: r.day, kind: r.mode as AvailabilityKind, startTime: r.start, endTime: r.end === r.start ? '23:59' : r.end, note: null }))
}
