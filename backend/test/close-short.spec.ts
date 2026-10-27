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

// Puts a document straight into a later status, satisfying the CHECK constraints (spec §3.2).
const FORCE: Record<
  'COMPLETED' | 'CLOSED_SHORT' | 'CANCELLED',
  Prisma.ReceivingDocumentUpdateInput
> = {
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

describe('close short (FR-35)', () => {
  let app: INestApplication<App>;
  let supervisorUser: User;
  let supervisor: string;
  let operator: string;

  const http = () => request(app.getHttpServer());
  const closeShort = (docId: string, body: object, token = supervisor) =>
    http()
      .post(`/api/v1/receiving-documents/${docId}/close-short`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const receive = (docId: string, itemId: string, quantity: number) =>
    http()
      .post(`/api/v1/receiving-documents/${docId}/items/${itemId}/receipts`)
      .set('Authorization', `Bearer ${operator}`)
      .set('Idempotency-Key', randomUUID())
      .send({ quantity });
  const statusOf = async (id: string) =>
    (await prisma.receivingDocument.findUniqueOrThrow({ where: { id } }))
      .status;

  /** OPEN document with one line expecting `expected`. */
  async function openDoc(expected = 100) {
    const product = await createProduct();
    const doc = await openDocument(
      (
        await createDraftDocument(
          [{ productId: product.id, expectedQuantity: expected }],
          supervisorUser,
        )
      ).id,
    );
    return { doc, item: doc.items[0], product };
  }

  /** IN_PROGRESS document: one line expecting 100 with 70 received. */
  async function shortDoc() {
    const d = await openDoc(100);
    expect((await receive(d.doc.id, d.item.id, 70)).status).toBe(201);
    return d;
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

  it('AC-08.1 FR-35 closes short with reason, time and user; stock unchanged; no further receipts', async () => {
    const { doc, item, product } = await shortDoc();
    const ledgerBefore = await prisma.inventoryTransaction.findMany({
      orderBy: { id: 'asc' },
    });

    const res = await closeShort(doc.id, {
      reason: '  Supplier out of stock ',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'CLOSED_SHORT',
      closeShortReason: 'Supplier out of stock',
      closedShortAt: expect.any(String) as string,
      closedShortBy: {
        id: supervisorUser.id,
        fullName: supervisorUser.fullName,
      },
      allItemsReceived: false,
      items: [
        {
          id: item.id,
          expectedQuantity: 100,
          receivedQuantity: 70,
          remainingQuantity: 30,
          isFullyReceived: false,
        },
      ],
    });

    const balance = await prisma.inventoryBalance.findUniqueOrThrow({
      where: { productId: product.id },
    });
    expect(balance.quantityOnHand).toBe(70);
    expect(
      await prisma.inventoryTransaction.findMany({ orderBy: { id: 'asc' } }),
    ).toEqual(ledgerBefore);

    const after = await receive(doc.id, item.id, 1);
    expect(after.status).toBe(409);
    expect(after.body).toMatchObject({
      error: { code: 'INVALID_DOCUMENT_STATUS' },
    });
  });

  it('AC-08.2 BR-11 every line fully received → 422 NOTHING_SHORT, status unchanged', async () => {
    const { doc, item } = await openDoc(10);
    expect((await receive(doc.id, item.id, 10)).status).toBe(201);

    const res = await closeShort(doc.id, { reason: 'Supplier out of stock' });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: { code: 'NOTHING_SHORT' } });
    expect(await statusOf(doc.id)).toBe('IN_PROGRESS');
  });

  it.each(['DRAFT', 'OPEN', 'COMPLETED', 'CLOSED_SHORT', 'CANCELLED'] as const)(
    'AC-08.3 close short on %s → 409 INVALID_STATUS_TRANSITION',
    async (status) => {
      const product = await createProduct();
      const doc = await createDraftDocument(
        [{ productId: product.id, expectedQuantity: 10 }],
        supervisorUser,
      );
      if (status === 'OPEN') await openDocument(doc.id);
      else if (status !== 'DRAFT') {
        await prisma.receivingDocument.update({
          where: { id: doc.id },
          data: FORCE[status],
        });
      }

      const res = await closeShort(doc.id, { reason: 'Supplier out of stock' });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        error: {
          code: 'INVALID_STATUS_TRANSITION',
          details: { currentStatus: status, action: 'CLOSE_SHORT' },
        },
      });
      expect(await statusOf(doc.id)).toBe(status);
    },
  );

  it.each([
    [{}],
    [{ reason: '' }],
    [{ reason: 'ab' }],
    [{ reason: '   ab  ' }],
  ])(
    'AC-08.4 BR-17 reason %j → 400 VALIDATION_ERROR, status unchanged',
    async (body) => {
      const { doc } = await shortDoc();
      const res = await closeShort(doc.id, body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          details: {
            fields: expect.arrayContaining([
              expect.objectContaining({ field: 'reason' }),
            ]) as unknown,
          },
        },
      });
      expect(await statusOf(doc.id)).toBe('IN_PROGRESS');
    },
  );

  it('FR-35 operator gets 403 FORBIDDEN, status unchanged', async () => {
    const { doc } = await shortDoc();
    const res = await closeShort(
      doc.id,
      { reason: 'Supplier out of stock' },
      operator,
    );
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(await statusOf(doc.id)).toBe('IN_PROGRESS');
  });

  it('FR-35 unknown document → 404 NOT_FOUND', async () => {
    const res = await closeShort(randomUUID(), {
      reason: 'Supplier out of stock',
    });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
