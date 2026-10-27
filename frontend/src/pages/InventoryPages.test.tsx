import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { InventoryBalance, InventoryTransaction } from '../api/types'
import { renderPage } from '../test/utils'
import { InventoryPage } from './InventoryPage'
import { TransactionsPage } from './TransactionsPage'

const P = '10000000-0000-0000-0000-000000000001'
const meta = (n: number) => ({ page: 1, pageSize: 20, totalItems: n, totalPages: 1 })
const balance: InventoryBalance = {
  productId: P,
  sku: 'FRZ-CHK-001',
  name: 'Frozen Chicken',
  unitOfMeasure: 'CTN',
  quantityOnHand: 100,
  updatedAt: '2026-10-27T09:00:00.000Z',
}
const tx = (id: string, change: number, after: number): InventoryTransaction => ({
  id,
  type: 'RECEIPT',
  product: { id: P, sku: 'FRZ-CHK-001', name: 'Frozen Chicken' },
  quantityChange: change,
  balanceAfter: after,
  receiptId: `r${id}`,
  receiptReversalId: null,
  receivingDocument: { id: '20000000-0000-0000-0000-000000000001', documentNumber: 'RCV-2026-000001' },
  createdBy: { id: 'u1', fullName: 'Budi Operator' },
  createdAt: '2026-10-27T09:00:00.000Z',
})

describe('InventoryPage', () => {
  it('AC-06.1 FR-40 shows on-hand per product, each row linking to its transactions', async () => {
    renderPage(<InventoryPage />, {
      as: 'OPERATOR',
      routes: { 'GET /api/v1/inventory': () => ({ status: 200, body: { data: [balance], meta: meta(1) } }) },
    })
    expect(await screen.findByText('100')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'FRZ-CHK-001' })).toHaveAttribute(
      'href',
      `/inventory/transactions?productId=${P}`,
    )
  })
})

describe('TransactionsPage', () => {
  it('AC-06.2 FR-41 sends the URL filters and lists rows with change, balance, document and user', async () => {
    const fetchMock = renderPage(<TransactionsPage />, {
      as: 'OPERATOR',
      path: `/inventory/transactions?productId=${P}&from=2026-10-01&to=2026-10-27`,
      routes: {
        'GET /api/v1/inventory/transactions': () => ({
          status: 200,
          body: { data: [tx('2', 60, 100), tx('1', 40, 40)], meta: meta(2) },
        }),
        [`GET /api/v1/products/${P}`]: () => ({ status: 200, body: { id: P, sku: 'FRZ-CHK-001', name: 'Frozen Chicken' } }),
        'GET /api/v1/products': () => ({ status: 200, body: { data: [], meta: meta(0) } }),
      },
    })
    expect(await screen.findByText('+60')).toBeInTheDocument()
    expect(screen.getByText('+40')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'RCV-2026-000001' })[0]).toHaveAttribute(
      'href',
      '/receiving/20000000-0000-0000-0000-000000000001',
    )
    expect(screen.getAllByText('Budi Operator')).toHaveLength(2)
    expect(screen.getAllByText('2026-10-27 16:00')).toHaveLength(2)

    await waitFor(() => {
      const url = fetchMock.mock.calls.map(([u]) => String(u)).find((u) => u.includes('/inventory/transactions'))!
      const q = new URL(url, 'http://x').searchParams
      expect(q.get('productId')).toBe(P)
      expect(q.get('from')).toBe('2026-09-30T17:00:00.000Z')
      expect(q.get('to')).toBe('2026-10-27T17:00:00.000Z')
    })
  })
})
