import type { ReceivingDocumentDetail, ReceivingStatus, Role } from '../api/types'
import { can } from './permissions'

// Mirrors backend/src/modules/receiving/document-state.ts (spec §7).
const ALLOWED = {
  EDIT_ITEMS: ['DRAFT'],
  OPEN: ['DRAFT'],
  RECEIVE: ['OPEN', 'IN_PROGRESS'],
  REVERSE: ['IN_PROGRESS'],
  COMPLETE: ['IN_PROGRESS'],
  CLOSE_SHORT: ['IN_PROGRESS'],
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
    // In IN_PROGRESS a line is short exactly when not every line is fully received (BR-11).
    closeShort: status && allows('CLOSE_SHORT', doc.status) && !doc.allItemsReceived,
    cancel: status && allows('CANCEL', doc.status),
    /** Per receipt, only while it is not reversed (BR-19). */
    reverse: can(role, 'REVERSE_RECEIPT') && allows('REVERSE', doc.status),
    /** Per line, only while it is not fully received. */
    receive: can(role, 'RECORD_RECEIPT') && allows('RECEIVE', doc.status),
  }
}
