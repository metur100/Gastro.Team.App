import { useDraggable } from '@dnd-kit/core'
import { AlertCircle, AlertTriangle, CircleDashed, GripVertical } from 'lucide-react'
import { fmt } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Severity, Shift } from '@/types/api'

interface ChipProps {
  shift: Shift
  severity: Severity | null
  showEmployee?: boolean
  draggable: boolean
  highlighted?: boolean
  onOpen: (shift: Shift) => void
}

/**
 * Shift card. Status is communicated by text/icon + border style, not by colour alone:
 * draft = dashed border + "Entwurf", unassigned = "Nicht besetzt", problems = icon with label.
 */
export function ShiftChip({ shift, severity, showEmployee, draggable, highlighted, onOpen }: ChipProps) {
  // The DragOverlay renders the moving preview; the source chip only dims while dragging.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: shift.id,
    data: { shift },
    disabled: !draggable,
  })
  const unassigned = !shift.employeeId
  const draft = shift.status === 'Draft'
  const label = [
    `${fmt.timeRange(shift.startTime, shift.endTime)} Uhr`,
    shift.jobRoleName,
    unassigned ? 'nicht besetzt' : shift.employeeName,
    draft ? 'Entwurf' : 'veröffentlicht',
    severity === 'Error' ? 'mit Fehler' : severity === 'Warning' ? 'mit Hinweis' : null,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'group relative flex w-full items-stretch overflow-hidden rounded-md border bg-surface text-left text-xs shadow-card transition-shadow',
        draft ? 'border-dashed border-line-strong' : 'border-line',
        unassigned && 'border-warning-700/40 bg-warning-50',
        severity === 'Error' && 'ring-1 ring-danger-600/50',
        highlighted && 'ring-2 ring-brand-600',
        isDragging && 'opacity-40',
      )}
    >
      <span className="w-1 shrink-0" style={{ backgroundColor: shift.jobRoleColor }} aria-hidden />
      <button type="button" onClick={() => onOpen(shift)} className="min-w-0 flex-1 cursor-pointer px-2 py-1.5 text-left" aria-label={`Schicht bearbeiten: ${label}`}>
        <span className="flex items-center gap-1">
          <span className="whitespace-nowrap font-semibold tabular-nums tracking-tight text-ink">{fmt.timeRange(shift.startTime, shift.endTime)}</span>
          {severity === 'Error' && <AlertCircle className="size-3.5 shrink-0 text-danger-600" aria-hidden />}
          {severity === 'Warning' && <AlertTriangle className="size-3.5 shrink-0 text-warning-700" aria-hidden />}
        </span>
        {showEmployee && (
          <span className={cn('block truncate', unassigned ? 'font-medium text-warning-700' : 'text-ink')}>
            {unassigned ? 'Nicht besetzt' : shift.employeeName}
          </span>
        )}
        <span className="flex items-center gap-1 truncate text-ink-muted">
          {unassigned && !showEmployee && <CircleDashed className="size-3 shrink-0 text-warning-700" aria-hidden />}
          <span className="truncate">{shift.jobRoleName}</span>
          {draft && <span className="shrink-0 text-ink-faint">· Entwurf</span>}
        </span>
      </button>
      {draggable && (
        <button
          type="button"
          {...listeners}
          {...attributes}
          aria-label={`Schicht verschieben: ${label}`}
          aria-roledescription="verschiebbare Schicht"
          className="flex w-5 shrink-0 cursor-grab touch-none items-center justify-center text-ink-faint opacity-60 hover:bg-subtle hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing group-hover:opacity-100"
        >
          <GripVertical className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  )
}
