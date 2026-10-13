import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Check, Mail, Pencil, UserPlus } from 'lucide-react'
import { api } from '@/lib/api'
import { useActiveLocation, useAuth, usePermissions } from '@/lib/auth'
import { applyServerErrors, useAction } from '@/lib/hooks'
import { fmt } from '@/lib/format'
import { permissionLabel, roleLabel, subscriptionStatusLabel, TIME_ZONES } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input, Label, Select, SwitchRow } from '@/components/ui/form'
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, Notice, PageHeader, Skeleton } from '@/components/ui/display'
import { Dialog, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay'
import { InvitationResultDialog } from '@/features/employees/EmployeeDialogs'
import type { AuditLogEntry, InvitationCreated, Member, Paged, PendingInvitation, Permission, PlanFeature, SubscriptionInfo, TenantSettings } from '@/types/api'

const FEATURE_LABEL: Record<PlanFeature, string> = {
  ShiftSwaps: 'Schichttausch',
  Availability: 'Verfügbarkeiten',
  Reports: 'Auswertungen & CSV-Export',
  EmailNotifications: 'E-Mail-Benachrichtigungen',
  AdvancedPermissions: 'Individuelle Rechte für Leitungen',
  MultipleLocations: 'Mehrere Standorte',
}
const PERMISSIONS = Object.keys(permissionLabel) as Permission[]

export default function SettingsPage() {
  const p = usePermissions()
  const [tab, setTab] = useState('betrieb')
  if (!p.isOwner)
    return (
      <>
        <PageHeader title="Einstellungen" />
        <Card><EmptyState title="Kein Zugriff" description="Einstellungen können nur von Inhaberinnen und Inhabern geändert werden." /></Card>
      </>
    )
  return (
    <>
      <PageHeader title="Einstellungen" />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="betrieb">Betrieb</TabsTrigger>
          <TabsTrigger value="regeln">Planungsregeln</TabsTrigger>
          <TabsTrigger value="team">Team & Rechte</TabsTrigger>
          <TabsTrigger value="tarif">Tarif</TabsTrigger>
          <TabsTrigger value="protokoll">Protokoll</TabsTrigger>
        </TabsList>
        <TabsContent value="betrieb"><TenantSettingsForm section="business" /></TabsContent>
        <TabsContent value="regeln"><TenantSettingsForm section="rules" /></TabsContent>
        <TabsContent value="team"><TeamTab /></TabsContent>
        <TabsContent value="tarif"><PlanTab /></TabsContent>
        <TabsContent value="protokoll"><AuditTab /></TabsContent>
      </Tabs>
    </>
  )
}

const settingsSchema = z.object({
  name: z.string().trim().min(1, 'Bitte geben Sie einen Namen an.').max(150),
  contactEmail: z.union([z.literal(''), z.email('Ungültige E-Mail-Adresse.')]),
  phone: z.string().max(40),
  logoUrl: z.union([z.literal(''), z.url({ protocol: /^https$/, message: 'Bitte eine https-Adresse angeben.' })]),
  defaultLanguage: z.string(),
  defaultTimeZone: z.string(),
  unassignedShiftsBlockPublish: z.boolean(),
  maxShiftHours: z.coerce.number<string>().min(1, 'Zwischen 1 und 16.').max(16, 'Zwischen 1 und 16.'),
  maxDailyHours: z.coerce.number<string>().min(1, 'Zwischen 1 und 16.').max(16, 'Zwischen 1 und 16.'),
  maxWeeklyHours: z.coerce.number<string>().min(1, 'Zwischen 1 und 80.').max(80, 'Zwischen 1 und 80.'),
  minRestHours: z.coerce.number<string>().min(0, 'Zwischen 0 und 24.').max(24, 'Zwischen 0 und 24.'),
  checkBreakRules: z.boolean(),
  swapRequiresManagerApproval: z.boolean(),
  allowOpenSwapOffers: z.boolean(),
  employeesSeeColleagueShifts: z.boolean(),
})
type SettingsInput = z.input<typeof settingsSchema>

function TenantSettingsForm({ section }: { section: 'business' | 'rules' }) {
  const { refreshMe } = useAuth()
  const settings = useQuery({ queryKey: ['tenant-settings'], queryFn: () => api.get<TenantSettings>('/settings/tenant') })
  const form = useForm<SettingsInput, unknown, z.output<typeof settingsSchema>>({ resolver: zodResolver(settingsSchema) })
  const { register, handleSubmit, reset, watch, setValue, setError, formState } = form
  useEffect(() => {
    const s = settings.data
    if (!s) return
    reset({
      ...s,
      contactEmail: s.contactEmail ?? '',
      phone: s.phone ?? '',
      logoUrl: s.logoUrl ?? '',
      maxShiftHours: String(s.maxShiftHours),
      maxDailyHours: String(s.maxDailyHours),
      maxWeeklyHours: String(s.maxWeeklyHours),
      minRestHours: String(s.minRestHours),
    })
  }, [settings.data, reset])
  const save = useAction({
    fn: (v: z.output<typeof settingsSchema>) => api.put<TenantSettings>('/settings/tenant', { ...v, contactEmail: v.contactEmail || null, phone: v.phone || null, logoUrl: v.logoUrl || null }),
    success: 'Einstellungen gespeichert',
    invalidate: [['tenant-settings'], ['week']],
    onSuccess: () => void refreshMe(),
    onError: (e) => applyServerErrors(e, setError),
  })
  if (settings.isPending) return <Skeleton className="h-96" />
  if (settings.isError) return <Card><ErrorState error={settings.error} onRetry={() => void settings.refetch()} /></Card>

  const sw = (name: 'unassignedShiftsBlockPublish' | 'checkBreakRules' | 'swapRequiresManagerApproval' | 'allowOpenSwapOffers' | 'employeesSeeColleagueShifts', label: string, description: string) => (
    <SwitchRow label={label} description={description} checked={Boolean(watch(name))} onCheckedChange={(v) => setValue(name, v, { shouldDirty: true })} />
  )
  const num = (name: 'maxShiftHours' | 'maxDailyHours' | 'maxWeeklyHours' | 'minRestHours', label: string, hint: string) => (
    <Field label={label} hint={hint} error={formState.errors[name]?.message}>
      {(id, d, inv) => <Input id={id} type="number" step="0.5" aria-describedby={d} aria-invalid={inv} {...register(name)} />}
    </Field>
  )

  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
      <Card>
        {section === 'business' ? (
          <>
            <CardHeader title="Betrieb" description="Grunddaten Ihres Restaurants." />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" required error={formState.errors.name?.message} className="sm:col-span-2">{(id, d, inv) => <Input id={id} aria-describedby={d} aria-invalid={inv} {...register('name')} />}</Field>
              <Field label="Kontakt-E-Mail" error={formState.errors.contactEmail?.message}>{(id, d, inv) => <Input id={id} type="email" aria-describedby={d} aria-invalid={inv} {...register('contactEmail')} />}</Field>
              <Field label="Telefon">{(id) => <Input id={id} type="tel" {...register('phone')} />}</Field>
              <Field label="Logo-URL" hint="Optional, https-Adresse eines Bildes." error={formState.errors.logoUrl?.message} className="sm:col-span-2">
                {(id, d, inv) => <Input id={id} type="url" placeholder="https://" aria-describedby={d} aria-invalid={inv} {...register('logoUrl')} />}
              </Field>
              <Field label="Sprache">{(id) => <Select id={id} {...register('defaultLanguage')}><option value="de-DE">Deutsch</option><option value="en-US">Englisch (in Vorbereitung)</option></Select>}</Field>
              <Field label="Zeitzone">{(id) => <Select id={id} {...register('defaultTimeZone')}>{TIME_ZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}</Select>}</Field>
            </CardBody>
          </>
        ) : (
          <>
            <CardHeader title="Planungsregeln" description={`Prüfungen beim Planen und Veröffentlichen · Regelwerk ${settings.data.ruleSetVersion}`} />
            <CardBody className="space-y-6">
              <Notice tone="warning" title="Keine Rechtsberatung">
                Die Werte sind konfigurierbare Hilfen (z. B. angelehnt an das Arbeitszeitgesetz) und garantieren keine arbeitsrechtliche Konformität. Bitte lassen Sie die für Ihren Betrieb geltenden Regeln (inkl. Tarifverträgen) rechtlich prüfen.
              </Notice>
              <div className="grid gap-4 sm:grid-cols-2">
                {num('maxShiftHours', 'Maximale Schichtlänge (Std.)', 'Längere Schichten erzeugen einen Hinweis.')}
                {num('maxDailyHours', 'Maximale Stunden pro Tag', 'Summe der Arbeitszeit ohne Pausen.')}
                {num('maxWeeklyHours', 'Maximale Stunden pro Woche', 'Summe über alle Standorte.')}
                {num('minRestHours', 'Mindestruhezeit (Std.)', 'Zwischen zwei Schichten derselben Person.')}
              </div>
              <div className="divide-y divide-line">
                {sw('unassignedShiftsBlockPublish', 'Unbesetzte Schichten blockieren das Veröffentlichen', 'Sonst werden sie nur als Hinweis angezeigt.')}
                {sw('checkBreakRules', 'Pausenregeln prüfen', 'Hinweis bei weniger als 30 Min. Pause ab 6 Std. bzw. 45 Min. ab 9 Std.')}
                {sw('swapRequiresManagerApproval', 'Schichttausch erfordert Freigabe', 'Angenommene Tauschanfragen müssen von der Leitung freigegeben werden.')}
                {sw('allowOpenSwapOffers', 'Offene Tauschangebote erlauben', 'Mitarbeitende können Schichten allen am Standort anbieten.')}
                {sw('employeesSeeColleagueShifts', 'Teamplan für Mitarbeitende sichtbar', 'Mitarbeitende sehen veröffentlichte Schichten ihrer Kolleginnen und Kollegen (Name, Zeit, Rolle).')}
              </div>
            </CardBody>
          </>
        )}
        <div className="flex justify-end border-t border-line px-5 py-3">
          <Button type="submit" loading={save.isPending} disabled={!formState.isDirty}>Änderungen speichern</Button>
        </div>
      </Card>
    </form>
  )
}

