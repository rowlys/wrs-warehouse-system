import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-code';
import { PrismaService } from '../../prisma/prisma.service';
import { lockDocument } from './document-lock';
import { assertCan, nextStatus } from './document-state';
import { ReceiptResult } from './receiving-documents.dto';
import {
  allItemsReceived,
  ITEM_INCLUDE,
  RECEIPT_INCLUDE,
  toItem,
  toReceipt,
} from './receiving.mappers';

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
  constructor(private readonly prisma: PrismaService) {}

  /** Spec §6 steps 4–14. */
  recordReceipt(
    documentId: string,
    itemId: string,
    quantity: number,
    idempotencyKey: string,
    userId: string,
  ): Promise<RecordedReceipt> {
    // Step 4
    return this.prisma.$transaction(
      async (tx) => {
        // Step 5
        const replay = await this.findReplay();
        if (replay) return { result: replay, replayed: true };

        // Steps 6–7
        const status = await lockDocument(tx, documentId);
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
  }

  // shortcut: always misses, so a reused key ends in a unique violation (500); T013 adds replay and 409.
  private findReplay(): Promise<ReceiptResult | null> {
    return Promise.resolve(null);
  }

  /** Spec §6 step 16: the receipt with its line, document state and product balance. */
  private async loadResult(
    tx: Prisma.TransactionClient,
    receiptId: string,
  ): Promise<ReceiptResult> {
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
