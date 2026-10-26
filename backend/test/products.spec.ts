import { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  assertInventoryConsistent,
  createProduct,
  createTestApp,
  loginAs,
  prisma,
  truncateAll,
} from './helpers';

const PRODUCT_KEYS = [
  'createdAt',
  'description',
  'id',
  'name',
  'quantityOnHand',
  'sku',
  'unitOfMeasure',
  'updatedAt',
];

describe('products', () => {
  let app: INestApplication<App>;
  let supervisor: string;
  let operator: string;

  const http = () => request(app.getHttpServer());
  const create = (body: object, token = supervisor) =>
    http()
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const list = (query = '', token = supervisor) =>
    http()
      .get(`/api/v1/products${query}`)
      .set('Authorization', `Bearer ${token}`);
  const valid = {
    sku: 'FRZ-CHK-001',
    name: 'Frozen Chicken',
    unitOfMeasure: 'CTN',
  };

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await truncateAll();
    supervisor = await loginAs(UserRole.SUPERVISOR);
    operator = await loginAs(UserRole.OPERATOR);
  });

  describe('POST /products', () => {
    it('AC-02.1 FR-12 normalizes the SKU and creates a zero balance', async () => {
      const res = await create({
        sku: '  frz-chk-001 ',
        name: 'Frozen Chicken Breast 1kg',
        unitOfMeasure: 'CTN',
      });
      expect(res.status).toBe(201);
      const body = res.body as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(PRODUCT_KEYS);
      expect(body).toEqual({
        id: expect.any(String) as string,
        sku: 'FRZ-CHK-001',
        name: 'Frozen Chicken Breast 1kg',
        unitOfMeasure: 'CTN',
        description: null,
        quantityOnHand: 0,
        createdAt: expect.any(String) as string,
        updatedAt: expect.any(String) as string,
      });
      const balance = await prisma.inventoryBalance.findUnique({
        where: { productId: body.id as string },
      });
      expect(balance?.quantityOnHand).toBe(0);
      await assertInventoryConsistent();
    });

    it('AC-02.2 BR-02 rejects a SKU that differs only in case with 409 DUPLICATE_SKU', async () => {
      expect((await create(valid)).status).toBe(201);
      const res = await create({ ...valid, sku: 'frz-chk-001' });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: { code: 'DUPLICATE_SKU' } });
      expect(await prisma.product.count()).toBe(1);
    });

    it.each([
      ['abc', 'ABC'],
      [' a-1 ', 'A-1'],
      ['9-9', '9-9'],
      ['abc-', 'ABC-'],
      ['A'.repeat(50), 'A'.repeat(50)],
    ])('BR-01 accepts SKU %j as %j', async (sku, expected) => {
      const res = await create({ ...valid, sku });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ sku: expected });
    });

    it.each([
      ['AB'],
      ['-ABC'],
      ['AB C'],
      [' AB '],
      [''],
      ['ABC_1'],
      ['A'.repeat(51)],
      [123],
      [undefined],
    ])(
      'AC-02.3 BR-01 rejects SKU %j with 400 naming the sku field',
      async (sku) => {
        const res = await create({ ...valid, sku });
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({
          error: {
            code: 'VALIDATION_ERROR',
            details: {
              fields: expect.arrayContaining([
                expect.objectContaining({ field: 'sku' }),
              ]) as unknown,
            },
          },
        });
        expect(await prisma.product.count()).toBe(0);
      },
    );

    it.each([
      ['name', 'N'.repeat(200)],
      ['unitOfMeasure', 'U'.repeat(20)],
      ['description', 'D'.repeat(1000)],
      ['description', null],
    ])('BR-03 accepts %s at its limit (%#)', async (field, value) => {
      const res = await create({ ...valid, [field]: value });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ [field]: value });
    });

    it('BR-03 trims the name', async () => {
      const res = await create({ ...valid, name: '  Frozen Chicken  ' });
      expect(res.body).toMatchObject({ name: 'Frozen Chicken' });
    });

    it.each([
      ['name', ''],
      ['name', '   '],
      ['name', 'N'.repeat(201)],
      ['name', undefined],
      ['unitOfMeasure', ''],
      ['unitOfMeasure', 'U'.repeat(21)],
      ['unitOfMeasure', undefined],
      ['description', 'D'.repeat(1001)],
      ['quantityOnHand', 5],
    ])('BR-03 rejects %s = %j with 400', async (field, value) => {
      const res = await create({ ...valid, [field]: value });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          details: {
            fields: expect.arrayContaining([
              expect.objectContaining({ field }),
            ]) as unknown,
          },
        },
      });
    });

    it('AC-02.5 operator gets 403 FORBIDDEN and nothing is created', async () => {
      const res = await create(valid, operator);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
      expect(await prisma.product.count()).toBe(0);
    });

    it('requires a token', async () => {
      const res = await http().post('/api/v1/products').send(valid);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /products', () => {
    it('AC-02.4 searches SKU or name, case-insensitive and partial', async () => {
      await createProduct({ sku: 'FRZ-CHK-001', name: 'Frozen Chicken' });
      await createProduct({ sku: 'XYZ-001', name: 'Pack of Chk wings' });
      await createProduct({ sku: 'FRZ-FSH-002', name: 'Tuna' });
      const res = await list('?search=chk');
      expect(res.status).toBe(200);
      const skus = (res.body as { data: { sku: string }[] }).data.map(
        (p) => p.sku,
      );
      expect(skus.sort()).toEqual(['FRZ-CHK-001', 'XYZ-001']);
    });

    it('AC-02.5 operator can list products', async () => {
      await createProduct();
      const res = await list('', operator);
      expect(res.status).toBe(200);
      expect((res.body as { data: unknown[] }).data).toHaveLength(1);
    });

    it('FR-10 paginates newest first with correct meta', async () => {
      for (const [i, sku] of ['OLD-001', 'MID-002', 'NEW-003'].entries()) {
        const p = await createProduct({ sku });
        await prisma.product.update({
          where: { id: p.id },
          data: { createdAt: new Date(Date.UTC(2026, 0, 1 + i)) },
        });
      }
      const page1 = await list('?page=1&pageSize=2');
      expect(page1.status).toBe(200);
      expect(page1.body).toMatchObject({
        meta: { page: 1, pageSize: 2, totalItems: 3, totalPages: 2 },
      });
      const page1Body = page1.body as { data: Record<string, unknown>[] };
      expect(page1Body.data.map((p) => p.sku)).toEqual(['NEW-003', 'MID-002']);
      expect(Object.keys(page1Body.data[0]).sort()).toEqual(PRODUCT_KEYS);

      const page2 = await list('?page=2&pageSize=2');
      expect(
        (page2.body as { data: { sku: string }[] }).data.map((p) => p.sku),
      ).toEqual(['OLD-001']);
    });

    it('uses defaults page=1 pageSize=20', async () => {
      const res = await list();
      expect(res.body).toEqual({
        data: [],
        meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
      });
    });

    it.each([['?page=0'], ['?pageSize=0'], ['?pageSize=101'], ['?page=abc']])(
      'rejects %s with 400 VALIDATION_ERROR',
      async (query) => {
        const res = await list(query);
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
      },
    );

    it('requires a token', async () => {
      expect((await http().get('/api/v1/products')).status).toBe(401);
    });
  });

  describe('GET /products/:productId', () => {
    it('FR-13 returns the product with quantityOnHand', async () => {
      const p = await createProduct({ sku: 'FRZ-CHK-001' });
      const res = await http()
        .get(`/api/v1/products/${p.id}`)
        .set('Authorization', `Bearer ${operator}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: p.id,
        sku: 'FRZ-CHK-001',
        name: p.name,
        unitOfMeasure: p.unitOfMeasure,
        description: null,
        quantityOnHand: 0,
        createdAt: p.createdAt.toISOString(),
        updatedAt: expect.any(String) as string,
      });
    });

    it('returns 404 NOT_FOUND for an unknown id', async () => {
      const res = await http()
        .get('/api/v1/products/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${operator}`);
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    });

    it('returns 400 VALIDATION_ERROR naming productId for a non-UUID', async () => {
      const res = await http()
        .get('/api/v1/products/abc')
        .set('Authorization', `Bearer ${operator}`);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          details: {
            fields: [expect.objectContaining({ field: 'productId' })],
          },
        },
      });
    });
  });
});
