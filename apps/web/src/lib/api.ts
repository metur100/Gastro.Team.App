/**
 * API client.
 * - Access token lives only in memory (never in localStorage).
 * - Refresh token is an HttpOnly cookie scoped to /api/v1/auth; refresh requires the anti-CSRF header.
 * - The selected tenant is sent as X-Tenant-Id; the server validates membership on every request.
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''

export interface ProblemDetails {
  status: number
  title: string
  code?: string
  errors?: Record<string, string[]>
  issues?: unknown
  traceId?: string
}

export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly errors?: Record<string, string[]>
  readonly problem: ProblemDetails

  constructor(problem: ProblemDetails) {
    super(problem.title)
    this.name = 'ApiError'
    this.status = problem.status
    this.code = problem.code
    this.errors = problem.errors
    this.problem = problem
  }

  /** First validation message for a field (camelCase), if any. */
  field(name: string): string | undefined {
    return this.errors?.[name]?.[0]
  }
}

export class NetworkError extends Error {
  constructor() {
    super('Keine Verbindung zum Server. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.')
    this.name = 'NetworkError'
  }
}

interface TokenResponse {
  accessToken: string
  accessTokenExpiresAt: string
}

let accessToken: string | null = null
let tenantId: string | null = null
let refreshPromise: Promise<boolean> | null = null
const listeners = new Set<() => void>()

const TENANT_KEY = 'gt.tenant'

export const session = {
  get token() {
    return accessToken
  },
  setToken(token: string | null) {
    accessToken = token
  },
  get tenantId() {
    if (tenantId === null) {
      try {
        tenantId = localStorage.getItem(TENANT_KEY)
      } catch {
        tenantId = null
      }
    }
    return tenantId
  },
  setTenant(id: string | null) {
    tenantId = id
    try {
      if (id) localStorage.setItem(TENANT_KEY, id)
      else localStorage.removeItem(TENANT_KEY)
    } catch {
      /* storage unavailable: selection is kept in memory only */
    }
  },
  /** Called when the session ends unexpectedly (refresh failed). */
  onExpired(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

async function parseProblem(res: Response): Promise<ProblemDetails> {
  try {
    const body = (await res.json()) as Partial<ProblemDetails>
    return { status: res.status, title: body.title ?? defaultMessage(res.status), ...body } as ProblemDetails
  } catch {
    return { status: res.status, title: defaultMessage(res.status) }
  }
}

function defaultMessage(status: number): string {
  if (status === 401) return 'Bitte melden Sie sich an.'
  if (status === 403) return 'Sie haben keine Berechtigung für diese Aktion.'
  if (status === 404) return 'Der Eintrag wurde nicht gefunden.'
  if (status === 429) return 'Zu viele Anfragen. Bitte warten Sie einen Moment.'
  if (status >= 500) return 'Es ist ein unerwarteter Fehler aufgetreten. Bitte versuchen Sie es später erneut.'
  return 'Die Anfrage konnte nicht verarbeitet werden.'
}

/** Rotates the refresh cookie and stores the new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<boolean> {
  refreshPromise ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'GastroTeam' },
        body: '{}',
      })
      if (!res.ok) {
        accessToken = null
        return false
      }
      const data = (await res.json()) as TokenResponse
      accessToken = data.accessToken
      return true
    } catch {
      return false
    } finally {
      // Callers that joined while pending already hold the promise; later callers start a new refresh.
      refreshPromise = null
    }
  })()
  return refreshPromise
}

interface RequestOptions {
  method?: string
  body?: unknown
  signal?: AbortSignal
  /** Skip the automatic refresh-and-retry on 401 (used by auth endpoints). */
  noRetry?: boolean
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const doFetch = async () => {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`
    const t = session.tenantId
    if (t) headers['X-Tenant-Id'] = t
    try {
      return await fetch(`${API_BASE}/api/v1${path}`, {
        method: options.method ?? 'GET',
        headers,
        credentials: 'include',
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      throw new NetworkError()
    }
  }

  let res = await doFetch()
  if (res.status === 401 && !options.noRetry) {
    const refreshed = await refreshSession()
    if (refreshed) res = await doFetch()
    else listeners.forEach((l) => l())
  }
  if (res.status === 403) {
    const problem = await parseProblem(res)
    // Stale tenant selection (e.g. membership removed): drop it and let the app reload the context.
    if (problem.code === 'tenant_forbidden') session.setTenant(null)
    throw new ApiError(problem)
  }
  if (!res.ok) throw new ApiError(await parseProblem(res))
  if (res.status === 204) return undefined as T
  const type = res.headers.get('content-type') ?? ''
  if (type.includes('application/json')) return (await res.json()) as T
  return undefined as T
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ?? {} }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body }),
  del: <T = void>(path: string) => request<T>(path, { method: 'DELETE' }),
}

/** Downloads a file (CSV export) with the current credentials. */
export async function download(path: string, fallbackName: string): Promise<void> {
  const go = () =>
    fetch(`${API_BASE}/api/v1${path}`, {
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(session.tenantId ? { 'X-Tenant-Id': session.tenantId } : {}),
      },
      credentials: 'include',
    })
  let res = await go()
  if (res.status === 401 && (await refreshSession())) res = await go()
  if (!res.ok) throw new ApiError(await parseProblem(res))
  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') ?? ''
  const match = /filename="?([^";]+)"?/i.exec(disposition)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = match?.[1] ?? fallbackName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function login(email: string, password: string): Promise<void> {
  const res = await request<TokenResponse>('/auth/login', { method: 'POST', body: { email, password }, noRetry: true })
  accessToken = res.accessToken
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/v1/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'GastroTeam' },
      body: '{}',
    })
  } finally {
    accessToken = null
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof NetworkError) return error.message
  return 'Es ist ein unerwarteter Fehler aufgetreten.'
}
