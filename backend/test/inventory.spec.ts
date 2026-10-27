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
type PageBody = { data: Body[]; meta: Body };

const BALANCE_KEYS = [
  'name',
  'productId',
  'quantityOnHand',
  'sku',
  'unitOfMeasure',
  'updatedAt',
];
const TRANSACTION_KEYS = [
  'balanceAfter',
  'createdAt',
  'createdBy',
  'id',
  'product',
  'quantityChange',
  'receiptId',
  'receiptReversalId',
  'receivingDocument',
  'type',
];

describe('inventory (read only)', () => {
  let app: INestApplication<App>;
  let operatorUser: User;
  let operator: string;

  const http = () => request(app.getHttpServer());
  const get = (path: string, token = operator) =>
    http().get(`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
  const data = (res: request.Response) => (res.body as PageBody).data;

  const receive = (docId: string, itemId: string, quantity: number) =>
    http()
      .post(`/api/v1/receiving-documents/${docId}/items/${itemId}/receipts`)
      .set('Authorization', `Bearer ${operator}`)
      .set('Idempotency-Key', randomUUID())
      .send({ quantity })
      .expect(201);

  /** OPEN document with one line of 100 for `productId`. */
  async function openDoc(productId: string) {
    const doc = await openDocument(
      (await createDraftDocument([{ productId, expectedQuantity: 100 }])).id,
    );
    return { doc, item: doc.items[0] };
  }

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await truncateAll();
    operatorUser = await createUser(UserRole.OPERATOR);
    operator = await loginAs(operatorUser);
  });
  afterEach(() => assertInventoryConsistent());

  describe('GET /inventory', () => {
    it('AC-06.1 receipts of 40 and 60 show on-hand 100', async () => {
      const p = await createProduct({ sku: 'FRZ-CHK-001', name: 'Chicken' });
      const { doc, item } = await openDoc(p.id);
      await receive(doc.id, item.id, 40);
      await receive(doc.id, item.id, 60);

      const res = await get('/inventory');
      expect(res.status).toBe(200);
      const [row] = data(res);
      expect(Object.keys(row).sort()).toEqual(BALANCE_KEYS);
      expect(row).toMatchObject({
        productId: p.id,
        sku: 'FRZ-CHK-001',
        name: 'Chicken',
        unitOfMeasure: 'PCS',
        quantityOnHand: 100,
      });
      expect(new Date(row.updatedAt as string).toISOString()).toBe(
        row.updatedAt,
      );
    });

    it('FR-40 sorts by SKU and paginates with correct meta', async () => {
      for (const sku of ['CCC-003', 'AAA-001', 'BBB-002']) {
        await createProduct({ sku });
      }
      const page1 = await get('/inventory?page=1&pageSize=2');
      expect(data(page1).map((b) => b.sku)).toEqual(['AAA-001', 'BBB-002']);
      expect((page1.body as PageBody).meta).toEqual({
        page: 1,
        pageSize: 2,
        totalItems: 3,
        totalPages: 2,
      });
      const page2 = await get('/inventory?page=2&pageSize=2');
      expect(data(page2).map((b) => b.sku)).toEqual(['CCC-003']);
    });

    it('FR-40 searches SKU or name, case-insensitive and partial', async () => {
      await createProduct({ sku: 'FRZ-CHK-001', name: 'Frozen Chicken' });
      await createProduct({ sku: 'XYZ-001', name: 'Pack of Chk wings' });
      await createProduct({ sku: 'FRZ-FSH-002', name: 'Tuna' });
      const res = await get('/inventory?search=chk');
      expect(data(res).map((b) => b.sku)).toEqual(['FRZ-CHK-001', 'XYZ-001']);
      expect((res.body as PageBody).meta).toMatchObject({ totalItems: 2 });
    });

    it.each([['?pageSize=101'], ['?page=0'], [`?search=${'x'.repeat(101)}`]])(
      'rejects %s with 400 VALIDATION_ERROR',
      async (query) => {
        const res = await get(`/inventory${query}`);
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
      },
    );

    it('requires a token', async () => {
      expect((await http().get('/api/v1/inventory')).status).toBe(401);
    });
  });

  describe('GET /inventory/transactions', () => {
    it('AC-06.2 filtered by product: two RECEIPT rows newest first with document number and user', async () => {
      const p = await createProduct();
      const other = await createProduct();
      const { doc, item } = await openDoc(p.id);
      const otherDoc = await openDoc(other.id);
      await receive(doc.id, item.id, 40);
      await receive(otherDoc.doc.id, otherDoc.item.id, 5);
      await receive(doc.id, item.id, 60);

      const res = await get(`/inventory/transactions?productId=${p.id}`);
      expect(res.status).toBe(200);
      const rows = data(res);
      expect(rows).toHaveLength(2);
      expect(Object.keys(rows[0]).sort()).toEqual(TRANSACTION_KEYS);
      const receipts = await prisma.receipt.findMany({
        where: { receivingItemId: item.id },
        orderBy: { quantity: 'desc' },
      });
      const common = {
        type: 'RECEIPT',
        product: { id: p.id, sku: p.sku, name: p.name },
        receiptReversalId: null,
        receivingDocument: { id: doc.id, documentNumber: doc.documentNumber },
        createdBy: { id: operatorUser.id, fullName: operatorUser.fullName },
      };
      expect(rows[0]).toMatchObject({
        ...common,
        quantityChange: 60,
        balanceAfter: 100,
        receiptId: receipts[0].id,
      });
      expect(rows[1]).toMatchObject({
        ...common,
        quantityChange: 40,
        balanceAfter: 40,
        receiptId: receipts[1].id,
      });
      // bigint ledger id is serialized as a string; newest first means descending ids.
      expect(rows.map((r) => typeof r.id)).toEqual(['string', 'string']);
      expect(BigInt(rows[0].id as string)).toBeGreaterThan(
        BigInt(rows[1].id as string),
      );
    });

    it('FR-41 lists all products newest first without filters, paginated', async () => {
      const p = await createProduct();
      const q = await createProduct();
      const a = await openDoc(p.id);
      const b = await openDoc(q.id);
      await receive(a.doc.id, a.item.id, 1);
      await receive(b.doc.id, b.item.id, 2);
      await receive(a.doc.id, a.item.id, 3);

      const page1 = await get('/inventory/transactions?pageSize=2');
      expect(data(page1).map((t) => t.quantityChange)).toEqual([3, 2]);
      expect((page1.body as PageBody).meta).toEqual({
        page: 1,
        pageSize: 2,
        totalItems: 3,
        totalPages: 2,
      });
      const page2 = await get('/inventory/transactions?page=2&pageSize=2');
      expect(data(page2).map((t) => t.quantityChange)).toEqual([1]);
    });

    it('FR-41 filters by receiving document', async () => {
      const p = await createProduct();
      const a = await openDoc(p.id);
      const b = await openDoc(p.id);
      await receive(a.doc.id, a.item.id, 7);
      await receive(b.doc.id, b.item.id, 9);

      const res = await get(
        `/inventory/transactions?receivingDocumentId=${b.doc.id}`,
      );
      expect(data(res)).toHaveLength(1);
      expect(data(res)[0]).toMatchObject({
        quantityChange: 9,
        receivingDocument: { id: b.doc.id },
      });
    });

    it('FR-41 filters by date range: from inclusive, to exclusive', async () => {
      const p = await createProduct();
      const { doc, item } = await openDoc(p.id);
      for (const q of [1, 2, 3]) await receive(doc.id, item.id, q);
      const ledger = await prisma.inventoryTransaction.findMany({
        orderBy: { id: 'asc' },
      });
      // Spread the rows over three days so the bounds are unambiguous.
      for (const [i, t] of ledger.entries()) {
        await prisma.$executeRaw`
          UPDATE inventory_transactions SET created_at = ${new Date(Date.UTC(2026, 9, 1 + i))}
          WHERE id = ${t.id}`;
      }
      const changes = async (query: string) =>
        data(await get(`/inventory/transactions?${query}`)).map(
          (t) => t.quantityChange,
        );

      expect(await changes('from=2026-10-02T00:00:00.000Z')).toEqual([3, 2]);
      expect(await changes('to=2026-10-02T00:00:00.000Z')).toEqual([1]);
      expect(
        await changes('from=2026-10-02T00:00:00.000Z&to=2026-10-03T00:00:00Z'),
      ).toEqual([2]);
      expect(await changes('from=2026-10-02&to=2026-10-03')).toEqual([2]);
    });

    it.each([
      ['productId', 'productId=abc'],
      ['receivingDocumentId', 'receivingDocumentId=123'],
      ['from', 'from=yesterday'],
      ['to', 'to=2026-02-30'],
      ['pageSize', 'pageSize=101'],
    ])(
      'rejects an invalid %s with 400 naming the field',
      async (field, query) => {
        const res = await get(`/inventory/transactions?${query}`);
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({
          error: {
            code: 'VALIDATION_ERROR',
            details: { fields: [expect.objectContaining({ field })] },
          },
        });
      },
    );

    it('requires a token', async () => {
      expect((await http().get('/api/v1/inventory/transactions')).status).toBe(
        401,
      );
    });
  });
});
