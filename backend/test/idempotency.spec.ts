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

describe('receipt idempotency (BR-09)', () => {
  let app: INestApplication<App>;
  let operator: string;

  const receive = (
    docId: string,
    itemId: string,
    quantity: number,
    key: string,
  ) =>
    request(app.getHttpServer())
      .post(`/api/v1/receiving-documents/${docId}/items/${itemId}/receipts`)
      .set('Authorization', `Bearer ${operator}`)
      .set('Idempotency-Key', key)
      .send({ quantity });

  /** OPEN document with two lines of 100 each. */
  async function openDoc() {
    const [p1, p2] = [await createProduct(), await createProduct()];
    const doc = await openDocument(
      (
        await createDraftDocument([
          { productId: p1.id, expectedQuantity: 100 },
          { productId: p2.id, expectedQuantity: 100 },
        ])
      ).id,
    );
    const line1 = doc.items.find((i) => i.productId === p1.id)!;
    const line2 = doc.items.find((i) => i.productId === p2.id)!;
    return { doc, line1, line2 };
  }

  const state = async () => ({
    receipts: await prisma.receipt.count(),
    ledger: await prisma.inventoryTransaction.count(),
    received: (
      await prisma.receivingItem.findMany({ orderBy: { id: 'asc' } })
    ).map((i) => i.receivedQuantity),
    onHand: (
      await prisma.inventoryBalance.findMany({ orderBy: { productId: 'asc' } })
    ).map((b) => b.quantityOnHand),
  });

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await truncateAll();
    operator = await loginAs(UserRole.OPERATOR);
  });
  afterEach(() => assertInventoryConsistent());

  it('AC-04.6 FR-33 the same request twice → 200 replay with the same receipt, nothing changes', async () => {
    const { doc, line1 } = await openDoc();
    const key = randomUUID();
    const first = await receive(doc.id, line1.id, 10, key);
    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    const before = await state();

    const again = await receive(doc.id, line1.id, 10, key);
    expect(again.status).toBe(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body).toEqual(first.body);
    expect(await state()).toEqual(before);
    expect(before).toMatchObject({ receipts: 1, ledger: 1 });
  });

  it('AC-04.6 a replay returns the original receipt with the current line and stock', async () => {
    const { doc, line1 } = await openDoc();
    const key = randomUUID();
    const first = (await receive(doc.id, line1.id, 10, key)).body as Body;
    await receive(doc.id, line1.id, 90, randomUUID());

    const again = await receive(doc.id, line1.id, 10, key);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({
      receipt: first.receipt as Body,
      item: {
        receivedQuantity: 100,
        remainingQuantity: 0,
        isFullyReceived: true,
      },
      inventory: { quantityOnHand: 100 },
    });
    expect(await prisma.receipt.count()).toBe(2);
  });

  it.each([
    ['another quantity', 'line1', 5],
    ['another line', 'line2', 10],
  ] as const)(
    'AC-04.7 the same key with %s → 409 IDEMPOTENCY_KEY_REUSED, nothing changes',
    async (_, line, quantity) => {
      const lines = await openDoc();
      const key = randomUUID();
      await receive(lines.doc.id, lines.line1.id, 10, key);
      const before = await state();

      const res = await receive(lines.doc.id, lines[line].id, quantity, key);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        error: { code: 'IDEMPOTENCY_KEY_REUSED' },
      });
      expect(await state()).toEqual(before);
    },
  );

  it('AC-04.7 the same key on a line of another document → 409', async () => {
    const a = await openDoc();
    const b = await openDoc();
    const key = randomUUID();
    await receive(a.doc.id, a.line1.id, 10, key);
    const before = await state();
    const res = await receive(b.doc.id, b.line1.id, 10, key);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });
    expect(await state()).toEqual(before);
  });

  it.each([[2], [5]])(
    'BR-09 %i identical requests sent concurrently → one 201, the rest 200, one receipt',
    async (n) => {
      const { doc, line1 } = await openDoc();
      const key = randomUUID();
      const responses = await Promise.all(
        Array.from({ length: n }, () => receive(doc.id, line1.id, 10, key)),
      );
      expect(responses.map((r) => r.status).sort()).toEqual([
        ...Array<number>(n - 1).fill(200),
        201,
      ]);
      const ids = new Set(
        responses.map((r) => ((r.body as Body).receipt as Body).id),
      );
      expect(ids.size).toBe(1);
      expect(await state()).toMatchObject({
        receipts: 1,
        ledger: 1,
        received: expect.arrayContaining([10, 0]) as unknown,
      });
      const item = await prisma.receivingItem.findUniqueOrThrow({
        where: { id: line1.id },
      });
      expect(item.receivedQuantity).toBe(10);
    },
  );

  /** OPEN document with one line expecting 10, so a receipt of 10 empties it. */
  async function lineOfTen() {
    const product = await createProduct();
    const doc = await openDocument(
      (
        await createDraftDocument([
          { productId: product.id, expectedQuantity: 10 },
        ])
      ).id,
    );
    return { doc, item: doc.items[0] };
  }

  // Races repeat so the duplicate gets a chance to read the key before the first commits.
  it('BR-09 identical concurrent requests for the whole remaining quantity → one 201, the rest 200', async () => {
    for (let round = 0; round < 5; round++) {
      const { doc, item } = await lineOfTen();
      const key = randomUUID();
      const responses = await Promise.all(
        Array.from({ length: 3 }, () => receive(doc.id, item.id, 10, key)),
      );
      expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 201]);
      expect(
        new Set(responses.map((r) => ((r.body as Body).receipt as Body).id))
          .size,
      ).toBe(1);
      expect(
        await prisma.receipt.count({ where: { idempotencyKey: key } }),
      ).toBe(1);
    }
  });

  it('BR-09 the same key sent concurrently with another quantity → one 201 and 409 IDEMPOTENCY_KEY_REUSED', async () => {
    for (let round = 0; round < 5; round++) {
      const { doc, item } = await lineOfTen();
      const key = randomUUID();
      const responses = await Promise.all([
        receive(doc.id, item.id, 10, key),
        receive(doc.id, item.id, 5, key),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
      const rejected = responses.find((r) => r.status === 409)!;
      expect(rejected.body).toMatchObject({
        error: { code: 'IDEMPOTENCY_KEY_REUSED' },
      });
    }
  });

  // Different document locks, so the loser can only find out through the step 15 P2002 retry.
  it('BR-09 the same key sent concurrently to lines of two documents → one 201 and 409, one receipt', async () => {
    for (let round = 0; round < 5; round++) {
      const [a, b] = [await lineOfTen(), await lineOfTen()];
      const key = randomUUID();
      const responses = await Promise.all([
        receive(a.doc.id, a.item.id, 10, key),
        receive(b.doc.id, b.item.id, 10, key),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(responses.find((r) => r.status === 409)!.body).toMatchObject({
        error: { code: 'IDEMPOTENCY_KEY_REUSED' },
      });
      expect(
        await prisma.receipt.count({ where: { idempotencyKey: key } }),
      ).toBe(1);
    }
  });

  it('AC-04.6 a replay after the document was COMPLETED → 200 with the original receipt', async () => {
    const { doc, item } = await lineOfTen();
    const key = randomUUID();
    const first = await receive(doc.id, item.id, 10, key);
    expect(first.status).toBe(201);
    const done = await request(app.getHttpServer())
      .post(`/api/v1/receiving-documents/${doc.id}/complete`)
      .set('Authorization', `Bearer ${await loginAs(UserRole.SUPERVISOR)}`);
    expect(done.status).toBe(200);

    const replay = await receive(doc.id, item.id, 10, key);
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toMatchObject({
      receipt: { id: ((first.body as Body).receipt as Body).id },
      document: { status: 'COMPLETED' },
    });
  });
});
