import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-code';
import { PrismaService } from '../../prisma/prisma.service';
import { lockDocument } from './document-lock';
import { assertCan, nextStatus } from './document-state';
import {
  ReceiptResult,
  ReceivingDocumentDetail,
} from './receiving-documents.dto';
import { ReceivingDocumentsService } from './receiving-documents.service';
import {
  allItemsReceived,
  ITEM_INCLUDE,
  RECEIPT_INCLUDE,
  toItem,
  toReceipt,
} from './receiving.mappers';

type Db = PrismaService | Prisma.TransactionClient;

const isIdempotencyKeyConflict = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError &&
  e.code === 'P2002' &&
  e.meta?.modelName === 'Receipt' &&
  JSON.stringify(e.meta?.target) === '["idempotency_key"]';

interface LockedItem {
  id: string;
  product_id: string;
  sku: string;
  expected_quantity: number;
  received_quantity: number;
}

export interface RecordedReceipt {
  result: ReceiptResult;
  /** True when an earlier request with the same Idempotency-Key is being replayed. */
  replayed: boolean;
}

/**
 * The only code that changes stock (with product creation's zero balance).
 * Lock order is always document → item → balance (spec §6).
 */
@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: ReceivingDocumentsService,
  ) {}

  /** Spec §6 steps 4–15. */
  async recordReceipt(
    documentId: string,
    itemId: string,
    quantity: number,
    idempotencyKey: string,
    userId: string,
  ): Promise<RecordedReceipt> {
    try {
      // Step 4
      return await this.prisma.$transaction(
        async (tx) => {
          // Step 6 before step 5: a concurrent duplicate waits here until the first request
          // commits, then its key lookup sees that receipt (READ COMMITTED reads per statement).
          const status = await lockDocument(tx, documentId);

          // Step 5
          const replay = await this.findReplay(
            tx,
            idempotencyKey,
            itemId,
            quantity,
          );
          if (replay) return { result: replay, replayed: true };

          // Step 7
          assertCan('RECEIVE', status);

          // Step 8: lock only the line; the product row is read for its SKU.
          const [item] = await tx.$queryRaw<LockedItem[]>`
          SELECT ri.id, ri.product_id, p.sku, ri.expected_quantity, ri.received_quantity
          FROM receiving_items ri
          JOIN products p ON p.id = ri.product_id
          WHERE ri.id = ${itemId}::uuid AND ri.receiving_document_id = ${documentId}::uuid
          FOR UPDATE OF ri`;
          if (!item) {
            throw new AppError(
              ErrorCode.NOT_FOUND,
              404,
              'Line not found on this receiving document',
            );
          }

          // Step 9 (BR-07)
          const remaining = item.expected_quantity - item.received_quantity;
          if (quantity > remaining) {
            throw new AppError(
              ErrorCode.QUANTITY_EXCEEDS_REMAINING,
              422,
              `Cannot receive ${quantity} units; only ${remaining} remaining for ${item.sku}.`,
              { remainingQuantity: remaining, requestedQuantity: quantity },
            );
          }

          // Step 10
          const receipt = await tx.receipt.create({
            data: {
              receivingItemId: item.id,
              quantity,
              idempotencyKey,
              receivedById: userId,
            },
          });

          // Step 11
          await tx.receivingItem.update({
            where: { id: item.id },
            data: { receivedQuantity: { increment: quantity } },
          });

          // Step 12: the UPDATE takes the balance row lock.
          const [balance] = await tx.$queryRaw<{ quantity_on_hand: number }[]>`
          UPDATE inventory_balances
          SET quantity_on_hand = quantity_on_hand + ${quantity}, updated_at = now()
          WHERE product_id = ${item.product_id}::uuid
          RETURNING quantity_on_hand`;

          // Step 13
          await tx.inventoryTransaction.create({
            data: {
              productId: item.product_id,
              type: 'RECEIPT',
              quantityChange: quantity,
              balanceAfter: balance.quantity_on_hand,
              receiptId: receipt.id,
              receivingDocumentId: documentId,
              createdById: userId,
            },
          });

          // Step 14
          if (status === 'OPEN') {
            await tx.receivingDocument.update({
              where: { id: documentId },
              data: { status: nextStatus('RECEIVE', status) },
            });
          }

          return {
            result: await this.loadResult(tx, receipt.id),
            replayed: false,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          timeout: 10_000,
        },
      );
    } catch (e) {
      // Step 15: the same key committed first on another document's line (a different
      // document lock). This transaction is rolled back; re-run step 5 once outside it.
      if (!isIdempotencyKeyConflict(e)) throw e;
      const replay = await this.findReplay(
        this.prisma,
        idempotencyKey,
        itemId,
        quantity,
      );
      if (!replay) throw e;
      return { result: replay, replayed: true };
    }
  }

  /** Spec §6.2 steps 4–15 (FR-37). The original receipt and its ledger row are never changed. */
  reverseReceipt(
    documentId: string,
    receiptId: string,
    reason: string,
    userId: string,
  ): Promise<ReceivingDocumentDetail> {
    // Step 4
    return this.prisma.$transaction(
      async (tx) => {
        // Steps 5–6 (BR-18)
        assertCan('REVERSE', await lockDocument(tx, documentId));

        // Step 7: only through the document the receipt belongs to (BR-18).
        const receipt = await tx.receipt.findFirst({
          where: {
            id: receiptId,
            receivingItem: { receivingDocumentId: documentId },
          },
          select: {
            quantity: true,
            receivingItemId: true,
            reversal: { select: { id: true } },
          },
        });
        if (!receipt) {
          throw new AppError(
            ErrorCode.NOT_FOUND,
            404,
            'Receipt not found on this receiving document',
          );
        }

        // Step 8 (BR-19)
        if (receipt.reversal) {
          throw new AppError(
            ErrorCode.RECEIPT_ALREADY_REVERSED,
            409,
            'This receipt has already been reversed.',
          );
        }

        // Step 9
        const [item] = await tx.$queryRaw<{ product_id: string }[]>`
          SELECT product_id FROM receiving_items
          WHERE id = ${receipt.receivingItemId}::uuid
          FOR UPDATE`;

        // Step 10: a racing duplicate hits receipt_reversals_receipt_id_key → 409.
        const reversal = await tx.receiptReversal.create({
          data: { receiptId, reason, reversedById: userId },
        });

        // Step 11
        await tx.receivingItem.update({
          where: { id: receipt.receivingItemId },
          data: { receivedQuantity: { decrement: receipt.quantity } },
        });

        // Step 12: the UPDATE takes the balance row lock.
        const [balance] = await tx.$queryRaw<{ quantity_on_hand: number }[]>`
          UPDATE inventory_balances
          SET quantity_on_hand = quantity_on_hand - ${receipt.quantity}, updated_at = now()
          WHERE product_id = ${item.product_id}::uuid
          RETURNING quantity_on_hand`;

        // Step 13
        await tx.inventoryTransaction.create({
          data: {
            productId: item.product_id,
            type: 'RECEIPT_REVERSAL',
            quantityChange: -receipt.quantity,
            balanceAfter: balance.quantity_on_hand,
            receiptReversalId: reversal.id,
            receivingDocumentId: documentId,
            createdById: userId,
          },
        });

        // Step 14: nothing received any more → back to OPEN; opened_at/by unchanged.
        const linesWithStock = await tx.receivingItem.count({
          where: {
            receivingDocumentId: documentId,
            receivedQuantity: { gt: 0 },
          },
        });
        if (!linesWithStock) {
          await tx.receivingDocument.update({
            where: { id: documentId },
            data: { status: 'OPEN' },
          });
        }

        return this.documents.loadDetail(tx, documentId);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 10_000,
      },
    );
  }

  /**
   * Step 5 (BR-09): a receipt with this key and the same line and quantity is replayed;
   * the same key with anything else is rejected.
   */
  private async findReplay(
    db: Db,
    idempotencyKey: string,
    itemId: string,
    quantity: number,
  ): Promise<ReceiptResult | null> {
    const existing = await db.receipt.findUnique({
      where: { idempotencyKey },
      select: { id: true, receivingItemId: true, quantity: true },
    });
    if (!existing) return null;
    if (existing.receivingItemId !== itemId || existing.quantity !== quantity) {
      throw new AppError(
        ErrorCode.IDEMPOTENCY_KEY_REUSED,
        409,
        'This Idempotency-Key was already used for a different receipt.',
      );
    }
    return this.loadResult(db, existing.id);
  }

  /** Spec §6 step 16: the receipt with its line, document state and product balance. */
  private async loadResult(tx: Db, receiptId: string): Promise<ReceiptResult> {
    const receipt = await tx.receipt.findUniqueOrThrow({
      where: { id: receiptId },
      include: RECEIPT_INCLUDE,
    });
    const item = await tx.receivingItem.findUniqueOrThrow({
      where: { id: receipt.receivingItemId },
      include: {
        ...ITEM_INCLUDE,
        receivingDocument: {
          select: {
            id: true,
            documentNumber: true,
            status: true,
            items: {
              select: { expectedQuantity: true, receivedQuantity: true },
            },
          },
        },
      },
    });
    const balance = await tx.inventoryBalance.findUniqueOrThrow({
      where: { productId: item.productId },
    });
    const doc = item.receivingDocument;
    return {
      receipt: toReceipt(receipt),
      item: toItem(item),
      document: {
        id: doc.id,
        documentNumber: doc.documentNumber,
        status: doc.status,
        allItemsReceived: allItemsReceived(doc.items),
      },
      inventory: {
        productId: balance.productId,
        quantityOnHand: balance.quantityOnHand,
      },
    };
  }
}
