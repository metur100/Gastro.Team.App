import { useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent,
  type Announcements,
} from '@dnd-kit/core'
import { Plus } from 'lucide-react'
import { fmt, todayString, WEEKDAY_SHORT } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { DayOfWeek, JobRole, Severity, Shift, WeekView } from '@/types/api'
import { ShiftChip } from './ShiftChip'

export type GridMode = 'employees' | 'roles'

const UNASSIGNED = '__unassigned__'

interface Row {
  key: string
  label: string
  sub?: string
  tone?: 'warning'
  hours?: { planned: number; target: number | null }
  employeeId?: string | null
  jobRoleId?: string
  color?: string
}

interface Props {
  week: WeekView
  mode: GridMode
  roles: JobRole[]
  shifts: Shift[]
  severityByShift: Map<string, Severity>
  canEdit: boolean
  highlightedShiftId: string | null
  onOpen: (shift: Shift) => void
  onCreate: (preset: { date: string; employeeId: string | null; jobRoleId?: string }) => void
  onMove: (shift: Shift, target: { employeeId: string | null; date: string; jobRoleId?: string }) => void
}

function dayOfWeek(date: string): DayOfWeek {
  return (['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const)[new Date(`${date}T12:00:00`).getDay()]!
}

function DropCell({ id, disabled, closed, children, className }: { id: string; disabled: boolean; closed: boolean; children: React.ReactNode; className?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'group/cell relative flex min-h-[72px] w-full flex-col gap-1.5 border-l border-line p-1.5',
        closed && 'bg-subtle/60',
        isOver && 'bg-brand-50 outline-2 -outline-offset-2 outline-brand-500',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function WeekGrid({ week, mode, roles, shifts, severityByShift, canEdit, highlightedShiftId, onOpen, onCreate, onMove }: Props) {
  const [active, setActive] = useState<Shift | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor))

  const rows: Row[] = useMemo(() => {
    if (mode === 'roles') {
      const used = new Set(shifts.map((s) => s.jobRoleId))
      return roles
        .filter((r) => r.isActive || used.has(r.id))
        .map((r) => ({ key: r.id, label: r.name, jobRoleId: r.id, color: r.color, sub: `${shifts.filter((s) => s.jobRoleId === r.id).length} Schichten` }))
    }
    const unassignedCount = shifts.filter((s) => !s.employeeId).length
    return [
      { key: UNASSIGNED, label: 'Nicht besetzt', sub: unassignedCount === 1 ? '1 offene Schicht' : `${unassignedCount} offene Schichten`, tone: 'warning' as const, employeeId: null },
      ...week.employees.map((e) => ({
        key: e.id,
        label: e.fullName,
        sub: e.jobRoleName ?? undefined,
        employeeId: e.id,
        hours: { planned: e.plannedHours, target: e.contractHoursPerWeek },
      })),
    ]
  }, [mode, roles, shifts, week.employees])

  const cellShifts = useMemo(() => {
    const map = new Map<string, Shift[]>()
    for (const s of shifts) {
      const rowKey = mode === 'roles' ? s.jobRoleId : (s.employeeId ?? UNASSIGNED)
      const key = `${rowKey}|${s.date}`
      const list = map.get(key) ?? []
      list.push(s)
      map.set(key, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.startUtc.localeCompare(b.startUtc))
    return map
  }, [shifts, mode])

  const absences = useMemo(() => {
    const map = new Map<string, { kind: string; label: string }[]>()
    for (const e of week.employees)
      for (const a of e.absences) {
        const key = `${e.id}|${a.date}`
        map.set(key, [...(map.get(key) ?? []), a])
      }
    return map
  }, [week.employees])

  const unavailableDays = useMemo(() => {
    const map = new Map<string, Set<DayOfWeek>>()
    for (const e of week.employees) {
      // Only positive availability windows define working days; unavailability-only patterns mark single days.
      if (e.availability.length === 0) continue
      const hasPositive = e.availability.some((a) => a.kind !== 'Unavailable')
      const available = new Set(e.availability.filter((a) => a.kind !== 'Unavailable').map((a) => a.dayOfWeek))
      const fullDayOff = new Set(e.availability.filter((a) => a.kind === 'Unavailable').map((a) => a.dayOfWeek))
      const off = new Set<DayOfWeek>()
      for (const d of week.days) {
        const dow = dayOfWeek(d.date)
        if ((hasPositive && !available.has(dow)) || fullDayOff.has(dow)) off.add(dow)
      }
      map.set(e.id, off)
    }
    return map
  }, [week.employees, week.days])

  const handleStart = (e: DragStartEvent) => setActive((e.active.data.current as { shift: Shift } | undefined)?.shift ?? null)
  const handleEnd = (e: DragEndEvent) => {
    setActive(null)
    const shift = (e.active.data.current as { shift: Shift } | undefined)?.shift
    if (!shift || !e.over) return
    const [rowKey, date] = String(e.over.id).split('|') as [string, string]
    if (mode === 'roles') onMove(shift, { employeeId: shift.employeeId, date, jobRoleId: rowKey })
    else onMove(shift, { employeeId: rowKey === UNASSIGNED ? null : rowKey, date })
  }

  const rowLabel = (key: string) => rows.find((r) => r.key === key)?.label ?? ''
  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `Schicht aufgenommen. ${(a.data.current as { shift: Shift }).shift.jobRoleName}. Mit den Pfeiltasten bewegen, Leertaste zum Ablegen, Escape zum Abbrechen.`,
    onDragOver: ({ over }) => {
      if (!over) return 'Kein Ziel.'
      const [rowKey, date] = String(over.id).split('|') as [string, string]
      return `Ziel: ${rowLabel(rowKey)}, ${fmt.dayLong(date)}.`
    },
    onDragEnd: ({ over }) => (over ? 'Schicht abgelegt. Änderung wird gespeichert.' : 'Verschieben abgebrochen.'),
    onDragCancel: () => 'Verschieben abgebrochen.',
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleStart} onDragEnd={handleEnd} onDragCancel={() => setActive(null)} accessibility={{ announcements }}>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
        <div className="grid min-w-[980px]" style={{ gridTemplateColumns: '220px repeat(7, minmax(0, 1fr))' }} role="grid" aria-label="Wochenplan">
          <div className="sticky left-0 z-10 border-b border-line bg-surface px-3 py-2.5 text-xs font-medium text-ink-faint" role="columnheader">
            {mode === 'roles' ? 'Rolle / Station' : 'Mitarbeiter'}
          </div>
          {week.days.map((d) => {
            const today = d.date === todayString()
            return (
              <div key={d.date} role="columnheader" className={cn('border-b border-l border-line px-2 py-2.5', d.isClosed && 'bg-subtle/60')}>
                <div className="flex items-baseline gap-1.5">
                  <span className={cn('text-sm font-semibold', today && 'text-brand-700')}>{WEEKDAY_SHORT[dayOfWeek(d.date)]}</span>
                  <span className={cn('text-sm text-ink-muted', today && 'font-medium text-brand-700')}>{fmt.dayMonth(d.date)}</span>
                  {today && <span className="sr-only">(heute)</span>}
                </div>
                <div className="text-[11px] text-ink-faint">{d.isClosed ? 'Geschlossen' : d.opensAt ? fmt.timeRange(d.opensAt, d.closesAt ?? '') : ''}</div>
              </div>
            )
          })}

          {rows.map((row) => (
            <div key={row.key} className="contents" role="row">
              <div role="rowheader" className="sticky left-0 z-10 flex min-h-[72px] flex-col justify-center border-b border-line bg-surface px-3 py-2">
                <span className={cn('flex items-center gap-2 truncate text-sm font-medium', row.tone === 'warning' && 'text-warning-700')}>
                  {row.color && <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} aria-hidden />}
                  <span className="truncate">{row.label}</span>
                </span>
                {row.sub && <span className="truncate text-xs text-ink-faint">{row.sub}</span>}
                {row.hours && (
                  <span
                    className={cn(
                      'mt-0.5 text-xs tabular-nums',
                      row.hours.target != null && row.hours.planned > row.hours.target ? 'font-medium text-warning-700' : 'text-ink-muted',
                    )}
                  >
                    {fmt.number(row.hours.planned)}
                    {row.hours.target != null ? ` / ${fmt.number(row.hours.target)}` : ''} Std.
                    {row.hours.target != null && row.hours.planned > row.hours.target && <span className="sr-only"> (über Vertragsstunden)</span>}
                  </span>
                )}
              </div>
              {week.days.map((d) => {
                const key = `${row.key}|${d.date}`
                const list = cellShifts.get(key) ?? []
                const cellAbsences = row.employeeId ? (absences.get(`${row.employeeId}|${d.date}`) ?? []) : []
                const off = row.employeeId ? unavailableDays.get(row.employeeId)?.has(dayOfWeek(d.date)) : false
                return (
                  <div key={key} role="gridcell" className="flex border-b border-line">
                    <DropCell id={key} disabled={!canEdit} closed={d.isClosed}>
                      {cellAbsences.map((a, i) => (
                        <span
                          key={i}
                          className={cn(
                            'rounded-sm px-1.5 py-0.5 text-[11px] font-medium',
                            a.kind === 'leave' ? 'bg-info-50 text-info-700' : a.kind === 'leave_pending' ? 'border border-dashed border-info-700/40 text-info-700' : 'bg-subtle text-ink-muted',
                          )}
                        >
                          {a.label}
                        </span>
                      ))}
                      {off && cellAbsences.length === 0 && <span className="text-[11px] text-ink-faint">laut Verfügbarkeit frei</span>}
                      {list.map((s) => (
                        <ShiftChip
                          key={s.id}
                          shift={s}
                          severity={severityByShift.get(s.id) ?? null}
                          showEmployee={mode === 'roles'}
                          draggable={canEdit}
                          highlighted={highlightedShiftId === s.id}
                          onOpen={onOpen}
                        />
                      ))}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => onCreate({ date: d.date, employeeId: row.employeeId ?? null, jobRoleId: row.jobRoleId })}
                          className="mt-auto flex h-6 w-full cursor-pointer items-center justify-center rounded-sm text-ink-faint opacity-0 hover:bg-subtle hover:text-ink focus-visible:opacity-100 group-hover/cell:opacity-100"
                          aria-label={`Schicht hinzufügen: ${row.label}, ${fmt.dayLong(d.date)}`}
                        >
                          <Plus className="size-3.5" />
                        </button>
                      )}
                    </DropCell>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {active ? (
          <div className="w-40 rotate-1 rounded-md border border-line bg-surface px-2 py-1.5 text-xs shadow-pop" aria-hidden>
            <span className="block font-semibold tabular-nums">{fmt.timeRange(active.startTime, active.endTime)}</span>
            <span className="block truncate text-ink-muted">{active.employeeName ?? 'Nicht besetzt'} · {active.jobRoleName}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
