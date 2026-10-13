import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Clock, MapPin, Pencil, Plus, Tag, Users } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { useAuth, usePermissions } from '@/lib/auth'
import { applyServerErrors, useAction, useJobRoles } from '@/lib/hooks'
import { WEEKDAY_SHORT, fmt } from '@/lib/format'
import { TIME_ZONES } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Switch } from '@/components/ui/form'
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, Notice, PageHeader, Skeleton } from '@/components/ui/display'
import { Dialog } from '@/components/ui/overlay'
import { OpeningHoursEditor, normalizeOpeningHours } from '@/components/domain/OpeningHoursEditor'
import type { JobRole, Location, OpeningHour } from '@/types/api'

export default function LocationsPage() {
  const p = usePermissions()
  const locations = useQuery({ queryKey: ['locations', 'all'], queryFn: () => api.get<Location[]>('/locations?includeInactive=true') })
  const [editing, setEditing] = useState<Location | 'new' | null>(null)
  const [hoursFor, setHoursFor] = useState<Location | null>(null)

  return (
    <>
      <PageHeader
        title="Standorte"
        description="Standorte, Öffnungszeiten sowie Rollen und Stationen Ihres Betriebs."
        actions={p.isOwner && p.canWrite && <Button onClick={() => setEditing('new')}><Plus /> Standort anlegen</Button>}
      />
      {locations.isPending ? (
        <div className="grid gap-4 md:grid-cols-2">{Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-52" />)}</div>
      ) : locations.isError ? (
        <Card><ErrorState error={locations.error} onRetry={() => void locations.refetch()} /></Card>
      ) : locations.data.length === 0 ? (
        <Card><EmptyState icon={<MapPin className="size-5" />} title="Noch kein Standort" description="Legen Sie Ihren ersten Standort an." /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {locations.data.map((l) => (
            <Card key={l.id} className={cn(!l.isActive && 'opacity-75')}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    {l.name}
                    {!l.isActive && <Badge>Inaktiv</Badge>}
                  </span>
                }
                description={[l.street, [l.postalCode, l.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Keine Adresse hinterlegt'}
                action={
                  p.isOwner && p.canWrite ? (
                    <Button variant="ghost" size="icon" aria-label={`${l.name} bearbeiten`} onClick={() => setEditing(l)}>
                      <Pencil />
                    </Button>
                  ) : undefined
                }
              />
              <CardBody className="space-y-3 text-sm">
                <p className="flex flex-wrap gap-x-4 gap-y-1 text-ink-muted">
                  <span className="inline-flex items-center gap-1"><Users className="size-4" aria-hidden />{l.employeeCount} Mitarbeitende</span>
                  <span className="inline-flex items-center gap-1"><Clock className="size-4" aria-hidden />{l.timeZoneId}</span>
                  {l.minStaffPerDay > 0 && <span>mind. {l.minStaffPerDay} Personen/Tag</span>}
                </p>
                <ul className="grid grid-cols-7 gap-1 text-center text-xs" aria-label="Öffnungszeiten">
                  {normalizeOpeningHours(l.openingHours).map((o) => (
                    <li key={o.dayOfWeek} className={cn('rounded-md border border-line px-1 py-1.5', o.isClosed && 'bg-subtle text-ink-faint')}>
                      <span className="block font-semibold">{WEEKDAY_SHORT[o.dayOfWeek]}</span>
                      {o.isClosed ? 'zu' : (
                        <>
                          <span className="block tabular-nums">{fmt.time(o.opensAt)}</span>
                          <span className="block tabular-nums">{fmt.time(o.closesAt)}</span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                {l.canManage && p.can('ManageSchedules') && p.canWrite && (
                  <Button variant="outline" size="sm" onClick={() => setHoursFor(l)}>
                    <Clock /> Öffnungszeiten bearbeiten
                  </Button>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      <JobRolesSection />
      <LocationDialog location={editing} onClose={() => setEditing(null)} />
      <OpeningHoursDialog location={hoursFor} onClose={() => setHoursFor(null)} />
    </>
  )
}

const locationSchema = z.object({
  name: z.string().trim().min(1, 'Bitte geben Sie einen Namen an.').max(120),
  street: z.string().max(150),
  postalCode: z.string().max(10),
  city: z.string().max(100),
  timeZoneId: z.string().min(1),
  phone: z.string().max(40),
  email: z.union([z.literal(''), z.email('Ungültige E-Mail-Adresse.')]),
  isActive: z.boolean(),
  minStaffPerDay: z.coerce.number<string>().int().min(0, 'Mindestens 0.').max(100),
  defaultBreakMinutes: z.coerce.number<string>().int().min(0).max(240, 'Höchstens 240 Minuten.'),
  prepBufferMinutes: z.coerce.number<string>().int().min(0).max(480, 'Höchstens 480 Minuten.'),
})

function LocationDialog({ location, onClose }: { location: Location | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient()
  const { refreshMe } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const existing = location !== 'new' ? location : null
  const { register, handleSubmit, reset, watch, setValue, setError: setFieldError, formState } = useForm<z.input<typeof locationSchema>, unknown, z.output<typeof locationSchema>>({
    resolver: zodResolver(locationSchema),
  })
  useEffect(() => {
    if (!location) return
    setError(null)
    reset({
      name: existing?.name ?? '',
      street: existing?.street ?? '',
      postalCode: existing?.postalCode ?? '',
      city: existing?.city ?? '',
      timeZoneId: existing?.timeZoneId ?? 'Europe/Berlin',
      phone: existing?.phone ?? '',
      email: existing?.email ?? '',
      isActive: existing?.isActive ?? true,
      minStaffPerDay: String(existing?.minStaffPerDay ?? 0),
      defaultBreakMinutes: String(existing?.defaultBreakMinutes ?? 30),
      prepBufferMinutes: String(existing?.prepBufferMinutes ?? 120),
    })
  }, [location, existing, reset])

  const submit = handleSubmit(async (v) => {
    setError(null)
    const body = { ...v, country: 'DE', street: v.street || null, postalCode: v.postalCode || null, city: v.city || null, phone: v.phone || null, email: v.email || null }
    try {
      if (existing) await api.put(`/locations/${existing.id}`, body)
      else await api.post('/locations', body)
      await qc.invalidateQueries({ queryKey: ['locations'] })
      await refreshMe()
      onClose()
    } catch (e) {
      if (!applyServerErrors(e, setFieldError)) setError(errorMessage(e))
    }
  })

  return (
    <Dialog
      open={Boolean(location)}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={existing ? `${existing.name} bearbeiten` : 'Standort anlegen'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button onClick={submit} loading={formState.isSubmitting}>{existing ? 'Änderungen speichern' : 'Standort anlegen'}</Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label="Name" required error={formState.errors.name?.message}>{(id, d, inv) => <Input id={id} aria-describedby={d} aria-invalid={inv} {...register('name')} />}</Field>
        <Field label="Straße und Hausnummer">{(id) => <Input id={id} {...register('street')} />}</Field>
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <Field label="PLZ">{(id) => <Input id={id} {...register('postalCode')} />}</Field>
          <Field label="Ort">{(id) => <Input id={id} {...register('city')} />}</Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Telefon">{(id) => <Input id={id} type="tel" {...register('phone')} />}</Field>
          <Field label="E-Mail" error={formState.errors.email?.message}>{(id, d, inv) => <Input id={id} type="email" aria-describedby={d} aria-invalid={inv} {...register('email')} />}</Field>
          <Field label="Zeitzone">
            {(id) => <Select id={id} {...register('timeZoneId')}>{TIME_ZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}</Select>}
          </Field>
          <Field label="Mindestbesetzung pro Tag" hint="0 = keine Prüfung" error={formState.errors.minStaffPerDay?.message}>
            {(id, d, inv) => <Input id={id} type="number" min={0} aria-describedby={d} aria-invalid={inv} {...register('minStaffPerDay')} />}
          </Field>
          <Field label="Standardpause (Min.)" error={formState.errors.defaultBreakMinutes?.message}>
            {(id, d, inv) => <Input id={id} type="number" min={0} step={5} aria-describedby={d} aria-invalid={inv} {...register('defaultBreakMinutes')} />}
          </Field>
          <Field label="Vor-/Nachbereitung (Min.)" hint="Zeitraum vor Öffnung bzw. nach Schließung ohne Hinweis" error={formState.errors.prepBufferMinutes?.message}>
            {(id, d, inv) => <Input id={id} type="number" min={0} step={15} aria-describedby={d} aria-invalid={inv} {...register('prepBufferMinutes')} />}
          </Field>
        </div>
        {existing && (
          <label className="flex items-center justify-between gap-4 rounded-md border border-line px-4 py-3 text-sm">
            <span>
              <span className="font-medium">Standort aktiv</span>
              <span className="block text-ink-muted">Inaktive Standorte erscheinen nicht in der Planung.</span>
            </span>
            <Switch checked={watch('isActive')} onCheckedChange={(v) => setValue('isActive', v, { shouldDirty: true })} aria-label="Standort aktiv" />
          </label>
        )}
      </form>
    </Dialog>
  )
}

function OpeningHoursDialog({ location, onClose }: { location: Location | null; onClose: () => void }) {
  const [hours, setHours] = useState<OpeningHour[]>([])
  useEffect(() => {
    if (location) setHours(normalizeOpeningHours(location.openingHours))
  }, [location])
  const save = useAction({
    fn: () => api.put(`/locations/${location!.id}/opening-hours`, { days: hours }),
    success: 'Öffnungszeiten gespeichert',
    invalidate: [['locations'], ['week']],
    onSuccess: onClose,
  })
  return (
    <Dialog
      open={Boolean(location)}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={`Öffnungszeiten – ${location?.name ?? ''}`}
      description="Eine Schließzeit vor der Öffnungszeit bedeutet: geöffnet bis nach Mitternacht."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>Speichern</Button>
        </>
      }
    >
      <OpeningHoursEditor value={hours} onChange={setHours} />
    </Dialog>
  )
}

const PALETTE = ['#0F766E', '#B45309', '#7C3AED', '#1D4ED8', '#BE123C', '#15803D', '#A16207', '#475569']

function JobRolesSection() {
  const p = usePermissions()
  const roles = useJobRoles()
  const [editing, setEditing] = useState<JobRole | 'new' | null>(null)
  const canEdit = p.can('ManageSchedules') && p.canWrite
  return (
    <Card className="mt-8">
      <CardHeader
        title="Rollen & Stationen"
        description="Z. B. Service, Küche, Bar. Rollen gelten für alle Standorte."
        action={canEdit ? <Button variant="outline" size="sm" onClick={() => setEditing('new')}><Plus /> Rolle</Button> : undefined}
      />
      {roles.isPending ? (
        <CardBody><Skeleton className="h-20" /></CardBody>
      ) : roles.isError ? (
        <ErrorState error={roles.error} onRetry={() => void roles.refetch()} />
      ) : roles.data.length === 0 ? (
        <EmptyState icon={<Tag className="size-5" />} title="Noch keine Rollen" />
      ) : (
        <ul className="divide-y divide-line">
          {roles.data.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-5 py-3 text-sm">
              <span className="size-3 rounded-full" style={{ backgroundColor: r.color }} aria-hidden />
              <span className="flex-1 font-medium">{r.name}</span>
              {!r.isActive && <Badge>Deaktiviert</Badge>}
              {canEdit && (
                <Button variant="ghost" size="icon" aria-label={`${r.name} bearbeiten`} onClick={() => setEditing(r)}>
                  <Pencil />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <JobRoleDialog role={editing} onClose={() => setEditing(null)} nextSort={(roles.data?.length ?? 0) + 1} />
    </Card>
  )
}

function JobRoleDialog({ role, onClose, nextSort }: { role: JobRole | 'new' | null; onClose: () => void; nextSort: number }) {
  const existing = role !== 'new' ? role : null
  const [name, setName] = useState('')
  const [color, setColor] = useState(PALETTE[0]!)
  const [active, setActive] = useState(true)
  const [error, setError] = useState<string | undefined>()
  useEffect(() => {
    if (!role) return
    setName(existing?.name ?? '')
    setColor(existing?.color ?? PALETTE[nextSort % PALETTE.length]!)
    setActive(existing?.isActive ?? true)
    setError(undefined)
  }, [role, existing, nextSort])
  const save = useAction({
    fn: () => {
      const body = { name: name.trim(), color, sortOrder: existing?.sortOrder ?? nextSort, isActive: active }
      return existing ? api.put(`/job-roles/${existing.id}`, body) : api.post('/job-roles', body)
    },
    success: 'Rolle gespeichert',
    invalidate: [['job-roles'], ['week']],
    onSuccess: onClose,
    onError: (e) => {
      setError(errorMessage(e))
      return true
    },
  })
  return (
    <Dialog
      open={Boolean(role)}
      onOpenChange={(o) => !o && onClose()}
      size="sm"
      title={existing ? 'Rolle bearbeiten' : 'Neue Rolle'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button onClick={() => (name.trim() ? save.mutate() : setError('Bitte geben Sie einen Namen an.'))} loading={save.isPending}>Speichern</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" required error={error}>{(id, d, inv) => <Input id={id} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-describedby={d} aria-invalid={inv} />}</Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Farbe</legend>
          <div className="flex flex-wrap gap-2">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={cn('size-8 cursor-pointer rounded-full border-2', color === c ? 'border-ink' : 'border-transparent')}
                style={{ backgroundColor: c }}
                aria-label={`Farbe ${c}`}
                aria-pressed={color === c}
              />
            ))}
          </div>
        </fieldset>
        {existing && (
          <label className="flex items-center justify-between text-sm">
            <span className="font-medium">Aktiv</span>
            <Switch checked={active} onCheckedChange={setActive} aria-label="Rolle aktiv" />
          </label>
        )}
      </div>
    </Dialog>
  )
}
