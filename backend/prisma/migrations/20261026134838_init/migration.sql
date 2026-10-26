-- Hand-added (spec §3.3): needed for gen_random_uuid() defaults
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('OPERATOR', 'SUPERVISOR');

-- CreateEnum
CREATE TYPE "receiving_status" AS ENUM ('DRAFT', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'CLOSED_SHORT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "inventory_transaction_type" AS ENUM ('RECEIPT', 'RECEIPT_REVERSAL');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "username" VARCHAR(50) NOT NULL,
    "password_hash" VARCHAR(100) NOT NULL,
    "full_name" VARCHAR(100) NOT NULL,
    "role" "user_role" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sku" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "unit_of_measure" VARCHAR(20) NOT NULL,
    "description" VARCHAR(1000),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receiving_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_number" VARCHAR(20) NOT NULL,
    "supplier_name" VARCHAR(200) NOT NULL,
    "reference_number" VARCHAR(100),
    "expected_date" DATE,
    "notes" VARCHAR(1000),
    "status" "receiving_status" NOT NULL DEFAULT 'DRAFT',
    "created_by_id" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ,
    "opened_by_id" UUID,
    "completed_at" TIMESTAMPTZ,
    "completed_by_id" UUID,
    "closed_short_at" TIMESTAMPTZ,
    "closed_short_by_id" UUID,
    "close_short_reason" VARCHAR(500),
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_by_id" UUID,
    "cancel_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receiving_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receiving_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receiving_document_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "expected_quantity" INTEGER NOT NULL,
    "received_quantity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receiving_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receiving_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "idempotency_key" VARCHAR(100) NOT NULL,
    "received_by_id" UUID NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_reversals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receipt_id" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "reversed_by_id" UUID NOT NULL,
    "reversed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_reversals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_balances" (
    "product_id" UUID NOT NULL,
    "quantity_on_hand" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_balances_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "product_id" UUID NOT NULL,
    "type" "inventory_transaction_type" NOT NULL,
    "quantity_change" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "receipt_id" UUID,
    "receipt_reversal_id" UUID,
    "receiving_document_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_created_at_idx" ON "products"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "receiving_documents_document_number_key" ON "receiving_documents"("document_number");

-- CreateIndex
CREATE INDEX "rd_status_created_idx" ON "receiving_documents"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "rd_created_at_idx" ON "receiving_documents"("created_at" DESC);

-- CreateIndex
CREATE INDEX "ri_product_idx" ON "receiving_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "ri_document_product_uq" ON "receiving_items"("receiving_document_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_idempotency_key_key" ON "receipts"("idempotency_key");

-- CreateIndex
CREATE INDEX "receipts_item_idx" ON "receipts"("receiving_item_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_reversals_receipt_id_key" ON "receipt_reversals"("receipt_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transactions_receipt_id_key" ON "inventory_transactions"("receipt_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transactions_receipt_reversal_id_key" ON "inventory_transactions"("receipt_reversal_id");

-- CreateIndex
CREATE INDEX "it_product_created_idx" ON "inventory_transactions"("product_id", "id" DESC);

-- CreateIndex
CREATE INDEX "it_document_idx" ON "inventory_transactions"("receiving_document_id");

-- CreateIndex
CREATE INDEX "it_created_at_idx" ON "inventory_transactions"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "receiving_documents" ADD CONSTRAINT "receiving_documents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "receiving_documents" ADD CONSTRAINT "receiving_documents_opened_by_id_fkey" FOREIGN KEY ("opened_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "receiving_documents" ADD CONSTRAINT "receiving_documents_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "receiving_documents" ADD CONSTRAINT "receiving_documents_closed_short_by_id_fkey" FOREIGN KEY ("closed_short_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "receiving_documents" ADD CONSTRAINT "receiving_documents_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "receiving_items" ADD CONSTRAINT "receiving_items_receiving_document_id_fkey" FOREIGN KEY ("receiving_document_id") REFERENCES "receiving_documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "receiving_items" ADD CONSTRAINT "receiving_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_receiving_item_id_fkey" FOREIGN KEY ("receiving_item_id") REFERENCES "receiving_items"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "receipt_reversals" ADD CONSTRAINT "receipt_reversals_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "receipt_reversals" ADD CONSTRAINT "receipt_reversals_reversed_by_id_fkey" FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_receipt_reversal_id_fkey" FOREIGN KEY ("receipt_reversal_id") REFERENCES "receipt_reversals"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_receiving_document_id_fkey" FOREIGN KEY ("receiving_document_id") REFERENCES "receiving_documents"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ---------------------------------------------------------------------------
-- Hand-added (spec §3.3): what Prisma cannot express. Copied from spec §3.2.
-- ---------------------------------------------------------------------------

CREATE SEQUENCE receiving_document_number_seq START 1;

CREATE INDEX products_name_idx ON products (lower(name));
CREATE INDEX rd_supplier_idx ON receiving_documents (lower(supplier_name));

ALTER TABLE products ADD CONSTRAINT products_sku_format_chk CHECK (sku ~ '^[A-Z0-9][A-Z0-9-]{2,49}$');

ALTER TABLE receiving_documents ADD CONSTRAINT rd_cancel_reason_chk CHECK (
  (status = 'CANCELLED') = (cancel_reason IS NOT NULL AND cancelled_at IS NOT NULL)
);
ALTER TABLE receiving_documents ADD CONSTRAINT rd_completed_chk CHECK (
  (status = 'COMPLETED') = (completed_at IS NOT NULL)
);
ALTER TABLE receiving_documents ADD CONSTRAINT rd_closed_short_chk CHECK (
  (status = 'CLOSED_SHORT') = (close_short_reason IS NOT NULL AND closed_short_at IS NOT NULL)
);

ALTER TABLE receiving_items ADD CONSTRAINT ri_expected_positive_chk CHECK (expected_quantity BETWEEN 1 AND 1000000);
ALTER TABLE receiving_items ADD CONSTRAINT ri_received_range_chk CHECK (received_quantity >= 0 AND received_quantity <= expected_quantity);

ALTER TABLE receipts ADD CONSTRAINT receipts_quantity_positive_chk CHECK (quantity > 0);

ALTER TABLE inventory_balances ADD CONSTRAINT ib_non_negative_chk CHECK (quantity_on_hand >= 0);

ALTER TABLE inventory_transactions ADD CONSTRAINT it_change_nonzero_chk CHECK (quantity_change <> 0);
ALTER TABLE inventory_transactions ADD CONSTRAINT it_balance_non_negative_chk CHECK (balance_after >= 0);
ALTER TABLE inventory_transactions ADD CONSTRAINT it_receipt_link_chk CHECK (type <> 'RECEIPT' OR (receipt_id IS NOT NULL AND receipt_reversal_id IS NULL AND receiving_document_id IS NOT NULL AND quantity_change > 0));
ALTER TABLE inventory_transactions ADD CONSTRAINT it_reversal_link_chk CHECK (type <> 'RECEIPT_REVERSAL' OR (receipt_reversal_id IS NOT NULL AND receipt_id IS NULL AND receiving_document_id IS NOT NULL AND quantity_change < 0));
