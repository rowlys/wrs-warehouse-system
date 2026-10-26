import { INestApplication } from '@nestjs/common';
import { Prisma, ReceivingStatus, UserRole } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  createDraftDocument,
  createProduct,
  createTestApp,
  loginAs,
  prisma,
  truncateAll,
} from './helpers';

type Body = Record<string, unknown>;
type Item = { id: string; expectedQuantity: number; product: { id: string } };

// Fields each status needs to satisfy the CHECK constraints in spec §3.2.
const STATUS_FIELDS: Record<
  Exclude<ReceivingStatus, 'DRAFT'>,
  Prisma.ReceivingDocumentUpdateInput
> = {
  OPEN: { status: 'OPEN', openedAt: new Date() },
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

describe('receiving items (draft line editing)', () => {
  let app: INestApplication<App>;
  let supervisor: string;
  let operator: string;

  const http = () => request(app.getHttpServer());
  const base = (docId: string) => `/api/v1/receiving-documents/${docId}/items`;
  const add = (docId: string, body: object, token = supervisor) =>
    http().post(base(docId)).set('Authorization', `Bearer ${token}`).send(body);
  const change = (
    docId: string,
    itemId: string,
    body: object,
    token = supervisor,
  ) =>
    http()
      .patch(`${base(docId)}/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const remove = (docId: string, itemId: string, token = supervisor) =>
    http()
      .delete(`${base(docId)}/${itemId}`)
      .set('Authorization', `Bearer ${token}`);

  async function draftWithLine(expectedQuantity = 10) {
    const product = await createProduct();
    const doc = await createDraftDocument([
      { productId: product.id, expectedQuantity },
    ]);
    return { doc, item: doc.items[0], product };
  }

  const itemsOf = async (docId: string) =>
    prisma.receivingItem.findMany({
      where: { receivingDocumentId: docId },
      orderBy: { createdAt: 'asc' },
    });

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await truncateAll();
    supervisor = await loginAs(UserRole.SUPERVISOR);
    operator = await loginAs(UserRole.OPERATOR);
  });

  describe('POST /receiving-documents/:documentId/items', () => {
    it('FR-24 adds a line to a DRAFT and returns the whole document', async () => {
      const doc = await createDraftDocument([]);
      const product = await createProduct();
      const res = await add(doc.id, {
        productId: product.id,
        expectedQuantity: 7,
      });
      expect(res.status).toBe(201);
      const body = res.body as Body & { items: Item[] };
      expect(body).toMatchObject({ id: doc.id, status: 'DRAFT', itemCount: 1 });
      expect(body.items).toEqual([
        expect.objectContaining({
          product: expect.objectContaining({ id: product.id }) as unknown,
          expectedQuantity: 7,
          receivedQuantity: 0,
          remainingQuantity: 7,
        }),
      ]);
    });

    it('AC-03.2 BR-06 rejects a product already on the document with 409', async () => {
      const { doc, product } = await draftWithLine();
      const res = await add(doc.id, {
        productId: product.id,
        expectedQuantity: 1,
      });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        error: { code: 'DUPLICATE_PRODUCT_IN_DOCUMENT' },
      });
      expect(await itemsOf(doc.id)).toHaveLength(1);
    });

    it('BR-16 rejects an unknown product with 422 PRODUCT_NOT_FOUND', async () => {
      const doc = await createDraftDocument([]);
      const res = await add(doc.id, {
        productId: '00000000-0000-4000-8000-000000000000',
        expectedQuantity: 1,
      });
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ error: { code: 'PRODUCT_NOT_FOUND' } });
      expect(await itemsOf(doc.id)).toHaveLength(0);
    });

    it.each([[0], [2.5], [1_000_001]])(
      'BR-05 rejects expectedQuantity %j with 400',
      async (expectedQuantity) => {
        const doc = await createDraftDocument([]);
        const product = await createProduct();
        const res = await add(doc.id, {
          productId: product.id,
          expectedQuantity,
        });
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
      },
    );

    it('returns 404 for an unknown document', async () => {
      const product = await createProduct();
      const res = await add('00000000-0000-4000-8000-000000000000', {
        productId: product.id,
        expectedQuantity: 1,
      });
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    });
  });

  describe('PATCH /receiving-documents/:documentId/items/:itemId', () => {
    it("FR-25 changes a line's expected quantity and returns the whole document", async () => {
      const { doc, item } = await draftWithLine(10);
      const res = await change(doc.id, item.id, { expectedQuantity: 25 });
      expect(res.status).toBe(200);
      expect((res.body as { items: Item[] }).items).toEqual([
        expect.objectContaining({ id: item.id, expectedQuantity: 25 }),
      ]);
      expect((await itemsOf(doc.id))[0].expectedQuantity).toBe(25);
    });

    it.each([[0], [-1], [1_000_001], [undefined]])(
      'BR-05 rejects expectedQuantity %j with 400',
      async (expectedQuantity) => {
        const { doc, item } = await draftWithLine(10);
        const res = await change(doc.id, item.id, { expectedQuantity });
        expect(res.status).toBe(400);
        expect((await itemsOf(doc.id))[0].expectedQuantity).toBe(10);
      },
    );
  });

  describe('DELETE /receiving-documents/:documentId/items/:itemId', () => {
    it('FR-26 removes a line with 204 and leaves the product alone', async () => {
      const { doc, item, product } = await draftWithLine();
      const res = await remove(doc.id, item.id);
      expect(res.status).toBe(204);
      expect(res.text).toBe('');
      expect(await itemsOf(doc.id)).toHaveLength(0);
      expect(await prisma.product.count({ where: { id: product.id } })).toBe(1);
    });
  });

  describe('BR-10 lines are locked outside DRAFT', () => {
    const statuses = Object.keys(STATUS_FIELDS) as Exclude<
      ReceivingStatus,
      'DRAFT'
    >[];

    it.each(statuses)(
      'BR-10 add, change and remove on %s → 409 INVALID_DOCUMENT_STATUS, nothing changes',
      async (status) => {
        const { doc, item } = await draftWithLine(10);
        await prisma.receivingDocument.update({
          where: { id: doc.id },
          data: STATUS_FIELDS[status],
        });
        const other = await createProduct();
        const responses = [
          await add(doc.id, { productId: other.id, expectedQuantity: 1 }),
          await change(doc.id, item.id, { expectedQuantity: 99 }),
          await remove(doc.id, item.id),
        ];
        for (const res of responses) {
          expect(res.status).toBe(409);
          expect(res.body).toMatchObject({
            error: { code: 'INVALID_DOCUMENT_STATUS' },
          });
        }
        expect(await itemsOf(doc.id)).toEqual([
          expect.objectContaining({ id: item.id, expectedQuantity: 10 }),
        ]);
      },
    );
  });

  describe('line must belong to the document', () => {
    it('returns 404 NOT_FOUND when changing or removing a line of another document', async () => {
      const a = await draftWithLine(10);
      const b = await draftWithLine(10);
      const responses = [
        await change(a.doc.id, b.item.id, { expectedQuantity: 3 }),
        await remove(a.doc.id, b.item.id),
      ];
      for (const res of responses) {
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
      }
      expect(await itemsOf(b.doc.id)).toEqual([
        expect.objectContaining({ id: b.item.id, expectedQuantity: 10 }),
      ]);
    });

    it('returns 400 naming itemId for a non-UUID', async () => {
      const { doc } = await draftWithLine();
      const res = await change(doc.id, 'abc', { expectedQuantity: 3 });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          details: { fields: [expect.objectContaining({ field: 'itemId' })] },
        },
      });
    });
  });

  it('FR-24–FR-26 operator gets 403 FORBIDDEN on add, change and remove', async () => {
    const { doc, item } = await draftWithLine(10);
    const other = await createProduct();
    const responses = [
      await add(doc.id, { productId: other.id, expectedQuantity: 1 }, operator),
      await change(doc.id, item.id, { expectedQuantity: 99 }, operator),
      await remove(doc.id, item.id, operator),
    ];
    for (const res of responses) {
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
    }
    expect(await itemsOf(doc.id)).toEqual([
      expect.objectContaining({ id: item.id, expectedQuantity: 10 }),
    ]);
  });
});
