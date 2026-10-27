import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { renderPage } from './test/utils'

describe('routing', () => {
  it('AC-01.3 a protected page without a session shows the login page', async () => {
    renderPage(<App />, { path: '/products' })
    expect(await screen.findByRole('button', { name: /log in/i })).toBeInTheDocument()
  })

  it('AC-01.1 a logged-in user sees the shell with name, role and logout', async () => {
    renderPage(<App />, {
      as: 'SUPERVISOR',
      path: '/receiving',
      routes: {
        'GET /api/v1/receiving-documents': () => ({
          status: 200,
          body: { data: [], meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } },
        }),
      },
    })
    expect(await screen.findByText('Test SUPERVISOR')).toBeInTheDocument()
    expect(screen.getByText('SUPERVISOR')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument()
  })
})
