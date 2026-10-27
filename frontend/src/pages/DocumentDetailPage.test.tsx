import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderDetail } from '../test/detail'
import { doc, DOC_ID, item, receipt } from '../test/fixtures'

describe('DocumentDetailPage', () => {
  it('FR-23 shows header, lines with remaining, and the fully-received check', async () => {
    renderDetail('OPERATOR', doc({ status: 'OPEN', openedBy: { id: 'u2', fullName: 'Siti Supervisor' }, openedAt: '2026-10-27T08:30:00.000Z' }))
    expect(await screen.findByText('RCV-2026-000001')).toBeInTheDocument()
    expect(screen.getByText('FRZ-CHK-001')).toBeInTheDocument()
    expect(screen.getByText(/opened/i)).toHaveTextContent('Siti Supervisor')
  })

  it('AC-04.9 an operator gets a Receive form on each line that is not fully received', async () => {
    renderDetail(
      'OPERATOR',
      doc({
        status: 'IN_PROGRESS',
        items: [
          item(),
          item({ id: '30000000-0000-0000-0000-000000000002', product: { id: 'p2', sku: 'FRZ-FSH-002', name: 'Tuna', unitOfMeasure: 'CTN' }, receivedQuantity: 100, remainingQuantity: 0, isFullyReceived: true }),
        ],
      }),
    )
    expect(await screen.findByRole('textbox', { name: 'Quantity to receive of FRZ-CHK-001' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Quantity to receive of FRZ-FSH-002' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^receive$/i })).toHaveLength(1)
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

  const reversed = receipt({
    id: '40000000-0000-0000-0000-000000000002',
    quantity: 60,
    reversal: { id: 'rv1', reason: 'Typo, counted 10', reversedAt: '2026-10-27T11:00:00.000Z', reversedBy: { id: 'u2', fullName: 'Siti Supervisor' } },
  })
  const inProgress = doc({
    status: 'IN_PROGRESS',
    items: [item({ receivedQuantity: 40, remainingQuantity: 60 })],
    receipts: [receipt(), reversed],
  })

  it('FR-36 BR-19 a supervisor gets Reverse only on receipts that are not reversed', async () => {
    renderDetail('SUPERVISOR', inProgress)
    expect(await screen.findAllByRole('button', { name: /^reverse$/i })).toHaveLength(1)
    expect(screen.getByRole('button', { name: /close short/i })).toBeInTheDocument()
  })

  it('FR-04 an operator gets neither Reverse nor Close short', async () => {
    renderDetail('OPERATOR', inProgress)
    await screen.findByText('RCV-2026-000001')
    expect(screen.queryByRole('button', { name: /^reverse$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /close short/i })).not.toBeInTheDocument()
  })

  it('FR-23 a reversed receipt is struck through with reason, time and user', async () => {
    renderDetail('OPERATOR', inProgress)
    const row = (await screen.findByText(/Typo, counted 10/)).closest('tr')!
    expect(row).toHaveTextContent('Siti Supervisor')
    expect(within(row).getByText('60')).toHaveStyle({ textDecoration: 'line-through' })
  })

  it('AC-09.1 reversing sends the reason and shows the updated document', async () => {
    const fetchMock = renderDetail('SUPERVISOR', doc({ status: 'IN_PROGRESS', items: [item({ receivedQuantity: 40, remainingQuantity: 60 })], receipts: [receipt()] }), {
      [`POST /api/v1/receiving-documents/${DOC_ID}/receipts/${receipt().id}/reverse`]: () => ({
        status: 200,
        body: doc({ status: 'OPEN', receipts: [receipt({ reversal: reversed.reversal })] }),
      }),
    })
    await userEvent.click(await screen.findByRole('button', { name: /^reverse$/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/reason/i), 'Typo, counted 10')
    await userEvent.click(within(dialog).getByRole('button', { name: /reverse receipt/i }))
    expect(await screen.findByText(/Typo, counted 10/)).toBeInTheDocument()
    const [, init] = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/reverse'))!
    expect(JSON.parse(String(init!.body))).toEqual({ reason: 'Typo, counted 10' })
  })

  it('AC-08.1 a CLOSED_SHORT document labels the remaining column "Short" and shows the reason', async () => {
    renderDetail(
      'OPERATOR',
      doc({
        status: 'CLOSED_SHORT',
        items: [item({ receivedQuantity: 70, remainingQuantity: 30 })],
        closedShortAt: '2026-10-27T12:00:00.000Z',
        closedShortBy: { id: 'u2', fullName: 'Siti Supervisor' },
        closeShortReason: 'Supplier out of stock',
      }),
    )
    expect(await screen.findByRole('columnheader', { name: 'Short' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Remaining' })).not.toBeInTheDocument()
    expect(screen.getByText(/Supplier out of stock/)).toHaveTextContent('Siti Supervisor')
  })

  it('AC-08.2 NFR-06 a failed close short shows the API message in the dialog', async () => {
    renderDetail('SUPERVISOR', inProgress, {
      [`POST /api/v1/receiving-documents/${DOC_ID}/close-short`]: () => ({
        status: 422,
        body: { error: { code: 'NOTHING_SHORT', message: 'Every line is fully received; complete the document instead.' } },
      }),
    })
    await userEvent.click(await screen.findByRole('button', { name: /close short/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/reason/i), 'Supplier out of stock')
    await userEvent.click(within(dialog).getByRole('button', { name: /close short/i }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Every line is fully received; complete the document instead.')
  })
})
