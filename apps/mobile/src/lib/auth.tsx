import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, login as apiLogin, logout as apiLogout, session } from './api'
import { registerForPush, unregisterPush } from './push'
import type { Me, Permission, PlanFeature } from '../types/api'

type Status = 'loading' | 'anonymous' | 'authenticated'

interface AuthValue {
  status: Status
  me: Me | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  reload: () => Promise<Me | null>
  switchTenant: (tenantId: string) => Promise<void>
}

const Ctx = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [status, setStatus] = useState<Status>('loading')
  const [me, setMe] = useState<Me | null>(null)

  const reload = useCallback(async () => {
    const data = await api.get<Me>('/auth/me')
    if (data.currentTenant && session.tenantId !== data.currentTenant.id) await session.setTenant(data.currentTenant.id)
    setMe(data)
    return data
  }, [])

  useEffect(() => {
    let alive = true
    session
      .restore()
      .then(async (ok) => {
        if (!alive) return
        if (!ok) return setStatus('anonymous')
        await reload()
        setStatus('authenticated')
      })
      .catch(() => alive && setStatus('anonymous'))
    const off = session.onExpired(() => {
      setMe(null)
      qc.clear()
      setStatus('anonymous')
    })
    return () => {
      alive = false
      off()
    }
  }, [qc, reload])

  const signIn = useCallback(
    async (email: string, password: string) => {
      await apiLogin(email, password)
      await reload()
      setStatus('authenticated')
      void registerForPush()
    },
    [reload],
  )

  const signOut = useCallback(async () => {
    await unregisterPush()
    await apiLogout()
    qc.clear()
    setMe(null)
    setStatus('anonymous')
  }, [qc])

  const switchTenant = useCallback(
    async (tenantId: string) => {
      await session.setTenant(tenantId)
      await reload()
      await qc.resetQueries()
    },
    [qc, reload],
  )

  const value = useMemo(() => ({ status, me, signIn, signOut, reload, switchTenant }), [status, me, signIn, signOut, reload, switchTenant])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

/** Convenience flags for showing UI. The API enforces every permission server-side. */
export function usePermissions() {
  const { me } = useAuth()
  const t = me?.currentTenant ?? null
  const isOwner = t?.role === 'Owner'
  const isManager = isOwner || t?.role === 'Manager'
  return {
    tenant: t,
    isManager,
    employeeId: t?.employeeId ?? null,
    can: (p: Permission) => isOwner || (t?.role === 'Manager' && (t.permissions.includes(p) ?? false)),
    hasFeature: (f: PlanFeature) => t?.subscription.features.includes(f) ?? false,
  }
}
