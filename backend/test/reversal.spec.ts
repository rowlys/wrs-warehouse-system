import { INestApplication } from '@nestjs/common';
import { User, UserRole } from '@prisma/client';
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

const errorCode = (res: request.Response) =>
  ((res.body as Body).error as Body).code;

// Races repeat so both orderings get a chance to occur in a single run.
const ROUNDS = 5;

describe('receipt reversal (FR-36, FR-37)', () => {
  let app: INestApplication<App>;
  let supervisorUser: User;
  let supervisor: string;
  let operator: string;

  const http = () => request(app.getHttpServer());
  const receive = (docId: string, itemId: string, quantity: number) =>
    http()
      .post(`/api/v1/receiving-documents/${docId}/items/${itemId}/receipts`)
      .set('Authorization', `Bearer ${operator}`)
      .set('Idempotency-Key', randomUUID())
      .send({ quantity });
  const reverse = (
    docId: string,
    receiptId: string,
    body: object = { reason: 'Typo, counted 10' },
    token = supervisor,
  ) =>
    http()
      .post(
        `/api/v1/receiving-documents/${docId}/receipts/${receiptId}/reverse`,
      )
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  /** Receives `quantity` and returns the new receipt's id. */
  async function received(docId: string, itemId: string, quantity: number) {
    const res = await receive(docId, itemId, quantity);
    expect(res.status).toBe(201);
    return ((res.body as Body).receipt as Body).id as string;
  }

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

  const onHand = async (productId: string) =>
    (await prisma.inventoryBalance.findUniqueOrThrow({ where: { productId } }))
      .quantityOnHand;
  const receivedQty = async (itemId: string) =>
    (await prisma.receivingItem.findUniqueOrThrow({ where: { id: itemId } }))
      .receivedQuantity;
  const statusOf = async (id: string) =>
    (await prisma.receivingDocument.findUniqueOrThrow({ where: { id } }))
      .status;

  /** Everything a rejected reversal must leave untouched. */
  const state = async () => ({
    reversals: await prisma.receiptReversal.findMany(),
    receipts: await prisma.receipt.findMany({ orderBy: { id: 'asc' } }),
    ledger: await prisma.inventoryTransaction.findMany({
      orderBy: { id: 'asc' },
    }),
    items: await prisma.receivingItem.findMany({ orderBy: { id: 'asc' } }),
    balances: await prisma.inventoryBalance.findMany({
      orderBy: { productId: 'asc' },
    }),
    documents: await prisma.receivingDocument.findMany({
      orderBy: { id: 'asc' },
    }),
  });

  beforeAll(async () => {
    app = await createTestApp();
    // One listening server; otherwise supertest starts one per parallel request.
    await app.listen(0);
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await truncateAll();
    supervisorUser = await createUser(UserRole.SUPERVISOR);
    supervisor = await loginAs(supervisorUser);
    operator = await loginAs(UserRole.OPERATOR);
  });
  afterEach(() => assertInventoryConsistent());

  /** AC-09.1 setup: one line expecting 100, one receipt R of 100, on-hand 100. */
  async function fullyReceived() {
    const d = await openDoc(100);
    const receiptId = await received(d.doc.id, d.item.id, 100);
    return { ...d, receiptId };
  }

  it('AC-09.1 FR-37 reversing the only receipt zeroes line and stock, logs −100, and reopens the document', async () => {
    const { doc, item, product, receiptId } = await fullyReceived();
    const originalReceipt = await prisma.receipt.findUniqueOrThrow({
      where: { id: receiptId },
    });
    const originalTx = await prisma.inventoryTransaction.findUniqueOrThrow({
      where: { receiptId },
    });

    const res = await reverse(doc.id, receiptId, {
      reason: '  Typo, counted 10 ',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: doc.id,
      status: 'OPEN',
      items: [{ id: item.id, receivedQuantity: 0, remainingQuantity: 100 }],
      receipts: [
        {
          id: receiptId,
          quantity: 100,
          reversal: {
            id: expect.any(String) as string,
            reason: 'Typo, counted 10',
            reversedAt: expect.any(String) as string,
            reversedBy: {
              id: supervisorUser.id,
              fullName: supervisorUser.fullName,
            },
          },
        },
      ],
    });
    const reversalId = (
      ((res.body as Body).receipts as Body[])[0].reversal as Body
    ).id as string;

    expect(await receivedQty(item.id)).toBe(0);
    expect(await onHand(product.id)).toBe(0);
    expect(
      await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } }),
    ).toEqual(originalReceipt);
    expect(
      await prisma.inventoryTransaction.findUniqueOrThrow({
        where: { receiptId },
      }),
    ).toEqual(originalTx);

    // Opened-by stays from the original open (spec §6.2 step 14).
    const after = await prisma.receivingDocument.findUniqueOrThrow({
      where: { id: doc.id },
    });
    expect(after.openedAt).toEqual(doc.openedAt);
    expect(after.openedById).toBe(doc.openedById);

    const ledger = await http()
      .get(`/api/v1/inventory/transactions?productId=${product.id}`)
      .set('Authorization', `Bearer ${operator}`);
    expect(ledger.status).toBe(200);
    expect((ledger.body as Body).data).toEqual([
      expect.objectContaining({
        type: 'RECEIPT_REVERSAL',
        quantityChange: -100,
        balanceAfter: 0,
        receiptId: null,
        receiptReversalId: reversalId,
        receivingDocument: { id: doc.id, documentNumber: doc.documentNumber },
        createdBy: {
          id: supervisorUser.id,
          fullName: supervisorUser.fullName,
        },
      }),
      expect.objectContaining({
        type: 'RECEIPT',
        quantityChange: 100,
        balanceAfter: 100,
        receiptId,
      }),
    ]);
  });

  it('AC-09.2 receiving again after a full reversal → IN_PROGRESS, ledger +100, −100, +10', async () => {
    const { doc, item, product, receiptId } = await fullyReceived();
    expect((await reverse(doc.id, receiptId)).status).toBe(200);

    await received(doc.id, item.id, 10);
    expect(await receivedQty(item.id)).toBe(10);
    expect(await onHand(product.id)).toBe(10);
    expect(await statusOf(doc.id)).toBe('IN_PROGRESS');

    const ledger = await prisma.inventoryTransaction.findMany({
      where: { productId: product.id },
      orderBy: { id: 'asc' },
    });
    expect(ledger.map((t) => [t.quantityChange, t.balanceAfter])).toEqual([
      [100, 100],
      [-100, 0],
      [10, 10],
    ]);
  });

  /** AC-09.3 setup: receipts of 40 and 60 on one line expecting 100. */
  async function fortyAndSixty() {
    const d = await openDoc(100);
    await received(d.doc.id, d.item.id, 40);
    const sixty = await received(d.doc.id, d.item.id, 60);
    return { ...d, sixty };
  }

  it('AC-09.3 reversing one of two receipts keeps the other and stays IN_PROGRESS', async () => {
    const { doc, item, product, sixty } = await fortyAndSixty();
    expect(await onHand(product.id)).toBe(100);

    const res = await reverse(doc.id, sixty);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'IN_PROGRESS',
      items: [{ receivedQuantity: 40, remainingQuantity: 60 }],
    });
    expect(await receivedQty(item.id)).toBe(40);
    expect(await onHand(product.id)).toBe(40);
  });

  it('AC-09.4 BR-19 reversing the same receipt again → 409 RECEIPT_ALREADY_REVERSED, nothing changes', async () => {
    const { doc, sixty } = await fortyAndSixty();
    expect((await reverse(doc.id, sixty)).status).toBe(200);
    const before = await state();

    const res = await reverse(doc.id, sixty);
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('RECEIPT_ALREADY_REVERSED');
    expect(await state()).toEqual(before);
  });

  it('AC-09.4 BR-19 two parallel reversals of the same receipt → exactly one 200', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { doc, item, product, sixty } = await fortyAndSixty();
      const responses = await Promise.all([
        reverse(doc.id, sixty),
        reverse(doc.id, sixty),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(errorCode(responses.find((r) => r.status === 409)!)).toBe(
        'RECEIPT_ALREADY_REVERSED',
      );
      expect(
        await prisma.receiptReversal.count({ where: { receiptId: sixty } }),
      ).toBe(1);
      expect(await receivedQty(item.id)).toBe(40);
      expect(await onHand(product.id)).toBe(40);
    }
  });

  it('BR-13 BR-14 a reversal racing a receipt on the same line → both succeed, totals exact', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      // Either order ends at 40: reverse 60 then receive 40, or receive 40 (100) then reverse 60.
      const { doc, item, product } = await openDoc(100);
      const sixty = await received(doc.id, item.id, 60);
      const [rev, rec] = await Promise.all([
        reverse(doc.id, sixty),
        receive(doc.id, item.id, 40),
      ]);
      expect([rev.status, rec.status]).toEqual([200, 201]);
      expect(await receivedQty(item.id)).toBe(40);
      expect(await onHand(product.id)).toBe(40);
      expect(await statusOf(doc.id)).toBe('IN_PROGRESS');
      await assertInventoryConsistent();
    }
  });

  it('AC-09.5 BR-18 OPEN after a full reversal → 409 INVALID_DOCUMENT_STATUS, nothing changes', async () => {
    const { doc, item, receiptId } = await fullyReceived();
    expect((await reverse(doc.id, receiptId)).status).toBe(200);
    // A second receipt that is reversed too, so the OPEN document still has an unreversed one to try.
    const other = await received(doc.id, item.id, 5);
    expect((await reverse(doc.id, other)).status).toBe(200);
    expect(await statusOf(doc.id)).toBe('OPEN');
    const before = await state();

    const res = await reverse(doc.id, receiptId);
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('INVALID_DOCUMENT_STATUS');
    expect(await state()).toEqual(before);
  });

  it('AC-09.5 BR-18 COMPLETED document → 409 INVALID_DOCUMENT_STATUS, nothing changes', async () => {
    const { doc, receiptId } = await fullyReceived();
    const done = await http()
      .post(`/api/v1/receiving-documents/${doc.id}/complete`)
      .set('Authorization', `Bearer ${supervisor}`);
    expect(done.status).toBe(200);
    const before = await state();

    const res = await reverse(doc.id, receiptId);
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('INVALID_DOCUMENT_STATUS');
    expect(await state()).toEqual(before);
  });

  it('AC-09.5 BR-18 CLOSED_SHORT document → 409 INVALID_DOCUMENT_STATUS, nothing changes', async () => {
    const { doc, item } = await openDoc(100);
    const receiptId = await received(doc.id, item.id, 70);
    const closed = await http()
      .post(`/api/v1/receiving-documents/${doc.id}/close-short`)
      .set('Authorization', `Bearer ${supervisor}`)
      .send({ reason: 'Supplier out of stock' });
    expect(closed.status).toBe(200);
    const before = await state();

    const res = await reverse(doc.id, receiptId);
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('INVALID_DOCUMENT_STATUS');
    expect(await state()).toEqual(before);
  });

  it('AC-09.6 BR-18 a receipt of another document → 404 NOT_FOUND, nothing changes', async () => {
    const a = await openDoc(100);
    const b = await openDoc(100);
    await received(a.doc.id, a.item.id, 10);
    const receiptOfB = await received(b.doc.id, b.item.id, 10);
    const before = await state();

    const res = await reverse(a.doc.id, receiptOfB);
    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('NOT_FOUND');
    expect(await state()).toEqual(before);
  });

  it('AC-09.6 an unknown receipt or document → 404 NOT_FOUND', async () => {
    const { doc, receiptId } = await fullyReceived();
    const unknownReceipt = await reverse(doc.id, randomUUID());
    expect(unknownReceipt.status).toBe(404);
    expect(errorCode(unknownReceipt)).toBe('NOT_FOUND');
    const unknownDoc = await reverse(randomUUID(), receiptId);
    expect(unknownDoc.status).toBe(404);
    expect(errorCode(unknownDoc)).toBe('NOT_FOUND');
  });

  it.each([
    [{}],
    [{ reason: '' }],
    [{ reason: 'ab' }],
    [{ reason: '   ab  ' }],
  ])(
    'AC-09.6 BR-17 reason %j → 400 VALIDATION_ERROR, nothing changes',
    async (body) => {
      const { doc, receiptId } = await fullyReceived();
      const before = await state();
      const res = await reverse(doc.id, receiptId, body);
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
      expect(await state()).toEqual(before);
    },
  );

  it('AC-09.6 a receiptId that is not a UUID → 400 VALIDATION_ERROR', async () => {
    const { doc } = await fullyReceived();
    const res = await reverse(doc.id, 'not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        details: { fields: [{ field: 'receiptId' }] },
      },
    });
  });

  it('AC-09.6 FR-36 operator gets 403 FORBIDDEN, nothing changes', async () => {
    const { doc, receiptId } = await fullyReceived();
    const before = await state();
    const res = await reverse(doc.id, receiptId, undefined, operator);
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('FORBIDDEN');
    expect(await state()).toEqual(before);
  });

  it('AC-05.4 a document reopened by a full reversal can be cancelled', async () => {
    const { doc, receiptId } = await fullyReceived();
    expect((await reverse(doc.id, receiptId)).status).toBe(200);

    const res = await http()
      .post(`/api/v1/receiving-documents/${doc.id}/cancel`)
      .set('Authorization', `Bearer ${supervisor}`)
      .send({ reason: 'Supplier cancelled shipment' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'Supplier cancelled shipment',
      cancelledBy: { id: supervisorUser.id },
    });
  });
});
