import { describe, expect, it } from 'vitest'
import { formatDateTime, transactionParams } from './rules'

describe('formatDateTime', () => {
  it('shows a UTC timestamp in the local zone (tests run in UTC+7)', () => {
    expect(formatDateTime('2026-10-27T17:30:00.000Z')).toBe('2026-10-28 00:30')
  })
})

describe('transactionParams', () => {
  it('FR-41 maps product, local date range and page to the API query', () => {
    expect(
      transactionParams({ productId: 'p1', from: '2026-10-01', to: '2026-10-27', page: 2 }),
    ).toEqual({
      productId: 'p1',
      // Local midnight of the from day (inclusive) and of the day after the to day (exclusive).
      from: '2026-09-30T17:00:00.000Z',
      to: '2026-10-27T17:00:00.000Z',
      page: 2,
    })
  })

  it('leaves out filters that are not set', () => {
    expect(transactionParams({ page: 1 })).toEqual({ page: 1 })
  })
})
