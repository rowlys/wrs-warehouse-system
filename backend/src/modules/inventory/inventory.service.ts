import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Page, pageArgs, paginate } from '../../common/pagination/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { USER_REF } from '../receiving/receiving.mappers';
import {
  InventoryBalance,
  InventoryTransaction,
  ListInventoryQuery,
  ListInventoryTransactionsQuery,
} from './inventory.dto';

const TRANSACTION_INCLUDE = {
  product: { select: { id: true, sku: true, name: true } },
  receivingDocument: { select: { id: true, documentNumber: true } },
  createdBy: USER_REF,
} satisfies Prisma.InventoryTransactionInclude;

/** FR-40, FR-41: read only; stock is written by ReceiptsService alone. */
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async listBalances(
    query: ListInventoryQuery,
  ): Promise<Page<InventoryBalance>> {
    const search = query.search?.trim();
    const where: Prisma.InventoryBalanceWhereInput = search
      ? {
          product: {
            OR: [
              { sku: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
            ],
          },
        }
      : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.inventoryBalance.findMany({
        where,
        include: { product: true },
        orderBy: { product: { sku: 'asc' } },
        ...pageArgs(query),
      }),
      this.prisma.inventoryBalance.count({ where }),
    ]);
    return paginate(
      rows.map((b) => ({
        productId: b.productId,
        sku: b.product.sku,
        name: b.product.name,
        unitOfMeasure: b.product.unitOfMeasure,
        quantityOnHand: b.quantityOnHand,
        updatedAt: b.updatedAt,
      })),
      total,
      query,
    );
  }

  async listTransactions(
    query: ListInventoryTransactionsQuery,
  ): Promise<Page<InventoryTransaction>> {
    const where: Prisma.InventoryTransactionWhereInput = {
      productId: query.productId,
      receivingDocumentId: query.receivingDocumentId,
      createdAt: {
        gte: query.from ? new Date(query.from) : undefined,
        lt: query.to ? new Date(query.to) : undefined,
      },
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.inventoryTransaction.findMany({
        where,
        include: TRANSACTION_INCLUDE,
        orderBy: { id: 'desc' },
        ...pageArgs(query),
      }),
      this.prisma.inventoryTransaction.count({ where }),
    ]);
    return paginate(
      rows.map((t) => ({
        id: t.id.toString(),
        type: t.type,
        product: t.product,
        quantityChange: t.quantityChange,
        balanceAfter: t.balanceAfter,
        receiptId: t.receiptId,
        receiptReversalId: t.receiptReversalId,
        receivingDocument: t.receivingDocument,
        createdBy: t.createdBy,
        createdAt: t.createdAt,
      })),
      total,
      query,
    );
  }
}
