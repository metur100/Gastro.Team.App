import { useState, type ComponentType } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  ArrowLeftRight, Bell, BarChart3, CalendarCheck, CalendarDays, CalendarClock, Building2, ChevronsUpDown, Clock, LayoutDashboard,
  LogOut, MapPin, Menu, Plane, Settings, Shield, User, Users, X,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useActiveLocation, useAuth, usePermissions } from '@/lib/auth'
import { fmt } from '@/lib/format'
import { roleLabel, subscriptionStatusLabel } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { Avatar, Badge } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { DropdownContent, DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, DropdownTrigger } from '@/components/ui/overlay'

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  end?: boolean
}

function useNavItems(): NavItem[] {
  const p = usePermissions()
  const { me } = useAuth()
  const items: NavItem[] = []
  if (!p.tenant) return items
  items.push({ to: '/', label: p.isManager ? 'Dashboard' : 'Heute', icon: LayoutDashboard, end: true })
  if (p.isManager) items.push({ to: '/schichtplan', label: 'Schichtplan', icon: CalendarDays })
  if (p.isEmployee) items.push({ to: '/meine-schichten', label: 'Meine Schichten', icon: CalendarClock })
  if (p.isManager) items.push({ to: '/mitarbeiter', label: 'Mitarbeiter', icon: Users })
  if (p.hasFeature('Availability') && (p.isEmployee || p.isManager)) items.push({ to: '/verfuegbarkeit', label: 'Verfügbarkeit', icon: Clock })
  if (p.isEmployee || p.can('ApproveLeave')) items.push({ to: '/urlaub', label: 'Urlaubsanträge', icon: Plane })
  if (p.hasFeature('ShiftSwaps') && (p.isEmployee || p.can('ManageSwaps'))) items.push({ to: '/schichttausch', label: 'Schichttausch', icon: ArrowLeftRight })
  items.push({ to: '/benachrichtigungen', label: 'Benachrichtigungen', icon: Bell })
  if (p.can('ViewReports') && p.hasFeature('Reports')) items.push({ to: '/auswertungen', label: 'Auswertungen', icon: BarChart3 })
  if (p.isManager) items.push({ to: '/standorte', label: 'Standorte', icon: MapPin })
  if (p.isOwner) items.push({ to: '/einstellungen', label: 'Einstellungen', icon: Settings })
  if (me?.isPlatformAdmin) items.push({ to: '/plattform', label: 'Plattform', icon: Shield })
  return items
}

function useUnreadCount() {
  const { me } = useAuth()
  return useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get<{ count: number }>('/notifications/unread-count'),
    enabled: Boolean(me?.currentTenant),
    refetchInterval: 60_000,
    select: (d) => d.count,
  })
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const items = useNavItems()
  const { data: unread = 0 } = useUnreadCount()
  return (
    <nav aria-label="Hauptnavigation" className="flex flex-col gap-0.5">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive ? 'bg-brand-50 text-brand-800' : 'text-ink-muted hover:bg-subtle hover:text-ink',
            )
          }
        >
          <item.icon className="size-4.5 shrink-0" />
          <span className="flex-1">{item.label}</span>
          {item.to === '/benachrichtigungen' && unread > 0 && (
            <span className="rounded-full bg-brand-700 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">{unread > 99 ? '99+' : unread}</span>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-3">
      <span className="flex size-8 items-center justify-center rounded-md bg-brand-700 text-white" aria-hidden>
        <CalendarCheck className="size-4.5" />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">GastroTeam</span>
    </div>
  )
}

function TenantSwitcher() {
  const { me, switchTenant } = useAuth()
  const navigate = useNavigate()
  const tenant = me?.currentTenant
  if (!tenant || !me) return null
  const sub = tenant.subscription
  return (
    <DropdownMenu>
      <DropdownTrigger asChild>
        <button className="flex w-full cursor-pointer items-center gap-2.5 rounded-md border border-line bg-surface px-3 py-2 text-left hover:bg-subtle">
          <Building2 className="size-4 shrink-0 text-ink-faint" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{tenant.name}</span>
            <span className="block truncate text-xs text-ink-faint">
              {roleLabel[tenant.role]} · {sub.planName}
              {sub.status === 'Trial' ? ` (${subscriptionStatusLabel.Trial})` : ''}
            </span>
          </span>
          {me.memberships.length > 1 && <ChevronsUpDown className="size-4 text-ink-faint" />}
        </button>
      </DropdownTrigger>
      <DropdownContent align="start" className="w-64">
        <DropdownLabel>Betrieb wechseln</DropdownLabel>
        {me.memberships.map((m) => (
          <DropdownItem
            key={m.tenantId}
            onSelect={() => {
              if (m.tenantId !== tenant.id) void switchTenant(m.tenantId).then(() => navigate('/'))
            }}
          >
            <Building2 />
            <span className="flex-1 truncate">{m.tenantName}</span>
            {m.tenantId === tenant.id && <Badge tone="brand">Aktiv</Badge>}
          </DropdownItem>
        ))}
        <DropdownSeparator />
        <DropdownItem onSelect={() => navigate('/onboarding?neu=1')}>
          <Building2 /> Weiteren Betrieb anlegen
        </DropdownItem>
      </DropdownContent>
    </DropdownMenu>
  )
}

