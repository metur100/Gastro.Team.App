import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, MoreHorizontal, Search, UserPlus, Users } from 'lucide-react'
import { api } from '@/lib/api'
import { useActiveLocation, usePermissions } from '@/lib/auth'
import { useAction, useJobRoles } from '@/lib/hooks'
import { fmt, plural } from '@/lib/format'
import { employeeStatusLabel, employeeStatusTone as STATUS_TONE } from '@/lib/labels'
import { qs } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/form'
import { Avatar, Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/display'
import { DropdownContent, DropdownItem, DropdownMenu, DropdownTrigger } from '@/components/ui/overlay'
import type { Employee, EmployeeStatus, InvitationCreated, Paged } from '@/types/api'
import { DeactivateDialog, EmployeeFormDialog, InvitationResultDialog } from './EmployeeDialogs'

function useDebounced<T>(value: T, delay = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}

type Sort = 'name' | 'role' | 'status'

export default function EmployeesPage() {
  const p = usePermissions()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { managed } = useActiveLocation()
  const { data: roles = [] } = useJobRoles()
  const [search, setSearch] = useState(params.get('suche') ?? '')
  const debounced = useDebounced(search)
  const status = (params.get('status') as EmployeeStatus | null) ?? ''
  const locationId = params.get('standort') ?? ''
  const jobRoleId = params.get('rolle') ?? ''
  const sort = (params.get('sortierung') as Sort | null) ?? 'name'
  const desc = params.get('absteigend') === '1'
  const page = Number(params.get('seite') ?? '1')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Employee | undefined>()
  const [deactivating, setDeactivating] = useState<Employee | null>(null)
  const [invitation, setInvitation] = useState<InvitationCreated | null>(null)

  const setParam = (key: string, value: string | null, resetPage = true) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (resetPage) next.delete('seite')
    setParams(next, { replace: true })
  }
  useEffect(() => {
    if ((params.get('suche') ?? '') !== debounced) setParam('suche', debounced || null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  const query = qs({ search: debounced, status, locationId, jobRoleId, sort, desc, page, pageSize: 25 })
  const list = useQuery({
    queryKey: ['employees', 'list', query],
    queryFn: () => api.get<Paged<Employee>>(`/employees${query}`),
    placeholderData: keepPreviousData,
    enabled: p.isManager,
  })
  const invite = useAction({
    fn: (e: Employee) => api.post<InvitationCreated>(`/employees/${e.id}/invite`),
    invalidate: [['employees']],
    onSuccess: (r) => setInvitation(r),
  })
  const reactivate = useAction({
    fn: (e: Employee) => api.post<Employee>(`/employees/${e.id}/reactivate`),
    success: 'Mitarbeiter/in reaktiviert',
    invalidate: [['employees']],
  })

  if (!p.isManager) return <ErrorState error={new Error('Kein Zugriff')} />
  const canManage = p.can('ManageEmployees') && p.canWrite

  const sortButton = (key: Sort, label: string) => (
    <button
      type="button"
      className="inline-flex cursor-pointer items-center gap-1 font-medium hover:text-ink"
      onClick={() => {
        const next = new URLSearchParams(params)
        next.set('sortierung', key)
        if (sort === key && !desc) next.set('absteigend', '1')
        else next.delete('absteigend')
        setParams(next, { replace: true })
      }}
      aria-label={`Nach ${label} sortieren`}
    >
      {label}
      {sort === key && (desc ? <ArrowDown className="size-3.5" aria-label="absteigend" /> : <ArrowUp className="size-3.5" aria-label="aufsteigend" />)}
    </button>
  )

  const actions = (e: Employee) => (
    <DropdownMenu>
      <DropdownTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Aktionen für ${e.fullName}`} onClick={(ev) => ev.stopPropagation()}>
          <MoreHorizontal />
        </Button>
      </DropdownTrigger>
      <DropdownContent>
        <DropdownItem onSelect={() => navigate(`/mitarbeiter/${e.id}`)}>Details ansehen</DropdownItem>
        {canManage && <DropdownItem onSelect={() => { setEditing(e); setFormOpen(true) }}>Bearbeiten</DropdownItem>}
        {canManage && !e.hasAccount && e.email && (e.status === 'Active' || e.status === 'Invited') && (
          <DropdownItem onSelect={() => invite.mutate(e)}>{e.status === 'Invited' ? 'Einladung erneut senden' : 'Zur App einladen'}</DropdownItem>
        )}
        {canManage && (e.status === 'Active' || e.status === 'Invited') && <DropdownItem destructive onSelect={() => setDeactivating(e)}>Deaktivieren</DropdownItem>}
        {canManage && e.status === 'Inactive' && <DropdownItem onSelect={() => reactivate.mutate(e)}>Reaktivieren</DropdownItem>}
      </DropdownContent>
    </DropdownMenu>
  )

  const data = list.data
  return (
    <>
      <PageHeader
        title="Mitarbeiter"
        description={data ? plural(data.totalCount, 'Person', 'Personen') : undefined}
        actions={
          canManage && (
            <Button onClick={() => { setEditing(undefined); setFormOpen(true) }}>
              <UserPlus /> Mitarbeiter/in anlegen
            </Button>
          )
        }
      />

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_repeat(3,12rem)]">
        <label className="relative">
          <span className="sr-only">Suchen</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name oder E-Mail suchen" className="pl-9" type="search" />
        </label>
        <Select aria-label="Standort" value={locationId} onChange={(e) => setParam('standort', e.target.value || null)}>
          <option value="">Alle Standorte</option>
          {managed.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
        <Select aria-label="Status" value={status} onChange={(e) => setParam('status', e.target.value || null)}>
          <option value="">Alle außer archiviert</option>
          {(Object.keys(employeeStatusLabel) as EmployeeStatus[]).map((s) => <option key={s} value={s}>{employeeStatusLabel[s]}</option>)}
        </Select>
        <Select aria-label="Rolle" value={jobRoleId} onChange={(e) => setParam('rolle', e.target.value || null)}>
          <option value="">Alle Rollen</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
      </div>

      <Card>
        {list.isPending ? (
          <div className="space-y-3 p-5">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-11" />)}</div>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : data && data.items.length === 0 ? (
          <EmptyState
            icon={<Users className="size-5" />}
            title={debounced || status || locationId || jobRoleId ? 'Keine Treffer' : 'Noch keine Mitarbeitenden'}
            description={debounced || status || locationId || jobRoleId ? 'Passen Sie Suche oder Filter an.' : 'Legen Sie Ihr Team an und laden Sie es zur App ein.'}
            action={canManage && !debounced ? <Button onClick={() => { setEditing(undefined); setFormOpen(true) }}><UserPlus /> Mitarbeiter/in anlegen</Button> : undefined}
          />
        ) : (
          data && (
            <>
              {/* Desktop table */}
              <table className="hidden w-full text-sm md:table">
                <thead className="border-b border-line text-left text-xs text-ink-muted">
                  <tr>
                    <th className="px-5 py-3">{sortButton('name', 'Name')}</th>
                    <th className="px-3 py-3">{sortButton('role', 'Rolle')}</th>
                    <th className="px-3 py-3">Standorte</th>
                    <th className="px-3 py-3 text-right">Std./Woche</th>
                    <th className="px-3 py-3">{sortButton('status', 'Status')}</th>
                    <th className="w-12 px-3 py-3"><span className="sr-only">Aktionen</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.items.map((e) => (
                    <tr key={e.id} className="cursor-pointer hover:bg-subtle/50" onClick={() => navigate(`/mitarbeiter/${e.id}`)}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={e.fullName} color={e.jobRoleColor} />
                          <div className="min-w-0">
                            <a href={`mitarbeiter/${e.id}`} onClick={(ev) => { ev.preventDefault(); navigate(`/mitarbeiter/${e.id}`) }} className="block truncate font-medium hover:underline">
                              {e.fullName}
                            </a>
                            <span className="block truncate text-xs text-ink-muted">{e.email ?? 'Keine E-Mail'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">{e.jobRoleName ?? <span className="text-ink-faint">–</span>}</td>
                      <td className="px-3 py-3 text-ink-muted">{e.locationIds.map((id) => managed.find((l) => l.id === id)?.name).filter(Boolean).join(', ') || '–'}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{e.contractHoursPerWeek != null ? fmt.number(e.contractHoursPerWeek) : '–'}</td>
                      <td className="px-3 py-3">
                        <Badge tone={STATUS_TONE[e.status]}>{employeeStatusLabel[e.status]}</Badge>
                        {e.status === 'Active' && !e.hasAccount && <span className="ml-1.5 text-xs text-ink-faint">ohne App-Zugang</span>}
                      </td>
                      <td className="px-3 py-3" onClick={(ev) => ev.stopPropagation()}>{actions(e)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Mobile list */}
              <ul className="divide-y divide-line md:hidden">
                {data.items.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                    <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left" onClick={() => navigate(`/mitarbeiter/${e.id}`)}>
                      <Avatar name={e.fullName} color={e.jobRoleColor} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{e.fullName}</span>
                        <span className="block truncate text-xs text-ink-muted">
                          {e.jobRoleName ?? 'Keine Rolle'}
                          {e.contractHoursPerWeek != null ? ` · ${fmt.hours(e.contractHoursPerWeek)}` : ''}
                        </span>
                      </span>
                    </button>
                    <Badge tone={STATUS_TONE[e.status]}>{employeeStatusLabel[e.status]}</Badge>
                    {actions(e)}
                  </li>
                ))}
              </ul>
              {data.totalCount > data.pageSize && (
                <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm">
                  <span className="text-ink-muted">
                    Seite {data.page} von {Math.ceil(data.totalCount / data.pageSize)}
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setParam('seite', String(page - 1), false)}>Zurück</Button>
                    <Button size="sm" variant="outline" disabled={page * data.pageSize >= data.totalCount} onClick={() => setParam('seite', String(page + 1), false)}>Weiter</Button>
                  </div>
                </div>
              )}
            </>
          )
        )}
      </Card>

      <EmployeeFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        employee={editing}
        onSaved={(_, inv) => {
          if (inv) setInvitation(inv)
        }}
      />
      <DeactivateDialog employee={deactivating} onClose={() => setDeactivating(null)} />
      <InvitationResultDialog result={invitation} onClose={() => setInvitation(null)} />
    </>
  )
}
