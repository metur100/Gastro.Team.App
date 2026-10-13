import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { endOfMonth, startOfMonth } from 'date-fns'
import { toast } from 'sonner'
import { BarChart3, Download, Printer } from 'lucide-react'
import { api, download, errorMessage } from '@/lib/api'
import { useActiveLocation, usePermissions } from '@/lib/auth'
import { fmt, toDateString } from '@/lib/format'
import { qs } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/form'
import { Card, EmptyState, ErrorState, Notice, PageHeader, Skeleton } from '@/components/ui/display'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/overlay'

type Cell = string | number | null
interface ReportDef {
  key: string
  label: string
  columns: { label: string; value: (row: Record<string, unknown>) => Cell; numeric?: boolean }[]
}

const n = (v: unknown) => (typeof v === 'number' ? fmt.number(v) : '–')
const s = (v: unknown) => (v == null || v === '' ? '–' : String(v))
const d = (v: unknown) => (typeof v === 'string' ? fmt.date(v) : '–')

const REPORTS: ReportDef[] = [
  {
    key: 'scheduled-hours',
    label: 'Stunden je Mitarbeiter',
    columns: [
      { label: 'Mitarbeiter/in', value: (r) => s(r.employeeName) },
      { label: 'Rolle', value: (r) => s(r.jobRole) },
      { label: 'Vertrag/Woche', value: (r) => n(r.contractHoursPerWeek), numeric: true },
      { label: 'Schichten', value: (r) => n(r.shifts), numeric: true },
      { label: 'Geplante Std.', value: (r) => n(r.plannedHours), numeric: true },
      { label: 'Davon veröffentlicht', value: (r) => n(r.publishedHours), numeric: true },
    ],
  },
  {
    key: 'location-hours',
    label: 'Stunden je Standort',
    columns: [
      { label: 'Standort', value: (r) => s(r.locationName) },
      { label: 'Schichten', value: (r) => n(r.shifts), numeric: true },
      { label: 'Unbesetzt', value: (r) => n(r.unassignedShifts), numeric: true },
      { label: 'Geplante Std.', value: (r) => n(r.plannedHours), numeric: true },
    ],
  },
  {
    key: 'staffing',
    label: 'Personalbesetzung',
    columns: [
      { label: 'Datum', value: (r) => d(r.date) },
      { label: 'Standort', value: (r) => s(r.locationName) },
      { label: 'Rolle', value: (r) => s(r.jobRole) },
      { label: 'Schichten', value: (r) => n(r.shifts), numeric: true },
      { label: 'Besetzt', value: (r) => n(r.assigned), numeric: true },
      { label: 'Unbesetzt', value: (r) => n(r.unassigned), numeric: true },
      { label: 'Geplante Std.', value: (r) => n(r.plannedHours), numeric: true },
    ],
  },
  {
    key: 'unassigned-shifts',
    label: 'Unbesetzte Schichten',
    columns: [
      { label: 'Datum', value: (r) => d(r.date) },
      { label: 'Standort', value: (r) => s(r.locationName) },
      { label: 'Rolle', value: (r) => s(r.jobRole) },
      { label: 'Zeit', value: (r) => `${s(r.start)}–${s(r.end)}` },
      { label: 'Status', value: (r) => s(r.status) },
    ],
  },
  {
    key: 'leave',
    label: 'Abwesenheiten',
    columns: [
      { label: 'Mitarbeiter/in', value: (r) => s(r.employeeName) },
      { label: 'Art', value: (r) => s(r.type) },
      { label: 'Von', value: (r) => d(r.startDate) },
      { label: 'Bis', value: (r) => d(r.endDate) },
      { label: 'Tage', value: (r) => n(r.days), numeric: true },
      { label: 'Status', value: (r) => s(r.status) },
    ],
  },
  {
    key: 'employee-status',
    label: 'Mitarbeiterstatus',
    columns: [
      { label: 'Status', value: (r) => s(r.status) },
      { label: 'Anzahl', value: (r) => n(r.count), numeric: true },
    ],
  },
  {
    key: 'shift-changes',
    label: 'Schichtänderungen',
    columns: [
      { label: 'Zeitpunkt', value: (r) => (typeof r.at === 'string' ? fmt.dateTime(r.at) : '–') },
      { label: 'Aktion', value: (r) => s(r.action) },
      { label: 'Durch', value: (r) => s(r.userName) },
    ],
  },
]

