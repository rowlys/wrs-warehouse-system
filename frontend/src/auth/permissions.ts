import type { Role } from '../api/types'

// Technical spec §8. Listing and viewing are open to every role, so only gated actions appear.
const ALLOWED = {
  CREATE_PRODUCT: ['SUPERVISOR'],
  CREATE_DOCUMENT: ['SUPERVISOR'],
  EDIT_LINES: ['SUPERVISOR'],
  CHANGE_STATUS: ['SUPERVISOR'],
  RECORD_RECEIPT: ['OPERATOR', 'SUPERVISOR'],
  REVERSE_RECEIPT: ['SUPERVISOR'],
} satisfies Record<string, Role[]>

export type Action = keyof typeof ALLOWED

/** FR-04: whether the UI offers this action. The API enforces it again (FR-03). */
export const can = (role: Role | undefined, action: Action): boolean =>
  !!role && (ALLOWED[action] as Role[]).includes(role)
