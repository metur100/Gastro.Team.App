import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertCircle, AlertTriangle, CalendarRange, ChevronLeft, ChevronRight, Copy, Info, ListChecks, MoreHorizontal, Plus, Send, Undo2,
} from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { useActiveLocation, usePermissions } from '@/lib/auth'
import { useJobRoles } from '@/lib/hooks'
import { addDaysTo, fmt, mondayOf, plural, todayString } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Label, Select } from '@/components/ui/form'
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/display'
import { ConfirmDialog, Dialog, DropdownContent, DropdownItem, DropdownMenu, DropdownTrigger, Tabs, TabsList, TabsTrigger } from '@/components/ui/overlay'
import type { CopyResult, Issue, Severity, Shift } from '@/types/api'
import { DayAgenda } from './DayAgenda'
import { PublishDialog } from './PublishDialog'
import { ShiftDialog, type ShiftDialogState } from './ShiftDialog'
import { worstSeverity } from './severity'
import { WeekGrid, type GridMode } from './WeekGrid'
import { useMoveShift, useWeek } from './scheduleApi'

type View = GridMode | 'day'

function useIsDesktop() {
  const query = '(min-width: 1024px)'
  const [desktop, setDesktop] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const handler = () => setDesktop(mql.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])
  return desktop
}

const STATE_LABEL = {
  empty: { text: 'Keine Schichten', tone: 'neutral' },
  draft: { text: 'Entwurf', tone: 'neutral' },
  partial: { text: 'Teilweise veröffentlicht', tone: 'warning' },
  published: { text: 'Veröffentlicht', tone: 'success' },
} as const

