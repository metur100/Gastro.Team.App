import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { CalendarX2, Clock, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useActiveLocation, usePermissions } from '@/lib/auth'
import { useAction } from '@/lib/hooks'
import { fmt, todayString, WEEKDAY_LABEL } from '@/lib/format'
import { availabilityKindLabel } from '@/lib/labels'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input, Label, Select } from '@/components/ui/form'
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, Notice, PageHeader, Skeleton } from '@/components/ui/display'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay'
import type { Availability, AvailabilityOverviewItem } from '@/types/api'
import { rowsToSlots, slotsToRows, type DayMode, type DayRow } from './availabilityRows'

export default function AvailabilityPage() {
  const p = usePermissions()
  const [params, setParams] = useSearchParams()
  const selectedEmployee = params.get('mitarbeiter')
  const [tab, setTab] = useState(p.isManager && !p.isEmployee ? 'team' : 'mine')

  if (!p.hasFeature('Availability'))
    return (
      <>
        <PageHeader title="Verfügbarkeit" />
        <Card><EmptyState title="Nicht im Tarif enthalten" description="Verfügbarkeiten sind ab dem Tarif Team verfügbar." /></Card>
      </>
    )

  if (selectedEmployee && p.isManager)
    return (
      <>
        <PageHeader
          title="Verfügbarkeit"
          actions={<Button variant="outline" onClick={() => setParams({})}>Zurück zur Übersicht</Button>}
        />
        <AvailabilityEditor employeeId={selectedEmployee} editable={p.can('ManageSchedules') && p.canWrite} />
      </>
    )

  return (
    <>
      <PageHeader title="Verfügbarkeit" description="Wann kann wer arbeiten? Verfügbarkeiten sind keine Urlaubsanträge und ändern bereits veröffentlichte Schichten nicht." />
      {p.isManager && p.isEmployee ? (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="team">Team</TabsTrigger>
            <TabsTrigger value="mine">Meine Verfügbarkeit</TabsTrigger>
          </TabsList>
          <TabsContent value="team"><TeamOverview onSelect={(id) => setParams({ mitarbeiter: id })} /></TabsContent>
          <TabsContent value="mine"><AvailabilityEditor editable={p.canWrite} /></TabsContent>
        </Tabs>
      ) : p.isManager ? (
        <TeamOverview onSelect={(id) => setParams({ mitarbeiter: id })} />
      ) : (
        <AvailabilityEditor editable={p.canWrite} />
      )}
    </>
  )
}

