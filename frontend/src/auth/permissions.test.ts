import { describe, expect, it } from 'vitest'
import { can, type Action } from './permissions'

// Technical spec §8 authorization matrix: [action, OPERATOR, SUPERVISOR].
const MATRIX: [Action, boolean, boolean][] = [
  ['CREATE_PRODUCT', false, true],
  ['CREATE_DOCUMENT', false, true],
  ['EDIT_LINES', false, true],
  ['CHANGE_STATUS', false, true],
  ['RECORD_RECEIPT', true, true],
  ['REVERSE_RECEIPT', false, true],
]

describe('can()', () => {
  it.each(MATRIX)('FR-04 %s matches spec §8', (action, operator, supervisor) => {
    expect(can('OPERATOR', action)).toBe(operator)
    expect(can('SUPERVISOR', action)).toBe(supervisor)
  })
})
