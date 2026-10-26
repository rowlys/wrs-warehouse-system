import { INestApplication } from '@nestjs/common';
import { User, UserRole } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  createDraftDocument,
  createProduct,
  createTestApp,
  createUser,
  loginAs,
  openDocument,
  prisma,
  truncateAll,
} from './helpers';

const YEAR = new Date().getUTCFullYear();

const SUMMARY_KEYS = [
  'createdAt',
  'createdBy',
  'documentNumber',
  'expectedDate',
  'id',
  'itemCount',
  'referenceNumber',
  'status',
  'supplierName',
  'totalExpectedQuantity',
  'totalReceivedQuantity',
];
const DETAIL_KEYS = [
  ...SUMMARY_KEYS,
  'allItemsReceived',
  'cancelReason',
  'cancelledAt',
  'cancelledBy',
  'closeShortReason',
  'closedShortAt',
  'closedShortBy',
  'completedAt',
  'completedBy',
  'items',
  'notes',
  'openedAt',
  'openedBy',
  'receipts',
  'updatedAt',
].sort();

type Body = Record<string, unknown>;

describe('receiving documents', () => {
  let app: INestApplication<App>;
  let supervisorUser: User;
  let supervisor: string;
  let operator: string;

  const http = () => request(app.getHttpServer());
  const create = (body: object, token = supervisor) =>
    http()
      .post('/api/v1/receiving-documents')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const list = (query = '', token = supervisor) =>
    http()
      .get(`/api/v1/receiving-documents${query}`)
      .set('Authorization', `Bearer ${token}`);
  const detail = (id: string, token = supervisor) =>
    http()
      .get(`/api/v1/receiving-documents/${id}`)
      .set('Authorization', `Bearer ${token}`);
  const fieldError = (field: string) => ({
    error: {
      code: 'VALIDATION_ERROR',
      details: {
        fields: expect.arrayContaining([
          expect.objectContaining({ field }),
        ]) as unknown,
      },
    },
  });

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

  describe('POST /receiving-documents', () => {
    it('AC-03.1 creates a DRAFT with a sequence number and lines received 0', async () => {
      const chicken = await createProduct({ sku: 'FRZ-CHK-001' });
      const tuna = await createProduct({ sku: 'FRZ-FSH-002' });
      const res = await create({
        supplierName: 'PT Sumber Beku Nusantara',
        items: [
          { productId: chicken.id, expectedQuantity: 100 },
          { productId: tuna.id, expectedQuantity: 40 },
        ],
      });
      expect(res.status).toBe(201);
      const body = res.body as Body;
      expect(Object.keys(body).sort()).toEqual(DETAIL_KEYS);
      expect(body).toMatchObject({
        documentNumber: `RCV-${YEAR}-000001`,
        supplierName: 'PT Sumber Beku Nusantara',
        referenceNumber: null,
        expectedDate: null,
        notes: null,
        status: 'DRAFT',
        itemCount: 2,
        totalExpectedQuantity: 140,
        totalReceivedQuantity: 0,
        allItemsReceived: false,
        receipts: [],
        createdBy: { id: supervisorUser.id, fullName: supervisorUser.fullName },
        openedAt: null,
        openedBy: null,
        completedAt: null,
        completedBy: null,
        closedShortAt: null,
        closedShortBy: null,
        closeShortReason: null,
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: null,
      });
      expect(body.items).toEqual([
        {
          id: expect.any(String) as string,
          product: {
            id: chicken.id,
            sku: 'FRZ-CHK-001',
            name: chicken.name,
            unitOfMeasure: 'PCS',
          },
          expectedQuantity: 100,
          receivedQuantity: 0,
          remainingQuantity: 100,
          isFullyReceived: false,
        },
        {
          id: expect.any(String) as string,
          product: {
            id: tuna.id,
            sku: 'FRZ-FSH-002',
            name: tuna.name,
            unitOfMeasure: 'PCS',
          },
          expectedQuantity: 40,
          receivedQuantity: 0,
          remainingQuantity: 40,
          isFullyReceived: false,
        },
      ]);
    });

    it('FR-21 stores optional header fields and accepts no lines', async () => {
      const res = await create({
        supplierName: 'Supplier',
        referenceNumber: 'SJ-2026-10-0042',
        expectedDate: '2026-10-28',
        notes: 'Dock 3',
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        referenceNumber: 'SJ-2026-10-0042',
        expectedDate: '2026-10-28',
        notes: 'Dock 3',
        items: [],
        itemCount: 0,
        allItemsReceived: false,
      });
    });

    it('AC-03.2 BR-06 rejects the same product twice with 409 and creates nothing', async () => {
      const p = await createProduct();
      const res = await create({
        supplierName: 'Supplier',
        items: [
          { productId: p.id, expectedQuantity: 1 },
          { productId: p.id, expectedQuantity: 2 },
        ],
      });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        error: { code: 'DUPLICATE_PRODUCT_IN_DOCUMENT' },
      });
      expect(await prisma.receivingDocument.count()).toBe(0);
    });

    it.each([[0], [-5], [2.5], [1_000_001], ['5'], [null]])(
      'AC-03.3 BR-05 rejects expectedQuantity %j with 400',
      async (expectedQuantity) => {
        const p = await createProduct();
        const res = await create({
          supplierName: 'Supplier',
          items: [{ productId: p.id, expectedQuantity }],
        });
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject(fieldError('items.0.expectedQuantity'));
        expect(await prisma.receivingDocument.count()).toBe(0);
      },
    );

    it.each([[1], [1_000_000]])(
      'BR-05 accepts expectedQuantity %j',
      async (expectedQuantity) => {
        const p = await createProduct();
        const res = await create({
          supplierName: 'Supplier',
          items: [{ productId: p.id, expectedQuantity }],
        });
        expect(res.status).toBe(201);
      },
    );

    it.each([
      ['supplierName', undefined],
      ['supplierName', ''],
      ['supplierName', 'S'.repeat(201)],
      ['referenceNumber', 'R'.repeat(101)],
      ['notes', 'N'.repeat(1001)],
      ['expectedDate', '2026-02-30'],
      ['expectedDate', '28-10-2026'],
      ['expectedDate', '2026-10-28T10:00:00Z'],
      ['items', 'not-an-array'],
      ['unknownField', 'x'],
    ])('BR-04 rejects %s = %j with 400', async (field, value) => {
      const res = await create({ supplierName: 'Supplier', [field]: value });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject(fieldError(field));
    });

    it.each([
      ['supplierName', 'S'.repeat(200)],
      ['referenceNumber', 'R'.repeat(100)],
      ['notes', 'N'.repeat(1000)],
      ['referenceNumber', null],
      ['expectedDate', null],
      ['notes', null],
    ])('BR-04 accepts %s at its limit or null (%#)', async (field, value) => {
      const res = await create({ supplierName: 'Supplier', [field]: value });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ [field]: value });
    });

    it('rejects more than 200 lines and a non-UUID productId with 400', async () => {
      const p = await createProduct();
      const many = Array.from({ length: 201 }, () => ({
        productId: p.id,
        expectedQuantity: 1,
      }));
      expect(
        (await create({ supplierName: 'S', items: many })).body,
      ).toMatchObject(fieldError('items'));
      expect(
        (
          await create({
            supplierName: 'S',
            items: [{ productId: 'abc', expectedQuantity: 1 }],
          })
        ).body,
      ).toMatchObject(fieldError('items.0.productId'));
    });

    it('BR-16 rejects an unknown productId with 422 PRODUCT_NOT_FOUND and creates nothing', async () => {
      const p = await createProduct();
      const missing = '00000000-0000-4000-8000-000000000000';
      const res = await create({
        supplierName: 'Supplier',
        items: [
          { productId: p.id, expectedQuantity: 1 },
          { productId: missing, expectedQuantity: 1 },
        ],
      });
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        error: {
          code: 'PRODUCT_NOT_FOUND',
          details: { productIds: [missing] },
        },
      });
      expect(await prisma.receivingDocument.count()).toBe(0);
    });

    it('FR-22 assigns unique, sequential numbers, also under concurrent creates', async () => {
      const first = await create({ supplierName: 'A' });
      expect((first.body as Body).documentNumber).toBe(`RCV-${YEAR}-000001`);
      const rest = await Promise.all(
        Array.from({ length: 5 }, () => create({ supplierName: 'B' })),
      );
      const numbers = rest
        .map((r) => (r.body as Body).documentNumber as string)
        .sort();
      expect(numbers).toEqual(
        [2, 3, 4, 5, 6].map((n) => `RCV-${YEAR}-00000${n}`),
      );
    });

    it('AC-02.5-style role check: operator gets 403 and nothing is created', async () => {
      const res = await create({ supplierName: 'Supplier' }, operator);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
      expect(await prisma.receivingDocument.count()).toBe(0);
    });

    it('requires a token', async () => {
      const res = await http()
        .post('/api/v1/receiving-documents')
        .send({ supplierName: 'S' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /receiving-documents', () => {
    it('FR-20 lists summaries newest first with totals and pagination', async () => {
      const p1 = await createProduct();
      const p2 = await createProduct();
      const older = await createDraftDocument(
        [
          { productId: p1.id, expectedQuantity: 10 },
          { productId: p2.id, expectedQuantity: 5 },
        ],
        supervisorUser,
      );
      await prisma.receivingDocument.update({
        where: { id: older.id },
        data: { createdAt: new Date(Date.UTC(2026, 0, 1)) },
      });
      const newer = await createDraftDocument([], supervisorUser);

      const res = await list('?pageSize=1', operator);
      expect(res.status).toBe(200);
      const body = res.body as { data: Body[]; meta: Body };
      expect(body.meta).toEqual({
        page: 1,
        pageSize: 1,
        totalItems: 2,
        totalPages: 2,
      });
      expect(body.data).toHaveLength(1);
      expect(Object.keys(body.data[0]).sort()).toEqual(SUMMARY_KEYS);
      expect(body.data[0]).toMatchObject({ id: newer.id, itemCount: 0 });

      const page2 = (await list('?page=2&pageSize=1')).body as {
        data: Body[];
      };
      expect(page2.data[0]).toEqual({
        id: older.id,
        documentNumber: older.documentNumber,
        supplierName: 'Test Supplier',
        referenceNumber: null,
        expectedDate: null,
        status: 'DRAFT',
        itemCount: 2,
        totalExpectedQuantity: 15,
        totalReceivedQuantity: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        createdBy: { id: supervisorUser.id, fullName: supervisorUser.fullName },
      });
    });

    it('FR-20 filters by status', async () => {
      const draft = await createDraftDocument([]);
      const open = await openDocument(
        (
          await createDraftDocument([
            { productId: (await createProduct()).id, expectedQuantity: 1 },
          ])
        ).id,
      );
      const ids = async (q: string) =>
        ((await list(q)).body as { data: Body[] }).data.map((d) => d.id);
      expect(await ids('?status=OPEN')).toEqual([open.id]);
      expect(await ids('?status=DRAFT')).toEqual([draft.id]);
      expect(await ids('?status=COMPLETED')).toEqual([]);
    });

    it('FR-20 searches number, supplier and reference, case-insensitive and partial', async () => {
      const a = await createDraftDocument([]);
      const b = await createDraftDocument([]);
      const c = await createDraftDocument([]);
      await prisma.receivingDocument.update({
        where: { id: b.id },
        data: { supplierName: 'PT Sumber Beku Nusantara' },
      });
      await prisma.receivingDocument.update({
        where: { id: c.id },
        data: { referenceNumber: 'SJ-2026-10-0042' },
      });
      const ids = async (search: string) =>
        (
          (await list(`?search=${encodeURIComponent(search)}`)).body as {
            data: Body[];
          }
        ).data.map((d) => d.id);
      expect(await ids('000001')).toEqual([a.id]);
      expect(await ids('rcv-')).toHaveLength(3);
      expect(await ids('beku')).toEqual([b.id]);
      expect(await ids('sj-2026')).toEqual([c.id]);
    });

    it.each([['?status=DONE'], ['?pageSize=101']])(
      'rejects %s with 400',
      async (q) => {
        expect((await list(q)).status).toBe(400);
      },
    );

    it('requires a token', async () => {
      expect((await http().get('/api/v1/receiving-documents')).status).toBe(
        401,
      );
    });
  });

  describe('GET /receiving-documents/:documentId', () => {
    it('FR-23 shows lines, receipts oldest first with reversals, and actor refs', async () => {
      const p1 = await createProduct({ sku: 'AAA-001' });
      const p2 = await createProduct({ sku: 'BBB-002' });
      const opener = await createUser(UserRole.SUPERVISOR);
      const receiver = await createUser(UserRole.OPERATOR);
      const doc = await openDocument(
        (
          await createDraftDocument(
            [
              { productId: p1.id, expectedQuantity: 10 },
              { productId: p2.id, expectedQuantity: 5 },
            ],
            supervisorUser,
          )
        ).id,
        opener,
      );
      const [item1, item2] = [...doc.items].sort((a, b) =>
        a.productId === p1.id ? -1 : b.productId === p1.id ? 1 : 0,
      );
      // Receipt rows written directly: ReceiptsService arrives in T012.
      const r1 = await prisma.receipt.create({
        data: {
          receivingItemId: item1.id,
          quantity: 10,
          idempotencyKey: 'k1',
          receivedById: receiver.id,
          receivedAt: new Date(Date.UTC(2026, 9, 1, 8)),
        },
      });
      const r2 = await prisma.receipt.create({
        data: {
          receivingItemId: item2.id,
          quantity: 2,
          idempotencyKey: 'k2',
          receivedById: receiver.id,
          receivedAt: new Date(Date.UTC(2026, 9, 1, 9)),
        },
      });
      const reversal = await prisma.receiptReversal.create({
        data: {
          receiptId: r2.id,
          reason: 'Counted twice',
          reversedById: opener.id,
        },
      });
      await prisma.receivingItem.update({
        where: { id: item1.id },
        data: { receivedQuantity: 10 },
      });
      await prisma.receivingItem.update({
        where: { id: item2.id },
        data: { receivedQuantity: 5 },
      });
      await prisma.receivingDocument.update({
        where: { id: doc.id },
        data: { status: 'IN_PROGRESS' },
      });

      const res = await detail(doc.id, operator);
      expect(res.status).toBe(200);
      const body = res.body as Body;
      expect(Object.keys(body).sort()).toEqual(DETAIL_KEYS);
      expect(body).toMatchObject({
        status: 'IN_PROGRESS',
        allItemsReceived: true,
        totalExpectedQuantity: 15,
        totalReceivedQuantity: 15,
        openedBy: { id: opener.id, fullName: opener.fullName },
        openedAt: expect.any(String) as string,
      });
      expect(
        (body.items as Body[]).map((i) => [
          (i.product as Body).sku,
          i.remainingQuantity,
          i.isFullyReceived,
        ]),
      ).toEqual([
        ['AAA-001', 0, true],
        ['BBB-002', 0, true],
      ]);
      expect(body.receipts).toEqual([
        {
          id: r1.id,
          receivingItemId: item1.id,
          productSku: 'AAA-001',
          quantity: 10,
          receivedAt: '2026-10-01T08:00:00.000Z',
          receivedBy: { id: receiver.id, fullName: receiver.fullName },
          reversal: null,
        },
        {
          id: r2.id,
          receivingItemId: item2.id,
          productSku: 'BBB-002',
          quantity: 2,
          receivedAt: '2026-10-01T09:00:00.000Z',
          receivedBy: { id: receiver.id, fullName: receiver.fullName },
          reversal: {
            id: reversal.id,
            reason: 'Counted twice',
            reversedAt: reversal.reversedAt.toISOString(),
            reversedBy: { id: opener.id, fullName: opener.fullName },
          },
        },
      ]);
    });

    it('returns 404 NOT_FOUND for an unknown id and 400 for a non-UUID', async () => {
      const missing = await detail('00000000-0000-4000-8000-000000000000');
      expect(missing.status).toBe(404);
      expect(missing.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
      const bad = await detail('abc');
      expect(bad.status).toBe(400);
      expect(bad.body).toMatchObject(fieldError('documentId'));
    });
  });
});
