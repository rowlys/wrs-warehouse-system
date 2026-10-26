import { INestApplication } from '@nestjs/common';
import { Prisma, Product, User, UserRole } from '@prisma/client';
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

describe('POST /receiving-documents/:documentId/items/:itemId/receipts', () => {
  let app: INestApplication<App>;
  let operatorUser: User;
  let operator: string;
  let supervisor: string;
  let product: Product;

  const receive = (
    docId: string,
    itemId: string,
    body: unknown,
    {
      key = randomUUID(),
      token = operator,
    }: { key?: string | null; token?: string } = {},
  ) => {
    const req = request(app.getHttpServer())
      .post(`/api/v1/receiving-documents/${docId}/items/${itemId}/receipts`)
      .set('Authorization', `Bearer ${token}`);
    if (key !== null) req.set('Idempotency-Key', key);
    return body === undefined ? req : req.send(body as object);
  };

  /** OPEN document with one line expecting `expected` of `product`. */
  async function openDoc(expected = 100, p = product) {
    const draft = await createDraftDocument([
      { productId: p.id, expectedQuantity: expected },
    ]);
    const doc = await openDocument(draft.id);
    return { doc, item: doc.items[0] };
  }

  /** Everything a failed receipt must leave untouched. */
  async function snapshot(itemId: string) {
    const item = await prisma.receivingItem.findUniqueOrThrow({
      where: { id: itemId },
      include: { receivingDocument: { select: { status: true } } },
    });
    return {
      received: item.receivedQuantity,
      status: item.receivingDocument.status,
      receipts: await prisma.receipt.count(),
      ledger: await prisma.inventoryTransaction.count(),
      onHand: (
        await prisma.inventoryBalance.findUniqueOrThrow({
          where: { productId: item.productId },
        })
      ).quantityOnHand,
    };
  }

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await truncateAll();
    operatorUser = await createUser(UserRole.OPERATOR);
    operator = await loginAs(operatorUser);
    supervisor = await loginAs(UserRole.SUPERVISOR);
    product = await createProduct({ sku: 'FRZ-CHK-001' });
  });
  // BR-12 and BR-13 must hold after every scenario, successful or not.
  afterEach(() => assertInventoryConsistent());

  it('AC-04.1 FR-31 partial receipt updates line, stock, ledger and status atomically', async () => {
    const { doc, item } = await openDoc(100);
    const res = await receive(doc.id, item.id, { quantity: 40 });
    expect(res.status).toBe(201);
    const body = res.body as Body;
    expect(body).toEqual({
      receipt: {
        id: expect.any(String) as string,
        receivingItemId: item.id,
        productSku: 'FRZ-CHK-001',
        quantity: 40,
        receivedAt: expect.any(String) as string,
        receivedBy: { id: operatorUser.id, fullName: operatorUser.fullName },
        reversal: null,
      },
      item: {
        id: item.id,
        product: {
          id: product.id,
          sku: 'FRZ-CHK-001',
          name: product.name,
          unitOfMeasure: product.unitOfMeasure,
        },
        expectedQuantity: 100,
        receivedQuantity: 40,
        remainingQuantity: 60,
        isFullyReceived: false,
      },
      document: {
        id: doc.id,
        documentNumber: doc.documentNumber,
        status: 'IN_PROGRESS',
        allItemsReceived: false,
      },
      inventory: { productId: product.id, quantityOnHand: 40 },
    });

    const ledger = await prisma.inventoryTransaction.findMany();
    expect(ledger).toEqual([
      expect.objectContaining({
        productId: product.id,
        type: 'RECEIPT',
        quantityChange: 40,
        balanceAfter: 40,
        receiptId: (body.receipt as Body).id,
        receiptReversalId: null,
        receivingDocumentId: doc.id,
        createdById: operatorUser.id,
      }),
    ]);
    expect(
      (
        await prisma.receivingDocument.findUniqueOrThrow({
          where: { id: doc.id },
        })
      ).status,
    ).toBe('IN_PROGRESS');
  });

  it('AC-04.2 FR-32 a second partial receipt fills the line', async () => {
    const { doc, item } = await openDoc(100);
    expect((await receive(doc.id, item.id, { quantity: 40 })).status).toBe(201);
    const res = await receive(doc.id, item.id, { quantity: 60 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      item: {
        receivedQuantity: 100,
        remainingQuantity: 0,
        isFullyReceived: true,
      },
      document: { status: 'IN_PROGRESS', allItemsReceived: true },
      inventory: { quantityOnHand: 100 },
    });
    const ledger = await prisma.inventoryTransaction.findMany({
      orderBy: { id: 'asc' },
    });
    expect(ledger.map((t) => [t.quantityChange, t.balanceAfter])).toEqual([
      [40, 40],
      [60, 100],
    ]);
  });

  it('AC-04.3 BR-07 over-receipt → 422 with remaining, and nothing changes', async () => {
    const { doc, item } = await openDoc(100);
    await receive(doc.id, item.id, { quantity: 40 });
    const before = await snapshot(item.id);
    const res = await receive(doc.id, item.id, { quantity: 61 });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      error: {
        code: 'QUANTITY_EXCEEDS_REMAINING',
        message: 'Cannot receive 61 units; only 60 remaining for FRZ-CHK-001.',
        details: { remainingQuantity: 60, requestedQuantity: 61 },
      },
    });
    expect(await snapshot(item.id)).toEqual(before);
  });

  it('BR-07 a fully received line accepts nothing more', async () => {
    const { doc, item } = await openDoc(5);
    await receive(doc.id, item.id, { quantity: 5 });
    const res = await receive(doc.id, item.id, { quantity: 1 });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: { details: { remainingQuantity: 0, requestedQuantity: 1 } },
    });
  });

  it.each([
    ['0', { quantity: 0 }],
    ['-1', { quantity: -1 }],
    ['1.5', { quantity: 1.5 }],
    ['"ten"', { quantity: 'ten' }],
    ['1000001', { quantity: 1_000_001 }],
    ['missing body', undefined],
  ])(
    'AC-04.4 BR-07 quantity %s → 400 VALIDATION_ERROR, nothing changes',
    async (_, body) => {
      const { doc, item } = await openDoc(100);
      const before = await snapshot(item.id);
      const res = await receive(doc.id, item.id, body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          details: {
            fields: expect.arrayContaining([
              expect.objectContaining({ field: 'quantity' }),
            ]) as unknown,
          },
        },
      });
      expect(await snapshot(item.id)).toEqual(before);
    },
  );

  it.each(['DRAFT', 'COMPLETED', 'CLOSED_SHORT', 'CANCELLED'] as const)(
    'AC-04.5 BR-08 receiving on %s → 409 INVALID_DOCUMENT_STATUS, nothing changes',
    async (status) => {
      const draft = await createDraftDocument([
        { productId: product.id, expectedQuantity: 100 },
      ]);
      if (status !== 'DRAFT') {
        await prisma.receivingDocument.update({
          where: { id: draft.id },
          data: FORCE[status],
        });
      }
      const item = draft.items[0];
      const before = await snapshot(item.id);
      const res = await receive(draft.id, item.id, { quantity: 1 });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        error: {
          code: 'INVALID_DOCUMENT_STATUS',
          details: { currentStatus: status, action: 'RECEIVE' },
        },
      });
      expect(await snapshot(item.id)).toEqual(before);
    },
  );

  it.each([
    ['missing', null],
    ['too short', 'abc1234'],
    ['too long', 'k'.repeat(101)],
    ['invalid characters', 'key with spaces!'],
  ])(
    'BR-09 Idempotency-Key %s → 400 VALIDATION_ERROR, nothing changes',
    async (_, key) => {
      const { doc, item } = await openDoc(100);
      const before = await snapshot(item.id);
      const res = await receive(doc.id, item.id, { quantity: 1 }, { key });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          details: {
            fields: [expect.objectContaining({ field: 'Idempotency-Key' })],
          },
        },
      });
      expect(await snapshot(item.id)).toEqual(before);
    },
  );

  it('BR-09 accepts keys of exactly 8 and 100 allowed characters', async () => {
    const { doc, item } = await openDoc(100);
    expect(
      (await receive(doc.id, item.id, { quantity: 1 }, { key: 'abc_-123' }))
        .status,
    ).toBe(201);
    expect(
      (
        await receive(
          doc.id,
          item.id,
          { quantity: 1 },
          { key: 'k'.repeat(100) },
        )
      ).status,
    ).toBe(201);
  });

  it('returns 404 for a line of another document, and for an unknown document', async () => {
    const a = await openDoc(10);
    const b = await openDoc(10, await createProduct());
    const before = await snapshot(b.item.id);
    const other = await receive(a.doc.id, b.item.id, { quantity: 1 });
    expect(other.status).toBe(404);
    expect(other.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    const unknown = await receive(
      '00000000-0000-4000-8000-000000000000',
      a.item.id,
      {
        quantity: 1,
      },
    );
    expect(unknown.status).toBe(404);
    expect(await snapshot(b.item.id)).toEqual(before);
  });

  it('BR-12 on-hand accumulates across documents for the same product', async () => {
    const a = await openDoc(50);
    const b = await openDoc(50);
    await receive(a.doc.id, a.item.id, { quantity: 30 });
    const res = await receive(
      b.doc.id,
      b.item.id,
      { quantity: 20 },
      { token: supervisor },
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ inventory: { quantityOnHand: 50 } });
    const ledger = await prisma.inventoryTransaction.findMany({
      orderBy: { id: 'asc' },
    });
    expect(ledger.map((t) => [t.receivingDocumentId, t.balanceAfter])).toEqual([
      [a.doc.id, 30],
      [b.doc.id, 50],
    ]);
  });

  it('requires a token', async () => {
    const { doc, item } = await openDoc(10);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/receiving-documents/${doc.id}/items/${item.id}/receipts`)
      .set('Idempotency-Key', randomUUID())
      .send({ quantity: 1 });
    expect(res.status).toBe(401);
  });
});
