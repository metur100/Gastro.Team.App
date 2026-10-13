import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Copy } from 'lucide-react'
import { ApiError, api, errorMessage } from '@/lib/api'
import { useActiveLocation } from '@/lib/auth'
import { applyServerErrors, useJobRoles } from '@/lib/hooks'
import { fmt, todayString } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input, Label, Select, Textarea } from '@/components/ui/form'
import { Notice } from '@/components/ui/display'
import { ConfirmDialog, Dialog } from '@/components/ui/overlay'
import type { DeactivateResult, Employee, InvitationCreated } from '@/types/api'
import { employeeSchema, toRequest, type EmployeeFormValues } from './employeeSchema'

export function EmployeeFormDialog({ open, onOpenChange, employee, onSaved }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  employee?: Employee
  onSaved?: (e: Employee, invitation?: InvitationCreated) => void
}) {
  const qc = useQueryClient()
  const { managed, locationId } = useActiveLocation()
  const { data: roles = [] } = useJobRoles()
  const [error, setError] = useState<string | null>(null)
  const { register, control, handleSubmit, reset, setError: setFieldError, formState } = useForm<EmployeeFormValues>({ resolver: zodResolver(employeeSchema) })

  useEffect(() => {
    if (!open) return
    setError(null)
    reset({
      firstName: employee?.firstName ?? '',
      lastName: employee?.lastName ?? '',
      email: employee?.email ?? '',
      phone: employee?.phone ?? '',
      jobRoleId: employee?.jobRoleId ?? '',
      contractHoursPerWeek: employee?.contractHoursPerWeek != null ? String(employee.contractHoursPerWeek).replace('.', ',') : '',
      employmentStartDate: employee?.employmentStartDate ?? '',
      employmentEndDate: employee?.employmentEndDate ?? '',
      preferredLanguage: employee?.preferredLanguage ?? 'de-DE',
      locationIds: employee?.locationIds ?? (locationId ? [locationId] : []),
      notes: employee?.notes ?? '',
      sendInvitation: false,
    })
  }, [open, employee, reset, locationId])

  const submit = handleSubmit(async (v) => {
    setError(null)
    try {
      const body = toRequest(v)
      const saved = employee
        ? await api.put<Employee>(`/employees/${employee.id}`, { ...body, sendInvitation: false, version: employee.version })
        : await api.post<Employee>('/employees', { ...body, sendInvitation: false })
      // Invite separately so the result (incl. a shareable link) can be shown to the manager.
      let invitation: InvitationCreated | undefined
      if (!employee && v.sendInvitation) {
        try {
          invitation = await api.post<InvitationCreated>(`/employees/${saved.id}/invite`)
        } catch (e) {
          toast.error(`Angelegt, aber die Einladung ist fehlgeschlagen: ${errorMessage(e)}`)
        }
      }
      await qc.invalidateQueries({ queryKey: ['employees'] })
      void qc.invalidateQueries({ queryKey: ['employee', saved.id] })
      void qc.invalidateQueries({ queryKey: ['week'] })
      toast.success(employee ? 'Änderungen gespeichert' : v.sendInvitation ? 'Mitarbeiter/in angelegt und eingeladen' : 'Mitarbeiter/in angelegt')
      onOpenChange(false)
      onSaved?.(saved, invitation)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'concurrency_conflict') void qc.invalidateQueries({ queryKey: ['employee'] })
      if (!applyServerErrors(e, setFieldError)) setError(errorMessage(e))
    }
  })

  // Locations outside the manager's scope stay assigned but cannot be changed here.
  const foreign = (employee?.locationIds ?? []).filter((id) => !managed.some((l) => l.id === id))

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={employee ? `${employee.fullName} bearbeiten` : 'Mitarbeiter/in anlegen'}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
          <Button onClick={submit} loading={formState.isSubmitting}>{employee ? 'Änderungen speichern' : 'Anlegen'}</Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vorname" required error={formState.errors.firstName?.message}>
            {(id, d, inv) => <Input id={id} aria-describedby={d} aria-invalid={inv} {...register('firstName')} />}
          </Field>
          <Field label="Nachname" required error={formState.errors.lastName?.message}>
            {(id, d, inv) => <Input id={id} aria-describedby={d} aria-invalid={inv} {...register('lastName')} />}
          </Field>
          <Field
            label="E-Mail-Adresse"
            error={formState.errors.email?.message}
            hint={employee?.hasAccount ? 'Mit einem Konto verknüpft – nur die Person selbst kann die Adresse ändern.' : 'Wird für die Einladung zur App benötigt.'}
          >
            {(id, d, inv) => <Input id={id} type="email" disabled={employee?.hasAccount} aria-describedby={d} aria-invalid={inv} {...register('email')} />}
          </Field>
          <Field label="Telefon" error={formState.errors.phone?.message}>
            {(id, d, inv) => <Input id={id} type="tel" aria-describedby={d} aria-invalid={inv} {...register('phone')} />}
          </Field>
          <Field label="Rolle / Station">
            {(id) => (
              <Select id={id} {...register('jobRoleId')}>
                <option value="">Keine</option>
                {roles.filter((r) => r.isActive || r.id === employee?.jobRoleId).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Vertragsstunden pro Woche" error={formState.errors.contractHoursPerWeek?.message} hint="Leer lassen, wenn keine feste Stundenzahl vereinbart ist.">
            {(id, d, inv) => <Input id={id} inputMode="decimal" placeholder="z. B. 20" aria-describedby={d} aria-invalid={inv} {...register('contractHoursPerWeek')} />}
          </Field>
          <Field label="Eintrittsdatum" error={formState.errors.employmentStartDate?.message}>
            {(id, d, inv) => <Input id={id} type="date" aria-describedby={d} aria-invalid={inv} {...register('employmentStartDate')} />}
          </Field>
          <Field label="Austrittsdatum" error={formState.errors.employmentEndDate?.message}>
            {(id, d, inv) => <Input id={id} type="date" aria-describedby={d} aria-invalid={inv} {...register('employmentEndDate')} />}
          </Field>
          <Field label="Bevorzugte Sprache">
            {(id) => (
              <Select id={id} {...register('preferredLanguage')}>
                <option value="de-DE">Deutsch</option>
                <option value="en-US">Englisch</option>
                <option value="bs-BA">Bosnisch</option>
                <option value="hr-HR">Kroatisch</option>
                <option value="sr-Latn-RS">Serbisch</option>
              </Select>
            )}
          </Field>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">
            Standorte <span className="text-danger-600" aria-hidden>*</span>
          </legend>
          <Controller
            control={control}
            name="locationIds"
            render={({ field }) => (
              <div className="grid gap-2 sm:grid-cols-2">
                {managed.map((l) => {
                  const checked = field.value?.includes(l.id) ?? false
                  return (
                    <label key={l.id} className="flex cursor-pointer items-center gap-2.5 rounded-md border border-line px-3 py-2 text-sm">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => field.onChange(v === true ? [...(field.value ?? []), l.id] : (field.value ?? []).filter((x) => x !== l.id))}
                      />
                      {l.name}
                    </label>
                  )
                })}
              </div>
            )}
          />
          {foreign.length > 0 && <p className="mt-1 text-xs text-ink-faint">Zusätzlich {foreign.length} Standort(e) außerhalb Ihres Zuständigkeitsbereichs.</p>}
          {formState.errors.locationIds && <p role="alert" className="mt-1 text-xs font-medium text-danger-600">{formState.errors.locationIds.message}</p>}
        </fieldset>
        <Field label="Interne Notiz" error={formState.errors.notes?.message} hint="Nur für Leitung sichtbar. Bitte keine sensiblen Daten (z. B. Gesundheit) eintragen.">
          {(id, d, inv) => <Textarea id={id} rows={2} aria-describedby={d} aria-invalid={inv} {...register('notes')} />}
        </Field>
        {!employee && (
          <div className="flex items-start gap-3">
            <Controller control={control} name="sendInvitation" render={({ field }) => <Checkbox id="send-invite" checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} className="mt-0.5" />} />
            <Label htmlFor="send-invite" className="font-normal">Direkt zur App einladen (Einladungslink per E-Mail)</Label>
          </div>
        )}
      </form>
    </Dialog>
  )
}

