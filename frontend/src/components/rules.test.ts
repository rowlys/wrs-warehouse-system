import { describe, expect, it } from 'vitest'
import { quantityError } from './rules'

describe('quantityError', () => {
  it.each([0, -5, 2.5, 1_000_001, ''])('BR-05 rejects %p', (v) => {
    expect(quantityError(v)).toBe('Whole number from 1 to 1,000,000')
  })

  it.each([1, 1_000_000])('BR-05 accepts %p', (v) => {
    expect(quantityError(v)).toBeNull()
  })
})
