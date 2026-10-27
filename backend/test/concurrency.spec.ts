import { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  assertInventoryConsistent,
  createDraftDocument,
  createProduct,
  createTestApp,
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

describe('concurrency (BR-14) and reconciliation (BR-12)', () => {
  let app: INestApplication<App>;
  let operator: string;
  let supervisor: string;

  const receive = (docId: string, itemId: string, quantity: number) =>
    request(app.getHttpServer())
      .post(`/api/v1/receiving-documents/${docId}/items/${itemId}/receipts`)
      .set('Authorization', `Bearer ${operator}`)
      .set('Idempotency-Key', randomUUID())
      .send({ quantity });

  const action = (docId: string, name: 'cancel' | 'complete') =>
    request(app.getHttpServer())
      .post(`/api/v1/receiving-documents/${docId}/${name}`)
      .set('Authorization', `Bearer ${supervisor}`)
      .send(name === 'cancel' ? { reason: 'Order withdrawn' } : {});

  /** OPEN document with one line of `expected` for `productId` (a new product by default). */
  async function openDoc(expected: number, productId?: string) {
    const pid = productId ?? (await createProduct()).id;
    const doc = await openDocument(
      (
        await createDraftDocument([
          { productId: pid, expectedQuantity: expected },
        ])
      ).id,
    );
    return { doc, item: doc.items[0] };
  }

  const onHand = async (productId: string) =>
    (await prisma.inventoryBalance.findUniqueOrThrow({ where: { productId } }))
      .quantityOnHand;

  beforeAll(async () => {
    app = await createTestApp();
    // One listening server; otherwise supertest starts one per parallel request.
    await app.listen(0);
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await truncateAll();
    operator = await loginAs(UserRole.OPERATOR);
    supervisor = await loginAs(UserRole.SUPERVISOR);
  });
  afterEach(() => assertInventoryConsistent());

  it('AC-04.8 BR-14 5 parallel receipts of 4 against remaining 10 → exactly 2 succeed', async () => {
    const { doc, item } = await openDoc(10);

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => receive(doc.id, item.id, 4)),
    );

    expect(responses.map((r) => r.status).sort()).toEqual([
      201, 201, 422, 422, 422,
    ]);
    for (const r of responses.filter((r) => r.status === 422)) {
      expect(errorCode(r)).toBe('QUANTITY_EXCEEDS_REMAINING');
    }
    const line = await prisma.receivingItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(line.receivedQuantity).toBe(8);
    expect(await onHand(item.productId)).toBe(8);
    expect(await prisma.receipt.count()).toBe(2);
  });

  it('BR-12 BR-14 20 parallel receipts of 1 across two documents for the same product → totals exact', async () => {
    const product = await createProduct();
    const a = await openDoc(10, product.id);
    const b = await openDoc(10, product.id);

    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) => {
        const { doc, item } = i % 2 ? a : b;
        return receive(doc.id, item.id, 1);
      }),
    );

    expect(responses.every((r) => r.status === 201)).toBe(true);
    expect(await onHand(product.id)).toBe(20);
    const ledger = await prisma.inventoryTransaction.findMany({
      where: { productId: product.id },
      orderBy: { id: 'asc' },
    });
    // Each balance update saw the previous one: balance_after runs 1..20 with no gaps or repeats.
    expect(ledger.map((t) => t.balanceAfter)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    const lines = await prisma.receivingItem.findMany({
      where: { productId: product.id },
    });
    expect(lines.map((l) => l.receivedQuantity)).toEqual([10, 10]);
  });

  it('BR-14 receipt racing cancel on an OPEN document → exactly one wins', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { doc, item } = await openDoc(10);

      const [receipt, cancel] = await Promise.all([
        receive(doc.id, item.id, 4),
        action(doc.id, 'cancel'),
      ]);

      const after = await prisma.receivingDocument.findUniqueOrThrow({
        where: { id: doc.id },
        include: { items: true },
      });
      if (receipt.status === 201) {
        // Receipt took the document lock first and moved it to IN_PROGRESS.
        expect(cancel.status).toBe(409);
        expect(errorCode(cancel)).toBe('INVALID_STATUS_TRANSITION');
        expect(after.status).toBe('IN_PROGRESS');
        expect(after.items[0].receivedQuantity).toBe(4);
      } else {
        expect(receipt.status).toBe(409);
        expect(errorCode(receipt)).toBe('INVALID_DOCUMENT_STATUS');
        expect(cancel.status).toBe(200);
        expect(after.status).toBe('CANCELLED');
        expect(after.items[0].receivedQuantity).toBe(0);
        expect(await onHand(item.productId)).toBe(0);
      }
    }
  });

  it('BR-14 last receipt racing complete → never COMPLETED while a line is short', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { doc, item } = await openDoc(10);
      expect((await receive(doc.id, item.id, 5)).status).toBe(201);

      const [receipt, complete] = await Promise.all([
        receive(doc.id, item.id, 5),
        action(doc.id, 'complete'),
      ]);

      // Complete never blocks the receipt: it either fails first or runs after it.
      expect(receipt.status).toBe(201);
      const after = await prisma.receivingDocument.findUniqueOrThrow({
        where: { id: doc.id },
        include: { items: true },
      });
      expect(after.items[0].receivedQuantity).toBe(10);
      if (complete.status === 200) {
        expect(after.status).toBe('COMPLETED');
      } else {
        expect(complete.status).toBe(422);
        expect(errorCode(complete)).toBe('ITEMS_NOT_FULLY_RECEIVED');
        expect(after.status).toBe('IN_PROGRESS');
      }
    }
  });
});
