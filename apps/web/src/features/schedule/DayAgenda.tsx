import { Plus } from 'lucide-react'
import { fmt, WEEKDAY_SHORT } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/display'
import type { DayOfWeek, Severity, Shift, WeekView } from '@/types/api'
import { ShiftChip } from './ShiftChip'

const DOW: DayOfWeek[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface Props {
  week: WeekView
  shifts: Shift[]
  day: string
  onDayChange: (date: string) => void
  severityByShift: Map<string, Severity>
  canEdit: boolean
  onOpen: (shift: Shift) => void
  onCreate: (preset: { date: string; employeeId: string | null }) => void
}

/** Mobile-friendly agenda: one day at a time, shifts as a list (no drag & drop, edit via dialog). */
export function DayAgenda({ week, shifts, day, onDayChange, severityByShift, canEdit, onOpen, onCreate }: Props) {
  const dayInfo = week.days.find((d) => d.date === day)
  const list = shifts.filter((s) => s.date === day).sort((a, b) => a.startUtc.localeCompare(b.startUtc))
  const absent = week.employees.flatMap((e) => e.absences.filter((a) => a.date === day).map((a) => ({ name: e.fullName, label: a.label })))

  return (
    <div>
      <div role="tablist" aria-label="Tag wählen" className="grid grid-cols-7 gap-1 rounded-lg border border-line bg-surface p-1">
        {week.days.map((d) => {
          const count = shifts.filter((s) => s.date === d.date).length
          const selected = d.date === day
          return (
            <button
              key={d.date}
              role="tab"
              aria-selected={selected}
              onClick={() => onDayChange(d.date)}
              className={cn(
                'flex cursor-pointer flex-col items-center rounded-md py-1.5 text-xs',
                selected ? 'bg-brand-700 text-white' : 'text-ink-muted hover:bg-subtle',
              )}
            >
              <span className="font-semibold">{WEEKDAY_SHORT[DOW[new Date(`${d.date}T12:00:00`).getDay()]!]}</span>
              <span>{d.date.slice(8, 10)}</span>
              <span className={cn('mt-0.5 text-[10px]', selected ? 'text-brand-100' : 'text-ink-faint')}>{count > 0 ? count : '–'}</span>
            </button>
          )
        })}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">{fmt.dayLong(day)}</h2>
          <p className="text-xs text-ink-muted">
            {dayInfo?.isClosed ? 'Laut Öffnungszeiten geschlossen' : dayInfo?.opensAt ? `Geöffnet ${fmt.timeRange(dayInfo.opensAt, dayInfo.closesAt ?? '')} Uhr` : ''}
          </p>
        </div>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => onCreate({ date: day, employeeId: null })}>
            <Plus /> Schicht
          </Button>
        )}
      </div>

      {absent.length > 0 && (
        <p className="mt-3 rounded-md bg-info-50 px-3 py-2 text-xs text-info-700">
          Abwesend: {absent.map((a) => `${a.name} (${a.label})`).join(', ')}
        </p>
      )}

      {list.length === 0 ? (
        <EmptyState title="Keine Schichten an diesem Tag" className="py-8" />
      ) : (
        <ul className="mt-3 space-y-2">
          {list.map((s) => (
            <li key={s.id}>
              <ShiftChip shift={s} severity={severityByShift.get(s.id) ?? null} showEmployee draggable={false} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
