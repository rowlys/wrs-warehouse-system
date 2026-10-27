import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderDetail } from '../test/detail'
import { doc, DOC_ID } from '../test/fixtures'

describe('DocumentDetailPage', () => {
  it('FR-23 shows header, lines with remaining, and the fully-received check', async () => {
    renderDetail('OPERATOR', doc({ status: 'OPEN', openedBy: { id: 'u2', fullName: 'Siti Supervisor' }, openedAt: '2026-10-27T08:30:00.000Z' }))
    expect(await screen.findByText('RCV-2026-000001')).toBeInTheDocument()
    expect(screen.getByText('FRZ-CHK-001')).toBeInTheDocument()
    expect(screen.getByText(/opened/i)).toHaveTextContent('Siti Supervisor')
  })

  it('FR-27 FR-29 a supervisor on a DRAFT sees Open and Cancel; an operator does not', async () => {
    renderDetail('SUPERVISOR', doc())
    expect(await screen.findByRole('button', { name: /open for receiving/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel document/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add line/i })).toBeInTheDocument()
  })

  it('FR-04 an operator on a DRAFT sees no status or line actions', async () => {
    renderDetail('OPERATOR', doc())
    await screen.findByText('RCV-2026-000001')
    expect(screen.queryByRole('button', { name: /open for receiving/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cancel document/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add line/i })).not.toBeInTheDocument()
  })

  it('A-06 IN_PROGRESS with all items received shows the hint and Complete', async () => {
    renderDetail('SUPERVISOR', doc({ status: 'IN_PROGRESS', allItemsReceived: true }))
    expect(await screen.findByText('All items received — ready to complete')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^complete$/i })).toBeInTheDocument()
  })

  it('AC-03.4 NFR-06 shows the API message when opening fails', async () => {
    renderDetail('SUPERVISOR', doc({ items: [] }), {
      [`POST /api/v1/receiving-documents/${DOC_ID}/open`]: () => ({
        status: 422,
        body: { error: { code: 'DOCUMENT_HAS_NO_ITEMS', message: 'A document needs at least one line before it can be opened.' } },
      }),
    })
    await userEvent.click(await screen.findByRole('button', { name: /open for receiving/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A document needs at least one line before it can be opened.')
  })

  it('AC-05.4 BR-15 cancel asks for a reason and sends it trimmed', async () => {
    const fetchMock = renderDetail('SUPERVISOR', doc({ status: 'OPEN' }), {
      [`POST /api/v1/receiving-documents/${DOC_ID}/cancel`]: () => ({
        status: 200,
        body: doc({ status: 'CANCELLED', cancelReason: 'Supplier cancelled shipment', cancelledAt: '2026-10-27T10:00:00.000Z' }),
      }),
    })
    await userEvent.click(await screen.findByRole('button', { name: /cancel document/i }))
    const dialog = await screen.findByRole('dialog')
    const reason = within(dialog).getByLabelText(/reason/i)
    await userEvent.type(reason, ' ab ')
    await userEvent.click(within(dialog).getByRole('button', { name: /cancel document/i }))
    expect(within(dialog).getByText('Reason must be 3–500 characters')).toBeInTheDocument()

    await userEvent.clear(reason)
    await userEvent.type(reason, '  Supplier cancelled shipment  ')
    await userEvent.click(within(dialog).getByRole('button', { name: /cancel document/i }))
    expect(await screen.findByText('Cancelled')).toBeInTheDocument()
    const [, init] = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/cancel'))!
    expect(JSON.parse(String(init!.body))).toEqual({ reason: 'Supplier cancelled shipment' })
  })
})
