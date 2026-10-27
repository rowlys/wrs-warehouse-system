import { PrismaClient } from '@prisma/client';

// Every named CHECK constraint in technical-spec §3.2.
const CHECKS = [
  'products_sku_format_chk',
  'rd_cancel_reason_chk',
  'rd_completed_chk',
  'rd_closed_short_chk',
  'ri_expected_positive_chk',
  'ri_received_range_chk',
  'receipts_quantity_positive_chk',
  'ib_non_negative_chk',
  'it_change_nonzero_chk',
  'it_balance_non_negative_chk',
  'it_receipt_link_chk',
  'it_reversal_link_chk',
];

describe('database schema (spec §3.2)', () => {
  const prisma = new PrismaClient();
  afterAll(() => prisma.$disconnect());

  it('has every named CHECK constraint', async () => {
    const rows = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint WHERE contype = 'c'`;
    expect(rows.map((r) => r.conname)).toEqual(expect.arrayContaining(CHECKS));
  });

  // Single statements, so the failed insert leaves no rows behind.
  it('BR-13 rejects received_quantity above expected_quantity at the database', async () => {
    await expect(prisma.$executeRaw`
      WITH u AS (
        INSERT INTO users (username, password_hash, full_name, role)
        VALUES ('schema-test', 'x', 'Schema Test', 'SUPERVISOR') RETURNING id
      ), p AS (
        INSERT INTO products (sku, name, unit_of_measure)
        VALUES ('SCHEMA-TEST-001', 'Schema test', 'PCS') RETURNING id
      ), d AS (
        INSERT INTO receiving_documents (document_number, supplier_name, created_by_id)
        SELECT 'SCHEMA-TEST', 'Supplier', id FROM u RETURNING id
      )
      INSERT INTO receiving_items (receiving_document_id, product_id, expected_quantity, received_quantity)
      SELECT d.id, p.id, 5, 6 FROM d, p`).rejects.toThrow(
      /ri_received_range_chk/,
    );
  });

  it('BR-12 rejects a negative balance at the database', async () => {
    await expect(prisma.$executeRaw`
      WITH p AS (
        INSERT INTO products (sku, name, unit_of_measure)
        VALUES ('SCHEMA-TEST-002', 'Schema test', 'PCS') RETURNING id
      )
      INSERT INTO inventory_balances (product_id, quantity_on_hand)
      SELECT id, -1 FROM p`).rejects.toThrow(/ib_non_negative_chk/);
  });

  it('BR-19 rejects a second reversal for the same receipt at the database', async () => {
    await expect(prisma.$executeRaw`
      WITH u AS (
        INSERT INTO users (username, password_hash, full_name, role)
        VALUES ('schema-test-3', 'x', 'Schema Test', 'SUPERVISOR') RETURNING id
      ), p AS (
        INSERT INTO products (sku, name, unit_of_measure)
        VALUES ('SCHEMA-TEST-003', 'Schema test', 'PCS') RETURNING id
      ), d AS (
        INSERT INTO receiving_documents (document_number, supplier_name, created_by_id)
        SELECT 'SCHEMA-TEST-3', 'Supplier', id FROM u RETURNING id
      ), i AS (
        INSERT INTO receiving_items (receiving_document_id, product_id, expected_quantity)
        SELECT d.id, p.id, 5 FROM d, p RETURNING id
      ), r AS (
        INSERT INTO receipts (receiving_item_id, quantity, idempotency_key, received_by_id)
        SELECT i.id, 1, 'schema-test-key-3', u.id FROM i, u RETURNING id
      ), first AS (
        INSERT INTO receipt_reversals (receipt_id, reason, reversed_by_id)
        SELECT r.id, 'first', u.id FROM r, u
      )
      INSERT INTO receipt_reversals (receipt_id, reason, reversed_by_id)
      SELECT r.id, 'second', u.id FROM r, u`).rejects.toThrow(
      // Unique violation on receipt_reversals_receipt_id_key; raw errors name the key, not the index.
      /23505[\s\S]*Key \(receipt_id\)/,
    );
  });
});
