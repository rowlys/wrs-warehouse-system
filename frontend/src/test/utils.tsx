import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'
import type { Role, User } from '../api/types'
import { setToken } from '../api/client'
import { AuthProvider } from '../auth/AuthProvider'

export type Handler = (init: RequestInit) => { status: number; body?: unknown }

/** Stubs fetch: `routes` maps "METHOD /path" (no query string) to a response. */
export function mockApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${url.split('?')[0]}`
    const handler = routes[key]
    if (!handler) throw new Error(`Unmocked request: ${key}`)
    const { status, body } = handler(init)
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

export const testUser = (role: Role): User => ({
  id: '00000000-0000-0000-0000-000000000001',
  username: role.toLowerCase(),
  fullName: `Test ${role}`,
  role,
})

/** Renders with every provider; `as` logs that user in (a token plus a mocked /auth/me). */
export function renderPage(
  ui: ReactNode,
  { as, routes = {}, path = '/' }: { as?: Role; routes?: Record<string, Handler>; path?: string } = {},
) {
  if (as) {
    setToken('test-token')
    routes = { 'GET /api/v1/auth/me': () => ({ status: 200, body: testUser(as) }), ...routes }
  }
  const fetchMock = mockApi(routes)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <MantineProvider env="test">
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <AuthProvider>{ui}</AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  )
  return fetchMock
}
