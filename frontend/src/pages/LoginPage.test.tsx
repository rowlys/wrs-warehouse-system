import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { getToken } from '../api/client'
import { renderPage } from '../test/utils'
import { LoginPage } from './LoginPage'

describe('LoginPage', () => {
  it('AC-01.2 shows the API message on 401 and stores no token', async () => {
    renderPage(<LoginPage />, {
      routes: {
        'POST /api/v1/auth/login': () => ({
          status: 401,
          body: { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' } },
        }),
      },
    })
    await userEvent.type(screen.getByLabelText(/username/i), 'operator')
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))
    expect(await screen.findByText('Invalid username or password')).toBeInTheDocument()
    expect(getToken()).toBeNull()
  })
})
