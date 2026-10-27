import { describe, expect, it, vi } from 'vitest'
import { mockApi } from '../test/utils'
import { api, ApiError, getToken, setToken } from './client'

describe('api client', () => {
  it('sends the bearer token to the relative /api/v1 path', async () => {
    setToken('abc')
    const fetchMock = mockApi({ 'GET /api/v1/products': () => ({ status: 200, body: { ok: true } }) })
    await expect(api('/products')).resolves.toEqual({ ok: true })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer abc')
  })

  it('§4.2 maps the error envelope to ApiError with code, message and details', async () => {
    const envelope = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: { fields: [{ field: 'sku', message: 'too short' }] },
      },
    }
    mockApi({ 'POST /api/v1/products': () => ({ status: 400, body: envelope }) })
    const err = await api('/products', { method: 'POST', body: {} }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 400, ...envelope.error })
  })

  it('AC-01.3 a 401 UNAUTHENTICATED clears the token and returns to /login', async () => {
    setToken('expired')
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    mockApi({
      'GET /api/v1/auth/me': () => ({
        status: 401,
        body: { error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired token' } },
      }),
    })
    await expect(api('/auth/me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    expect(getToken()).toBeNull()
    expect(assign).toHaveBeenCalledWith('/login')
  })

  it('a response without an envelope still becomes an ApiError', async () => {
    mockApi({ 'GET /api/v1/products': () => ({ status: 502 }) })
    await expect(api('/products')).rejects.toMatchObject({ status: 502, code: 'INTERNAL_ERROR' })
  })
})
