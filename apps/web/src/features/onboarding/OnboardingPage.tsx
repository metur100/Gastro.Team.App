import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CalendarCheck, Check, PartyPopper, Plus, Trash2 } from 'lucide-react'
import { api, errorMessage, session } from '@/lib/api'
import { useAuth, useLocations } from '@/lib/auth'
import { applyServerErrors, useJobRoles } from '@/lib/hooks'
import { TIME_ZONES } from '@/lib/labels'
import { addDaysTo, fmt, mondayOf, todayString } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/form'
import { Badge, Card, Notice, Spinner } from '@/components/ui/display'
import { OpeningHoursEditor, normalizeOpeningHours } from '@/components/domain/OpeningHoursEditor'
import type { Employee, Location, OnboardingState, OpeningHour, Paged, PublishResult, ShiftSaveResult } from '@/types/api'

const STEPS = ['Betrieb', 'Standort', 'Öffnungszeiten', 'Team', 'Schichtplan', 'Fertig'] as const

export default function OnboardingPage() {
  const { me, refreshMe, establish } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const newBusiness = params.get('neu') === '1'
  const hasTenant = Boolean(me?.currentTenant) && !newBusiness
  const [step, setStep] = useState(1)

  const state = useQuery({
    queryKey: ['onboarding'],
    queryFn: () => api.get<OnboardingState>('/onboarding'),
    enabled: hasTenant && me?.currentTenant?.role !== 'Employee',
  })

  useEffect(() => {
    if (!hasTenant) setStep(1)
    else if (state.data) setStep(Math.min(Math.max(state.data.step, 2), 6))
  }, [hasTenant, state.data])

  const go = async (next: number) => {
    setStep(next)
    if (hasTenant || next > 1) await api.put('/onboarding/step', { step: next }).catch(() => undefined)
    window.scrollTo({ top: 0 })
  }

  if (me?.currentTenant?.role === 'Employee' && !newBusiness) {
    navigate('/', { replace: true })
    return null
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-md bg-brand-700 text-white" aria-hidden>
              <CalendarCheck className="size-4.5" />
            </span>
            <span className="font-semibold tracking-tight">GastroTeam</span>
          </div>
          {hasTenant && (
            <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
              Später fortsetzen
            </Button>
          )}
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-4 py-8">
        <ol className="mb-8 grid grid-cols-6 gap-2" aria-label="Fortschritt der Einrichtung">
          {STEPS.map((label, i) => {
            const n = i + 1
            const done = n < step
            const current = n === step
            return (
              <li key={label} className="flex flex-col gap-2" aria-current={current ? 'step' : undefined}>
                <span className={cn('h-1.5 rounded-full', done || current ? 'bg-brand-700' : 'bg-line')} />
                <span className={cn('hidden text-xs font-medium sm:block', current ? 'text-ink' : 'text-ink-faint')}>
                  {done && <Check className="mr-1 inline size-3" aria-hidden />}
                  {label}
                </span>
              </li>
            )
          })}
        </ol>
        <p className="mb-1 text-sm text-ink-muted">
          Schritt {step} von {STEPS.length}
        </p>
        {hasTenant && state.isPending ? (
          <Spinner />
        ) : (
          <>
            {step === 1 && (
              <BusinessStep
                onDone={async (tenantId) => {
                  session.setTenant(tenantId)
                  qc.clear()
                  await establish()
                  await api.put('/onboarding/step', { step: 2 }).catch(() => undefined)
                  navigate('/onboarding', { replace: true })
                  setStep(2)
                }}
              />
            )}
            {step === 2 && <LocationStep onDone={() => go(3)} />}
            {step === 3 && <OpeningHoursStep onBack={() => go(2)} onDone={() => go(4)} />}
            {step === 4 && <TeamStep onBack={() => go(3)} onDone={() => go(5)} />}
            {step === 5 && <ScheduleStep onBack={() => go(4)} onDone={() => go(6)} />}
            {step === 6 && (
              <DoneStep
                onFinish={async () => {
                  await api.post('/onboarding/complete')
                  await refreshMe()
                  navigate('/', { replace: true })
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

function StepCard({ title, description, children, footer }: { title: string; description: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <Card>
      <div className="border-b border-line px-6 py-5">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-ink-muted">{description}</p>
      </div>
      <div className="px-6 py-5">{children}</div>
      <div className="flex flex-col-reverse gap-2 border-t border-line px-6 py-4 sm:flex-row sm:justify-between">{footer}</div>
    </Card>
  )
}

const businessSchema = z.object({
  name: z.string().trim().min(1, 'Bitte geben Sie den Namen Ihres Betriebs an.').max(150),
  contactEmail: z.union([z.literal(''), z.email('Ungültige E-Mail-Adresse.')]),
  phone: z.string().max(40),
  timeZone: z.string().min(1),
})

function BusinessStep({ onDone }: { onDone: (tenantId: string) => Promise<void> }) {
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, setError: setFieldError, formState } = useForm<z.infer<typeof businessSchema>>({
    resolver: zodResolver(businessSchema),
    defaultValues: { name: '', contactEmail: '', phone: '', timeZone: 'Europe/Berlin' },
  })
  const submit = handleSubmit(async (v) => {
    setError(null)
    try {
      const res = await api.post<{ tenantId: string }>('/onboarding/business', v)
      await onDone(res.tenantId)
    } catch (e) {
      if (!applyServerErrors(e, setFieldError)) setError(errorMessage(e))
    }
  })
  return (
    <form onSubmit={submit} noValidate>
      <StepCard
        title="Willkommen! Erzählen Sie uns von Ihrem Betrieb."
        description="Diese Angaben können Sie später jederzeit in den Einstellungen ändern."
        footer={
          <Button type="submit" loading={formState.isSubmitting} className="sm:ml-auto">
            Betrieb anlegen
          </Button>
        }
      >
        <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="Name des Betriebs" required error={formState.errors.name?.message}>
            {(id, d, inv) => <Input id={id} placeholder="z. B. Bistro am Markt" aria-describedby={d} aria-invalid={inv} {...register('name')} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Kontakt-E-Mail" error={formState.errors.contactEmail?.message} hint="Leer lassen, um Ihre Anmelde-Adresse zu verwenden.">
              {(id, d, inv) => <Input id={id} type="email" aria-describedby={d} aria-invalid={inv} {...register('contactEmail')} />}
            </Field>
            <Field label="Telefon" error={formState.errors.phone?.message}>
              {(id, d, inv) => <Input id={id} type="tel" aria-describedby={d} aria-invalid={inv} {...register('phone')} />}
            </Field>
          </div>
          <Field label="Zeitzone">
            {(id) => (
              <Select id={id} {...register('timeZone')}>
                {TIME_ZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Notice tone="info">Sie starten mit einer 30-tägigen Testphase mit allen Funktionen. Es werden keine Zahlungsdaten abgefragt.</Notice>
        </div>
      </StepCard>
    </form>
  )
}

const locationSchema = z.object({
  name: z.string().trim().min(1, 'Bitte geben Sie einen Namen an.').max(120),
  street: z.string().max(150),
  postalCode: z.string().max(10),
  city: z.string().max(100),
  timeZoneId: z.string().min(1),
})

function LocationStep({ onDone }: { onDone: () => void }) {
  const { refreshMe } = useAuth()
  const qc = useQueryClient()
  const { data: locations, isPending } = useLocations()
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState, setError: setFieldError } = useForm<z.infer<typeof locationSchema>>({
    resolver: zodResolver(locationSchema),
    defaultValues: { name: '', street: '', postalCode: '', city: '', timeZoneId: 'Europe/Berlin' },
  })
  if (isPending) return <Spinner />
  const existing = locations ?? []

  const submit = handleSubmit(async (v) => {
    setError(null)
    try {
      await api.post<Location>('/locations', {
        ...v, country: 'DE', phone: null, email: null, isActive: true, minStaffPerDay: 0, defaultBreakMinutes: 30, prepBufferMinutes: 120,
      })
      await refreshMe()
      await qc.invalidateQueries({ queryKey: ['locations'] })
      onDone()
    } catch (e) {
      if (!applyServerErrors(e, setFieldError)) setError(errorMessage(e))
    }
  })

  if (existing.length > 0)
    return (
      <StepCard
        title="Ihr Standort"
        description="Sie haben bereits einen Standort angelegt. Weitere Standorte können Sie später hinzufügen."
        footer={<Button onClick={onDone} className="sm:ml-auto">Weiter</Button>}
      >
        <ul className="space-y-2">
          {existing.map((l) => (
            <li key={l.id} className="rounded-md border border-line px-4 py-3 text-sm">
              <span className="font-medium">{l.name}</span>
              <span className="text-ink-muted">{[l.street, [l.postalCode, l.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') ? ` · ${[l.street, [l.postalCode, l.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}` : ''}</span>
            </li>
          ))}
        </ul>
      </StepCard>
    )

  return (
    <form onSubmit={submit} noValidate>
      <StepCard
        title="Ersten Standort anlegen"
        description="Ein Standort ist z. B. Ihr Restaurant oder eine Filiale. Schichten werden pro Standort geplant."
        footer={<Button type="submit" loading={formState.isSubmitting} className="sm:ml-auto">Standort anlegen</Button>}
      >
        <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="Name des Standorts" required error={formState.errors.name?.message}>
            {(id, d, inv) => <Input id={id} placeholder="z. B. Altstadt" aria-describedby={d} aria-invalid={inv} {...register('name')} />}
          </Field>
          <Field label="Straße und Hausnummer">{(id) => <Input id={id} autoComplete="street-address" {...register('street')} />}</Field>
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <Field label="PLZ">{(id) => <Input id={id} autoComplete="postal-code" inputMode="numeric" {...register('postalCode')} />}</Field>
            <Field label="Ort">{(id) => <Input id={id} autoComplete="address-level2" {...register('city')} />}</Field>
          </div>
          <Field label="Zeitzone">
            {(id) => (
              <Select id={id} {...register('timeZoneId')}>
                {TIME_ZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </StepCard>
    </form>
  )
}

function OpeningHoursStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const { data: locations, isPending } = useLocations()
  const qc = useQueryClient()
  const location = locations?.[0]
  const [hours, setHours] = useState<OpeningHour[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (location) setHours(normalizeOpeningHours(location.openingHours))
  }, [location])
  if (isPending) return <Spinner />
  if (!location) return <Notice tone="warning">Bitte legen Sie zuerst einen Standort an.</Notice>

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.put(`/locations/${location.id}/opening-hours`, { days: hours })
      await qc.invalidateQueries({ queryKey: ['locations'] })
      onDone()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <StepCard
      title={`Öffnungszeiten – ${location.name}`}
      description="GastroTeam weist Sie darauf hin, wenn Schichten außerhalb der Öffnungszeiten (inkl. 2 Std. Vor- und Nachbereitung) liegen."
      footer={
        <>
          <Button variant="outline" onClick={onBack}>Zurück</Button>
          <Button onClick={save} loading={saving}>Speichern und weiter</Button>
        </>
      }
    >
      {error && <div className="mb-4"><Notice tone="danger">{error}</Notice></div>}
      <OpeningHoursEditor value={hours} onChange={setHours} />
    </StepCard>
  )
}

const memberSchema = z.object({
  firstName: z.string().trim().min(1, 'Vorname fehlt.').max(100),
  lastName: z.string().trim().min(1, 'Nachname fehlt.').max(100),
  email: z.union([z.literal(''), z.email('Ungültige E-Mail-Adresse.')]),
  jobRoleId: z.string(),
  contractHoursPerWeek: z.string().regex(/^\d{0,2}([.,]\d{1,2})?$/, 'Bitte eine Zahl angeben.'),
})

function TeamStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const qc = useQueryClient()
  const { data: locations } = useLocations()
  const { data: roles = [] } = useJobRoles()
  const employees = useQuery({ queryKey: ['employees', 'onboarding'], queryFn: () => api.get<Paged<Employee>>('/employees?pageSize=100') })
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, reset, formState, setError: setFieldError } = useForm<z.infer<typeof memberSchema>>({
    resolver: zodResolver(memberSchema),
    defaultValues: { firstName: '', lastName: '', email: '', jobRoleId: '', contractHoursPerWeek: '' },
  })
  const location = locations?.[0]

  const add = handleSubmit(async (v) => {
    if (!location) return
    setError(null)
    try {
      await api.post<Employee>('/employees', {
        firstName: v.firstName, lastName: v.lastName, email: v.email || null, phone: null,
        jobRoleId: v.jobRoleId || null,
        contractHoursPerWeek: v.contractHoursPerWeek ? Number(v.contractHoursPerWeek.replace(',', '.')) : null,
        employmentStartDate: null, employmentEndDate: null, preferredLanguage: 'de-DE',
        locationIds: [location.id], notes: null, sendInvitation: false,
      })
      reset({ firstName: '', lastName: '', email: '', jobRoleId: v.jobRoleId, contractHoursPerWeek: '' })
      await qc.invalidateQueries({ queryKey: ['employees'] })
    } catch (e) {
      if (!applyServerErrors(e, setFieldError)) setError(errorMessage(e))
    }
  })

  const remove = async (e: Employee) => {
    try {
      await api.post(`/employees/${e.id}/deactivate`, { endDate: null, version: e.version })
      await qc.invalidateQueries({ queryKey: ['employees'] })
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const list = (employees.data?.items ?? []).filter((e) => e.status === 'Active' || e.status === 'Invited')
  return (
    <StepCard
      title="Ihr Team"
      description="Legen Sie die ersten Mitarbeitenden an. Einladungen per E-Mail oder Link können Sie danach in der Mitarbeiterübersicht verschicken."
      footer={
        <>
          <Button variant="outline" onClick={onBack}>Zurück</Button>
          <Button onClick={onDone}>{list.length === 0 ? 'Überspringen' : 'Weiter'}</Button>
        </>
      }
    >
      <form onSubmit={add} noValidate className="grid gap-3 rounded-lg border border-line bg-subtle/50 p-4 sm:grid-cols-2">
        {error && <div className="sm:col-span-2"><Notice tone="danger">{error}</Notice></div>}
        <Field label="Vorname" required error={formState.errors.firstName?.message}>
          {(id, d, inv) => <Input id={id} aria-describedby={d} aria-invalid={inv} {...register('firstName')} />}
        </Field>
        <Field label="Nachname" required error={formState.errors.lastName?.message}>
          {(id, d, inv) => <Input id={id} aria-describedby={d} aria-invalid={inv} {...register('lastName')} />}
        </Field>
        <Field label="E-Mail (optional)" error={formState.errors.email?.message}>
          {(id, d, inv) => <Input id={id} type="email" aria-describedby={d} aria-invalid={inv} {...register('email')} />}
        </Field>
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field label="Rolle">
            {(id) => (
              <Select id={id} {...register('jobRoleId')}>
                <option value="">Keine</option>
                {roles.filter((r) => r.isActive).map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Std./Woche" error={formState.errors.contractHoursPerWeek?.message}>
            {(id, d, inv) => <Input id={id} inputMode="decimal" aria-describedby={d} aria-invalid={inv} {...register('contractHoursPerWeek')} />}
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" variant="outline" loading={formState.isSubmitting}>
            <Plus /> Hinzufügen
          </Button>
        </div>
      </form>
      <ul className="mt-4 divide-y divide-line">
        {list.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <span>
              <span className="font-medium">{e.fullName}</span>
              {e.jobRoleName && <span className="text-ink-muted"> · {e.jobRoleName}</span>}
              {e.contractHoursPerWeek != null && <span className="text-ink-muted"> · {fmt.hours(e.contractHoursPerWeek)}</span>}
            </span>
            <Button variant="ghost" size="icon" aria-label={`${e.fullName} entfernen`} onClick={() => void remove(e)}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
    </StepCard>
  )
}

const shiftSchema = z.object({
  date: z.string().min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Uhrzeit fehlt.'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Uhrzeit fehlt.'),
  employeeId: z.string(),
  jobRoleId: z.string().min(1, 'Bitte eine Rolle wählen.'),
})

function ScheduleStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const qc = useQueryClient()
  const { data: locations } = useLocations()
  const { data: roles = [] } = useJobRoles()
  const location = locations?.[0]
  const employees = useQuery({ queryKey: ['employees', 'onboarding'], queryFn: () => api.get<Paged<Employee>>('/employees?pageSize=100') })
  const weekStart = mondayOf(addDaysTo(todayString(), 7))
  const week = useQuery({
    queryKey: ['week', location?.id, weekStart],
    queryFn: () => api.get<import('@/types/api').WeekView>(`/schedules/week?locationId=${location!.id}&date=${weekStart}`),
    enabled: Boolean(location),
  })
  const [error, setError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState<PublishResult | null>(null)
  const { register, handleSubmit, formState, setError: setFieldError } = useForm<z.infer<typeof shiftSchema>>({
    resolver: zodResolver(shiftSchema),
    defaultValues: { date: weekStart, startTime: '11:00', endTime: '17:00', employeeId: '', jobRoleId: roles[0]?.id ?? '' },
  })
  if (!location) return <Notice tone="warning">Bitte legen Sie zuerst einen Standort an.</Notice>

  const add = handleSubmit(async (v) => {
    setError(null)
    try {
      await api.post<ShiftSaveResult>('/shifts', {
        locationId: location.id, jobRoleId: v.jobRoleId, employeeId: v.employeeId || null, date: v.date,
        startTime: v.startTime, endTime: v.endTime, breakMinutes: location.defaultBreakMinutes, notes: null,
      })
      await qc.invalidateQueries({ queryKey: ['week'] })
    } catch (e) {
      if (!applyServerErrors(e, setFieldError)) setError(errorMessage(e))
    }
  })

  const publish = async () => {
    setPublishing(true)
    setError(null)
    try {
      setPublished(await api.post<PublishResult>('/schedules/publish', { locationId: location.id, weekStart, acknowledgeWarnings: true }))
      await qc.invalidateQueries({ queryKey: ['week'] })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setPublishing(false)
    }
  }

  const days = Array.from({ length: 7 }, (_, i) => addDaysTo(weekStart, i))
  const shifts = week.data?.shifts ?? []
  return (
    <StepCard
      title="Ersten Schichtplan erstellen"
      description={`Planen Sie ein paar Schichten für die nächste Woche (${fmt.week(weekStart)}). Den vollständigen Planer mit Drag & Drop finden Sie danach unter „Schichtplan“.`}
      footer={
        <>
          <Button variant="outline" onClick={onBack}>Zurück</Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="ghost" onClick={onDone}>{published ? 'Weiter' : 'Überspringen'}</Button>
            {!published && (
              <Button onClick={publish} loading={publishing} disabled={shifts.filter((s) => s.status === 'Draft').length === 0}>
                Schichtplan veröffentlichen
              </Button>
            )}
          </div>
        </>
      }
    >
      {error && <div className="mb-4"><Notice tone="danger">{error}</Notice></div>}
      {published && (
        <div className="mb-4">
          <Notice tone="success" title="Schichtplan veröffentlicht">
            {published.publishedShifts} Schichten veröffentlicht, {published.notifiedEmployees} Personen benachrichtigt.
          </Notice>
        </div>
      )}
      <form onSubmit={add} noValidate className="grid gap-3 rounded-lg border border-line bg-subtle/50 p-4 sm:grid-cols-6">
        <Field label="Tag" className="sm:col-span-2">
          {(id) => (
            <Select id={id} {...register('date')}>
              {days.map((d) => <option key={d} value={d}>{fmt.dayLong(d)}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Beginn" error={formState.errors.startTime?.message}>{(id) => <Input id={id} type="time" {...register('startTime')} />}</Field>
        <Field label="Ende" error={formState.errors.endTime?.message}>{(id) => <Input id={id} type="time" {...register('endTime')} />}</Field>
        <Field label="Rolle" className="sm:col-span-2" error={formState.errors.jobRoleId?.message}>
          {(id) => (
            <Select id={id} {...register('jobRoleId')}>
              <option value="">Bitte wählen</option>
              {roles.filter((r) => r.isActive).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Mitarbeiter/in" className="sm:col-span-4">
          {(id) => (
            <Select id={id} {...register('employeeId')}>
              <option value="">Noch nicht besetzt</option>
              {(employees.data?.items ?? []).filter((e) => e.status === 'Active' || e.status === 'Invited').map((e) => (
                <option key={e.id} value={e.id}>{e.fullName}</option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex items-end sm:col-span-2">
          <Button type="submit" variant="outline" className="w-full" loading={formState.isSubmitting}>
            <Plus /> Schicht hinzufügen
          </Button>
        </div>
      </form>
      <ul className="mt-4 divide-y divide-line">
        {shifts.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
            <span>
              <span className="font-medium">{fmt.dayShort(s.date)}</span> · {fmt.timeRange(s.startTime, s.endTime)} · {s.jobRoleName}
            </span>
            <span className="flex items-center gap-2">
              <span className={s.employeeName ? '' : 'text-warning-700'}>{s.employeeName ?? 'Nicht besetzt'}</span>
              <Badge tone={s.status === 'Published' ? 'success' : 'neutral'}>{s.status === 'Published' ? 'Veröffentlicht' : 'Entwurf'}</Badge>
            </span>
          </li>
        ))}
        {shifts.length === 0 && <li className="py-6 text-center text-sm text-ink-muted">Noch keine Schichten in dieser Woche.</li>}
      </ul>
    </StepCard>
  )
}

function DoneStep({ onFinish }: { onFinish: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  return (
    <StepCard
      title="Geschafft – Ihr Betrieb ist eingerichtet"
      description="Sie können jetzt Ihr Team einladen, Schichten planen und Anträge bearbeiten."
      footer={
        <Button
          className="sm:ml-auto"
          loading={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onFinish()
            } finally {
              setBusy(false)
            }
          }}
        >
          Zum Dashboard
        </Button>
      }
    >
      <div className="flex items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
          <PartyPopper className="size-5" aria-hidden />
        </span>
        <ul className="space-y-2 text-sm text-ink-muted">
          <li>Laden Sie Ihr Team unter <strong className="text-ink">Mitarbeiter</strong> per E-Mail oder Link ein.</li>
          <li>Planen Sie unter <strong className="text-ink">Schichtplan</strong> per Drag & Drop und prüfen Sie Konflikte vor dem Veröffentlichen.</li>
          <li>Mitarbeitende sehen veröffentlichte Schichten im Web und in der App.</li>
        </ul>
      </div>
    </StepCard>
  )
}
