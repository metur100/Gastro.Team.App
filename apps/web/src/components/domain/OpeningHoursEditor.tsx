import { WEEKDAYS, WEEKDAY_LABEL } from '@/lib/format'
import { Input } from '@/components/ui/form'
import { Switch } from '@/components/ui/form'
import type { OpeningHour } from '@/types/api'

export function normalizeOpeningHours(hours: OpeningHour[]): OpeningHour[] {
  return WEEKDAYS.map(
    (day) => hours.find((h) => h.dayOfWeek === day) ?? { dayOfWeek: day, isClosed: false, opensAt: '11:00', closesAt: '23:00' },
  )
}

/** Seven-day opening hours editor. A closing time before the opening time means "open past midnight". */
export function OpeningHoursEditor({ value, onChange, disabled }: { value: OpeningHour[]; onChange: (v: OpeningHour[]) => void; disabled?: boolean }) {
  const rows = normalizeOpeningHours(value)
  const update = (index: number, patch: Partial<OpeningHour>) => onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  return (
    <div className="divide-y divide-line rounded-lg border border-line">
      {rows.map((row, i) => {
        const overnight = !row.isClosed && row.closesAt <= row.opensAt
        return (
          <div key={row.dayOfWeek} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <span className="w-24 text-sm font-medium">{WEEKDAY_LABEL[row.dayOfWeek]}</span>
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              <Switch
                checked={!row.isClosed}
                onCheckedChange={(open) => update(i, { isClosed: !open })}
                disabled={disabled}
                aria-label={`${WEEKDAY_LABEL[row.dayOfWeek]} geöffnet`}
              />
              {row.isClosed ? 'Geschlossen' : 'Geöffnet'}
            </label>
            {!row.isClosed && (
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  value={row.opensAt}
                  onChange={(e) => update(i, { opensAt: e.target.value })}
                  className="w-28"
                  aria-label={`${WEEKDAY_LABEL[row.dayOfWeek]} Öffnung`}
                  disabled={disabled}
                />
                <span className="text-ink-faint" aria-hidden>–</span>
                <Input
                  type="time"
                  value={row.closesAt}
                  onChange={(e) => update(i, { closesAt: e.target.value })}
                  className="w-28"
                  aria-label={`${WEEKDAY_LABEL[row.dayOfWeek]} Schließung`}
                  disabled={disabled}
                />
                {overnight && <span className="text-xs text-ink-faint">bis zum Folgetag</span>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
