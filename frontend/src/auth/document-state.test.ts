import { describe, expect, it } from 'vitest'
import type { ReceivingStatus, Role } from '../api/types'
import { documentActions } from './document-state'

type Shown = 'editLines' | 'open' | 'complete' | 'cancel'

// Spec §7 ALLOWED × §8 roles, plus the complete guard (all lines fully received).
const SUPERVISOR: [ReceivingStatus, boolean, Shown[]][] = [
  ['DRAFT', false, ['editLines', 'open', 'cancel']],
  ['OPEN', false, ['cancel']],
  ['IN_PROGRESS', false, []],
  ['IN_PROGRESS', true, ['complete']],
  ['COMPLETED', true, []],
  ['CLOSED_SHORT', false, []],
  ['CANCELLED', false, []],
]

const shown = (role: Role, status: ReceivingStatus, allItemsReceived: boolean) => {
  const a = documentActions(role, { status, allItemsReceived })
  return (['editLines', 'open', 'complete', 'cancel'] as const).filter((k) => a[k])
}

describe('documentActions', () => {
  it.each(SUPERVISOR)('FR-24–FR-29 supervisor on %s (all received: %s) sees %j', (status, all, expected) => {
    expect(shown('SUPERVISOR', status, all)).toEqual(expected)
  })

  it.each(SUPERVISOR)('FR-04 operator on %s (all received: %s) sees no document actions', (status, all) => {
    expect(shown('OPERATOR', status, all)).toEqual([])
  })
})
