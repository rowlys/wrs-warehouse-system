import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-code';
import { Page, pageArgs, paginate } from '../../common/pagination/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateProductRequest,
  ListProductsQuery,
  Product,
} from './products.dto';

const WITH_BALANCE = { inventoryBalance: true } as const;
type ProductRow = Prisma.ProductGetPayload<{ include: typeof WITH_BALANCE }>;

function toProduct({ inventoryBalance, ...p }: ProductRow): Product {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    unitOfMeasure: p.unitOfMeasure,
    description: p.description,
    quantityOnHand: inventoryBalance?.quantityOnHand ?? 0,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListProductsQuery): Promise<Page<Product>> {
    const search = query.search?.trim();
    const where: Prisma.ProductWhereInput = search
      ? {
          OR: [
            { sku: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: WITH_BALANCE,
        // id breaks ties so pages stay stable when timestamps are equal.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      }),
      this.prisma.product.count({ where }),
    ]);
    return paginate(rows.map(toProduct), total, query);
  }

  async get(id: string): Promise<Product> {
    const row = await this.prisma.product.findUnique({
      where: { id },
      include: WITH_BALANCE,
    });
    if (!row) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'Product not found');
    }
    return toProduct(row);
  }

  /**
   * FR-12: product and its zero balance in one nested write, which Prisma runs in a
   * single transaction. A duplicate SKU (BR-02) hits products_sku_key → 409 DUPLICATE_SKU.
   */
  async create(input: CreateProductRequest): Promise<Product> {
    const row = await this.prisma.product.create({
      data: {
        sku: input.sku,
        name: input.name,
        unitOfMeasure: input.unitOfMeasure,
        description: input.description ?? null,
        inventoryBalance: { create: { quantityOnHand: 0 } },
      },
      include: WITH_BALANCE,
    });
    return toProduct(row);
  }
}
