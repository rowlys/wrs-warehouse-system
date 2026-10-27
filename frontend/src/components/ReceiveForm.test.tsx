import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { DOC_ID, item, receipt } from '../test/fixtures'
import { renderPage, type Handler } from '../test/utils'
import { ReceiveForm } from './ReceiveForm'

const line = item({ receivedQuantity: 40, remainingQuantity: 60 })
const URL = `POST /api/v1/receiving-documents/${DOC_ID}/items/${line.id}/receipts`
const created: Handler = () => ({
  status: 201,
  body: {
    receipt: receipt(),
    item: line,
    document: { id: DOC_ID, documentNumber: 'RCV-2026-000001', status: 'IN_PROGRESS', allItemsReceived: false },
    inventory: { productId: line.product.id, quantityOnHand: 40 },
  },
})

const keysSent = (fetchMock: ReturnType<typeof renderPage>) =>
  fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith('/receipts'))
    .map(([, init]) => new Headers((init as RequestInit).headers).get('Idempotency-Key'))

async function receive(qty: string) {
  const input = screen.getByRole('textbox', { name: /quantity to receive/i })
  await userEvent.clear(input)
  await userEvent.type(input, qty)
  await userEvent.click(screen.getByRole('button', { name: /^receive$/i }))
}

describe('ReceiveForm', () => {
  it('FR-33 retrying after a network error sends the same Idempotency-Key', async () => {
    let calls = 0
    const fetchMock = renderPage(<ReceiveForm documentId={DOC_ID} item={line} />, {
      as: 'OPERATOR',
      routes: {
        [URL]: (init) => {
          calls += 1
          if (calls === 1) throw new TypeError('Failed to fetch')
          return created(init)
        },
      },
    })
    await receive('10')
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch')
    await userEvent.click(screen.getByRole('button', { name: /^receive$/i }))
    await waitFor(() => expect(keysSent(fetchMock)).toHaveLength(2))
    const [first, retry] = keysSent(fetchMock)
    expect(first).toMatch(/^[A-Za-z0-9_-]{8,100}$/)
    expect(retry).toBe(first)
    expect(JSON.parse(String((fetchMock.mock.lastCall![1] as RequestInit).body))).toEqual({ quantity: 10 })
  })

  it('AC-04.9 a success clears the field, and the next receipt gets a new key', async () => {
    const fetchMock = renderPage(<ReceiveForm documentId={DOC_ID} item={line} />, {
      as: 'OPERATOR',
      routes: { [URL]: created },
    })
    await receive('10')
    await waitFor(() => expect(screen.getByRole('textbox', { name: /quantity to receive/i })).toHaveValue(''))
    await receive('10')
    await waitFor(() => expect(keysSent(fetchMock)).toHaveLength(2))
    const [a, b] = keysSent(fetchMock)
    expect(b).not.toBe(a)
  })

  it('AC-04.9 BR-07 more than the remaining quantity cannot be submitted', async () => {
    const fetchMock = renderPage(<ReceiveForm documentId={DOC_ID} item={line} />, {
      as: 'OPERATOR',
      routes: { [URL]: created },
    })
    await userEvent.type(screen.getByRole('textbox', { name: /quantity to receive/i }), '61')
    expect(screen.getByText('Only 60 remaining')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^receive$/i })).toBeDisabled()
    expect(keysSent(fetchMock)).toHaveLength(0)
  })

  it('AC-04.3 a 422 shows the remaining quantity from details', async () => {
    renderPage(<ReceiveForm documentId={DOC_ID} item={line} />, {
      as: 'OPERATOR',
      routes: {
        [URL]: () => ({
          status: 422,
          body: {
            error: {
              code: 'QUANTITY_EXCEEDS_REMAINING',
              message: 'Cannot receive 50 units; only 30 remaining for FRZ-CHK-001.',
              details: { remainingQuantity: 30, requestedQuantity: 50 },
            },
          },
        }),
        [`GET /api/v1/receiving-documents/${DOC_ID}`]: () => ({ status: 200, body: {} }),
      },
    })
    await receive('50')
    expect(await screen.findByText('Only 30 remaining')).toBeInTheDocument()
  })
})
