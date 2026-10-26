// Receiving document state machine (spec §7, PRD §9). Pure: no database access.
import { ReceivingStatus } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-code';

export type Action =
  | 'OPEN'
  | 'RECEIVE'
  | 'REVERSE'
  | 'COMPLETE'
  | 'CLOSE_SHORT'
  | 'CANCEL'
  | 'EDIT_ITEMS';

const ALLOWED: Record<Action, ReceivingStatus[]> = {
  EDIT_ITEMS: ['DRAFT'],
  OPEN: ['DRAFT'],
  RECEIVE: ['OPEN', 'IN_PROGRESS'],
  REVERSE: ['IN_PROGRESS'],
  COMPLETE: ['IN_PROGRESS'],
  CLOSE_SHORT: ['IN_PROGRESS'],
  CANCEL: ['DRAFT', 'OPEN'],
};

// Work done *within* a document vs. moving the document itself.
const DOCUMENT_STATUS_ACTIONS: Action[] = ['RECEIVE', 'REVERSE', 'EDIT_ITEMS'];

export function assertCan(action: Action, status: ReceivingStatus): void {
  if (ALLOWED[action].includes(status)) return;
  const code = DOCUMENT_STATUS_ACTIONS.includes(action)
    ? ErrorCode.INVALID_DOCUMENT_STATUS
    : ErrorCode.INVALID_STATUS_TRANSITION;
  throw new AppError(
    code,
    409,
    `Cannot ${action.toLowerCase().replace('_', ' ')} a document with status ${status}.`,
  );
}

/**
 * Status after `action`. REVERSE is excluded: its result depends on the data, so
 * ReceiptsService decides it (spec §6.2 step 14).
 */
export function nextStatus(
  action: Exclude<Action, 'REVERSE'>,
  status: ReceivingStatus,
): ReceivingStatus {
  assertCan(action, status);
  switch (action) {
    case 'OPEN':
      return 'OPEN';
    case 'RECEIVE':
      return 'IN_PROGRESS';
    case 'COMPLETE':
      return 'COMPLETED';
    case 'CLOSE_SHORT':
      return 'CLOSED_SHORT';
    case 'CANCEL':
      return 'CANCELLED';
    case 'EDIT_ITEMS':
      return status;
  }
}
