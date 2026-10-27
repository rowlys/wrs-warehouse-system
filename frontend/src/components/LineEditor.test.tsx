import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { Product } from '../api/types'
import { renderPage } from '../test/utils'
import { LineEditor } from './LineEditor'
import type { Line } from './rules'

const product = (n: number, sku: string): Product => ({
  id: `10000000-0000-0000-0000-00000000000${n}`,
  sku,
  name: `Product ${sku}`,
  unitOfMeasure: 'CTN',
  description: null,
  quantityOnHand: 0,
  createdAt: '2026-10-27T08:00:00.000Z',
  updatedAt: '2026-10-27T08:00:00.000Z',
})
const p1 = product(1, 'FRZ-CHK-001')
const p2 = product(2, 'FRZ-FSH-002')
const products = () => ({
  status: 200,
  body: { data: [p1, p2], meta: { page: 1, pageSize: 20, totalItems: 2, totalPages: 1 } },
})

function Harness({ initial }: { initial: Line[] }) {
  const [lines, setLines] = useState(initial)
  return <LineEditor lines={lines} onChange={setLines} />
}

describe('LineEditor', () => {
  it('BR-06 a product already on another line cannot be picked again', async () => {
    renderPage(
      <Harness
        initial={[
          { key: 'a', product: p1, expectedQuantity: 5 },
          { key: 'b', product: null, expectedQuantity: '' },
        ]}
      />,
      { routes: { 'GET /api/v1/products': products } },
    )
    const pickers = screen.getAllByRole('textbox', { name: /product/i })
    await userEvent.click(pickers[1])
    const listbox = await screen.findByRole('listbox')
    const taken = await within(listbox).findByRole('option', { name: /FRZ-CHK-001/ })
    expect(taken).toHaveAttribute('data-combobox-disabled', 'true')

    await userEvent.click(taken)
    expect(pickers[1]).toHaveValue('')
    await userEvent.click(within(listbox).getByRole('option', { name: /FRZ-FSH-002/ }))
    expect(pickers[1]).toHaveValue('FRZ-FSH-002 — Product FRZ-FSH-002')
  })

  it('BR-05 the quantity input drops a decimal point and a minus sign', async () => {
    renderPage(<Harness initial={[{ key: 'a', product: p1, expectedQuantity: '' }]} />, {
      routes: { 'GET /api/v1/products': products },
    })
    const qty = screen.getByRole('textbox', { name: /expected quantity/i })
    await userEvent.type(qty, '-2.5')
    expect(qty).toHaveValue('25')
  })

  it('BR-05 a quantity of 0 is rejected with a message', async () => {
    renderPage(<Harness initial={[{ key: 'a', product: p1, expectedQuantity: '' }]} />, {
      routes: { 'GET /api/v1/products': products },
    })
    const qty = screen.getByRole('textbox', { name: /expected quantity/i })
    await userEvent.type(qty, '0')
    expect(await screen.findByText('Whole number from 1 to 1,000,000')).toBeInTheDocument()
    expect(qty).toHaveAttribute('aria-invalid', 'true')
  })
})
