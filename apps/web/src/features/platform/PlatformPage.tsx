import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Building2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useAction } from '@/lib/hooks'
import { fmt } from '@/lib/format'
import { subscriptionStatusLabel } from '@/lib/labels'
import { Button } from '@/components/ui/button'
import { Field, Textarea } from '@/components/ui/form'
import { Badge, Card, EmptyState, ErrorState, Notice, PageHeader, Skeleton } from '@/components/ui/display'
import { Dialog } from '@/components/ui/overlay'
import type { TenantAdmin } from '@/types/api'

export default function PlatformPage() {
  const { me } = useAuth()
  const tenants = useQuery({ queryKey: ['platform', 'tenants'], queryFn: () => api.get<TenantAdmin[]>('/platform/tenants'), enabled: Boolean(me?.isPlatformAdmin) })
  const [suspending, setSuspending] = useState<TenantAdmin | null>(null)
  const reactivate = useAction({ fn: (id: string) => api.post(`/platform/tenants/${id}/reactivate`), success: 'Betrieb reaktiviert', invalidate: [['platform']] })

  if (!me?.isPlatformAdmin)
    return (
      <>
        <PageHeader title="Plattform" />
        <Card><EmptyState title="Kein Zugriff" description="Dieser Bereich ist der Plattformverwaltung vorbehalten." /></Card>
      </>
    )

  return (
    <>
      <PageHeader title="Plattform" description="Betriebe und Abonnements. Personenbezogene Daten von Mitarbeitenden werden hier bewusst nicht angezeigt." />
      <Card className="overflow-x-auto">
        {tenants.isPending ? (
          <div className="p-5"><Skeleton className="h-48" /></div>
        ) : tenants.isError ? (
          <ErrorState error={tenants.error} onRetry={() => void tenants.refetch()} />
        ) : tenants.data.length === 0 ? (
          <EmptyState icon={<Building2 className="size-5" />} title="Noch keine Betriebe" />
        ) : (
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-line text-left text-xs text-ink-muted">
              <tr>
                <th className="px-5 py-3">Betrieb</th>
                <th className="px-3 py-3">Tarif</th>
                <th className="px-3 py-3 text-right">Standorte</th>
                <th className="px-3 py-3 text-right">Aktive MA</th>
                <th className="px-3 py-3">Angelegt</th>
                <th className="px-3 py-3"><span className="sr-only">Aktionen</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {tenants.data.map((t) => (
                <tr key={t.id}>
                  <td className="px-5 py-3">
                    <span className="font-medium">{t.name}</span>{' '}
                    {t.status === 'Suspended' && <Badge tone="danger">Gesperrt</Badge>}
                    {t.suspensionReason && <span className="block text-xs text-ink-muted">{t.suspensionReason}</span>}
                  </td>
                  <td className="px-3 py-3">{t.planCode} · {subscriptionStatusLabel[t.subscriptionStatus]}{t.trialEndsAt ? ` bis ${fmt.date(t.trialEndsAt.slice(0, 10))}` : ''}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{t.locations}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{t.activeEmployees}</td>
                  <td className="px-3 py-3">{fmt.date(t.createdAt.slice(0, 10))}</td>
                  <td className="px-3 py-3 text-right">
                    {t.status === 'Suspended' ? (
                      <Button size="sm" variant="outline" onClick={() => reactivate.mutate(t.id)}>Reaktivieren</Button>
                    ) : (
                      <Button size="sm" variant="outline" className="text-danger-600" onClick={() => setSuspending(t)}>Sperren</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <SuspendDialog tenant={suspending} onClose={() => setSuspending(null)} />
    </>
  )
}

function SuspendDialog({ tenant, onClose }: { tenant: TenantAdmin | null; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | undefined>()
  const suspend = useAction({
    fn: () => api.post(`/platform/tenants/${tenant!.id}/suspend`, { reason }),
    success: 'Betrieb gesperrt',
    invalidate: [['platform']],
    onSuccess: () => { setReason(''); onClose() },
  })
  return (
    <Dialog
      open={Boolean(tenant)}
      onOpenChange={(o) => !o && onClose()}
      title={`${tenant?.name ?? ''} sperren`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button variant="danger" loading={suspend.isPending} onClick={() => (reason.trim() ? suspend.mutate() : setError('Bitte geben Sie einen Grund an.'))}>Sperren</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Notice tone="warning">Gesperrte Betriebe können Daten lesen, aber nichts mehr ändern.</Notice>
        <Field label="Grund" required error={error}>{(id, d, inv) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby={d} aria-invalid={inv} />}</Field>
      </div>
    </Dialog>
  )
}