export default function SchedulePage() {
  const p = usePermissions()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const { locationId: activeLocationId, setLocationId, managed } = useActiveLocation()
  const isDesktop = useIsDesktop()

  // URL is the source of truth for location and week so links from the dashboard work.
  const urlLocation = params.get('standort')
  useEffect(() => {
    if (urlLocation && urlLocation !== activeLocationId && managed.some((l) => l.id === urlLocation)) setLocationId(urlLocation)
  }, [urlLocation, activeLocationId, managed, setLocationId])
  const locationId = activeLocationId
  const location = managed.find((l) => l.id === locationId)
  const weekStart = mondayOf(params.get('woche') ?? todayString())
  const [selectedView, setView] = useState<View>('employees')
  // Small screens always use the agenda; the chosen desktop view is kept when the window grows again.
  const view: View = isDesktop ? selectedView : 'day'
  const [day, setDay] = useState(() => {
    const t = todayString()
    return t >= weekStart && t <= addDaysTo(weekStart, 6) ? t : weekStart
  })
  useEffect(() => {
    setDay((d) => (d >= weekStart && d <= addDaysTo(weekStart, 6) ? d : weekStart))
  }, [weekStart])

  const [roleFilter, setRoleFilter] = useState('')
  const unassignedOnly = params.get('unbesetzt') === '1'
  const [dialog, setDialog] = useState<ShiftDialogState | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const [unpublishOpen, setUnpublishOpen] = useState(false)
  const [issuesOpen, setIssuesOpen] = useState(false)
  const [highlight, setHighlight] = useState<string | null>(null)

  const week = useWeek(locationId, weekStart)
  const { data: roles = [] } = useJobRoles()
  const move = useMoveShift(locationId, weekStart)
  const canEdit = p.can('ManageSchedules') && p.canWrite
  const canPublish = p.can('PublishSchedules') && p.canWrite

  const setWeek = (ws: string) => {
    const next = new URLSearchParams(params)
    next.set('woche', ws)
    setParams(next, { replace: true })
  }

  const shifts = useMemo(() => {
    let list = week.data?.shifts ?? []
    if (roleFilter) list = list.filter((s) => s.jobRoleId === roleFilter)
    if (unassignedOnly) list = list.filter((s) => !s.employeeId)
    return list
  }, [week.data, roleFilter, unassignedOnly])

  const severityByShift = useMemo(() => {
    const map = new Map<string, Severity[]>()
    for (const i of week.data?.issues ?? []) if (i.shiftId) map.set(i.shiftId, [...(map.get(i.shiftId) ?? []), i.severity])
    const result = new Map<string, Severity>()
    for (const [id, list] of map) {
      const worst = worstSeverity(list.filter((s) => s !== 'Info'))
      if (worst) result.set(id, worst)
    }
    return result
  }, [week.data])

  const issues = week.data?.issues ?? []
  const counts = { Error: 0, Warning: 0, Info: 0 }
  for (const i of issues) counts[i.severity]++

  const showIssue = (i: Issue) => {
    setPublishOpen(false)
    setIssuesOpen(false)
    if (i.date) setDay(i.date)
    setHighlight(i.shiftId)
    const shift = week.data?.shifts.find((s) => s.id === i.shiftId)
    if (shift) setDialog({ shift })
    setTimeout(() => setHighlight(null), 4000)
  }

  if (!p.isManager) return <ErrorState error={new Error('Kein Zugriff')} />
  if (managed.length === 0)
    return (
      <>
        <PageHeader title="Schichtplan" />
        <Card>
          <EmptyState title="Kein Standort verfügbar" description="Legen Sie zuerst einen Standort an oder lassen Sie sich einem Standort zuweisen." />
        </Card>
      </>
    )

  const state = week.data?.publication.state ?? 'empty'
  const stateLabel = STATE_LABEL[state]
  const draftCount = week.data?.publication.draftShifts ?? 0

  return (
    <>
      <PageHeader
        title="Schichtplan"
        description={location?.name}
        actions={
          <>
            {canEdit && (
              <Button variant="outline" onClick={() => setDialog({ preset: { date: view === 'day' ? day : weekStart, employeeId: null } })}>
                <Plus /> Schicht
              </Button>
            )}
            {(canEdit || canPublish) && (
              <DropdownMenu>
                <DropdownTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Weitere Aktionen">
                    <MoreHorizontal />
                  </Button>
                </DropdownTrigger>
                <DropdownContent>
                  {canEdit && (
                    <DropdownItem onSelect={() => setCopyOpen(true)}>
                      <Copy /> Woche oder Tag kopieren
                    </DropdownItem>
                  )}
                  {canPublish && (
                    <DropdownItem onSelect={() => setUnpublishOpen(true)} disabled={(week.data?.publication.publishedShifts ?? 0) === 0}>
                      <Undo2 /> Veröffentlichung zurückziehen
                    </DropdownItem>
                  )}
                </DropdownContent>
              </DropdownMenu>
            )}
            {canPublish && (
              <Button onClick={() => setPublishOpen(true)} disabled={draftCount === 0}>
                <Send /> Veröffentlichen{draftCount > 0 ? ` (${draftCount})` : ''}
              </Button>
            )}
          </>
        }
      />

      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-md border border-line-strong bg-surface">
            <Button variant="ghost" size="icon" aria-label="Vorherige Woche" onClick={() => setWeek(addDaysTo(weekStart, -7))}>
              <ChevronLeft />
            </Button>
            <span className="min-w-52 px-1 text-center text-sm font-medium tabular-nums" aria-live="polite">
              {fmt.week(weekStart)}
            </span>
            <Button variant="ghost" size="icon" aria-label="Nächste Woche" onClick={() => setWeek(addDaysTo(weekStart, 7))}>
              <ChevronRight />
            </Button>
          </div>
          <Button variant="outline" size="sm" className="h-10" onClick={() => setWeek(mondayOf(todayString()))}>
            Heute
          </Button>
          {managed.length > 1 && (
            <label className="sr-only" htmlFor="schedule-location">Standort</label>
          )}
          {managed.length > 1 && (
            <Select
              id="schedule-location"
              value={locationId ?? ''}
              onChange={(e) => {
                setLocationId(e.target.value)
                const next = new URLSearchParams(params)
                next.set('standort', e.target.value)
                setParams(next, { replace: true })
              }}
              className="w-auto min-w-44"
            >
              {managed.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          )}
          <Badge tone={stateLabel.tone}>{stateLabel.text}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="role-filter">Nach Rolle filtern</label>
          <Select id="role-filter" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="w-auto min-w-40">
            <option value="">Alle Rollen</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
          <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-surface px-3 text-sm">
            <Checkbox
              checked={unassignedOnly}
              onCheckedChange={(v) => {
                const next = new URLSearchParams(params)
                if (v === true) next.set('unbesetzt', '1')
                else next.delete('unbesetzt')
                setParams(next, { replace: true })
              }}
              aria-label="Nur unbesetzte Schichten"
            />
            Nur unbesetzt
          </label>
          {isDesktop && (
            <Tabs value={view} onValueChange={(v) => setView(v as View)}>
              <TabsList>
                <TabsTrigger value="employees">Mitarbeiter</TabsTrigger>
                <TabsTrigger value="roles">Rollen</TabsTrigger>
                <TabsTrigger value="day">Tag</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </div>
      </div>

      {/* Summary + issues */}
      {week.data && (
        <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-line bg-surface px-4 py-3 text-sm shadow-card">
          <span><span className="font-semibold tabular-nums">{fmt.number(week.data.totalPlannedHours)}</span> <span className="text-ink-muted">Std. geplant</span></span>
          <span><span className="font-semibold tabular-nums">{week.data.shifts.length}</span> <span className="text-ink-muted">Schichten</span></span>
          <span className={week.data.unassignedShifts > 0 ? 'font-medium text-warning-700' : 'text-ink-muted'}>
            {plural(week.data.unassignedShifts, 'unbesetzte Schicht', 'unbesetzte Schichten')}
          </span>
          <button
            type="button"
            onClick={() => setIssuesOpen(true)}
            className="ml-auto flex cursor-pointer items-center gap-3 rounded-md px-2 py-1 hover:bg-subtle"
            aria-label={`Prüfergebnis anzeigen: ${counts.Error} Fehler, ${counts.Warning} Hinweise, ${counts.Info} Informationen`}
          >
            <ListChecks className="size-4 text-ink-faint" aria-hidden />
            <span className={cn('flex items-center gap-1', counts.Error > 0 ? 'font-medium text-danger-600' : 'text-ink-faint')}>
              <AlertCircle className="size-4" aria-hidden /> {counts.Error} Fehler
            </span>
            <span className={cn('flex items-center gap-1', counts.Warning > 0 ? 'font-medium text-warning-700' : 'text-ink-faint')}>
              <AlertTriangle className="size-4" aria-hidden /> {counts.Warning} Hinweise
            </span>
            <span className="hidden items-center gap-1 text-ink-faint sm:flex">
              <Info className="size-4" aria-hidden /> {counts.Info}
            </span>
          </button>
        </div>
      )}

      {week.isPending ? (
        <Skeleton className="h-[480px]" />
      ) : week.isError ? (
        <Card><ErrorState error={week.error} onRetry={() => void week.refetch()} /></Card>
      ) : view === 'day' ? (
        <DayAgenda
          week={week.data}
          shifts={shifts}
          day={day}
          onDayChange={setDay}
          severityByShift={severityByShift}
          canEdit={canEdit}
          onOpen={(shift) => setDialog({ shift })}
          onCreate={(preset) => setDialog({ preset })}
        />
      ) : (
        <>
          {week.data.employees.length === 0 && view === 'employees' && (
            <p className="mb-3 text-sm text-ink-muted">Diesem Standort sind noch keine aktiven Mitarbeitenden zugeordnet. Schichten können trotzdem unbesetzt geplant werden.</p>
          )}
          <WeekGrid
            week={week.data}
            mode={view}
            roles={roles}
            shifts={shifts}
            severityByShift={severityByShift}
            canEdit={canEdit}
            highlightedShiftId={highlight}
            onOpen={(shift: Shift) => setDialog({ shift })}
            onCreate={(preset) => setDialog({ preset })}
            onMove={(shift, target) => void move(shift, target)}
          />
          <Legend />
        </>
      )}

      {location && (
        <ShiftDialog
          state={dialog}
          onClose={() => setDialog(null)}
          location={location}
          week={week.data}
          roles={roles}
          canPublish={canPublish}
          issues={issues}
        />
      )}
      {locationId && location && (
        <PublishDialog
          open={publishOpen}
          onOpenChange={setPublishOpen}
          locationId={locationId}
          locationName={location.name}
          weekStart={weekStart}
          draftCount={draftCount}
          onShowIssue={showIssue}
        />
      )}
      {locationId && (
        <CopyDialog
          open={copyOpen}
          onOpenChange={setCopyOpen}
          locationId={locationId}
          weekStart={weekStart}
          day={day}
          onCopied={(targetWeek) => {
            void qc.invalidateQueries({ queryKey: ['week'] })
            if (targetWeek) setWeek(targetWeek)
          }}
        />
      )}
      <IssuesDialog open={issuesOpen} onOpenChange={setIssuesOpen} issues={issues} onShowIssue={showIssue} />
      <ConfirmDialog
        open={unpublishOpen}
        onOpenChange={setUnpublishOpen}
        title="Veröffentlichung zurückziehen?"
        description="Alle noch nicht begonnenen veröffentlichten Schichten dieser Woche werden wieder zu Entwürfen. Die betroffenen Mitarbeitenden werden informiert, dass der Plan überarbeitet wird. Bereits vergangene Schichten bleiben unverändert."
        confirmLabel="Zurückziehen"
        onConfirm={async () => {
          try {
            const r = await api.post<{ revertedShifts: number }>('/schedules/unpublish', { locationId, weekStart })
            toast.success(`${plural(r.revertedShifts, 'Schicht', 'Schichten')} wieder als Entwurf.`)
            await qc.invalidateQueries({ queryKey: ['week'] })
          } catch (e) {
            toast.error(errorMessage(e))
          } finally {
            setUnpublishOpen(false)
          }
        }}
      />
    </>
  )
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-muted" aria-label="Legende">
      <span className="flex items-center gap-1.5"><span className="h-4 w-6 rounded-sm border border-line bg-surface" aria-hidden /> Veröffentlicht</span>
      <span className="flex items-center gap-1.5"><span className="h-4 w-6 rounded-sm border border-dashed border-line-strong bg-surface" aria-hidden /> Entwurf</span>
      <span className="flex items-center gap-1.5"><span className="h-4 w-6 rounded-sm border border-warning-700/40 bg-warning-50" aria-hidden /> Nicht besetzt</span>
      <span className="flex items-center gap-1.5"><AlertCircle className="size-3.5 text-danger-600" aria-hidden /> Fehler (blockiert Veröffentlichung)</span>
      <span className="flex items-center gap-1.5"><AlertTriangle className="size-3.5 text-warning-700" aria-hidden /> Hinweis</span>
      <span className="flex items-center gap-1.5"><span className="h-4 w-6 rounded-sm bg-info-50" aria-hidden /> Urlaub / Abwesenheit</span>
      <span>Schichten per Ziehen verschieben oder zum Bearbeiten anklicken.</span>
    </div>
  )
}

function IssuesDialog({ open, onOpenChange, issues, onShowIssue }: { open: boolean; onOpenChange: (o: boolean) => void; issues: Issue[]; onShowIssue: (i: Issue) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title="Prüfergebnis der Woche" description="Fehler blockieren das Veröffentlichen, Hinweise erfordern eine Bestätigung.">
      {issues.length === 0 ? (
        <EmptyState title="Keine Auffälligkeiten" description="Der Schichtplan dieser Woche ist ohne Fehler und Hinweise." />
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {issues.map((i, idx) => (
            <li key={idx} className="flex items-start gap-2.5 px-3 py-2 text-sm">
              <Badge tone={i.severity === 'Error' ? 'danger' : i.severity === 'Warning' ? 'warning' : 'info'}>
                {i.severity === 'Error' ? 'Fehler' : i.severity === 'Warning' ? 'Hinweis' : 'Info'}
              </Badge>
              <span className="flex-1">
                {i.date && <span className="font-medium">{fmt.dayShort(i.date)}: </span>}
                {i.message}
              </span>
              {i.shiftId && (
                <button type="button" className="shrink-0 cursor-pointer text-xs font-medium text-brand-700 hover:underline" onClick={() => onShowIssue(i)}>
                  Anzeigen
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}

function CopyDialog({ open, onOpenChange, locationId, weekStart, day, onCopied }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  locationId: string
  weekStart: string
  day: string
  onCopied: (targetWeek: string | null) => void
}) {
  const [mode, setMode] = useState<'week' | 'day'>('week')
  const [targetWeek, setTargetWeek] = useState(addDaysTo(weekStart, 7))
  const [targetDay, setTargetDay] = useState(addDaysTo(day, 1))
  const [assignments, setAssignments] = useState(true)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setTargetWeek(addDaysTo(weekStart, 7))
      setTargetDay(addDaysTo(day, 1))
    }
  }, [open, weekStart, day])

  const weeks = Array.from({ length: 6 }, (_, i) => addDaysTo(weekStart, 7 * (i + 1)))
  const submit = async () => {
    setBusy(true)
    try {
      const r =
        mode === 'week'
          ? await api.post<CopyResult>('/schedules/copy-week', { locationId, sourceWeekStart: weekStart, targetWeekStart: targetWeek, includeAssignments: assignments })
          : await api.post<CopyResult>('/schedules/copy-day', { locationId, sourceDate: day, targetDate: targetDay, includeAssignments: assignments })
      toast.success(
        `${plural(r.createdShifts, 'Schicht', 'Schichten')} als Entwurf kopiert.${r.skippedAssignments > 0 ? ` ${plural(r.skippedAssignments, 'Zuweisung', 'Zuweisungen')} übersprungen (nicht mehr aktiv/zugeordnet).` : ''}`,
      )
      onCopied(mode === 'week' ? targetWeek : null)
      onOpenChange(false)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Schichten kopieren"
      description="Kopierte Schichten werden als Entwürfe angelegt und vor dem Veröffentlichen geprüft."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
          <Button onClick={submit} loading={busy}><Copy /> Kopieren</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'week' | 'day')}>
          <TabsList>
            <TabsTrigger value="week"><CalendarRange className="size-4" /> Ganze Woche</TabsTrigger>
            <TabsTrigger value="day">Einzelner Tag</TabsTrigger>
          </TabsList>
        </Tabs>
        {mode === 'week' ? (
          <Field label={`Von ${fmt.week(weekStart)} nach`}>
            {(id) => (
              <Select id={id} value={targetWeek} onChange={(e) => setTargetWeek(e.target.value)}>
                {weeks.map((w) => <option key={w} value={w}>{fmt.week(w)}</option>)}
              </Select>
            )}
          </Field>
        ) : (
          <Field label={`Von ${fmt.dayLong(day)} nach`}>
            {(id) => <input id={id} type="date" value={targetDay} onChange={(e) => setTargetDay(e.target.value)} className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm" />}
          </Field>
        )}
        <div className="flex items-start gap-3">
          <Checkbox id="copy-assign" checked={assignments} onCheckedChange={(v) => setAssignments(v === true)} className="mt-0.5" />
          <Label htmlFor="copy-assign" className="font-normal">
            Zuweisungen übernehmen (sonst werden alle Schichten als „nicht besetzt“ kopiert)
          </Label>
        </div>
      </div>
    </Dialog>
  )
}
