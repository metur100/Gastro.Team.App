import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Ban, Copy, Send, Trash2 } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { applyServerErrors } from '@/lib/hooks'
import { availabilityKindLabel, shiftStatusLabel } from '@/lib/labels'
import { fmt, minutes, WEEKDAY_LABEL } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import { Badge, Notice } from '@/components/ui/display'
import { ConfirmDialog, Dialog } from '@/components/ui/overlay'
import type { DayOfWeek, Issue, JobRole, Location, Shift, ShiftSaveResult, WeekView } from '@/types/api'
import { reportIssues } from './scheduleApi'

const schema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Bitte ein Datum wählen.'),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Bitte eine Uhrzeit angeben.'),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Bitte eine Uhrzeit angeben.'),
    breakMinutes: z.coerce.number<string>().int('Ganze Minuten angeben.').min(0, 'Mindestens 0 Minuten.').max(240, 'Höchstens 240 Minuten.'),
    jobRoleId: z.string().min(1, 'Bitte eine Rolle bzw. Station wählen.'),
    employeeId: z.string(),
    notes: z.string().max(500, 'Höchstens 500 Zeichen.'),
  })
  .refine((v) => v.startTime !== v.endTime, { message: 'Beginn und Ende dürfen nicht identisch sein.', path: ['endTime'] })
  .refine(
    (v) => {
      const duration = (minutes(v.endTime) - minutes(v.startTime) + 1440) % 1440
      return v.breakMinutes < duration
    },
    { message: 'Die Pause muss kürzer als die Schicht sein.', path: ['breakMinutes'] },
  )

type FormInput = z.input<typeof schema>
type FormOutput = z.output<typeof schema>

export interface ShiftDialogState {
  shift?: Shift
  preset?: { date: string; employeeId: string | null; jobRoleId?: string }
}

interface Props {
  state: ShiftDialogState | null
  onClose: () => void
  location: Location
  week: WeekView | undefined
  roles: JobRole[]
  canPublish: boolean
  issues: Issue[]
}