function TeamOverview({ onSelect }: { onSelect: (employeeId: string) => void }) {
  const { locationId, managed } = useActiveLocation()
  const overview = useQuery({
    queryKey: ['availability-overview', locationId],
    queryFn: () => api.get<AvailabilityOverviewItem[]>(`/availability/overview?locationId=${locationId}`),
    enabled: Boolean(locationId),
  })
  const location = managed.find((l) => l.id === locationId)
  return (
    <Card>
      <CardHeader title={`Team${location ? ` · ${location.name}` : ''}`} description="Den Standort wählen Sie oben in der Kopfzeile." />
      {overview.isPending ? (
        <CardBody className="space-y-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10" />)}</CardBody>
      ) : overview.isError ? (
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
      ) : overview.data.length === 0 ? (
        <EmptyState title="Keine Mitarbeitenden an diesem Standort" />
      ) : (
        <ul className="divide-y divide-line">
          {overview.data.map((e) => (
            <li key={e.employeeId}>
              <button type="button" onClick={() => onSelect(e.employeeId)} className="flex w-full cursor-pointer items-center gap-3 px-5 py-3 text-left text-sm hover:bg-subtle/60">
                <span className="flex-1 font-medium">{e.employeeName}</span>
                {e.weeklySlots === 0 ? (
                  <Badge tone="neutral">Keine Angaben</Badge>
                ) : (
                  <Badge tone="brand">{e.weeklySlots} {e.weeklySlots === 1 ? 'Tag' : 'Tage'} hinterlegt</Badge>
                )}
                {e.upcomingExceptions > 0 && <Badge tone="warning">{e.upcomingExceptions} Ausnahme{e.upcomingExceptions === 1 ? '' : 'n'}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function AvailabilityEditor({ employeeId, editable }: { employeeId?: string; editable: boolean }) {
  const query = useQuery({
    queryKey: ['availability', employeeId ?? 'me'],
    queryFn: () => api.get<Availability>(`/availability${employeeId ? `?employeeId=${employeeId}` : ''}`),
  })
  const [rows, setRows] = useState<DayRow[]>([])
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    if (query.data) {
      setRows(slotsToRows(query.data.weekly))
      setDirty(false)
    }
  }, [query.data])

  const save = useAction({
    fn: () => api.put<Availability>('/availability/weekly', { employeeId: employeeId ?? null, slots: rowsToSlots(rows), validFrom: null }),
    success: 'Verfügbarkeit gespeichert',
    invalidate: [['availability'], ['availability-overview'], ['week']],
    onSuccess: () => setDirty(false),
  })

  if (query.isPending) return <Skeleton className="h-96" />
  if (query.isError) return <Card><ErrorState error={query.error} onRetry={() => void query.refetch()} /></Card>
  const data = query.data
  const update = (i: number, patch: Partial<DayRow>) => {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
    setDirty(true)
  }
  const hasPositive = rows.some((r) => r.mode === 'Available' || r.mode === 'Preferred')

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader
          title={employeeId ? `Wöchentliche Verfügbarkeit – ${data.employeeName}` : 'Meine wöchentliche Verfügbarkeit'}
          description={data.validFrom ? `Gültig seit ${fmt.date(data.validFrom)}. Frühere Angaben bleiben im Verlauf erhalten.` : 'Noch keine Angaben hinterlegt.'}
        />
        <CardBody>
          <div className="divide-y divide-line rounded-lg border border-line">
            {rows.map((r, i) => (
              <div key={r.day} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <span className="w-24 text-sm font-medium">{WEEKDAY_LABEL[r.day]}</span>
                <Select
                  aria-label={`${WEEKDAY_LABEL[r.day]}: Verfügbarkeit`}
                  value={r.mode}
                  onChange={(e) => update(i, { mode: e.target.value as DayMode })}
                  disabled={!editable}
                  className="w-48"
                >
                  <option value="none">Keine Angabe</option>
                  <option value="Available">{availabilityKindLabel.Available}</option>
                  <option value="Preferred">{availabilityKindLabel.Preferred}</option>
                  <option value="Unavailable">{availabilityKindLabel.Unavailable}</option>
                </Select>
                {r.mode !== 'none' && (
                  <div className="flex items-center gap-2">
                    <Input type="time" value={r.start} onChange={(e) => update(i, { start: e.target.value })} disabled={!editable} className="w-28" aria-label={`${WEEKDAY_LABEL[r.day]} von`} />
                    <span className="text-ink-faint" aria-hidden>–</span>
                    <Input type="time" value={r.end} onChange={(e) => update(i, { end: e.target.value })} disabled={!editable} className="w-28" aria-label={`${WEEKDAY_LABEL[r.day]} bis`} />
                  </div>
                )}
              </div>
            ))}
          </div>
          {hasPositive && rows.some((r) => r.mode === 'none') && (
            <p className="mt-3 text-sm text-ink-muted">Hinweis: Sobald Zeiten als verfügbar hinterlegt sind, gelten Tage ohne Angabe bei der Planung als nicht verfügbar.</p>
          )}
          {editable && (
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" disabled={!dirty} onClick={() => { setRows(slotsToRows(data.weekly)); setDirty(false) }}>Verwerfen</Button>
              <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>Änderungen speichern</Button>
            </div>
          )}
        </CardBody>
      </Card>
      <ExceptionsCard availability={data} employeeId={employeeId} editable={editable} />
    </div>
  )
}

function ExceptionsCard({ availability, employeeId, editable }: { availability: Availability; employeeId?: string; editable: boolean }) {
  const [date, setDate] = useState('')
  const [wholeDay, setWholeDay] = useState(true)
  const [start, setStart] = useState('10:00')
  const [end, setEnd] = useState('14:00')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | undefined>()
  const add = useAction({
    fn: () => api.post('/availability/exceptions', { employeeId: employeeId ?? null, date, startTime: wholeDay ? null : start, endTime: wholeDay ? null : end, note: note.trim() || null }),
    success: 'Ausnahme eingetragen',
    invalidate: [['availability'], ['availability-overview'], ['week']],
    onSuccess: () => {
      setDate('')
      setNote('')
    },
  })
  const remove = useAction({
    fn: (id: string) => api.del(`/availability/exceptions/${id}`),
    success: 'Ausnahme entfernt',
    invalidate: [['availability'], ['availability-overview'], ['week']],
  })
  const upcoming = availability.exceptions.filter((x) => x.date >= todayString())

  return (
    <Card>
      <CardHeader title="Einzelne Tage nicht verfügbar" description="Z. B. Prüfung, Termin oder Familienfeier." />
      <CardBody className="space-y-4">
        {editable && (
          <div className="space-y-3 rounded-md border border-line bg-subtle/40 p-3">
            <Field label="Datum" error={error}>
              {(id, d, inv) => <Input id={id} type="date" min={todayString()} value={date} onChange={(e) => setDate(e.target.value)} aria-describedby={d} aria-invalid={inv} />}
            </Field>
            <div className="flex items-center gap-2">
              <Checkbox id="whole-day" checked={wholeDay} onCheckedChange={(v) => setWholeDay(v === true)} />
              <Label htmlFor="whole-day" className="font-normal">Ganzer Tag</Label>
            </div>
            {!wholeDay && (
              <div className="flex items-center gap-2">
                <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Von" className="w-28" />
                <span aria-hidden>–</span>
                <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Bis" className="w-28" />
              </div>
            )}
            <Field label="Notiz (optional)">{(id) => <Input id={id} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />}</Field>
            <Button
              variant="outline"
              loading={add.isPending}
              onClick={() => {
                if (!date) return setError('Bitte ein Datum wählen.')
                if (!wholeDay && start === end) return setError('Beginn und Ende dürfen nicht identisch sein.')
                setError(undefined)
                add.mutate()
              }}
            >
              <CalendarX2 /> Eintragen
            </Button>
          </div>
        )}
        {upcoming.length === 0 ? (
          <p className="text-sm text-ink-muted">Keine bevorstehenden Ausnahmen.</p>
        ) : (
          <ul className="divide-y divide-line">
            {upcoming.map((x) => (
              <li key={x.id} className="flex items-center gap-3 py-2.5 text-sm">
                <Clock className="size-4 text-ink-faint" aria-hidden />
                <span className="flex-1">
                  <span className="font-medium">{fmt.dayShort(x.date)}</span>{' '}
                  {x.startTime ? `${fmt.timeRange(x.startTime, x.endTime ?? '')} Uhr` : 'ganztägig'}
                  {x.note && <span className="block text-ink-muted">{x.note}</span>}
                </span>
                {editable && (
                  <Button variant="ghost" size="icon" aria-label={`Ausnahme am ${fmt.date(x.date)} entfernen`} onClick={() => remove.mutate(x.id)}>
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <Notice tone="info">Für Urlaub stellen Sie bitte einen Urlaubsantrag – Verfügbarkeiten werden nicht genehmigt.</Notice>
      </CardBody>
    </Card>
  )
}