export function LocationSelect({ className }: { className?: string }) {
  const { locationId, setLocationId, managed, locations } = useActiveLocation()
  const pool = managed.length > 0 ? managed : locations
  if (pool.length <= 1) return null
  return (
    <label className={cn('relative flex items-center', className)}>
      <span className="sr-only">Standort wählen</span>
      <MapPin className="pointer-events-none absolute left-2.5 size-4 text-ink-faint" aria-hidden />
      <select
        value={locationId ?? ''}
        onChange={(e) => setLocationId(e.target.value)}
        className="h-9 max-w-52 cursor-pointer appearance-none truncate rounded-md border border-line-strong bg-surface pl-8 pr-8 text-sm font-medium hover:bg-subtle"
      >
        {pool.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute right-2.5 size-3.5 text-ink-faint" aria-hidden />
    </label>
  )
}

function UserMenu() {
  const { me, logout } = useAuth()
  const navigate = useNavigate()
  if (!me) return null
  const name = `${me.firstName} ${me.lastName}`
  return (
    <DropdownMenu>
      <DropdownTrigger asChild>
        <button className="flex cursor-pointer items-center gap-2 rounded-full p-0.5 hover:bg-subtle" aria-label="Benutzermenü">
          <Avatar name={name} />
        </button>
      </DropdownTrigger>
      <DropdownContent>
        <div className="px-2.5 py-2">
          <p className="text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-ink-faint">{me.email}</p>
        </div>
        <DropdownSeparator />
        <DropdownItem onSelect={() => navigate('/profil')}>
          <User /> Profil &amp; Datenschutz
        </DropdownItem>
        <DropdownItem
          onSelect={() => {
            void logout().then(() => navigate('/anmelden'))
          }}
        >
          <LogOut /> Abmelden
        </DropdownItem>
      </DropdownContent>
    </DropdownMenu>
  )
}

function NotificationBell() {
  const { data: unread = 0 } = useUnreadCount()
  const navigate = useNavigate()
  return (
    <Button
      variant="ghost"
      size="icon"
      className="relative"
      onClick={() => navigate('/benachrichtigungen')}
      aria-label={unread > 0 ? `Benachrichtigungen, ${unread} ungelesen` : 'Benachrichtigungen'}
    >
      <Bell />
      {unread > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-danger-600 ring-2 ring-surface" aria-hidden />}
    </Button>
  )
}

function StatusBanner() {
  const p = usePermissions()
  const t = p.tenant
  if (!t) return null
  if (t.status === 'Suspended')
    return <div className="bg-danger-600 px-4 py-2 text-center text-sm font-medium text-white">Dieses Restaurantkonto ist gesperrt. Änderungen sind nicht möglich.</div>
  if (!t.subscription.canWrite)
    return (
      <div className="bg-warning-50 px-4 py-2 text-center text-sm font-medium text-warning-700">
        Ihr Abonnement ist nicht aktiv – Daten sind schreibgeschützt.{p.isOwner ? ' Bitte wählen Sie unter Einstellungen einen Tarif.' : ''}
      </div>
    )
  return null
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false)
  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-pop">
        Zum Inhalt springen
      </a>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface lg:flex no-print">
        <div className="flex h-16 items-center border-b border-line">
          <Brand />
        </div>
        <div className="p-3">
          <TenantSwitcher />
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-6">
          <SidebarNav />
        </div>
      </aside>

      {/* Mobile drawer */}
      <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink/40 lg:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-surface shadow-pop focus:outline-none lg:hidden">
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Hauptnavigation von GastroTeam</DialogPrimitive.Description>
            <div className="flex h-16 items-center justify-between border-b border-line pr-3">
              <Brand />
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon" aria-label="Navigation schließen">
                  <X />
                </Button>
              </DialogPrimitive.Close>
            </div>
            <div className="p-3">
              <TenantSwitcher />
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-6">
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="lg:pl-64">
        <StatusBanner />
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur sm:px-6 no-print">
          <Button variant="ghost" size="icon" className="-ml-2 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Navigation öffnen">
            <Menu />
          </Button>
          <span className="hidden text-sm text-ink-muted md:block">{fmt.full(new Date())}</span>
          <div className="ml-auto flex items-center gap-2">
            <LocationSelect className="hidden sm:flex" />
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
