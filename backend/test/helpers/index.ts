import { INestApplication, Type } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { PrismaClient, User, UserRole } from '@prisma/client';
import { hash } from 'bcrypt';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { loadConfig } from '../../src/config/config';

export const prisma = new PrismaClient();
export const TEST_PASSWORD = 'Password123!';

let seq = 0;
const next = () => String(++seq).padStart(4, '0');

/**
 * Real Nest app with the same global prefix, pipes, filter and logging as main.ts.
 * `customize` can override providers, e.g. to simulate a database failure;
 * `controllers` mounts test-only routes.
 */
export async function createTestApp(
  customize: (builder: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
  controllers: Type[] = [],
): Promise<INestApplication<App>> {
  const moduleRef = await customize(
    Test.createTestingModule({ imports: [AppModule], controllers }),
  ).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({
    logger: false,
  });
  configureApp(app);
  await app.init();
  return app;
}

export async function truncateAll(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE inventory_transactions, receipt_reversals, receipts, inventory_balances,
      receiving_items, receiving_documents, products, users RESTART IDENTITY CASCADE`);
  await prisma.$executeRawUnsafe(
    'ALTER SEQUENCE receiving_document_number_seq RESTART',
  );
}

// Hashed once per test file; every test user shares TEST_PASSWORD.
let passwordHash: Promise<string> | undefined;

export function createUser(role: UserRole): Promise<User> {
  const n = next();
  passwordHash ??= hash(TEST_PASSWORD, 10);
  return passwordHash.then((passwordHash) =>
    prisma.user.create({
      data: {
        username: `${role.toLowerCase()}-${n}`,
        fullName: `Test ${role} ${n}`,
        role,
        passwordHash,
      },
    }),
  );
}

/** Signs a token with the spec §8 claims. Pass a role to create a fresh user. */
export async function loginAs(who: UserRole | User): Promise<string> {
  const user = typeof who === 'string' ? await createUser(who) : who;
  const config = loadConfig(process.env);
  return new JwtService().sign(
    { sub: user.id, username: user.username, role: user.role },
    {
      secret: config.jwtSecret,
      // Validated config string such as '8h'; the lib types it as a template literal.
      expiresIn: config.jwtExpiresIn as JwtSignOptions['expiresIn'],
    },
  );
}

/** Product plus its zero balance, as product creation does. */
export function createProduct(
  overrides: { sku?: string; name?: string; unitOfMeasure?: string } = {},
) {
  const n = next();
  return prisma.product.create({
    data: {
      sku: `TEST-${n}`,
      name: `Test product ${n}`,
      unitOfMeasure: 'PCS',
      ...overrides,
      inventoryBalance: { create: { quantityOnHand: 0 } },
    },
  });
}

/** Draft document numbered from the real sequence (RCV-YYYY-NNNNNN). */
export async function createDraftDocument(
  lines: { productId: string; expectedQuantity: number }[],
  createdBy?: User,
) {
  const creator = createdBy ?? (await createUser(UserRole.SUPERVISOR));
  const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT nextval('receiving_document_number_seq') AS n`;
  return prisma.receivingDocument.create({
    data: {
      documentNumber: `RCV-${new Date().getUTCFullYear()}-${String(n).padStart(6, '0')}`,
      supplierName: 'Test Supplier',
      createdById: creator.id,
      items: { create: lines },
    },
    include: { items: true },
  });
}

/** Moves a draft to OPEN; defaults to the document's creator as opener. */
export async function openDocument(documentId: string, openedBy?: User) {
  const doc = await prisma.receivingDocument.findUniqueOrThrow({
    where: { id: documentId },
  });
  return prisma.receivingDocument.update({
    where: { id: documentId },
    data: {
      status: 'OPEN',
      openedAt: new Date(),
      openedById: openedBy?.id ?? doc.createdById,
    },
    include: { items: true },
  });
}

/** BR-12 and BR-13 across the whole database. */
export async function assertInventoryConsistent(): Promise<void> {
  const balances = await prisma.$queryRaw<unknown[]>`
    SELECT p.sku, b.quantity_on_hand AS "onHand",
           COALESCE(SUM(t.quantity_change), 0)::int AS "ledgerSum"
    FROM products p
    LEFT JOIN inventory_balances b ON b.product_id = p.id
    LEFT JOIN inventory_transactions t ON t.product_id = p.id
    GROUP BY p.sku, b.quantity_on_hand
    HAVING b.quantity_on_hand IS NULL
        OR b.quantity_on_hand < 0
        OR b.quantity_on_hand <> COALESCE(SUM(t.quantity_change), 0)`;
  expect({ 'BR-12 balance != ledger': balances }).toEqual({
    'BR-12 balance != ledger': [],
  });

  const items = await prisma.$queryRaw<unknown[]>`
    SELECT i.id, i.expected_quantity AS "expected", i.received_quantity AS "received",
           COALESCE(SUM(r.quantity) FILTER (WHERE rr.id IS NULL), 0)::int AS "unreversedSum"
    FROM receiving_items i
    LEFT JOIN receipts r ON r.receiving_item_id = i.id
    LEFT JOIN receipt_reversals rr ON rr.receipt_id = r.id
    GROUP BY i.id
    HAVING i.received_quantity < 0
        OR i.received_quantity > i.expected_quantity
        OR i.received_quantity <> COALESCE(SUM(r.quantity) FILTER (WHERE rr.id IS NULL), 0)`;
  expect({ 'BR-13 received != unreversed receipts': items }).toEqual({
    'BR-13 received != unreversed receipts': [],
  });
}
