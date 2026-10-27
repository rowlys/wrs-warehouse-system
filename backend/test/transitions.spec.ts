import { INestApplication } from '@nestjs/common';
import { Prisma, User, UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  assertInventoryConsistent,
  createDraftDocument,
  createProduct,
  createTestApp,
  createUser,
  loginAs,
  openDocument,
  prisma,
  truncateAll,
} from './helpers';

type Body = Record<string, unknown>;

// Puts a document straight into a later status, satisfying the CHECK constraints (spec §3.2).
const FORCE: Record<
  'IN_PROGRESS' | 'COMPLETED' | 'CLOSED_SHORT' | 'CANCELLED',
  Prisma.ReceivingDocumentUpdateInput
> = {
  IN_PROGRESS: { status: 'IN_PROGRESS', openedAt: new Date() },
  COMPLETED: { status: 'COMPLETED', completedAt: new Date() },
  CLOSED_SHORT: {
    status: 'CLOSED_SHORT',
    closedShortAt: new Date(),
    closeShortReason: 'Supplier out of stock',
  },
  CANCELLED: {
    status: 'CANCELLED',
    cancelledAt: new Date(),
    cancelReason: 'Order withdrawn',
  },
};

describe('document transitions: open, complete, cancel', () => {
  let app: INestApplication<App>;
  let supervisorUser: User;
  let supervisor: string;
  let operator: string;

  const http = () => request(app.getHttpServer());
  const act = (
    docId: string,
    action: 'open' | 'complete' | 'cancel',
    body?: object,
    token = supervisor,
  ) =>
    http()
      .post(`/api/v1/receiving-documents/${docId}/${action}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const statusOf = async (id: string) =>
    (await prisma.receivingDocument.findUniqueOrThrow({ where: { id } }))
      .status;

  async function draftWithLine() {
    const product = await createProduct();
    return createDraftDocument(
      [{ productId: product.id, expectedQuantity: 10 }],
      supervisorUser,
    );
  }
  async function inStatus(status: keyof typeof FORCE | 'DRAFT' | 'OPEN') {
    const doc = await draftWithLine();
    if (status === 'OPEN') await openDocument(doc.id);
    else if (status !== 'DRAFT') {
      await prisma.receivingDocument.update({
        where: { id: doc.id },
        data: FORCE[status],
      });
    }
    return doc;
  }

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await truncateAll();
    supervisorUser = await createUser(UserRole.SUPERVISOR);
    supervisor = await loginAs(supervisorUser);
    operator = await loginAs(UserRole.OPERATOR);
  });
  afterEach(() => assertInventoryConsistent());

  describe('POST /open', () => {
    it('AC-03.4 BR-11 a DRAFT with no lines → 422 DOCUMENT_HAS_NO_ITEMS, stays DRAFT', async () => {
      const doc = await createDraftDocument([], supervisorUser);
      const res = await act(doc.id, 'open');
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        error: { code: 'DOCUMENT_HAS_NO_ITEMS' },
      });
      expect(await statusOf(doc.id)).toBe('DRAFT');
    });

    it('AC-03.5 FR-27 opens a DRAFT with lines, records who and when, and locks the lines', async () => {
      const doc = await draftWithLine();
      const before = Date.now();
      const res = await act(doc.id, 'open');
      expect(res.status).toBe(200);
      const body = res.body as Body;
      expect(body).toMatchObject({
        id: doc.id,
        status: 'OPEN',
        openedBy: { id: supervisorUser.id, fullName: supervisorUser.fullName },
      });
      expect(Date.parse(body.openedAt as string)).toBeGreaterThanOrEqual(
        before - 1000,
      );

      const edit = await http()
        .patch(`/api/v1/receiving-documents/${doc.id}/items/${doc.items[0].id}`)
        .set('Authorization', `Bearer ${supervisor}`)
        .send({ expectedQuantity: 5 });
      expect(edit.status).toBe(409);
      expect(edit.body).toMatchObject({
        error: { code: 'INVALID_DOCUMENT_STATUS' },
      });
    });

    it.each([
      'OPEN',
      'IN_PROGRESS',
      'COMPLETED',
      'CLOSED_SHORT',
      'CANCELLED',
    ] as const)(
      'BR-11 open on %s → 409 INVALID_STATUS_TRANSITION with current status and action',
      async (status) => {
        const doc = await inStatus(status);
        const res = await act(doc.id, 'open');
        expect(res.status).toBe(409);
        expect(res.body).toEqual({
          error: {
            code: 'INVALID_STATUS_TRANSITION',
            message: `Cannot open a document with status ${status}.`,
            details: { currentStatus: status, action: 'OPEN' },
          },
        });
        expect(await statusOf(doc.id)).toBe(status);
      },
    );
  });

  describe('POST /complete', () => {
    const receive = (docId: string, itemId: string, quantity: number) =>
      http()
        .post(`/api/v1/receiving-documents/${docId}/items/${itemId}/receipts`)
        .set('Authorization', `Bearer ${operator}`)
        .set('Idempotency-Key', randomUUID())
        .send({ quantity });

    it('AC-05.1 FR-28 completes a fully received IN_PROGRESS document; no further receipts', async () => {
      const doc = await openDocument((await draftWithLine()).id);
      const item = doc.items[0];
      expect((await receive(doc.id, item.id, 10)).status).toBe(201);

      const res = await act(doc.id, 'complete');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'COMPLETED',
        allItemsReceived: true,
        completedAt: expect.any(String) as string,
        completedBy: {
          id: supervisorUser.id,
          fullName: supervisorUser.fullName,
        },
      });

      const after = await receive(doc.id, item.id, 1);
      expect(after.status).toBe(409);
      expect(after.body).toMatchObject({
        error: { code: 'INVALID_DOCUMENT_STATUS' },
      });
      await assertInventoryConsistent();
    });

    it('AC-05.2 BR-11 incomplete lines → 422 ITEMS_NOT_FULLY_RECEIVED with their ids, status unchanged', async () => {
      const [p1, p2] = [await createProduct(), await createProduct()];
      const doc = await openDocument(
        (
          await createDraftDocument(
            [
              { productId: p1.id, expectedQuantity: 10 },
              { productId: p2.id, expectedQuantity: 10 },
            ],
            supervisorUser,
          )
        ).id,
      );
      const full = doc.items.find((i) => i.productId === p1.id)!;
      const partial = doc.items.find((i) => i.productId === p2.id)!;
      await receive(doc.id, full.id, 10);
      await receive(doc.id, partial.id, 4);

      const res = await act(doc.id, 'complete');
      expect(res.status).toBe(422);
      expect(res.body).toEqual({
        error: {
          code: 'ITEMS_NOT_FULLY_RECEIVED',
          message: '1 of 2 items are not fully received.',
          details: { incompleteItemIds: [partial.id] },
        },
      });
      expect(await statusOf(doc.id)).toBe('IN_PROGRESS');
      await assertInventoryConsistent();
    });

    it.each([
      'DRAFT',
      'OPEN',
      'COMPLETED',
      'CLOSED_SHORT',
      'CANCELLED',
    ] as const)(
      'AC-05.3 complete on %s → 409 INVALID_STATUS_TRANSITION',
      async (status) => {
        const doc = await inStatus(status);
        const res = await act(doc.id, 'complete');
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({
          error: {
            code: 'INVALID_STATUS_TRANSITION',
            details: { currentStatus: status, action: 'COMPLETE' },
          },
        });
        expect(await statusOf(doc.id)).toBe(status);
      },
    );
  });

  describe('POST /cancel', () => {
    it.each(['DRAFT', 'OPEN'] as const)(
      'AC-05.4 FR-29 cancels a %s document with reason, time and user recorded',
      async (status) => {
        const doc = await inStatus(status);
        const res = await act(doc.id, 'cancel', {
          reason: '  Supplier cancelled shipment  ',
        });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          status: 'CANCELLED',
          cancelReason: 'Supplier cancelled shipment',
          cancelledAt: expect.any(String) as string,
          cancelledBy: {
            id: supervisorUser.id,
            fullName: supervisorUser.fullName,
          },
        });
      },
    );

    it.each(['IN_PROGRESS', 'COMPLETED', 'CLOSED_SHORT', 'CANCELLED'] as const)(
      'AC-05.5 BR-15 cancel on %s → 409 INVALID_STATUS_TRANSITION',
      async (status) => {
        const doc = await inStatus(status);
        const res = await act(doc.id, 'cancel', { reason: 'Too late now' });
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({
          error: { code: 'INVALID_STATUS_TRANSITION' },
        });
        expect(await statusOf(doc.id)).toBe(status);
      },
    );

    it.each([
      [{ reason: '' }],
      [{ reason: '   ' }],
      [{ reason: '  ab  ' }],
      [{ reason: 'R'.repeat(501) }],
      [{}],
      [{ reason: 'Valid reason', extra: 1 }],
    ])('AC-05.6 BR-15 rejects %j with 400 VALIDATION_ERROR', async (body) => {
      const doc = await inStatus('DRAFT');
      const res = await act(doc.id, 'cancel', body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
      expect(await statusOf(doc.id)).toBe('DRAFT');
    });

    it('BR-15 accepts a reason of exactly 3 and 500 characters', async () => {
      const a = await inStatus('DRAFT');
      const b = await inStatus('DRAFT');
      expect((await act(a.id, 'cancel', { reason: 'abc' })).status).toBe(200);
      expect(
        (await act(b.id, 'cancel', { reason: 'R'.repeat(500) })).status,
      ).toBe(200);
    });
  });

  it('FR-27–FR-29 operator gets 403 FORBIDDEN on open, complete and cancel', async () => {
    const draft = await inStatus('DRAFT');
    const inProgress = await inStatus('IN_PROGRESS');
    const responses = [
      await act(draft.id, 'open', undefined, operator),
      await act(inProgress.id, 'complete', undefined, operator),
      await act(draft.id, 'cancel', { reason: 'Not mine' }, operator),
    ];
    for (const res of responses) {
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
    }
    expect(await statusOf(draft.id)).toBe('DRAFT');
    expect(await statusOf(inProgress.id)).toBe('IN_PROGRESS');
  });

  it.each(['open', 'complete', 'cancel'] as const)(
    '%s on an unknown document → 404 NOT_FOUND',
    async (action) => {
      const res = await act(
        '00000000-0000-4000-8000-000000000000',
        action,
        action === 'cancel' ? { reason: 'Gone away' } : undefined,
      );
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    },
  );
});
