// Prisma query shapes and their mapping to the OpenAPI response schemas.
import { Prisma } from '@prisma/client';
import {
  Receipt,
  ReceivingDocumentDetail,
  ReceivingDocumentSummary,
  ReceivingItem,
} from './receiving-documents.dto';

export const USER_REF = { select: { id: true, fullName: true } } as const;

export const ITEM_INCLUDE = {
  product: { select: { id: true, sku: true, name: true, unitOfMeasure: true } },
} satisfies Prisma.ReceivingItemInclude;

// Lines created together share created_at, so SKU keeps their order stable.
export const ITEM_ORDER: Prisma.ReceivingItemOrderByWithRelationInput[] = [
  { createdAt: 'asc' },
  { product: { sku: 'asc' } },
];

export const SUMMARY_INCLUDE = {
  createdBy: USER_REF,
  items: { select: { expectedQuantity: true, receivedQuantity: true } },
} satisfies Prisma.ReceivingDocumentInclude;

export const DETAIL_INCLUDE = {
  createdBy: USER_REF,
  openedBy: USER_REF,
  completedBy: USER_REF,
  closedShortBy: USER_REF,
  cancelledBy: USER_REF,
  items: { include: ITEM_INCLUDE, orderBy: ITEM_ORDER },
} satisfies Prisma.ReceivingDocumentInclude;

export const RECEIPT_INCLUDE = {
  receivingItem: { select: { product: { select: { sku: true } } } },
  receivedBy: USER_REF,
  reversal: { include: { reversedBy: USER_REF } },
} satisfies Prisma.ReceiptInclude;

type ItemRow = Prisma.ReceivingItemGetPayload<{ include: typeof ITEM_INCLUDE }>;
type SummaryRow = Prisma.ReceivingDocumentGetPayload<{
  include: typeof SUMMARY_INCLUDE;
}>;
type DetailRow = Prisma.ReceivingDocumentGetPayload<{
  include: typeof DETAIL_INCLUDE;
}>;
type ReceiptRow = Prisma.ReceiptGetPayload<{ include: typeof RECEIPT_INCLUDE }>;

/** `date` columns come back as UTC midnight; the API uses `YYYY-MM-DD`. */
export const toDateOnly = (d: Date | null): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

export const fromDateOnly = (s: string | null | undefined): Date | null =>
  s ? new Date(`${s}T00:00:00.000Z`) : null;

export function toItem(row: ItemRow): ReceivingItem {
  return {
    id: row.id,
    product: row.product,
    expectedQuantity: row.expectedQuantity,
    receivedQuantity: row.receivedQuantity,
    remainingQuantity: row.expectedQuantity - row.receivedQuantity,
    isFullyReceived: row.receivedQuantity === row.expectedQuantity,
  };
}

export function toReceipt(row: ReceiptRow): Receipt {
  return {
    id: row.id,
    receivingItemId: row.receivingItemId,
    productSku: row.receivingItem.product.sku,
    quantity: row.quantity,
    receivedAt: row.receivedAt,
    receivedBy: row.receivedBy,
    reversal: row.reversal && {
      id: row.reversal.id,
      reason: row.reversal.reason,
      reversedAt: row.reversal.reversedAt,
      reversedBy: row.reversal.reversedBy,
    },
  };
}

/** True when the document has at least one line and every line is fully received. */
export const allItemsReceived = (
  items: { expectedQuantity: number; receivedQuantity: number }[],
): boolean =>
  items.length > 0 &&
  items.every((i) => i.receivedQuantity === i.expectedQuantity);

export function toSummary(
  row: SummaryRow | DetailRow,
): ReceivingDocumentSummary {
  return {
    id: row.id,
    documentNumber: row.documentNumber,
    supplierName: row.supplierName,
    referenceNumber: row.referenceNumber,
    expectedDate: toDateOnly(row.expectedDate),
    status: row.status,
    itemCount: row.items.length,
    totalExpectedQuantity: row.items.reduce(
      (s, i) => s + i.expectedQuantity,
      0,
    ),
    totalReceivedQuantity: row.items.reduce(
      (s, i) => s + i.receivedQuantity,
      0,
    ),
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}

export function toDetail(
  row: DetailRow,
  receipts: ReceiptRow[],
): ReceivingDocumentDetail {
  return {
    ...toSummary(row),
    notes: row.notes,
    allItemsReceived: allItemsReceived(row.items),
    items: row.items.map(toItem),
    receipts: receipts.map(toReceipt),
    openedAt: row.openedAt,
    openedBy: row.openedBy,
    completedAt: row.completedAt,
    completedBy: row.completedBy,
    closedShortAt: row.closedShortAt,
    closedShortBy: row.closedShortBy,
    closeShortReason: row.closeShortReason,
    cancelledAt: row.cancelledAt,
    cancelledBy: row.cancelledBy,
    cancelReason: row.cancelReason,
    updatedAt: row.updatedAt,
  };
}
