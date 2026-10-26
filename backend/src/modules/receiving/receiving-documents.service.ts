import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-code';
import { Page, pageArgs, paginate } from '../../common/pagination/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { formatDocumentNumber } from './document-number';
import {
  CreateReceivingDocumentRequest,
  ListReceivingDocumentsQuery,
  ReceivingDocumentDetail,
  ReceivingDocumentSummary,
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
