import * as SecureStore from 'expo-secure-store'
import { ApiError, api, login, logout, session } from '@/lib/api'

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store

function res(status: number, body?: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => (body === undefined ? '' : JSON.stringify(body)) } as Response
}

describe('mobile API client', () => {
  const fetchMock = jest.fn()
  beforeEach(() => {
    store.clear()
    fetchMock.mockReset()
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  it('stores the rotated refresh token in secure storage on login and sends the native client header', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { accessToken: 'a1', refreshToken: 'r1' }))
    await login('mia@test.example', 'geheim-passwort')
    expect(store.get('gt.refresh')).toBe('r1')
    expect(session.accessToken).toBe('a1')
    const init = fetchMock.mock.calls[0][1]
    expect(init.headers['X-Client']).toBe('mobile')
  })

  it('refreshes on 401, persists the new refresh token and retries', async () => {
    store.set('gt.refresh', 'r1')
    fetchMock
      .mockResolvedValueOnce(res(401, { title: 'abgelaufen' }))
      .mockResolvedValueOnce(res(200, { accessToken: 'a2', refreshToken: 'r2' }))
      .mockResolvedValueOnce(res(200, { ok: 1 }))
    const data = await api.get<{ ok: number }>('/shifts/mine')
    expect(data.ok).toBe(1)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ refreshToken: 'r1' })
    expect(store.get('gt.refresh')).toBe('r2')
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer a2')
  })

  it('clears the session and notifies listeners when refresh fails', async () => {
    store.set('gt.refresh', 'revoked')
    const expired = jest.fn()
    const off = session.onExpired(expired)
    fetchMock.mockResolvedValueOnce(res(401, {})).mockResolvedValueOnce(res(401, { code: 'invalid_session' }))
    await expect(api.get('/shifts/mine')).rejects.toBeInstanceOf(ApiError)
    expect(store.has('gt.refresh')).toBe(false)
    expect(expired).toHaveBeenCalledTimes(1)
    off()
  })

  it('maps problem details to German error messages', async () => {
    fetchMock.mockResolvedValueOnce(res(409, { title: 'Für diesen Zeitraum gibt es bereits einen Antrag.', code: 'leave_overlap' }))
    const err = (await api.post('/leave-requests', {}).catch((e: unknown) => e)) as ApiError
    expect(err.code).toBe('leave_overlap')
    expect(err.message).toMatch(/bereits einen Antrag/)
  })

  it('logs out locally even when the server is unreachable', async () => {
    store.set('gt.refresh', 'r9')
    fetchMock.mockRejectedValueOnce(new TypeError('network'))
    await logout()
    expect(store.has('gt.refresh')).toBe(false)
    expect(session.accessToken).toBeNull()
  })
})