function TeamTab() {
  const p = usePermissions()
  const { managed } = useActiveLocation()
  const members = useQuery({ queryKey: ['members'], queryFn: () => api.get<Member[]>('/settings/members') })
  const invitations = useQuery({ queryKey: ['invitations'], queryFn: () => api.get<PendingInvitation[]>('/invitations') })
  const [inviteOpen, setInviteOpen] = useState(false)
  const [editing, setEditing] = useState<Member | null>(null)
  const [result, setResult] = useState<InvitationCreated | null>(null)
  const revoke = useAction({ fn: (id: string) => api.post(`/invitations/${id}/revoke`), success: 'Einladung zurückgezogen', invalidate: [['invitations'], ['employees']] })

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Inhaber und Leitungen"
          description="Leitungen sehen und planen nur die ihnen zugewiesenen Standorte."
          action={p.canWrite ? <Button size="sm" onClick={() => setInviteOpen(true)}><UserPlus /> Leitung einladen</Button> : undefined}
        />
        {members.isPending ? (
          <CardBody><Skeleton className="h-24" /></CardBody>
        ) : members.isError ? (
          <ErrorState error={members.error} onRetry={() => void members.refetch()} />
        ) : (
          <ul className="divide-y divide-line">
            {members.data.map((m) => (
              <li key={m.membershipId} className="flex flex-col gap-2 px-5 py-3 text-sm sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {m.fullName} <Badge tone={m.role === 'Owner' ? 'brand' : 'neutral'}>{roleLabel[m.role]}</Badge>
                    {!m.isActive && <Badge tone="danger">Deaktiviert</Badge>}
                  </p>
                  <p className="truncate text-ink-muted">{m.email}</p>
                  {m.role === 'Manager' && (
                    <p className="mt-1 text-xs text-ink-muted">
                      Standorte: {m.locationIds.map((id) => managed.find((l) => l.id === id)?.name).filter(Boolean).join(', ') || 'keine'} · Rechte:{' '}
                      {m.permissions.map((x) => permissionLabel[x]).join(', ') || 'keine'}
                    </p>
                  )}
                </div>
                {m.role === 'Manager' && p.canWrite && (
                  <Button variant="outline" size="sm" onClick={() => setEditing(m)}><Pencil /> Bearbeiten</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title="Offene Einladungen" description="Einladungen für Leitungen und Mitarbeitende, die noch nicht angenommen wurden." />
        {invitations.isPending ? (
          <CardBody><Skeleton className="h-16" /></CardBody>
        ) : invitations.isError ? (
          <ErrorState error={invitations.error} onRetry={() => void invitations.refetch()} />
        ) : invitations.data.length === 0 ? (
          <EmptyState icon={<Mail className="size-5" />} title="Keine offenen Einladungen" className="py-8" />
        ) : (
          <ul className="divide-y divide-line">
            {invitations.data.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{i.fullName}</span> <span className="text-ink-muted">· {i.email}</span>
                  <span className="block text-xs text-ink-faint">{roleLabel[i.role]} · gültig bis {fmt.dateTime(i.expiresAt)}</span>
                </span>
                <Button variant="ghost" size="sm" onClick={() => revoke.mutate(i.id)}>Zurückziehen</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <MemberDialog open={inviteOpen} onClose={() => setInviteOpen(false)} onInvited={setResult} />
      <MemberDialog open={Boolean(editing)} member={editing ?? undefined} onClose={() => setEditing(null)} />
      <InvitationResultDialog result={result} onClose={() => setResult(null)} />
    </div>
  )
}

function MemberDialog({ open, member, onClose, onInvited }: { open: boolean; member?: Member; onClose: () => void; onInvited?: (r: InvitationCreated) => void }) {
  const p = usePermissions()
  const { managed } = useActiveLocation()
  const advanced = p.hasFeature('AdvancedPermissions')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [locations, setLocations] = useState<string[]>([])
  const [perms, setPerms] = useState<Permission[]>(PERMISSIONS)
  const [active, setActive] = useState(true)
  const [errors, setErrors] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!open) return
    setFirstName('')
    setLastName('')
    setEmail('')
    setLocations(member?.locationIds ?? [])
    setPerms(member?.permissions ?? PERMISSIONS)
    setActive(member?.isActive ?? true)
    setErrors({})
  }, [open, member])

  const save = useAction({
    fn: () =>
      member
        ? api.put(`/settings/members/${member.membershipId}`, { locationIds: locations, permissions: perms, isActive: active })
        : api.post<InvitationCreated>('/settings/members/invite', { email, firstName, lastName, locationIds: locations, permissions: perms }),
    success: member ? 'Leitung aktualisiert' : undefined,
    invalidate: [['members'], ['invitations']],
    onSuccess: (r) => {
      onClose()
      if (!member && r) onInvited?.(r as InvitationCreated)
    },
  })
  const submit = () => {
    const e: Record<string, string> = {}
    if (!member) {
      if (!firstName.trim()) e.firstName = 'Vorname fehlt.'
      if (!lastName.trim()) e.lastName = 'Nachname fehlt.'
      if (!/^\S+@\S+\.\S+$/.test(email)) e.email = 'Bitte eine gültige E-Mail-Adresse angeben.'
    }
    if (locations.length === 0) e.locations = 'Bitte mindestens einen Standort wählen.'
    setErrors(e)
    if (Object.keys(e).length === 0) save.mutate()
  }
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={member ? `${member.fullName} bearbeiten` : 'Leitung einladen'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button onClick={submit} loading={save.isPending}>{member ? 'Speichern' : 'Einladung erstellen'}</Button>
        </>
      }
    >
      <div className="space-y-5">
        {!member && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Vorname" required error={errors.firstName}>{(id, d, inv) => <Input id={id} value={firstName} onChange={(e) => setFirstName(e.target.value)} aria-describedby={d} aria-invalid={inv} />}</Field>
            <Field label="Nachname" required error={errors.lastName}>{(id, d, inv) => <Input id={id} value={lastName} onChange={(e) => setLastName(e.target.value)} aria-describedby={d} aria-invalid={inv} />}</Field>
            <Field label="E-Mail-Adresse" required error={errors.email} className="sm:col-span-2">{(id, d, inv) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-describedby={d} aria-invalid={inv} />}</Field>
          </div>
        )}
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Standorte</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {managed.map((l) => (
              <label key={l.id} className="flex cursor-pointer items-center gap-2.5 rounded-md border border-line px-3 py-2 text-sm">
                <Checkbox checked={locations.includes(l.id)} onCheckedChange={() => setLocations(toggle(locations, l.id))} />
                {l.name}
              </label>
            ))}
          </div>
          {errors.locations && <p role="alert" className="mt-1 text-xs font-medium text-danger-600">{errors.locations}</p>}
        </fieldset>
        <fieldset disabled={!advanced}>
          <legend className="mb-2 text-sm font-medium">Rechte</legend>
          {!advanced && <p className="mb-2 text-xs text-ink-muted">Leitungen erhalten alle Rechte. Individuelle Rechte sind im Tarif Business enthalten.</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            {PERMISSIONS.map((perm) => (
              <label key={perm} className={cn('flex items-center gap-2.5 rounded-md border border-line px-3 py-2 text-sm', advanced ? 'cursor-pointer' : 'opacity-70')}>
                <Checkbox checked={perms.includes(perm)} onCheckedChange={() => setPerms(toggle(perms, perm))} disabled={!advanced} />
                {permissionLabel[perm]}
              </label>
            ))}
          </div>
        </fieldset>
        {member && (
          <div className="flex items-center gap-2.5">
            <Checkbox id="member-active" checked={active} onCheckedChange={(v) => setActive(v === true)} />
            <Label htmlFor="member-active" className="font-normal">Zugang aktiv</Label>
          </div>
        )}
      </div>
    </Dialog>
  )
}

function PlanTab() {
  const { refreshMe } = useAuth()
  const sub = useQuery({ queryKey: ['subscription'], queryFn: () => api.get<SubscriptionInfo>('/subscription') })
  const change = useAction({
    fn: (planCode: string) => api.post<SubscriptionInfo>('/subscription/change-plan', { planCode }),
    success: 'Tarif im Testmodus geändert',
    invalidate: [['subscription']],
    onSuccess: () => void refreshMe(),
  })
  if (sub.isPending) return <Skeleton className="h-96" />
  if (sub.isError) return <Card><ErrorState error={sub.error} onRetry={() => void sub.refetch()} /></Card>
  const s = sub.data
  const current = s.plans.find((pl) => pl.code === s.current.planCode)
  const bar = (used: number, max: number) => (
    <div className="mt-1.5 h-2 rounded-full bg-subtle" role="progressbar" aria-valuenow={used} aria-valuemin={0} aria-valuemax={max}>
      <div className={cn('h-2 rounded-full', used >= max ? 'bg-warning-700' : 'bg-brand-600')} style={{ width: `${Math.min(100, (used / Math.max(1, max)) * 100)}%` }} />
    </div>
  )
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={`Aktueller Tarif: ${s.current.planName}`}
          description={
            <>
              Status: {subscriptionStatusLabel[s.current.status]}
              {s.current.trialEndsAt && s.current.status === 'Trial' ? ` bis ${fmt.dateTime(s.current.trialEndsAt)}` : ''}
              {s.current.isTestMode && ' · Testmodus (ohne Zahlungsanbindung)'}
            </>
          }
        />
        {current && (
          <CardBody className="grid gap-6 sm:grid-cols-2">
            <div className="text-sm">
              <span className="font-medium">Aktive Standorte</span> <span className="tabular-nums text-ink-muted">{s.usage.activeLocations} von {current.maxLocations}</span>
              {bar(s.usage.activeLocations, current.maxLocations)}
            </div>
            <div className="text-sm">
              <span className="font-medium">Aktive Mitarbeitende</span> <span className="tabular-nums text-ink-muted">{s.usage.activeEmployees} von {current.maxActiveEmployees}</span>
              {bar(s.usage.activeEmployees, current.maxActiveEmployees)}
            </div>
          </CardBody>
        )}
      </Card>
      {!s.manualPlanChangeAllowed && (
        <Notice tone="info">Die Zahlungsabwicklung ist noch nicht angebunden. Für einen Tarifwechsel wenden Sie sich bitte an den Support.</Notice>
      )}
      {s.manualPlanChangeAllowed && (
        <Notice tone="warning" title="Testmodus">Tarifwechsel sind ohne Zahlungsanbindung möglich. Es wird keine Zahlung ausgeführt und keine Rechnung erstellt.</Notice>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        {s.plans.map((plan) => {
          const isCurrent = plan.code === s.current.planCode
          return (
            <Card key={plan.code} className={cn('flex flex-col', isCurrent && 'border-brand-600 ring-1 ring-brand-600')}>
              <div className="border-b border-line px-5 py-4">
                <p className="flex items-center gap-2 font-semibold">{plan.name} {isCurrent && <Badge tone="brand">Aktuell</Badge>}</p>
                <p className="mt-1 text-2xl font-semibold">{fmt.euro(plan.monthlyPriceEur)}<span className="text-sm font-normal text-ink-muted"> / Monat je Betrieb</span></p>
                <p className="text-xs text-ink-faint">zzgl. MwSt.</p>
              </div>
              <ul className="flex-1 space-y-2 px-5 py-4 text-sm">
                <li className="flex gap-2"><Check className="size-4 shrink-0 text-brand-700" aria-hidden />{plan.maxLocations === 1 ? '1 Standort' : `Bis zu ${plan.maxLocations} Standorte`}</li>
                <li className="flex gap-2"><Check className="size-4 shrink-0 text-brand-700" aria-hidden />Bis zu {plan.maxActiveEmployees} aktive Mitarbeitende</li>
                <li className="flex gap-2"><Check className="size-4 shrink-0 text-brand-700" aria-hidden />Schichtplanung & Urlaubsanträge</li>
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2"><Check className="size-4 shrink-0 text-brand-700" aria-hidden />{FEATURE_LABEL[f]}</li>
                ))}
              </ul>
              {s.manualPlanChangeAllowed && !isCurrent && (
                <div className="px-5 pb-5">
                  <Button variant="outline" className="w-full" loading={change.isPending && change.variables === plan.code} onClick={() => change.mutate(plan.code)}>
                    Zu {plan.name} wechseln (Testmodus)
                  </Button>
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}

const ACTION_LABEL: Record<string, string> = {
  'tenant.created': 'Betrieb angelegt',
  'tenant.settings_updated': 'Einstellungen geändert',
  'tenant.onboarding_completed': 'Einrichtung abgeschlossen',
  'location.created': 'Standort angelegt',
  'location.updated': 'Standort geändert',
  'location.opening_hours_updated': 'Öffnungszeiten geändert',
  'employee.created': 'Mitarbeiter/in angelegt',
  'employee.updated': 'Mitarbeiter/in geändert',
  'employee.deactivated': 'Mitarbeiter/in deaktiviert',
  'employee.reactivated': 'Mitarbeiter/in reaktiviert',
  'employee.anonymized': 'Personendaten gelöscht',
  'employee.exported': 'Daten exportiert',
  'invitation.created': 'Einladung erstellt',
  'invitation.accepted': 'Einladung angenommen',
  'invitation.revoked': 'Einladung zurückgezogen',
  'shift.created': 'Schicht angelegt',
  'shift.updated': 'Schicht geändert',
  'shift.deleted': 'Schicht gelöscht',
  'shift.cancelled': 'Schicht abgesagt',
  'shift.published': 'Schicht veröffentlicht',
  'schedule.published': 'Schichtplan veröffentlicht',
  'schedule.unpublished': 'Veröffentlichung zurückgezogen',
  'schedule.week_copied': 'Woche kopiert',
  'schedule.day_copied': 'Tag kopiert',
  'leave.created': 'Antrag gestellt',
  'leave.approved': 'Antrag genehmigt',
  'leave.rejected': 'Antrag abgelehnt',
  'leave.cancelled': 'Antrag storniert',
  'swap.created': 'Tauschanfrage erstellt',
  'swap.accepted': 'Tausch angenommen',
  'swap.approved': 'Tausch freigegeben',
  'swap.rejected': 'Tausch abgelehnt',
  'swap.declined': 'Tausch abgelehnt (Kollege)',
  'swap.cancelled': 'Tausch zurückgezogen',
  'member.updated': 'Leitung geändert',
  'availability.updated': 'Verfügbarkeit geändert',
  'availability.exception_added': 'Abwesenheitstag eingetragen',
  'availability.exception_removed': 'Abwesenheitstag entfernt',
  'jobrole.created': 'Rolle angelegt',
  'jobrole.updated': 'Rolle geändert',
  'subscription.plan_changed_test_mode': 'Tarif geändert (Testmodus)',
}

function AuditTab() {
  const [page, setPage] = useState(1)
  const log = useQuery({ queryKey: ['audit', page], queryFn: () => api.get<Paged<AuditLogEntry>>(`/settings/audit-log?page=${page}&pageSize=30`) })
  return (
    <Card>
      <CardHeader title="Protokoll" description="Nachvollziehbarkeit administrativer Änderungen in Ihrem Betrieb." />
      {log.isPending ? (
        <CardBody><Skeleton className="h-64" /></CardBody>
      ) : log.isError ? (
        <ErrorState error={log.error} onRetry={() => void log.refetch()} />
      ) : log.data.items.length === 0 ? (
        <EmptyState title="Noch keine Einträge" />
      ) : (
        <>
          <ul className="divide-y divide-line text-sm">
            {log.data.items.map((a) => (
              <li key={a.id} className="flex flex-col gap-0.5 px-5 py-2.5 sm:flex-row sm:items-center sm:gap-4">
                <time className="w-40 shrink-0 text-xs tabular-nums text-ink-faint" dateTime={a.createdAt}>{fmt.dateTime(a.createdAt)}</time>
                <span className="flex-1">{ACTION_LABEL[a.action] ?? a.action}</span>
                <span className="text-ink-muted">{a.userName ?? 'System'}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Neuere</Button>
            <Button size="sm" variant="outline" disabled={page * log.data.pageSize >= log.data.totalCount} onClick={() => setPage(page + 1)}>Ältere</Button>
          </div>
        </>
      )}
    </Card>
  )
}
