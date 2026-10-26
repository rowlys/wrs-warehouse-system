import { ReceivingStatus } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-code';
import { Action, assertCan, nextStatus } from './document-state';

const STATUSES = Object.values(ReceivingStatus);

// Expected matrix written out independently of the implementation (spec §7, PRD §9).
const EXPECTED: Record<
  Action,
  { allowed: ReceivingStatus[]; error: ErrorCode }
> = {
  EDIT_ITEMS: { allowed: ['DRAFT'], error: ErrorCode.INVALID_DOCUMENT_STATUS },
  OPEN: { allowed: ['DRAFT'], error: ErrorCode.INVALID_STATUS_TRANSITION },
  RECEIVE: {
    allowed: ['OPEN', 'IN_PROGRESS'],
    error: ErrorCode.INVALID_DOCUMENT_STATUS,
  },
  REVERSE: {
    allowed: ['IN_PROGRESS'],
    error: ErrorCode.INVALID_DOCUMENT_STATUS,
  },
  COMPLETE: {
    allowed: ['IN_PROGRESS'],
    error: ErrorCode.INVALID_STATUS_TRANSITION,
  },
  CLOSE_SHORT: {
    allowed: ['IN_PROGRESS'],
    error: ErrorCode.INVALID_STATUS_TRANSITION,
  },
  CANCEL: {
    allowed: ['DRAFT', 'OPEN'],
    error: ErrorCode.INVALID_STATUS_TRANSITION,
  },
};

const CASES = (Object.keys(EXPECTED) as Action[]).flatMap((action) =>
  STATUSES.map((status) => ({
    action,
    status,
    allowed: EXPECTED[action].allowed.includes(status),
    error: EXPECTED[action].error,
  })),
);

describe('document-state', () => {
  it('covers 7 actions × 6 statuses', () => {
    expect(CASES).toHaveLength(42);
  });

  it.each(CASES)(
    'BR-11 $action on $status → allowed=$allowed',
    ({ action, status, allowed, error }) => {
      if (allowed) {
        expect(() => assertCan(action, status)).not.toThrow();
        return;
      }
      let thrown: unknown;
      try {
        assertCan(action, status);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(AppError);
      expect(thrown).toMatchObject({
        code: error,
        httpStatus: 409,
        details: { currentStatus: status, action },
      });
    },
  );

  it.each([
    ['OPEN', 'DRAFT', 'OPEN'],
    ['RECEIVE', 'OPEN', 'IN_PROGRESS'],
    ['RECEIVE', 'IN_PROGRESS', 'IN_PROGRESS'],
    ['COMPLETE', 'IN_PROGRESS', 'COMPLETED'],
    ['CLOSE_SHORT', 'IN_PROGRESS', 'CLOSED_SHORT'],
    ['CANCEL', 'DRAFT', 'CANCELLED'],
    ['CANCEL', 'OPEN', 'CANCELLED'],
    ['EDIT_ITEMS', 'DRAFT', 'DRAFT'],
  ] as const)('nextStatus(%s, %s) → %s', (action, status, expected) => {
    expect(nextStatus(action, status)).toBe(expected);
  });

  it('nextStatus rejects a disallowed transition with the same error as assertCan', () => {
    expect(() => nextStatus('COMPLETE', 'OPEN')).toThrow(
      expect.objectContaining({
        code: ErrorCode.INVALID_STATUS_TRANSITION,
      }) as Error,
    );
  });
});
