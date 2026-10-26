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
});
