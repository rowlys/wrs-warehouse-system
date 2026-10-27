import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Product } from '../api/types'
import { renderPage } from '../test/utils'
import { ProductsPage } from './ProductsPage'

const product: Product = {
  id: '10000000-0000-0000-0000-000000000001',
  sku: 'FRZ-CHK-001',
  name: 'Frozen Chicken Breast 1kg',
  unitOfMeasure: 'CTN',
  description: null,
  quantityOnHand: 40,
  createdAt: '2026-10-27T08:00:00.000Z',
  updatedAt: '2026-10-27T08:00:00.000Z',
}
const list = () => ({
  status: 200,
  body: { data: [product], meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } },
})

async function submitNewProduct() {
  await userEvent.click(await screen.findByRole('button', { name: /new product/i }))
  await userEvent.type(screen.getByLabelText(/sku/i), 'ab')
  await userEvent.type(screen.getByLabelText(/^name/i), 'Thing')
  await userEvent.type(screen.getByLabelText(/unit of measure/i), 'PCS')
  await userEvent.click(screen.getByRole('button', { name: /create/i }))
}

describe('ProductsPage', () => {
  it('FR-10 lists products with SKU, name, unit and on-hand', async () => {
    renderPage(<ProductsPage />, { as: 'OPERATOR', routes: { 'GET /api/v1/products': list } })
    expect(await screen.findByText('FRZ-CHK-001')).toBeInTheDocument()
    expect(screen.getByText('Frozen Chicken Breast 1kg')).toBeInTheDocument()
    expect(screen.getByText('40')).toBeInTheDocument()
  })

  it('AC-02.5 FR-04 the "New product" button is hidden for an operator', async () => {
    renderPage(<ProductsPage />, { as: 'OPERATOR', routes: { 'GET /api/v1/products': list } })
    await screen.findByText('FRZ-CHK-001')
    expect(screen.queryByRole('button', { name: /new product/i })).not.toBeInTheDocument()
  })

  it('AC-02.3 shows details.fields of a VALIDATION_ERROR under the input', async () => {
    renderPage(<ProductsPage />, {
      as: 'SUPERVISOR',
      routes: {
        'GET /api/v1/products': list,
        'POST /api/v1/products': () => ({
          status: 400,
          body: {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Validation failed',
              details: { fields: [{ field: 'sku', message: 'sku must be longer than or equal to 3 characters' }] },
            },
          },
        }),
      },
    })
    await submitNewProduct()
    expect(await screen.findByText('sku must be longer than or equal to 3 characters')).toBeInTheDocument()
    expect(screen.getByLabelText(/sku/i)).toHaveAttribute('aria-invalid', 'true')
  })

  it('AC-02.2 shows a 409 DUPLICATE_SKU as a form error', async () => {
    renderPage(<ProductsPage />, {
      as: 'SUPERVISOR',
      routes: {
        'GET /api/v1/products': list,
        'POST /api/v1/products': () => ({
          status: 409,
          body: { error: { code: 'DUPLICATE_SKU', message: 'A product with this SKU already exists.' } },
        }),
      },
    })
    await submitNewProduct()
    expect(await screen.findByRole('alert')).toHaveTextContent('A product with this SKU already exists.')
  })
})
