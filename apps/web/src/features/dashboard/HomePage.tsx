import { Link, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle, ArrowLeftRight, ArrowRight, CalendarClock, CalendarDays, CalendarPlus, Clock, Info, MapPin, Plane, UserPlus, Users,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useActiveLocation, useAuth, usePermissions } from '@/lib/auth'
import { fmt, plural } from '@/lib/format'
import { shiftStatusLabel } from '@/lib/labels'
import { Button } from '@/components/ui/button'
import { Avatar, Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, Notice, PageHeader, Skeleton, StatCard } from '@/components/ui/display'
import { LocationSelect } from '@/components/layout/AppShell'
import type { ActionItem, DashboardSummary, EmployeeOverview, Shift } from '@/types/api'

export default function HomePage() {
  const p = usePermissions()
  return p.isManager ? <ManagerDashboard /> : <EmployeeHome />
}

function ManagerDashboard() {
  const { me } = useAuth()
  const p = usePermissions()
  const navigate = useNavigate()
  const { locationId, managed } = useActiveLocation()
  const location = managed.find((l) => l.id === locationId)
  const q = locationId ? `?locationId=${locationId}` : ''

  const summary = useQuery({ queryKey: ['dashboard', 'summary', locationId], queryFn: () => api.get<DashboardSummary>(`/dashboard/summary${q}`), enabled: managed.length > 0 })
  const today = useQuery({ queryKey: ['dashboard', 'today', locationId], queryFn: () => api.get<Shift[]>(`/dashboard/today${q}`), enabled: managed.length > 0 })
  const actions = useQuery({ queryKey: ['dashboard', 'actions', locationId], queryFn: () => api.get<ActionItem[]>(`/dashboard/action-items${q}`), enabled: managed.length > 0 })

  const tenant = me?.currentTenant
  const s = summary.data

  return (
    <>
      <PageHeader
        title={tenant?.name ?? 'Dashboard'}
        description={location ? <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{location.name}</span> : undefined}
        actions={
          <>
            <LocationSelect className="sm:hidden" />
            {p.can('ManageSchedules') && managed.length > 0 && (
              <Button onClick={() => navigate('/schichtplan')}>
                <CalendarDays /> Zum Schichtplan
              </Button>
            )}
          </>
        }
      />

      {tenant && !tenant.onboardingCompleted && p.isOwner && (
        <div className="mb-6">
          <Notice
            tone="info"
            title="Einrichtung noch nicht abgeschlossen"
            action={<Button size="sm" variant="outline" onClick={() => navigate('/onboarding')}>Einrichtung fortsetzen</Button>}
          >
            Legen Sie Standort, Öffnungszeiten, Team und den ersten Schichtplan an.
          </Notice>
        </div>
      )}

      {managed.length === 0 ? (
        <Card>
          <EmptyState
            icon={<MapPin className="size-5" />}
            title="Noch kein Standort"
            description={p.isOwner ? 'Legen Sie Ihren ersten Standort an, um Schichten zu planen.' : 'Ihnen ist noch kein Standort zugewiesen. Bitte wenden Sie sich an die Inhaberin bzw. den Inhaber.'}
            action={p.isOwner ? <Button onClick={() => navigate('/onboarding')}>Standort anlegen</Button> : undefined}
          />
        </Card>
      ) : (
        <>
          <section aria-label="Kennzahlen" className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            {summary.isPending ? (
              Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[104px]" />)
            ) : summary.isError ? (
              <div className="col-span-full">
                <Card><ErrorState error={summary.error} onRetry={() => void summary.refetch()} /></Card>
              </div>
            ) : (
              s && (
                <>
                  <StatCard label="Heute im Einsatz" value={s.employeesWorkingToday} hint={plural(s.shiftsToday, 'Schicht heute', 'Schichten heute')} icon={<Users />} />
                  <StatCard label="Schichten heute" value={s.shiftsToday} icon={<CalendarClock />} onClick={() => navigate('/schichtplan')} />
                  <StatCard
                    label="Unbesetzt"
                    value={s.unassignedShifts}
                    hint="ab heute"
                    icon={<AlertTriangle />}
                    tone={s.unassignedShifts > 0 ? 'warning' : 'neutral'}
                    onClick={() => navigate('/schichtplan?unbesetzt=1')}
                  />
                  <StatCard label="Urlaubsanträge" value={s.pendingLeaveRequests} hint="warten auf Freigabe" icon={<Plane />} onClick={p.can('ApproveLeave') ? () => navigate('/urlaub?status=Pending') : undefined} />
                  <StatCard label="Schichttausch" value={s.pendingSwapRequests} hint="offen" icon={<ArrowLeftRight />} onClick={p.hasFeature('ShiftSwaps') && p.can('ManageSwaps') ? () => navigate('/schichttausch') : undefined} />
                  <StatCard label="Geplante Stunden" value={fmt.number(s.scheduledHoursThisWeek)} hint="diese Woche" icon={<Clock />} />
                </>
              )
            )}
          </section>

          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px] [&>*]:min-w-0">
            <Card>
              <CardHeader
                title="Heute im Dienst"
                description={s ? fmt.dayLong(s.today) : undefined}
                action={<Button variant="ghost" size="sm" onClick={() => navigate('/schichtplan')}>Woche ansehen <ArrowRight /></Button>}
              />
              {today.isPending ? (
                <CardBody className="space-y-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12" />)}</CardBody>
              ) : today.isError ? (
                <ErrorState error={today.error} onRetry={() => void today.refetch()} />
              ) : today.data.length === 0 ? (
                <EmptyState
                  icon={<CalendarPlus className="size-5" />}
                  title="Heute sind keine Schichten geplant"
                  description={s?.hasAnyShifts ? 'An diesem Tag ist niemand eingeplant.' : 'Erstellen Sie Ihren ersten Schichtplan – mit Drag & Drop und automatischer Prüfung.'}
                  action={p.can('ManageSchedules') ? <Button variant="outline" onClick={() => navigate('/schichtplan')}>Schichten planen</Button> : undefined}
                />
              ) : (
                <TodayTimeline shifts={today.data} />
              )}
            </Card>

            <Card>
              <CardHeader title="Zu erledigen" />
              {actions.isPending ? (
                <CardBody className="space-y-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-10" />)}</CardBody>
              ) : actions.isError ? (
                <ErrorState error={actions.error} onRetry={() => void actions.refetch()} />
              ) : actions.data.length === 0 ? (
                <EmptyState title="Alles erledigt" description="Es gibt aktuell keine offenen Aufgaben." />
              ) : (
                <ul className="divide-y divide-line">
                  {actions.data.map((a, i) => (
                    <li key={`${a.kind}-${i}`}>
                      <Link to={a.link} className="flex items-start gap-3 px-5 py-3.5 text-sm hover:bg-subtle/60">
                        {a.severity === 'warning' ? (
                          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-700" aria-label="Hinweis" />
                        ) : (
                          <Info className="mt-0.5 size-4 shrink-0 text-info-700" aria-label="Info" />
                        )}
                        <span className="flex-1">{a.message}</span>
                        <ArrowRight className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {p.can('ManageEmployees') && (
                <div className="border-t border-line px-5 py-3">
                  <Button variant="ghost" size="sm" onClick={() => navigate('/mitarbeiter')}>
                    <UserPlus /> Mitarbeiter einladen
                  </Button>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  )
}

function TodayTimeline({ shifts }: { shifts: Shift[] }) {
  const now = new Date()
  return (
    <ul className="divide-y divide-line">
      {shifts.map((s) => {
        const running = new Date(s.startUtc) <= now && now < new Date(s.endUtc)
        const done = new Date(s.endUtc) <= now
        return (
          <li key={s.id} className="flex items-center gap-3 px-5 py-3">
            <div className="w-24 shrink-0 text-sm tabular-nums">
              <span className="font-medium">{fmt.timeRange(s.startTime, s.endTime)}</span>
              {s.endsNextDay && <span className="block text-xs text-ink-faint">bis Folgetag</span>}
            </div>
            <span className="h-9 w-1 shrink-0 rounded-full" style={{ backgroundColor: s.jobRoleColor }} aria-hidden />
            {s.employeeName ? <Avatar name={s.employeeName} color={s.jobRoleColor} /> : <span className="size-8 shrink-0 rounded-full border border-dashed border-warning-700/50" aria-hidden />}
            <div className="min-w-0 flex-1">
              <p className={s.employeeName ? 'truncate text-sm font-medium' : 'truncate text-sm font-medium text-warning-700'}>{s.employeeName ?? 'Schicht nicht besetzt'}</p>
              <p className="truncate text-xs text-ink-muted">
                {s.jobRoleName}
                {s.locationName ? ` · ${s.locationName}` : ''}
              </p>
            </div>
            <div className="hidden shrink-0 gap-1.5 sm:flex">
              {running && <Badge tone="brand">Läuft</Badge>}
              {done && <Badge tone="neutral">Beendet</Badge>}
              {s.status !== 'Published' && <Badge tone="neutral">{shiftStatusLabel[s.status]}</Badge>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function EmployeeHome() {
  const { me } = useAuth()
  const navigate = useNavigate()
  const p = usePermissions()
  const overview = useQuery({ queryKey: ['dashboard', 'employee'], queryFn: () => api.get<EmployeeOverview>('/dashboard/employee'), enabled: p.isEmployee })

  if (!p.isEmployee)
    return (
      <Card>
        <EmptyState title="Kein Mitarbeiterprofil" description="Ihr Konto ist in diesem Betrieb mit keinem Mitarbeiterprofil verknüpft." />
      </Card>
    )

  const o = overview.data
  return (
    <>
      <PageHeader title={`Hallo ${me?.firstName ?? ''}`} description={fmt.full(new Date())} />
      {overview.isPending ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-44 lg:col-span-2" />
          <Skeleton className="h-44" />
        </div>
      ) : overview.isError ? (
        <Card><ErrorState error={overview.error} onRetry={() => void overview.refetch()} /></Card>
      ) : (
        o && (
          <>
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader title="Meine nächste Schicht" />
                {o.nextShift ? (
                  <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <div className="flex size-16 shrink-0 flex-col items-center justify-center rounded-lg bg-brand-50 text-brand-800">
                      <span className="text-xs font-medium uppercase">{fmt.weekday(o.nextShift.date)}</span>
                      <span className="text-xl font-semibold leading-none">{o.nextShift.date.slice(8, 10)}</span>
                    </div>
                    <div className="flex-1">
                      <p className="text-lg font-semibold tabular-nums">
                        {fmt.timeRange(o.nextShift.startTime, o.nextShift.endTime)} Uhr
                      </p>
                      <p className="text-sm text-ink-muted">
                        {fmt.dayLong(o.nextShift.date)} · {o.nextShift.jobRoleName}
                        {o.nextShift.locationName ? ` · ${o.nextShift.locationName}` : ''}
                      </p>
                      {o.nextShift.breakMinutes > 0 && <p className="text-sm text-ink-muted">{o.nextShift.breakMinutes} Min. Pause</p>}
                    </div>
                    <Button variant="outline" onClick={() => navigate('/meine-schichten')}>Alle Schichten</Button>
                  </CardBody>
                ) : (
                  <EmptyState icon={<CalendarClock className="size-5" />} title="Keine anstehenden Schichten" description="Sobald ein Schichtplan veröffentlicht wird, sehen Sie Ihre Schichten hier." />
                )}
              </Card>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
                <StatCard
                  label="Geplant diese Woche"
                  value={fmt.hours(o.scheduledHoursThisWeek)}
                  hint={o.contractHoursPerWeek != null ? `Vereinbart: ${fmt.hours(o.contractHoursPerWeek)}` : undefined}
                  icon={<Clock />}
                />
                <StatCard label="Offene Anträge" value={o.pendingLeaveRequests} icon={<Plane />} onClick={() => navigate('/urlaub')} />
                {p.hasFeature('ShiftSwaps') && (
                  <StatCard label="Tauschangebote" value={o.openSwapOffers} hint="für Sie offen" icon={<ArrowLeftRight />} onClick={() => navigate('/schichttausch')} />
                )}
              </div>
            </div>
            {o.upcomingShifts.length > 1 && (
              <Card className="mt-6">
                <CardHeader title="Demnächst" />
                <ul className="divide-y divide-line">
                  {o.upcomingShifts.slice(1, 6).map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <span className="font-medium">{fmt.dayShort(s.date)}</span>
                      <span className="tabular-nums">{fmt.timeRange(s.startTime, s.endTime)}</span>
                      <span className="hidden flex-1 truncate text-right text-ink-muted sm:block">
                        {s.jobRoleName}
                        {s.locationName ? ` · ${s.locationName}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )
      )}
    </>
  )
}
