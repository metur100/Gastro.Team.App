import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeftRight, ArrowRight } from 'lucide-react'
import { api } from '@/lib/api'
import { usePermissions } from '@/lib/auth'
import { useAction } from '@/lib/hooks'
import { fmt } from '@/lib/format'
import { swapStatusLabel } from '@/lib/labels'
import { Button } from '@/components/ui/button'
import { Field, Textarea } from '@/components/ui/form'
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/display'
import { Dialog, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay'
import { Checkbox, Label } from '@/components/ui/form'
import type { Swap, SwapStatus } from '@/types/api'

const TONE: Record<SwapStatus, 'warning' | 'info' | 'success' | 'danger' | 'neutral'> = {
  Pending: 'warning',
  AwaitingApproval: 'info',
  Completed: 'success',
  Declined: 'danger',
  Rejected: 'danger',
  Cancelled: 'neutral',
  Invalidated: 'neutral',
}

export default function SwapsPage() {
  const p = usePermissions()
  const manager = p.can('ManageSwaps')
  const [tab, setTab] = useState(manager ? 'manage' : 'mine')

  if (!p.hasFeature('ShiftSwaps'))
    return (
      <>
        <PageHeader title="Schichttausch" />
        <Card><EmptyState title="Nicht im Tarif enthalten" description="Schichttausch ist ab dem Tarif Team verfügbar." /></Card>
      </>
    )

  return (
    <>
      <PageHeader
        title="Schichttausch"
        description="Mitarbeitende bieten Schichten an, Kolleginnen und Kollegen übernehmen – die Leitung behält den Überblick."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          {manager && <TabsTrigger value="manage">Freigaben</TabsTrigger>}
          {p.isEmployee && <TabsTrigger value="mine">Meine Anfragen</TabsTrigger>}
          {p.isEmployee && <TabsTrigger value="open">Offene Angebote</TabsTrigger>}
        </TabsList>
        {manager && <TabsContent value="manage"><SwapList scope="manage" /></TabsContent>}
        {p.isEmployee && <TabsContent value="mine"><SwapList scope="mine" /></TabsContent>}
        {p.isEmployee && <TabsContent value="open"><SwapList scope="open" /></TabsContent>}
      </Tabs>
    </>
  )
}

function SwapList({ scope }: { scope: 'mine' | 'open' | 'manage' }) {
  const [openOnly, setOpenOnly] = useState(scope === 'manage')
  const [rejecting, setRejecting] = useState<Swap | null>(null)
  const list = useQuery({
    queryKey: ['swaps', scope, openOnly],
    queryFn: () => api.get<Swap[]>(`/shift-swaps?scope=${scope}&openOnly=${openOnly}`),
  })
  const invalidate = [['swaps'], ['week'], ['my-shifts'], ['dashboard']]
  const act = useAction({
    fn: ({ swap, action }: { swap: Swap; action: 'accept' | 'decline' | 'approve' | 'cancel' }) =>
      api.post<Swap>(`/shift-swaps/${swap.id}/${action}`, { version: swap.version, reason: null }),
    success: (r: Swap) =>
      r.status === 'Completed' ? 'Schichttausch abgeschlossen' : r.status === 'AwaitingApproval' ? 'Angenommen – wartet auf Freigabe der Leitung' : 'Anfrage aktualisiert',
    invalidate,
  })

  return (
    <>
      {scope !== 'open' && (
        <div className="mb-3 flex items-center gap-2">
          <Checkbox id={`open-only-${scope}`} checked={openOnly} onCheckedChange={(v) => setOpenOnly(v === true)} />
          <Label htmlFor={`open-only-${scope}`} className="font-normal">Nur offene Anfragen</Label>
        </div>
      )}
      {list.isPending ? (
        <div className="space-y-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : list.isError ? (
        <Card><ErrorState error={list.error} onRetry={() => void list.refetch()} /></Card>
      ) : list.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ArrowLeftRight className="size-5" />}
            title={scope === 'open' ? 'Keine offenen Angebote' : scope === 'manage' ? 'Keine Tauschanfragen' : 'Keine Tauschanfragen'}
            description={
              scope === 'mine'
                ? 'Unter „Meine Schichten“ können Sie eine Schicht zum Tausch anbieten.'
                : scope === 'open'
                  ? 'Wenn Kolleginnen oder Kollegen eine Schicht abgeben möchten, erscheint sie hier.'
                  : 'Aktuell wartet keine Anfrage auf Ihre Freigabe.'
            }
          />
        </Card>
      ) : (
        <ul className="space-y-3">
          {list.data.map((s) => (
            <li key={s.id}>
              <Card className="p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{fmt.dayLong(s.shift.date)}</span>
                      <span className="text-sm tabular-nums">{fmt.timeRange(s.shift.startTime, s.shift.endTime)} Uhr</span>
                      <Badge tone={TONE[s.status]}>{swapStatusLabel[s.status]}</Badge>
                    </div>
                    <p className="mt-0.5 text-sm text-ink-muted">
                      {s.shift.jobRoleName}
                      {s.shift.locationName ? ` · ${s.shift.locationName}` : ''}
                    </p>
                    <p className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
                      <span className="font-medium">{s.requesterName}</span>
                      <ArrowRight className="size-3.5 text-ink-faint" aria-label="an" />
                      <span className={s.acceptedByName || s.targetName ? 'font-medium' : 'text-ink-muted'}>
                        {s.acceptedByName ?? s.targetName ?? 'Offenes Angebot an alle'}
                      </span>
                    </p>
                    {s.message && <p className="mt-1 text-sm text-ink-muted">„{s.message}“</p>}
                    {s.decisionReason && <p className="mt-1 text-sm text-ink-muted">Begründung: {s.decisionReason}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {s.canDecline && <Button size="sm" variant="outline" onClick={() => act.mutate({ swap: s, action: 'decline' })}>Ablehnen</Button>}
                    {s.canAccept && <Button size="sm" onClick={() => act.mutate({ swap: s, action: 'accept' })} loading={act.isPending && act.variables?.swap.id === s.id}>Übernehmen</Button>}
                    {s.canCancel && <Button size="sm" variant="ghost" onClick={() => act.mutate({ swap: s, action: 'cancel' })}>Zurückziehen</Button>}
                    {s.canReject && <Button size="sm" variant="outline" onClick={() => setRejecting(s)}>Ablehnen</Button>}
                    {s.canApprove && <Button size="sm" onClick={() => act.mutate({ swap: s, action: 'approve' })} loading={act.isPending && act.variables?.swap.id === s.id}>Freigeben</Button>}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <RejectSwapDialog swap={rejecting} onClose={() => setRejecting(null)} />
    </>
  )
}

function RejectSwapDialog({ swap, onClose }: { swap: Swap | null; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const reject = useAction({
    fn: () => api.post(`/shift-swaps/${swap!.id}/reject`, { version: swap!.version, reason: reason.trim() || null }),
    success: 'Schichttausch abgelehnt',
    invalidate: [['swaps'], ['dashboard']],
    onSuccess: () => {
      setReason('')
      onClose()
    },
  })
  return (
    <Dialog
      open={Boolean(swap)}
      onOpenChange={(o) => !o && onClose()}
      title="Schichttausch ablehnen"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button variant="danger" onClick={() => reject.mutate()} loading={reject.isPending}>Ablehnen</Button>
        </>
      }
    >
      <Field label="Begründung (optional)" hint="Wird den Beteiligten angezeigt.">
        {(id) => <Textarea id={id} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </Dialog>
  )
}
