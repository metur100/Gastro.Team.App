import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, NetworkError, api, refreshSession, session } from './api'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' } })
}

describe('api client', () => {
  const fetchMock = vi.fn<typeof fetch>()
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    session.setToken('old-token')
    session.setTenant('tenant-1')
  })
  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    session.setTenant(null)
  })

  it('sends bearer token and tenant header', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }))
    await api.get('/employees')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('/api/v1/employees')
    const headers = init!.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer old-token')
    expect(headers['X-Tenant-Id']).toBe('tenant-1')
    expect(init!.credentials).toBe('include')
  })

  it('refreshes once on 401 and retries the request with the new token', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { title: 'abgelaufen' }))
      .mockResolvedValueOnce(json(200, { accessToken: 'new-token', accessTokenExpiresAt: '2030-01-01T00:00:00Z' }))
      .mockResolvedValueOnce(json(200, { value: 42 }))
    const result = await api.get<{ value: number }>('/dashboard/summary')
    expect(result.value).toBe(42)
    const refreshCall = fetchMock.mock.calls[1]!
    expect(String(refreshCall[0])).toBe('/api/v1/auth/refresh')
    expect((refreshCall[1]!.headers as Record<string, string>)['X-Requested-With']).toBe('GastroTeam')
    expect((fetchMock.mock.calls[2]![1]!.headers as Record<string, string>).Authorization).toBe('Bearer new-token')
  })

  it('notifies session expiry when refresh fails', async () => {
    const expired = vi.fn()
    const off = session.onExpired(expired)
    fetchMock.mockResolvedValueOnce(json(401, {})).mockResolvedValueOnce(json(401, {}))
    await expect(api.get('/employees')).rejects.toBeInstanceOf(ApiError)
    expect(expired).toHaveBeenCalledOnce()
    expect(session.token).toBeNull()
    off()
  })

  it('maps problem details including validation errors', async () => {
    fetchMock.mockResolvedValueOnce(json(400, { status: 400, title: 'Bitte prüfen Sie Ihre Eingaben.', code: 'validation_failed', errors: { email: ['Ungültig'] } }))
    const error = await api.post('/employees', {}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).field('email')).toBe('Ungültig')
    expect((error as ApiError).message).toBe('Bitte prüfen Sie Ihre Eingaben.')
  })

  it('reports network failures in German', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const error = await api.get('/employees').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(NetworkError)
    expect((error as Error).message).toMatch(/Keine Verbindung/)
  })

  it('drops a stale tenant selection on tenant_forbidden', async () => {
    fetchMock.mockResolvedValueOnce(json(403, { status: 403, title: 'Kein Zugriff', code: 'tenant_forbidden' }))
    await expect(api.get('/employees')).rejects.toBeInstanceOf(ApiError)
    expect(session.tenantId).toBeNull()
  })

  it('shares a single refresh request between concurrent callers', async () => {
    fetchMock.mockResolvedValue(json(200, { accessToken: 't', accessTokenExpiresAt: '2030-01-01T00:00:00Z' }))
    const [a, b] = await Promise.all([refreshSession(), refreshSession()])
    expect(a && b).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
