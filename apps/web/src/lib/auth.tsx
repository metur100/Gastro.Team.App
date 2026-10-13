import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, login as apiLogin, logout as apiLogout, refreshSession, session } from './api'
import type { Location, Me, Permission, PlanFeature } from '@/types/api'

type Status = 'loading' | 'anonymous' | 'authenticated'

interface AuthContextValue {
  status: Status
  me: Me | undefined
  login: (email: string, password: string) => Promise<Me>
  /** Completes a login when tokens were obtained elsewhere (registration, invitation). */
  establish: () => Promise<Me>
  logout: () => Promise<void>
  switchTenant: (tenantId: string) => Promise<void>
  refreshMe: () => Promise<Me | undefined>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [status, setStatus] = useState<Status>('loading')

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/auth/me'),
    enabled: status === 'authenticated',
    staleTime: 60_000,
  })

  // Keep the tenant header in sync with what the server resolved.
  useEffect(() => {
    const current = meQuery.data?.currentTenant?.id
    if (current && session.tenantId !== current) session.setTenant(current)
  }, [meQuery.data])

  useEffect(() => {
    let cancelled = false
    refreshSession().then((ok) => {
      if (!cancelled) setStatus(ok ? 'authenticated' : 'anonymous')
    })
    const off = session.onExpired(() => {
      qc.clear()
      setStatus('anonymous')
    })
    return () => {
      cancelled = true
      off()
    }
  }, [qc])

  const establish = useCallback(async () => {
    const me = await api.get<Me>('/auth/me')
    qc.setQueryData(['me'], me)
    setStatus('authenticated')
    return me
  }, [qc])

  const login = useCallback(
    async (email: string, password: string) => {
      await apiLogin(email, password)
      return establish()
    },
    [establish],
  )

  const logout = useCallback(async () => {
    await apiLogout()
    session.setTenant(null)
    qc.clear()
    setStatus('anonymous')
  }, [qc])

  const switchTenant = useCallback(
    async (tenantId: string) => {
      session.setTenant(tenantId)
      qc.clear()
      await establish()
    },
    [qc, establish],
  )

  const refreshMe = useCallback(async () => (await meQuery.refetch()).data, [meQuery])

  const value = useMemo<AuthContextValue>(
    () => ({ status: status === 'authenticated' && meQuery.isPending ? 'loading' : status, me: meQuery.data, login, establish, logout, switchTenant, refreshMe }),
    [status, meQuery.isPending, meQuery.data, login, establish, logout, switchTenant, refreshMe],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

/** Role/permission/feature helpers. UI-only convenience — the API enforces all of these. */
export function usePermissions() {
  const { me } = useAuth()
  const t = me?.currentTenant ?? null
  return useMemo(() => {
    const role = t?.role
    const isOwner = role === 'Owner'
    const isManager = role === 'Owner' || role === 'Manager'
    return {
      tenant: t,
      role,
      isOwner,
      isManager,
      isEmployee: Boolean(t?.employeeId),
      employeeId: t?.employeeId ?? null,
      can: (p: Permission) => isOwner || (role === 'Manager' && (t?.permissions.includes(p) ?? false)),
      hasFeature: (f: PlanFeature) => t?.subscription.features.includes(f) ?? false,
      canWrite: t?.subscription.canWrite ?? false,
      managedLocationIds: t?.managedLocationIds ?? [],
    }
  }, [t])
}

export function useLocations() {
  const { me } = useAuth()
  return useQuery({
    queryKey: ['locations'],
    queryFn: () => api.get<Location[]>('/locations'),
    enabled: Boolean(me?.currentTenant),
    staleTime: 5 * 60_000,
  })
}

// ---- Active location selection (persisted per tenant in localStorage as a convenience) ----

interface LocationContextValue {
  locationId: string | null
  setLocationId: (id: string) => void
  locations: Location[]
  managed: Location[]
}

const LocationContext = createContext<LocationContextValue | null>(null)

export function LocationProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth()
  const tenantId = me?.currentTenant?.id
  const { data: locations = [] } = useLocations()
  const managed = useMemo(() => locations.filter((l) => l.canManage), [locations])
  const key = tenantId ? `gt.location.${tenantId}` : null
  const [selected, setSelected] = useState<string | null>(() => {
    try {
      return key ? localStorage.getItem(key) : null
    } catch {
      return null
    }
  })

  const pool = managed.length > 0 ? managed : locations
  const locationId = pool.find((l) => l.id === selected)?.id ?? pool[0]?.id ?? null

  const setLocationId = useCallback(
    (id: string) => {
      setSelected(id)
      try {
        if (key) localStorage.setItem(key, id)
      } catch {
        /* ignore */
      }
    },
    [key],
  )

  const value = useMemo(() => ({ locationId, setLocationId, locations, managed }), [locationId, setLocationId, locations, managed])
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>
}

export function useActiveLocation() {
  const ctx = useContext(LocationContext)
  if (!ctx) throw new Error('useActiveLocation must be used within LocationProvider')
  return ctx
}
