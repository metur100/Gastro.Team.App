/**
 * Native API client.
 * - Access token: memory only.
 * - Refresh token: platform secure storage (Keychain / Android Keystore via expo-secure-store).
 * - Refresh tokens rotate on every use; the newest one is always persisted. Concurrent 401s share one refresh.
 */
import * as SecureStore from 'expo-secure-store'
import Constants from 'expo-constants'

const REFRESH_KEY = 'gt.refresh'
const TENANT_KEY = 'gt.tenant'

export const API_URL: string = (
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  'https://gastroteam.runasp.net'
).replace(/\/$/, '')

export interface ProblemDetails {
  status: number
  title: string
  code?: string
  errors?: Record<string, string[]>
}

export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly errors?: Record<string, string[]>
  constructor(p: ProblemDetails) {
    super(p.title)
    this.name = 'ApiError'
    this.status = p.status
    this.code = p.code
    this.errors = p.errors
  }
  field(name: string) {
    return this.errors?.[name]?.[0]
  }
}

export class NetworkError extends Error {
  constructor() {
    super('Keine Verbindung zum Server. Bitte prüfen Sie Ihre Internetverbindung.')
    this.name = 'NetworkError'
  }
}

interface Tokens {
  accessToken: string
  refreshToken: string | null
}

let accessToken: string | null = null
let tenantId: string | null = null
let refreshing: Promise<boolean> | null = null
const expiredListeners = new Set<() => void>()

export const session = {
  get accessToken() {
    return accessToken
  },
  get tenantId() {
    return tenantId
  },
  async setTenant(id: string | null) {
    tenantId = id
    if (id) await SecureStore.setItemAsync(TENANT_KEY, id)
    else await SecureStore.deleteItemAsync(TENANT_KEY)
  },
  async restore(): Promise<boolean> {
    tenantId = await SecureStore.getItemAsync(TENANT_KEY)
    if (!(await SecureStore.getItemAsync(REFRESH_KEY))) return false
    return refreshSession()
  },
  onExpired(listener: () => void) {
    expiredListeners.add(listener)
    return () => {
      expiredListeners.delete(listener)
    }
  },
}

async function store(tokens: Tokens) {
  accessToken = tokens.accessToken
  if (tokens.refreshToken) await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken)
}

async function clear() {
  accessToken = null
  await SecureStore.deleteItemAsync(REFRESH_KEY)
}

async function parseProblem(res: Response): Promise<ProblemDetails> {
  try {
    const body = (await res.json()) as Partial<ProblemDetails>
    return { status: res.status, title: body.title ?? defaultMessage(res.status), code: body.code, errors: body.errors }
  } catch {
    return { status: res.status, title: defaultMessage(res.status) }
  }
}

function defaultMessage(status: number) {
  if (status === 401) return 'Bitte melden Sie sich an.'
  if (status === 403) return 'Sie haben keine Berechtigung für diese Aktion.'
  if (status === 404) return 'Der Eintrag wurde nicht gefunden.'
  if (status === 429) return 'Zu viele Anfragen. Bitte warten Sie einen Moment.'
  if (status >= 500) return 'Es ist ein unerwarteter Fehler aufgetreten. Bitte versuchen Sie es später erneut.'
  return 'Die Anfrage konnte nicht verarbeitet werden.'
}

async function rawFetch(path: string, init: RequestInit & { headers?: Record<string, string> }) {
  try {
    return await fetch(`${API_URL}/api/v1${path}`, {
      ...init,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Client': 'mobile', ...init.headers },
    })
  } catch {
    throw new NetworkError()
  }
}

export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const token = await SecureStore.getItemAsync(REFRESH_KEY)
      if (!token) return false
      const res = await rawFetch('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: token }) })
      if (!res.ok) {
        if (res.status === 401) await clear()
        return false
      }
      await store((await res.json()) as Tokens)
      return true
    } catch {
      return false
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

export async function request<T>(path: string, options: { method?: string; body?: unknown; retry?: boolean } = {}): Promise<T> {
  const send = () => {
    const headers: Record<string, string> = {}
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`
    if (tenantId) headers['X-Tenant-Id'] = tenantId
    return rawFetch(path, { method: options.method ?? 'GET', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) })
  }
  let res = await send()
  if (res.status === 401 && options.retry !== false) {
    if (await refreshSession()) res = await send()
    else {
      await clear()
      expiredListeners.forEach((l) => l())
    }
  }
  if (!res.ok) {
    const problem = await parseProblem(res)
    if (problem.code === 'tenant_forbidden') await session.setTenant(null)
    throw new ApiError(problem)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown = {}) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body }),
  del: <T = void>(path: string) => request<T>(path, { method: 'DELETE' }),
}

export async function login(email: string, password: string) {
  const res = await rawFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email: email.trim(), password }) })
  if (!res.ok) throw new ApiError(await parseProblem(res))
  await store((await res.json()) as Tokens)
}

export async function logout() {
  const token = await SecureStore.getItemAsync(REFRESH_KEY)
  try {
    if (token) await rawFetch('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: token }) })
  } catch {
    // Logging out locally must always succeed.
  } finally {
    await clear()
    await session.setTenant(null)
  }
}

export function errorMessage(e: unknown) {
  if (e instanceof ApiError || e instanceof NetworkError) return e.message
  return 'Es ist ein unerwarteter Fehler aufgetreten.'
}
