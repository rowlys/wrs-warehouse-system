import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-code';
import { Page, pageArgs, paginate } from '../../common/pagination/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { lockDocument } from './document-lock';
import { formatDocumentNumber } from './document-number';
import { assertCan } from './document-state';
import {
  CreateReceivingDocumentRequest,
  ListReceivingDocumentsQuery,
  ReceivingDocumentDetail,
  ReceivingDocumentSummary,
  ReceivingItemInput,
  UpdateReceivingItemRequest,
} from './receiving-documents.dto';
import {
  DETAIL_INCLUDE,
  fromDateOnly,
  RECEIPT_INCLUDE,
  SUMMARY_INCLUDE,
  toDetail,
  toSummary,
} from './receiving.mappers';

type Db = PrismaService | Prisma.TransactionClient;

const itemNotFound = () =>
  new AppError(
    ErrorCode.NOT_FOUND,
    404,
    'Line not found on this receiving document',
  );

@Injectable()
export class ReceivingDocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ListReceivingDocumentsQuery,
  ): Promise<Page<ReceivingDocumentSummary>> {
    const search = query.search?.trim();
    const where: Prisma.ReceivingDocumentWhereInput = {
      ...(query.status && { status: query.status }),
      ...(search && {
        OR: [
          { documentNumber: { contains: search, mode: 'insensitive' } },
          { supplierName: { contains: search, mode: 'insensitive' } },
          { referenceNumber: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.receivingDocument.findMany({
        where,
        include: SUMMARY_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      }),
      this.prisma.receivingDocument.count({ where }),
    ]);
    return paginate(rows.map(toSummary), total, query);
  }

  getDetail(id: string): Promise<ReceivingDocumentDetail> {
    return this.loadDetail(this.prisma, id);
  }

  /** Spec §6.1 "Create document": number from the sequence, document and lines in one transaction. */
  async create(
    input: CreateReceivingDocumentRequest,
    userId: string,
  ): Promise<ReceivingDocumentDetail> {
    const items = input.items ?? [];
    const productIds = items.map((i) => i.productId);
    if (new Set(productIds).size !== productIds.length) {
      throw new AppError(
        ErrorCode.DUPLICATE_PRODUCT_IN_DOCUMENT,
        409,
        'A product may appear only once per receiving document.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const found = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true },
      });
      const missing = productIds.filter(
        (id) => !found.some((p) => p.id === id),
      );
      if (missing.length) {
        throw new AppError(
          ErrorCode.PRODUCT_NOT_FOUND,
          422,
          'One or more products do not exist.',
          { productIds: missing },
        );
      }

      const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT nextval('receiving_document_number_seq') AS n`;
      const doc = await tx.receivingDocument.create({
        data: {
          // Creation year in UTC, like every stored timestamp.
          documentNumber: formatDocumentNumber(new Date().getUTCFullYear(), n),
          supplierName: input.supplierName,
          referenceNumber: input.referenceNumber ?? null,
          expectedDate: fromDateOnly(input.expectedDate),
          notes: input.notes ?? null,
          createdById: userId,
          items: { create: items },
        },
      });
      return this.loadDetail(tx, doc.id);
    });
  }

  /** FR-24. A duplicate product hits ri_document_product_uq → 409 (BR-06). */
  addItem(
    documentId: string,
    input: ReceivingItemInput,
  ): Promise<ReceivingDocumentDetail> {
    return this.prisma.$transaction(async (tx) => {
      assertCan('EDIT_ITEMS', await lockDocument(tx, documentId));
      const product = await tx.product.findUnique({
        where: { id: input.productId },
        select: { id: true },
      });
      if (!product) {
        throw new AppError(
          ErrorCode.PRODUCT_NOT_FOUND,
          422,
          'Product does not exist.',
          { productIds: [input.productId] },
        );
      }
      await tx.receivingItem.create({
        data: { receivingDocumentId: documentId, ...input },
      });
      return this.loadDetail(tx, documentId);
    });
  }

  /** FR-25 */
  updateItem(
    documentId: string,
    itemId: string,
    input: UpdateReceivingItemRequest,
  ): Promise<ReceivingDocumentDetail> {
    return this.prisma.$transaction(async (tx) => {
      assertCan('EDIT_ITEMS', await lockDocument(tx, documentId));
      const { count } = await tx.receivingItem.updateMany({
        where: { id: itemId, receivingDocumentId: documentId },
        data: { expectedQuantity: input.expectedQuantity },
      });
      if (!count) throw itemNotFound();
      return this.loadDetail(tx, documentId);
    });
  }

  /** FR-26 */
  removeItem(documentId: string, itemId: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      assertCan('EDIT_ITEMS', await lockDocument(tx, documentId));
      const { count } = await tx.receivingItem.deleteMany({
        where: { id: itemId, receivingDocumentId: documentId },
      });
      if (!count) throw itemNotFound();
    });
  }

  async loadDetail(db: Db, id: string): Promise<ReceivingDocumentDetail> {
    const row = await db.receivingDocument.findUnique({
      where: { id },
      include: DETAIL_INCLUDE,
    });
    if (!row) {
      throw new AppError(
        ErrorCode.NOT_FOUND,
        404,
        'Receiving document not found',
      );
    }
    const receipts = await db.receipt.findMany({
      where: { receivingItem: { receivingDocumentId: id } },
      include: RECEIPT_INCLUDE,
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
    });
    return toDetail(row, receipts);
  }
}