/** Shows the result of an invitation, including a copyable link when the server returns one. */
export function InvitationResultDialog({ result, onClose }: { result: InvitationCreated | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (!result?.link) return
    try {
      await navigator.clipboard.writeText(result.link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      toast.error('Kopieren nicht möglich. Bitte markieren Sie den Link manuell.')
    }
  }
  return (
    <Dialog open={Boolean(result)} onOpenChange={(o) => !o && onClose()} title="Einladung erstellt" footer={<Button onClick={onClose}>Fertig</Button>}>
      {result && (
        <div className="space-y-4 text-sm">
          <p>
            Die Einladung für <strong>{result.email}</strong> ist bis {fmt.dateTime(result.expiresAt)} gültig und kann nur einmal verwendet werden.
          </p>
          {result.emailSent ? (
            <Notice tone="success">Die Einladung wurde per E-Mail verschickt.</Notice>
          ) : (
            <Notice tone="warning">Es ist kein E-Mail-Versand eingerichtet. {result.link ? 'Bitte teilen Sie den Link direkt mit der Person.' : 'Bitte wenden Sie sich an den Support.'}</Notice>
          )}
          {result.link && (
            <div>
              <Label htmlFor="invite-link">Einladungslink (z. B. per Messenger teilen)</Label>
              <div className="mt-1.5 flex gap-2">
                <Input id="invite-link" readOnly value={result.link} onFocus={(e) => e.currentTarget.select()} />
                <Button variant="outline" onClick={copy} aria-label="Link kopieren">
                  {copied ? <Check /> : <Copy />}
                </Button>
              </div>
              <p className="mt-1.5 text-xs text-ink-faint">Behandeln Sie den Link vertraulich – wer ihn hat, kann der Einladung folgen.</p>
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}

export function DeactivateDialog({ employee, onClose }: { employee: Employee | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [endDate, setEndDate] = useState(todayString())
  const [busy, setBusy] = useState(false)
  return (
    <ConfirmDialog
      open={Boolean(employee)}
      onOpenChange={(o) => !o && onClose()}
      title={`${employee?.fullName ?? ''} deaktivieren?`}
      description="Die Person kann sich nicht mehr anmelden und wird nicht mehr eingeplant. Zukünftige Schichten werden als „nicht besetzt“ markiert. Vergangene Schichten und Anträge bleiben erhalten."
      confirmLabel="Deaktivieren"
      destructive
      loading={busy}
      onConfirm={async () => {
        if (!employee) return
        setBusy(true)
        try {
          const r = await api.post<DeactivateResult>(`/employees/${employee.id}/deactivate`, { endDate: endDate || null, version: employee.version })
          toast.success(r.unassignedFutureShifts > 0 ? `Deaktiviert. ${r.unassignedFutureShifts} zukünftige Schicht(en) sind jetzt unbesetzt.` : 'Mitarbeiter/in deaktiviert')
          await qc.invalidateQueries({ queryKey: ['employees'] })
          void qc.invalidateQueries({ queryKey: ['employee', employee.id] })
          void qc.invalidateQueries({ queryKey: ['week'] })
          onClose()
        } catch (e) {
          toast.error(errorMessage(e))
        } finally {
          setBusy(false)
        }
      }}
    >
      <div className="mt-4">
        <Field label="Austrittsdatum (optional)">{(id) => <Input id={id} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />}</Field>
      </div>
    </ConfirmDialog>
  )
}
