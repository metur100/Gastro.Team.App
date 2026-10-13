import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, CalendarClock, Download, Mail, Pencil, Phone, ShieldX, UserCheck, UserX } from 'lucide-react'
import { ApiError, api, errorMessage } from '@/lib/api'
import { useActiveLocation, usePermissions } from '@/lib/auth'
import { useAction } from '@/lib/hooks'
import { addDaysTo, fmt, todayString } from '@/lib/format'
import { employeeStatusLabel, leaveStatusLabel, leaveTypeLabel } from '@/lib/labels'
import { Button } from '@/components/ui/button'
import { Avatar, Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/display'
import { ConfirmDialog } from '@/components/ui/overlay'
import type { Employee, InvitationCreated, LeaveRequest, Paged, Shift } from '@/types/api'
import { DeactivateDialog, EmployeeFormDialog, InvitationResultDialog } from './EmployeeDialogs'
import { STATUS_TONE } from './EmployeesPage'

export default function EmployeeDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const p = usePermissions()
  const { locations } = useActiveLocation()
  const [editOpen, setEditOpen] = useState(false)
  const [deactivating, setDeactivating] = useState(false)
  const [anonymizing, setAnonymizing] = useState(false)
  const [invitation, setInvitation] = useState<InvitationCreated | null>(null)

  const employee = useQuery({ queryKey: ['employee', id], queryFn: () => api.get<Employee>(`/employees/${id}`), retry: false })
  const from = todayString()
  const to = addDaysTo(from, 28)
  const shifts = useQuery({
    queryKey: ['employee', id, 'shifts'],
    queryFn: () => api.get<Shift[]>(`/shifts?employeeId=${id}&from=${from}&to=${to}`),
    enabled: p.isManager && employee.isSuccess,
  })
  const leave = useQuery({
    queryKey: ['employee', id, 'leave'],
    queryFn: () => api.get<Paged<LeaveRequest>>(`/leave-requests?employeeId=${id}&pageSize=10`),
    enabled: p.isManager && employee.isSuccess,
  })
  const invite = useAction({ fn: () => api.post<InvitationCreated>(`/employees/${id}/invite`), invalidate: [['employee', id], ['employees']], onSuccess: setInvitation })
  const reactivate = useAction({ fn: () => api.post(`/employees/${id}/reactivate`), success: 'Mitarbeiter/in reaktiviert', invalidate: [['employee', id], ['employees']] })
  const anonymize = useAction({
    fn: () => api.post(`/employees/${id}/anonymize`),
    success: 'Personenbezogene Daten wurden entfernt',
    invalidate: [['employee', id], ['employees']],
    onSuccess: () => setAnonymizing(false),
  })

  const exportData = async () => {
    try {
      const data = await api.get<unknown>(`/employees/${id}/export`)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `mitarbeiterdaten-${id}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  if (employee.isPending) return <Skeleton className="h-96" />
  if (employee.isError)
    return employee.error instanceof ApiError && employee.error.status === 404 ? (
      <Card>
        <EmptyState title="Mitarbeiter/in nicht gefunden" description="Der Eintrag existiert nicht oder liegt außerhalb Ihres Zuständigkeitsbereichs." action={<Button asChild variant="outline"><Link to="/mitarbeiter">Zur Übersicht</Link></Button>} />
      </Card>
    ) : (
      <Card><ErrorState error={employee.error} onRetry={() => void employee.refetch()} /></Card>
    )

  const e = employee.data
  const canManage = p.can('ManageEmployees') && p.canWrite && e.status !== 'Archived'
  return (
    <>
      <Button variant="ghost" size="sm" className="mb-3 -ml-2" onClick={() => navigate('/mitarbeiter')}>
        <ArrowLeft /> Alle Mitarbeiter
      </Button>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Avatar name={e.fullName} color={e.jobRoleColor} className="size-11 text-sm" />
            <span>
              {e.fullName}
              <span className="mt-1 flex flex-wrap items-center gap-2 text-sm font-normal text-ink-muted">
                {e.jobRoleName ?? 'Keine Rolle'} <Badge tone={STATUS_TONE[e.status]}>{employeeStatusLabel[e.status]}</Badge>
                {e.hasAccount ? <Badge tone="brand">App-Zugang</Badge> : <Badge>Ohne App-Zugang</Badge>}
              </span>
            </span>
          </span>
        }
        actions={
          canManage && (
            <>
              {!e.hasAccount && e.email && (e.status === 'Active' || e.status === 'Invited') && (
                <Button variant="outline" onClick={() => invite.mutate()} loading={invite.isPending}>
                  <Mail /> {e.status === 'Invited' ? 'Einladung erneut senden' : 'Zur App einladen'}
                </Button>
              )}
              {(e.status === 'Active' || e.status === 'Invited') && (
                <Button variant="outline" onClick={() => setDeactivating(true)}><UserX /> Deaktivieren</Button>
              )}
              {e.status === 'Inactive' && (
                <Button variant="outline" onClick={() => reactivate.mutate()} loading={reactivate.isPending}><UserCheck /> Reaktivieren</Button>
              )}
              <Button onClick={() => setEditOpen(true)}><Pencil /> Bearbeiten</Button>
            </>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader title="Stammdaten" />
          <CardBody>
            <dl className="grid grid-cols-[10rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
              <dt className="text-ink-muted">E-Mail</dt>
              <dd className="truncate">{e.email ? <a href={`mailto:${e.email}`} className="inline-flex items-center gap-1 hover:underline"><Mail className="size-3.5" aria-hidden />{e.email}</a> : '–'}</dd>
              <dt className="text-ink-muted">Telefon</dt>
              <dd>{e.phone ? <a href={`tel:${e.phone}`} className="inline-flex items-center gap-1 hover:underline"><Phone className="size-3.5" aria-hidden />{e.phone}</a> : '–'}</dd>
              <dt className="text-ink-muted">Standorte</dt>
              <dd>{e.locationIds.map((l) => locations.find((x) => x.id === l)?.name ?? 'Weiterer Standort').join(', ') || '–'}</dd>
              <dt className="text-ink-muted">Vertragsstunden</dt>
              <dd>{e.contractHoursPerWeek != null ? `${fmt.hours(e.contractHoursPerWeek)} pro Woche` : 'Keine Angabe'}</dd>
              <dt className="text-ink-muted">Eintritt</dt>
              <dd>{e.employmentStartDate ? fmt.date(e.employmentStartDate) : '–'}</dd>
              <dt className="text-ink-muted">Austritt</dt>
              <dd>{e.employmentEndDate ? fmt.date(e.employmentEndDate) : '–'}</dd>
              {e.invitationExpiresAt && (
                <>
                  <dt className="text-ink-muted">Einladung</dt>
                  <dd>gültig bis {fmt.dateTime(e.invitationExpiresAt)}</dd>
                </>
              )}
              {e.notes && (
                <>
                  <dt className="text-ink-muted">Interne Notiz</dt>
                  <dd className="whitespace-pre-line">{e.notes}</dd>
                </>
              )}
              <dt className="text-ink-muted">Angelegt</dt>
              <dd>{fmt.dateTime(e.createdAt)}</dd>
            </dl>
            {p.isOwner && (
              <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-4">
                <Button variant="outline" size="sm" onClick={exportData}><Download /> Daten exportieren (JSON)</Button>
                {e.status === 'Inactive' && (
                  <Button variant="outline" size="sm" className="text-danger-600" onClick={() => setAnonymizing(true)}><ShieldX /> Personendaten löschen</Button>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Nächste Schichten" description="Die kommenden 4 Wochen" action={<Button asChild variant="ghost" size="sm"><Link to="/schichtplan">Schichtplan</Link></Button>} />
            {shifts.isPending ? (
              <CardBody><Skeleton className="h-24" /></CardBody>
            ) : shifts.isError ? (
              <ErrorState error={shifts.error} onRetry={() => void shifts.refetch()} />
            ) : shifts.data.length === 0 ? (
              <EmptyState icon={<CalendarClock className="size-5" />} title="Keine Schichten geplant" className="py-8" />
            ) : (
              <ul className="divide-y divide-line">
                {shifts.data.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-sm">
                    <span className="w-28 font-medium">{fmt.dayShort(s.date)}</span>
                    <span className="tabular-nums">{fmt.timeRange(s.startTime, s.endTime)}</span>
                    <span className="flex-1 text-ink-muted">{s.jobRoleName} · {s.locationName}</span>
                    {s.status === 'Draft' && <Badge>Entwurf</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Abwesenheiten" />
            {leave.isPending ? (
              <CardBody><Skeleton className="h-16" /></CardBody>
            ) : leave.isError ? (
              <ErrorState error={leave.error} onRetry={() => void leave.refetch()} />
            ) : leave.data.items.length === 0 ? (
              <EmptyState title="Keine Anträge" className="py-8" />
            ) : (
              <ul className="divide-y divide-line">
                {leave.data.items.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-sm">
                    <span className="flex-1">{leaveTypeLabel[l.type]} · {fmt.date(l.startDate)} – {fmt.date(l.endDate)}</span>
                    <Badge tone={l.status === 'Approved' ? 'success' : l.status === 'Pending' ? 'warning' : 'neutral'}>{leaveStatusLabel[l.status]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <EmployeeFormDialog open={editOpen} onOpenChange={setEditOpen} employee={e} />
      <DeactivateDialog employee={deactivating ? e : null} onClose={() => setDeactivating(false)} />
      <InvitationResultDialog result={invitation} onClose={() => setInvitation(null)} />
      <ConfirmDialog
        open={anonymizing}
        onOpenChange={setAnonymizing}
        title="Personendaten endgültig löschen?"
        description="Name, Kontaktdaten und Notizen werden unwiderruflich entfernt. Geplante Stunden und Schichthistorie bleiben anonymisiert erhalten. Diese Aktion kann nicht rückgängig gemacht werden."
        confirmLabel="Endgültig löschen"
        destructive
        loading={anonymize.isPending}
        onConfirm={() => anonymize.mutate()}
      />
    </>
  )
}
