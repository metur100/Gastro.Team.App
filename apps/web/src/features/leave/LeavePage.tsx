import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { leaveRequestSchema as createSchema } from './leaveSchema'
import { z } from 'zod'
import { AlertTriangle, Check, Plane, Plus, X } from 'lucide-react'
import { api } from '@/lib/api'
import { useActiveLocation, usePermissions } from '@/lib/auth'
import { applyServerErrors, useAction } from '@/lib/hooks'
import { fmt, plural } from '@/lib/format'
import { leaveStatusLabel, leaveTypeLabel } from '@/lib/labels'
import { qs } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import { Avatar, Badge, Card, EmptyState, ErrorState, Notice, PageHeader, Skeleton, Spinner } from '@/components/ui/display'
import { Dialog, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay'
import type { LeaveConflicts, LeaveRequest, LeaveStatus, LeaveType, Paged } from '@/types/api'

const STATUS_TONE: Record<LeaveStatus, 'warning' | 'success' | 'danger' | 'neutral'> = {
  Pending: 'warning',
  Approved: 'success',
  Rejected: 'danger',
  Cancelled: 'neutral',
}

export default function LeavePage() {
  const p = usePermissions()
  const manager = p.can('ApproveLeave')
  const [params] = useSearchParams()
  const [tab, setTab] = useState(manager ? 'team' : 'mine')
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <>
      <PageHeader
        title="Urlaubsanträge"
        description={manager ? 'Anträge Ihres Teams prüfen und eigene Abwesenheiten beantragen.' : 'Urlaub und Abwesenheiten beantragen und den Status verfolgen.'}
        actions={
          p.isEmployee && (
            <Button onClick={() => setCreateOpen(true)} disabled={!p.canWrite}>
              <Plus /> Neuer Antrag
            </Button>
          )
        }
      />
      {manager && p.isEmployee ? (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="team">Team</TabsTrigger>
            <TabsTrigger value="mine">Meine Anträge</TabsTrigger>
          </TabsList>
          <TabsContent value="team"><TeamRequests initialStatus={(params.get('status') as LeaveStatus | null) ?? 'Pending'} /></TabsContent>
          <TabsContent value="mine"><MyRequests /></TabsContent>
        </Tabs>
      ) : manager ? (
        <TeamRequests initialStatus={(params.get('status') as LeaveStatus | null) ?? 'Pending'} />
      ) : (
        <MyRequests />
      )}
      <CreateLeaveDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}

function RequestRow({ r, showEmployee, actions }: { r: LeaveRequest; showEmployee: boolean; actions?: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
      {showEmployee && <Avatar name={r.employeeName} />}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {showEmployee && <span>{r.employeeName}</span>}
          <span className={showEmployee ? 'text-ink-muted' : undefined}>{leaveTypeLabel[r.type]}</span>
          <Badge tone={STATUS_TONE[r.status]}>{leaveStatusLabel[r.status]}</Badge>
        </p>
        <p className="mt-0.5 text-sm text-ink-muted">
          {r.startDate === r.endDate ? fmt.date(r.startDate) : `${fmt.date(r.startDate)} – ${fmt.date(r.endDate)}`} · {plural(r.days, 'Tag', 'Tage')}
        </p>
        {r.note && <p className="mt-1 text-sm">„{r.note}“</p>}
        {r.decisionReason && <p className="mt-1 text-sm text-ink-muted">Begründung: {r.decisionReason}</p>}
        {r.decidedByName && r.status !== 'Pending' && (
          <p className="mt-0.5 text-xs text-ink-faint">{leaveStatusLabel[r.status]} von {r.decidedByName}{r.decidedAt ? ` am ${fmt.dateTime(r.decidedAt)}` : ''}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </li>
  )
}

function MyRequests() {
  const p = usePermissions()
  const list = useQuery({ queryKey: ['leave', 'mine'], queryFn: () => api.get<Paged<LeaveRequest>>('/leave-requests?mine=true&pageSize=100') })
  const cancel = useAction({
    fn: (r: LeaveRequest) => api.post(`/leave-requests/${r.id}/cancel`, { version: r.version }),
    success: 'Antrag storniert',
    invalidate: [['leave']],
  })
  if (!p.isEmployee) return <Card><EmptyState title="Kein Mitarbeiterprofil" /></Card>
  if (list.isPending) return <Skeleton className="h-48" />
  if (list.isError) return <Card><ErrorState error={list.error} onRetry={() => void list.refetch()} /></Card>
  return (
    <Card>
      {list.data.items.length === 0 ? (
        <EmptyState icon={<Plane className="size-5" />} title="Noch keine Anträge" description="Beantragen Sie Urlaub oder melden Sie eine Abwesenheit über „Neuer Antrag“." />
      ) : (
        <ul className="divide-y divide-line">
          {list.data.items.map((r) => (
            <RequestRow
              key={r.id}
              r={r}
              showEmployee={false}
              actions={
                r.canCancel && r.status === 'Pending' ? (
                  <Button variant="outline" size="sm" loading={cancel.isPending && cancel.variables?.id === r.id} onClick={() => cancel.mutate(r)}>
                    Stornieren
                  </Button>
                ) : undefined
              }
            />
          ))}
        </ul>
      )}
    </Card>
  )
}

function TeamRequests({ initialStatus }: { initialStatus: LeaveStatus | 'all' }) {
  const { managed } = useActiveLocation()
  const [status, setStatus] = useState<LeaveStatus | 'all'>(initialStatus)
  const [locationId, setLocationId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [approve, setApprove] = useState<LeaveRequest | null>(null)
  const [reject, setReject] = useState<LeaveRequest | null>(null)
  const query = qs({ status: status === 'all' ? null : status, locationId, from, to, page, pageSize: 20 })
  const list = useQuery({ queryKey: ['leave', 'team', query], queryFn: () => api.get<Paged<LeaveRequest>>(`/leave-requests${query}`) })
  const cancel = useAction({
    fn: (r: LeaveRequest) => api.post(`/leave-requests/${r.id}/cancel`, { version: r.version }),
    success: 'Abwesenheit storniert',
    invalidate: [['leave'], ['week'], ['dashboard']],
  })

  return (
    <>
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
        <Field label="Status" className="lg:w-44">
          {(id) => (
            <Select id={id} value={status} onChange={(e) => { setStatus(e.target.value as LeaveStatus | 'all'); setPage(1) }}>
              <option value="all">Alle</option>
              {(Object.keys(leaveStatusLabel) as LeaveStatus[]).map((s) => <option key={s} value={s}>{leaveStatusLabel[s]}</option>)}
            </Select>
          )}
        </Field>
        {managed.length > 1 && (
          <Field label="Standort" className="lg:w-56">
            {(id) => (
              <Select id={id} value={locationId} onChange={(e) => { setLocationId(e.target.value); setPage(1) }}>
                <option value="">Alle Standorte</option>
                {managed.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            )}
          </Field>
        )}
        <Field label="Von" className="lg:w-44">{(id) => <Input id={id} type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} />}</Field>
        <Field label="Bis" className="lg:w-44">{(id) => <Input id={id} type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} />}</Field>
      </div>
      <Card>
        {list.isPending ? (
          <div className="space-y-3 p-5">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <EmptyState icon={<Plane className="size-5" />} title={status === 'Pending' ? 'Keine offenen Anträge' : 'Keine Anträge gefunden'} description={status === 'Pending' ? 'Alle Anträge sind bearbeitet.' : 'Passen Sie die Filter an.'} />
        ) : (
          <ul className="divide-y divide-line">
            {list.data.items.map((r) => (
              <RequestRow
                key={r.id}
                r={r}
                showEmployee
                actions={
                  <>
                    {r.canDecide && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setReject(r)}><X /> Ablehnen</Button>
                        <Button size="sm" onClick={() => setApprove(r)}><Check /> Genehmigen</Button>
                      </>
                    )}
                    {r.canCancel && r.status === 'Approved' && (
                      <Button size="sm" variant="ghost" loading={cancel.isPending && cancel.variables?.id === r.id} onClick={() => cancel.mutate(r)}>
                        Stornieren
                      </Button>
                    )}
                  </>
                }
              />
            ))}
          </ul>
        )}
        {list.data && list.data.totalCount > list.data.pageSize && (
          <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm">
            <span className="text-ink-muted">{plural(list.data.totalCount, 'Antrag', 'Anträge')}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Zurück</Button>
              <Button size="sm" variant="outline" disabled={page * list.data.pageSize >= list.data.totalCount} onClick={() => setPage(page + 1)}>Weiter</Button>
            </div>
          </div>
        )}
      </Card>
      <ApproveDialog request={approve} onClose={() => setApprove(null)} />
      <RejectDialog request={reject} onClose={() => setReject(null)} />
    </>
  )
}

function ApproveDialog({ request, onClose }: { request: LeaveRequest | null; onClose: () => void }) {
  const conflicts = useQuery({
    queryKey: ['leave-conflicts', request?.id],
    queryFn: () => api.get<LeaveConflicts>(`/leave-requests/${request!.id}/conflicts`),
    enabled: Boolean(request),
    gcTime: 0,
  })
  const approve = useAction({
    fn: () => api.post(`/leave-requests/${request!.id}/approve`, { version: request!.version, reason: null }),
    success: 'Antrag genehmigt',
    invalidate: [['leave'], ['week'], ['dashboard']],
    onSuccess: onClose,
  })
  const c = conflicts.data
  return (
    <Dialog
      open={Boolean(request)}
      onOpenChange={(o) => !o && onClose()}
      title="Antrag genehmigen"
      description={request ? `${request.employeeName} · ${leaveTypeLabel[request.type]} · ${fmt.date(request.startDate)} – ${fmt.date(request.endDate)}` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button onClick={() => approve.mutate()} loading={approve.isPending} disabled={conflicts.isPending}>Genehmigen</Button>
        </>
      }
    >
      {conflicts.isPending ? (
        <Spinner label="Konflikte werden geprüft …" />
      ) : conflicts.isError ? (
        <ErrorState error={conflicts.error} onRetry={() => void conflicts.refetch()} />
      ) : c && c.shifts.length === 0 && c.overlappingRequests.length === 0 ? (
        <Notice tone="success">Keine Konflikte: Im Zeitraum sind keine Schichten geplant und niemand sonst am Standort abwesend.</Notice>
      ) : (
        c && (
          <div className="space-y-4 text-sm">
            {c.shifts.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-2 font-medium text-warning-700">
                  <AlertTriangle className="size-4" aria-hidden /> {plural(c.shifts.length, 'geplante Schicht', 'geplante Schichten')} im Zeitraum
                </p>
                <ul className="divide-y divide-line rounded-md border border-line">
                  {c.shifts.map((s) => (
                    <li key={s.id} className="flex justify-between gap-2 px-3 py-2">
                      <span>{fmt.dayShort(s.date)} · {fmt.timeRange(s.startTime, s.endTime)}</span>
                      <span className="text-ink-muted">{s.locationName} · {s.status === 'Published' ? 'veröffentlicht' : 'Entwurf'}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-ink-muted">Nach der Genehmigung werden diese Schichten im Schichtplan als Fehler markiert. Bitte besetzen Sie sie anschließend um.</p>
              </div>
            )}
            {c.overlappingRequests.length > 0 && (
              <div>
                <p className="mb-2 font-medium">Ebenfalls abwesend</p>
                <ul className="space-y-1 text-ink-muted">
                  {c.overlappingRequests.map((o) => (
                    <li key={o.id}>{o.employeeName}: {fmt.date(o.startDate)} – {fmt.date(o.endDate)}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )
      )}
    </Dialog>
  )
}

function RejectDialog({ request, onClose }: { request: LeaveRequest | null; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | undefined>()
  const reject = useAction({
    fn: () => api.post(`/leave-requests/${request!.id}/reject`, { version: request!.version, reason }),
    success: 'Antrag abgelehnt',
    invalidate: [['leave'], ['dashboard']],
    onSuccess: () => {
      setReason('')
      onClose()
    },
  })
  return (
    <Dialog
      open={Boolean(request)}
      onOpenChange={(o) => !o && onClose()}
      title="Antrag ablehnen"
      description={request ? `${request.employeeName} · ${fmt.date(request.startDate)} – ${fmt.date(request.endDate)}` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button
            variant="danger"
            loading={reject.isPending}
            onClick={() => {
              if (!reason.trim()) return setError('Bitte geben Sie einen Grund an.')
              setError(undefined)
              reject.mutate()
            }}
          >
            Ablehnen
          </Button>
        </>
      }
    >
      <Field label="Begründung" required error={error} hint="Die Begründung ist für die antragstellende Person sichtbar.">
        {(id, d, inv) => <Textarea id={id} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} aria-describedby={d} aria-invalid={inv} />}
      </Field>
    </Dialog>
  )
}



function CreateLeaveDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { register, handleSubmit, watch, reset, setError, formState } = useForm<z.infer<typeof createSchema>>({
    resolver: zodResolver(createSchema),
    defaultValues: { type: 'Vacation', startDate: '', endDate: '', note: '' },
  })
  const create = useAction({
    fn: (v: z.infer<typeof createSchema>) => api.post<LeaveRequest>('/leave-requests', { ...v, note: v.note.trim() || null }),
    success: 'Antrag eingereicht – Ihre Leitung wurde benachrichtigt',
    invalidate: [['leave'], ['dashboard']],
    onSuccess: () => {
      reset()
      onOpenChange(false)
    },
    onError: (e) => applyServerErrors(e, setError),
  })
  const type = watch('type')
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Neuer Antrag"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
          <Button onClick={handleSubmit((v) => create.mutate(v))} loading={create.isPending}>Antrag einreichen</Button>
        </>
      }
    >
      <form className="space-y-4" noValidate onSubmit={handleSubmit((v) => create.mutate(v))}>
        <Field label="Art" required>
          {(id) => (
            <Select id={id} {...register('type')}>
              {(Object.keys(leaveTypeLabel) as LeaveType[]).map((t) => <option key={t} value={t}>{leaveTypeLabel[t]}</option>)}
            </Select>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Von" required error={formState.errors.startDate?.message}>
            {(id, d, inv) => <Input id={id} type="date" aria-describedby={d} aria-invalid={inv} {...register('startDate')} />}
          </Field>
          <Field label="Bis" required error={formState.errors.endDate?.message}>
            {(id, d, inv) => <Input id={id} type="date" aria-describedby={d} aria-invalid={inv} {...register('endDate')} />}
          </Field>
        </div>
        <Field
          label="Notiz (optional)"
          error={formState.errors.note?.message}
          hint={type === 'Sick' ? 'Bitte keine Diagnosen oder Gesundheitsdaten angeben. Die Notiz sehen nur Sie und die Leitung.' : 'Sichtbar für Sie und Ihre Leitung.'}
        >
          {(id, d, inv) => <Textarea id={id} rows={2} aria-describedby={d} aria-invalid={inv} {...register('note')} />}
        </Field>
      </form>
    </Dialog>
  )
}
