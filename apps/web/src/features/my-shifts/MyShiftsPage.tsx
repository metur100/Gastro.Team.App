import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeftRight, CalendarClock, ChevronLeft, ChevronRight, Clock, MapPin, Users } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth, usePermissions } from '@/lib/auth'
import { addDaysTo, fmt, mondayOf, todayString } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/display'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay'
import { RequestSwapDialog } from '@/features/swaps/RequestSwapDialog'
import type { Shift } from '@/types/api'

export default function MyShiftsPage() {
  const p = usePermissions()
  const [tab, setTab] = useState('mine')
  if (!p.isEmployee)
    return (
      <>
        <PageHeader title="Meine Schichten" />
        <Card><EmptyState title="Kein Mitarbeiterprofil" description="Ihr Konto ist in diesem Betrieb mit keinem Mitarbeiterprofil verknüpft." /></Card>
      </>
    )
  return (
    <>
      <PageHeader title="Meine Schichten" description="Veröffentlichte Schichten. Entwürfe sehen Sie erst nach der Veröffentlichung." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="mine"><CalendarClock className="size-4" /> Meine Schichten</TabsTrigger>
          <TabsTrigger value="team"><Users className="size-4" /> Teamplan</TabsTrigger>
        </TabsList>
        <TabsContent value="mine"><MyAgenda /></TabsContent>
        <TabsContent value="team"><TeamWeek /></TabsContent>
      </Tabs>
    </>
  )
}

function MyAgenda() {
  const p = usePermissions()
  const [swapShift, setSwapShift] = useState<Shift | null>(null)
  const from = addDaysTo(todayString(), -7)
  const to = addDaysTo(todayString(), 42)
  const shifts = useQuery({ queryKey: ['my-shifts', from, to], queryFn: () => api.get<Shift[]>(`/shifts/mine?from=${from}&to=${to}`) })

  const now = Date.now()
  const groups = useMemo(() => {
    const map = new Map<string, Shift[]>()
    for (const s of shifts.data ?? []) map.set(s.date, [...(map.get(s.date) ?? []), s])
    return [...map.entries()]
  }, [shifts.data])
  const weekHours = (shifts.data ?? [])
    .filter((s) => s.status === 'Published' && mondayOf(s.date) === mondayOf(todayString()))
    .reduce((sum, s) => sum + s.paidHours, 0)

  if (shifts.isPending) return <div className="space-y-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div>
  if (shifts.isError) return <Card><ErrorState error={shifts.error} onRetry={() => void shifts.refetch()} /></Card>

  return (
    <>
      <p className="mb-4 text-sm text-ink-muted">
        Diese Woche geplant: <span className="font-semibold text-ink">{fmt.hours(weekHours)}</span> (geplante Stunden, keine erfassten Arbeitszeiten)
      </p>
      {groups.length === 0 ? (
        <Card><EmptyState icon={<CalendarClock className="size-5" />} title="Keine Schichten im Zeitraum" description="Sobald Ihre Leitung einen Schichtplan veröffentlicht, erscheinen Ihre Schichten hier." /></Card>
      ) : (
        <div className="space-y-5">
          {groups.map(([date, list]) => (
            <section key={date} aria-label={fmt.dayLong(date)}>
              <h2 className={date === todayString() ? 'mb-2 text-sm font-semibold text-brand-700' : 'mb-2 text-sm font-semibold text-ink-muted'}>
                {fmt.dayLong(date)}
                {date === todayString() && ' · Heute'}
              </h2>
              <ul className="space-y-2">
                {list.map((s) => {
                  const past = new Date(s.endUtc).getTime() < now
                  const upcoming = new Date(s.startUtc).getTime() > now
                  return (
                    <li key={s.id}>
                      <Card className={past ? 'opacity-70' : undefined}>
                        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                          <span className="hidden h-10 w-1 shrink-0 rounded-full sm:block" style={{ backgroundColor: s.jobRoleColor }} aria-hidden />
                          <div className="flex-1">
                            <p className="flex flex-wrap items-center gap-2 text-base font-semibold tabular-nums">
                              {fmt.timeRange(s.startTime, s.endTime)} Uhr
                              {s.endsNextDay && <span className="text-xs font-normal text-ink-muted">(bis Folgetag)</span>}
                              {s.status === 'Cancelled' && <Badge tone="danger">Abgesagt</Badge>}
                            </p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
                              <span>{s.jobRoleName}</span>
                              {s.locationName && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{s.locationName}</span>}
                              <span className="inline-flex items-center gap-1"><Clock className="size-3.5" aria-hidden />{s.breakMinutes} Min. Pause · {fmt.hours(s.paidHours)}</span>
                            </p>
                            {s.notes && <p className="mt-1 text-sm">{s.notes}</p>}
                          </div>
                          {upcoming && s.status === 'Published' && p.hasFeature('ShiftSwaps') && (
                            <Button variant="outline" size="sm" onClick={() => setSwapShift(s)}>
                              <ArrowLeftRight /> Tauschen
                            </Button>
                          )}
                        </div>
                      </Card>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      <RequestSwapDialog shift={swapShift} onClose={() => setSwapShift(null)} />
    </>
  )
}

function TeamWeek() {
  const { me } = useAuth()
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<import('@/types/api').Location[]>('/locations'), enabled: Boolean(me?.currentTenant) })
  const [weekStart, setWeekStart] = useState(mondayOf(todayString()))
  const [locationId, setLocationId] = useState<string | null>(null)
  const loc = locationId ?? locations.data?.[0]?.id ?? null
  const team = useQuery({
    queryKey: ['team-week', loc, weekStart],
    queryFn: () => api.get<Shift[]>(`/schedules/team?locationId=${loc}&weekStart=${weekStart}`),
    enabled: Boolean(loc),
  })
  const days = Array.from({ length: 7 }, (_, i) => addDaysTo(weekStart, i))

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-md border border-line-strong bg-surface">
          <Button variant="ghost" size="icon" aria-label="Vorherige Woche" onClick={() => setWeekStart(addDaysTo(weekStart, -7))}><ChevronLeft /></Button>
          <span className="min-w-52 text-center text-sm font-medium">{fmt.week(weekStart)}</span>
          <Button variant="ghost" size="icon" aria-label="Nächste Woche" onClick={() => setWeekStart(addDaysTo(weekStart, 7))}><ChevronRight /></Button>
        </div>
        {(locations.data?.length ?? 0) > 1 && (
          <select
            aria-label="Standort"
            value={loc ?? ''}
            onChange={(e) => setLocationId(e.target.value)}
            className="h-10 rounded-md border border-line-strong bg-surface px-3 text-sm"
          >
            {locations.data!.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
      </div>
      {team.isPending ? (
        <Skeleton className="h-64" />
      ) : team.isError ? (
        <Card><ErrorState error={team.error} onRetry={() => void team.refetch()} /></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {days.map((d) => {
            const list = team.data.filter((s) => s.date === d)
            return (
              <Card key={d}>
                <div className="border-b border-line px-4 py-2.5 text-sm font-semibold">{fmt.dayLong(d)}</div>
                {list.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-ink-faint">Keine veröffentlichten Schichten</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {list.map((s) => (
                      <li key={s.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: s.jobRoleColor }} aria-hidden />
                        <span className="tabular-nums">{fmt.timeRange(s.startTime, s.endTime)}</span>
                        <span className="flex-1 truncate">{s.employeeName ?? 'Nicht besetzt'}</span>
                        <span className="text-xs text-ink-faint">{s.jobRoleName}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}