const DOW: DayOfWeek[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function ShiftDialog({ state, onClose, location, week, roles, canPublish, issues }: Props) {
  const qc = useQueryClient()
  const shift = state?.shift
  const editing = Boolean(shift)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'delete' | 'cancel' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const form = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(schema) })
  const { register, handleSubmit, reset, watch, formState, setError: setFieldError } = form

  useEffect(() => {
    if (!state) return
    setError(null)
    const s = state.shift
    reset({
      date: s?.date ?? state.preset?.date ?? '',
      startTime: s?.startTime ?? '11:00',
      endTime: s?.endTime ?? '17:00',
      breakMinutes: String(s?.breakMinutes ?? location.defaultBreakMinutes),
      jobRoleId: s?.jobRoleId ?? state.preset?.jobRoleId ?? roles.find((r) => r.isActive)?.id ?? '',
      employeeId: s?.employeeId ?? state.preset?.employeeId ?? '',
      notes: s?.notes ?? '',
    })
  }, [state, reset, location.defaultBreakMinutes, roles])

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['week'] })
    void qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const submit = handleSubmit(async (v) => {
    setError(null)
    const body = {
      locationId: location.id,
      jobRoleId: v.jobRoleId,
      employeeId: v.employeeId || null,
      date: v.date,
      startTime: v.startTime,
      endTime: v.endTime,
      breakMinutes: v.breakMinutes,
      notes: v.notes.trim() || null,
    }
    try {
      const result = shift
        ? await api.put<ShiftSaveResult>(`/shifts/${shift.id}`, { ...body, version: shift.version })
        : await api.post<ShiftSaveResult>('/shifts', body)
      reportIssues(result.issues, shift ? 'Änderungen gespeichert' : 'Schicht angelegt')
      await refresh()
      onClose()
    } catch (e) {
      if (!applyServerErrors(e, setFieldError)) setError(errorMessage(e))
      if (e instanceof Error && 'code' in e && (e as { code?: string }).code === 'concurrency_conflict') await refresh()
    }
  })

  const action = async (name: string, fn: () => Promise<void>) => {
    setBusy(name)
    setError(null)
    try {
      await fn()
      await refresh()
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
      setConfirm(null)
    }
  }

  const values = watch()
  const employees = week?.employees ?? []
  const selected = employees.find((e) => e.id === values.employeeId)
  const hints = useMemo(() => {
    if (!selected || !values.date) return null
    const dow = DOW[new Date(`${values.date}T12:00:00`).getDay()]!
    const absences = selected.absences.filter((a) => a.date === values.date)
    const windows = selected.availability.filter((a) => a.dayOfWeek === dow)
    return { dow, absences, windows }
  }, [selected, values.date])

  const shiftIssues = shift ? issues.filter((i) => i.shiftId === shift.id) : []

  return (
    <>
      <Dialog
        open={Boolean(state)}
        onOpenChange={(o) => !o && onClose()}
        title={editing ? 'Schicht bearbeiten' : 'Neue Schicht'}
        description={
          editing && shift ? (
            <span className="inline-flex items-center gap-2">
              {location.name} <Badge tone={shift.status === 'Published' ? 'success' : 'neutral'}>{shiftStatusLabel[shift.status]}</Badge>
            </span>
          ) : (
            location.name
          )
        }
        footer={
          <>
            {editing && shift && (
              <div className="flex flex-wrap gap-2 sm:mr-auto">
                <Button variant="ghost" size="sm" loading={busy === 'duplicate'} onClick={() => void action('duplicate', async () => {
                  const r = await api.post<ShiftSaveResult>(`/shifts/${shift.id}/duplicate`, { date: null, keepEmployee: false })
                  reportIssues(r.issues, 'Schicht dupliziert (unbesetzt)')
                })}>
                  <Copy /> Duplizieren
                </Button>
                {shift.status === 'Draft' ? (
                  <Button variant="ghost" size="sm" className="text-danger-600" onClick={() => setConfirm('delete')}>
                    <Trash2 /> Löschen
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" className="text-danger-600" onClick={() => setConfirm('cancel')}>
                    <Ban /> Absagen
                  </Button>
                )}
                {shift.status === 'Draft' && canPublish && (
                  <Button variant="ghost" size="sm" loading={busy === 'publish'} onClick={() => void action('publish', async () => {
                    const r = await api.post<ShiftSaveResult>(`/shifts/${shift.id}/publish`)
                    reportIssues(r.issues, 'Schicht veröffentlicht')
                  })}>
                    <Send /> Veröffentlichen
                  </Button>
                )}
              </div>
            )}
            <Button variant="outline" onClick={onClose}>Abbrechen</Button>
            <Button onClick={submit} loading={formState.isSubmitting}>{editing ? 'Änderungen speichern' : 'Schicht anlegen'}</Button>
          </>
        }
      >
        <form onSubmit={submit} noValidate className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          {shiftIssues.length > 0 && (
            <ul className="space-y-1.5 rounded-md border border-line bg-subtle/50 p-3 text-sm">
              {shiftIssues.map((i, idx) => (
                <li key={idx} className="flex gap-2">
                  <Badge tone={i.severity === 'Error' ? 'danger' : i.severity === 'Warning' ? 'warning' : 'info'}>
                    {i.severity === 'Error' ? 'Fehler' : i.severity === 'Warning' ? 'Hinweis' : 'Info'}
                  </Badge>
                  <span>{i.message}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Datum" required error={formState.errors.date?.message} className="sm:col-span-3">
              {(id, d, inv) => <Input id={id} type="date" aria-describedby={d} aria-invalid={inv} {...register('date')} />}
            </Field>
            <Field label="Beginn" required error={formState.errors.startTime?.message}>
              {(id, d, inv) => <Input id={id} type="time" aria-describedby={d} aria-invalid={inv} {...register('startTime')} />}
            </Field>
            <Field
              label="Ende"
              required
              error={formState.errors.endTime?.message}
              hint={values.endTime && values.startTime && values.endTime < values.startTime ? 'Endet am Folgetag' : undefined}
            >
              {(id, d, inv) => <Input id={id} type="time" aria-describedby={d} aria-invalid={inv} {...register('endTime')} />}
            </Field>
            <Field label="Pause (Min.)" error={formState.errors.breakMinutes?.message}>
              {(id, d, inv) => <Input id={id} type="number" min={0} max={240} step={5} aria-describedby={d} aria-invalid={inv} {...register('breakMinutes')} />}
            </Field>
          </div>
          <Field label="Rolle / Station" required error={formState.errors.jobRoleId?.message}>
            {(id, d, inv) => (
              <Select id={id} aria-describedby={d} aria-invalid={inv} {...register('jobRoleId')}>
                <option value="">Bitte wählen</option>
                {roles.filter((r) => r.isActive || r.id === shift?.jobRoleId).map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Mitarbeiter/in" hint="Leer lassen, um die Schicht als „nicht besetzt“ zu planen.">
            {(id, d) => (
              <Select id={id} aria-describedby={d} {...register('employeeId')}>
                <option value="">Nicht besetzt</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName}
                    {e.jobRoleName ? ` (${e.jobRoleName})` : ''} – {fmt.number(e.plannedHours)}
                    {e.contractHoursPerWeek != null ? `/${fmt.number(e.contractHoursPerWeek)}` : ''} Std.
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {hints && (
            <div className="rounded-md border border-line bg-subtle/50 p-3 text-sm" aria-live="polite">
              <p className="font-medium">{selected?.fullName} am {WEEKDAY_LABEL[hints.dow]}</p>
              <ul className="mt-1 space-y-0.5 text-ink-muted">
                {hints.absences.map((a, i) => (
                  <li key={i} className={a.kind === 'leave' ? 'font-medium text-info-700' : undefined}>{a.label}</li>
                ))}
                {selected && selected.availability.length === 0 && <li>Keine Verfügbarkeit hinterlegt.</li>}
                {selected && selected.availability.length > 0 && hints.windows.length === 0 && <li>Laut Verfügbarkeit an diesem Wochentag nicht verfügbar.</li>}
                {hints.windows.map((w, i) => (
                  <li key={i}>
                    {availabilityKindLabel[w.kind]}: {fmt.timeRange(w.startTime, w.endTime)} Uhr
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Field label="Notiz" error={formState.errors.notes?.message}>
            {(id, d, inv) => <Textarea id={id} rows={2} placeholder="z. B. Terrasse, Bankett, Einarbeitung" aria-describedby={d} aria-invalid={inv} {...register('notes')} />}
          </Field>
        </form>
      </Dialog>

      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Schicht löschen?"
        description="Der Entwurf wird endgültig gelöscht."
        confirmLabel="Löschen"
        destructive
        loading={busy === 'delete'}
        onConfirm={() =>
          void action('delete', async () => {
            await api.del(`/shifts/${shift!.id}?version=${encodeURIComponent(shift!.version)}`)
            toast.success('Schicht gelöscht')
          })
        }
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Schicht absagen?"
        description="Die Schicht ist bereits veröffentlicht. Sie wird als abgesagt markiert und die eingeplante Person wird benachrichtigt. Offene Tauschanfragen werden hinfällig."
        confirmLabel="Schicht absagen"
        destructive
        loading={busy === 'cancel'}
        onConfirm={() =>
          void action('cancel', async () => {
            await api.post(`/shifts/${shift!.id}/cancel`, { version: shift!.version })
            toast.success('Schicht abgesagt')
          })
        }
      />
    </>
  )
}
