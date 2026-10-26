import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
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

describe('integration test harness', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => truncateAll());

  it('runs against the real wrs_test database', async () => {
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`
      SELECT current_database() AS db`;
    expect(db).toBe('wrs_test');
  });

  it('serves requests through the real app with the global error envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: expect.any(String) as string },
    });
  });

  it('builds and opens a draft document with the factories', async () => {
    const supervisor = await createUser(UserRole.SUPERVISOR);
    const product = await createProduct();
    const doc = await createDraftDocument(
      [{ productId: product.id, expectedQuantity: 10 }],
      supervisor,
    );
    expect(doc.documentNumber).toMatch(/^RCV-\d{4}-000001$/);
    expect(doc.status).toBe('DRAFT');
    expect(doc.items).toEqual([
      expect.objectContaining({
        productId: product.id,
        expectedQuantity: 10,
        receivedQuantity: 0,
      }),
    ]);

    const opened = await openDocument(doc.id, supervisor);
    expect(opened.status).toBe('OPEN');
    expect(opened.openedById).toBe(supervisor.id);
    expect(opened.openedAt).toBeInstanceOf(Date);
    await assertInventoryConsistent();
  });

  it('isolates tests by truncating every table', async () => {
    expect(await prisma.product.count()).toBe(0);
    expect(await prisma.receivingDocument.count()).toBe(0);
    const doc = await createDraftDocument([
      { productId: (await createProduct()).id, expectedQuantity: 1 },
    ]);
    expect(doc.documentNumber).toMatch(/-000001$/);
  });

  it('loginAs returns a token carrying sub, username and role', async () => {
    const token = await loginAs(UserRole.OPERATOR);
    const claims = new JwtService().verify<{
      sub: string;
      username: string;
      role: string;
    }>(token, { secret: process.env.JWT_SECRET });
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: claims.sub },
    });
    expect(claims).toMatchObject({ username: user.username, role: 'OPERATOR' });
  });

  it('BR-12 BR-13 assertInventoryConsistent accepts a receipt and its reversal', async () => {
    const supervisor = await createUser(UserRole.SUPERVISOR);
    const product = await createProduct();
    const doc = await openDocument(
      (
        await createDraftDocument(
          [{ productId: product.id, expectedQuantity: 10 }],
          supervisor,
        )
      ).id,
    );
    const item = doc.items[0];
    // Simulates what ReceiptsService will write: +4 receipt, then its -4 reversal.
    const receipt = await prisma.receipt.create({
      data: {
        receivingItemId: item.id,
        quantity: 4,
        idempotencyKey: 'harness-1',
        receivedById: supervisor.id,
      },
    });
    await prisma.inventoryTransaction.create({
      data: {
        productId: product.id,
        type: 'RECEIPT',
        quantityChange: 4,
        balanceAfter: 4,
        receiptId: receipt.id,
        receivingDocumentId: doc.id,
        createdById: supervisor.id,
      },
    });
    const reversal = await prisma.receiptReversal.create({
      data: {
        receiptId: receipt.id,
        reason: 'test',
        reversedById: supervisor.id,
      },
    });
    await prisma.inventoryTransaction.create({
      data: {
        productId: product.id,
        type: 'RECEIPT_REVERSAL',
        quantityChange: -4,
        balanceAfter: 0,
        receiptReversalId: reversal.id,
        receivingDocumentId: doc.id,
        createdById: supervisor.id,
      },
    });
    await assertInventoryConsistent();
  });

  it('BR-12 assertInventoryConsistent rejects a balance that differs from the ledger', async () => {
    const product = await createProduct();
    await prisma.inventoryBalance.update({
      where: { productId: product.id },
      data: { quantityOnHand: 5 },
    });
    await expect(assertInventoryConsistent()).rejects.toThrow();
  });

  it('BR-13 assertInventoryConsistent rejects received quantity without receipts', async () => {
    const doc = await createDraftDocument([
      { productId: (await createProduct()).id, expectedQuantity: 10 },
    ]);
    await prisma.receivingItem.update({
      where: { id: doc.items[0].id },
      data: { receivedQuantity: 3 },
    });
    await expect(assertInventoryConsistent()).rejects.toThrow();
  });
});
