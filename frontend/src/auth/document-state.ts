import type { ReceivingDocumentDetail, ReceivingStatus, Role } from '../api/types'
import { can } from './permissions'

// Mirrors backend/src/modules/receiving/document-state.ts (spec §7).
const ALLOWED = {
  EDIT_ITEMS: ['DRAFT'],
  OPEN: ['DRAFT'],
  COMPLETE: ['IN_PROGRESS'],
  CANCEL: ['DRAFT', 'OPEN'],
} satisfies Record<string, ReceivingStatus[]>

const allows = (action: keyof typeof ALLOWED, status: ReceivingStatus) =>
  (ALLOWED[action] as ReceivingStatus[]).includes(status)

/** Which buttons the detail page shows: role (spec §8), status (§7) and the visible guards. */
export function documentActions(role: Role | undefined, doc: Pick<ReceivingDocumentDetail, 'status' | 'allItemsReceived'>) {
  const lines = can(role, 'EDIT_LINES')
  const status = can(role, 'CHANGE_STATUS')
  return {
    editLines: lines && allows('EDIT_ITEMS', doc.status),
    open: status && allows('OPEN', doc.status),
    complete: status && allows('COMPLETE', doc.status) && doc.allItemsReceived,
    cancel: status && allows('CANCEL', doc.status),
  }
}
