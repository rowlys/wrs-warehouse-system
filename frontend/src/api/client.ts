const TOKEN_KEY = 'wrs.token'

export const getToken = () => sessionStorage.getItem(TOKEN_KEY)
export const setToken = (token: string) => sessionStorage.setItem(TOKEN_KEY, token)
export const clearToken = () => sessionStorage.removeItem(TOKEN_KEY)

export interface FieldError {
  field: string
  message: string
}

/** A non-2xx response, parsed from the error envelope (spec §4.2). */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  /** `details.fields` of a VALIDATION_ERROR, keyed by field name. */
  get fieldErrors(): Record<string, string> {
    const fields = (this.details?.fields ?? []) as FieldError[]
    return Object.fromEntries(fields.map((f) => [f.field, f.message]))
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | undefined>
  headers?: Record<string, string>
}

/** Calls `/api/v1{path}` with the bearer token; throws ApiError on any non-2xx. */
export async function api<T>(path: string, { method = 'GET', body, query, headers: extra }: Options = {}): Promise<T> {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== '') params.set(k, String(v))
  }
  const qs = params.size ? `?${params}` : ''
  const headers: Record<string, string> = { ...extra }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(`/api/v1${path}${qs}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json: unknown = res.status === 204 ? undefined : await res.json().catch(() => undefined)
  if (res.ok) return json as T

  const error = (json as { error?: { code: string; message: string; details?: Record<string, unknown> } })
    ?.error
  const err = error
    ? new ApiError(res.status, error.code, error.message, error.details)
    : new ApiError(res.status, 'INTERNAL_ERROR', `Request failed (${res.status})`)
  // AC-01.3: a missing or expired token sends the user back to log in. A wrong login is
  // INVALID_CREDENTIALS, which stays on the page.
  if (err.code === 'UNAUTHENTICATED') {
    clearToken()
    window.location.assign('/login')
  }
  throw err
}