export default function ReportsPage() {
  const p = usePermissions()
  const { managed } = useActiveLocation()
  const [report, setReport] = useState(REPORTS[0]!.key)
  const [from, setFrom] = useState(toDateString(startOfMonth(new Date())))
  const [to, setTo] = useState(toDateString(endOfMonth(new Date())))
  const [locationId, setLocationId] = useState('')
  const [downloading, setDownloading] = useState(false)
  const def = REPORTS.find((r) => r.key === report)!
  const query = qs({ from, to, locationId })
  const allowed = p.can('ViewReports') && p.hasFeature('Reports')
  const data = useQuery({
    queryKey: ['report', report, query],
    queryFn: () => api.get<Record<string, unknown>[]>(`/reports/${report}${query}`),
    enabled: allowed && Boolean(from && to) && from <= to,
  })

  if (!allowed)
    return (
      <>
        <PageHeader title="Auswertungen" />
        <Card><EmptyState title={p.hasFeature('Reports') ? 'Kein Zugriff' : 'Nicht im Tarif enthalten'} description={p.hasFeature('Reports') ? 'Ihnen fehlt die Berechtigung „Auswertungen ansehen“.' : 'Auswertungen sind ab dem Tarif Team verfügbar.'} /></Card>
      </>
    )

  const exportCsv = async () => {
    setDownloading(true)
    try {
      await download(`/reports/${report}${query}&format=csv`, `gastroteam-${report}.csv`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Auswertungen"
        description={`${def.label} · ${from ? fmt.date(from) : ''} – ${to ? fmt.date(to) : ''}`}
        actions={
          <div className="no-print flex gap-2">
            <Button variant="outline" onClick={() => window.print()}><Printer /> Drucken</Button>
            <Button onClick={exportCsv} loading={downloading} disabled={!data.data?.length}><Download /> CSV exportieren</Button>
          </div>
        }
      />
      <div className="no-print mb-4 grid gap-2 sm:grid-cols-3 lg:flex lg:items-end">
        <Field label="Von" className="lg:w-44">{(id) => <Input id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label="Bis" className="lg:w-44">{(id) => <Input id={id} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
        <Field label="Standort" className="lg:w-56">
          {(id) => (
            <Select id={id} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">Alle Standorte</option>
              {managed.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          )}
        </Field>
      </div>
      <Tabs value={report} onValueChange={setReport}>
        <TabsList className="no-print mb-4 flex-wrap">
          {REPORTS.map((r) => <TabsTrigger key={r.key} value={r.key}>{r.label}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      <div className="mb-4">
        <Notice tone="info">Geplante Stunden laut Schichtplan (Arbeitszeit abzüglich Pausen) – keine erfassten oder geprüften Arbeitszeiten.</Notice>
      </div>
      <Card className="overflow-x-auto">
        {from > to ? (
          <EmptyState title="Ungültiger Zeitraum" description="Das Enddatum muss nach dem Startdatum liegen." />
        ) : data.isPending ? (
          <div className="space-y-3 p-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : data.isError ? (
          <ErrorState error={data.error} onRetry={() => void data.refetch()} />
        ) : data.data.length === 0 ? (
          <EmptyState icon={<BarChart3 className="size-5" />} title="Keine Daten im Zeitraum" description="Für die gewählten Filter liegen keine Einträge vor." />
        ) : (
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-line text-left text-xs text-ink-muted">
              <tr>{def.columns.map((c) => <th key={c.label} className={c.numeric ? 'px-4 py-3 text-right' : 'px-4 py-3'}>{c.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.data.map((row, i) => (
                <tr key={i}>
                  {def.columns.map((c) => <td key={c.label} className={c.numeric ? 'px-4 py-2.5 text-right tabular-nums' : 'px-4 py-2.5'}>{c.value(row)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  )
}
