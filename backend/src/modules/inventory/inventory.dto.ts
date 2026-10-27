import { InventoryTransactionType } from '@prisma/client';
import {
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PageQuery } from '../../common/pagination/pagination';

export class ListInventoryQuery extends PageQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class ListInventoryTransactionsQuery extends PageQuery {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  receivingDocumentId?: string;

  /** Inclusive lower bound on createdAt. */
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  /** Exclusive upper bound on createdAt. */
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

export interface InventoryBalance {
  productId: string;
  sku: string;
  name: string;
  unitOfMeasure: string;
  quantityOnHand: number;
  updatedAt: Date;
}

export interface InventoryTransaction {
  /** bigint ledger id, serialized as a string. */
  id: string;
  type: InventoryTransactionType;
  product: { id: string; sku: string; name: string };
  quantityChange: number;
  balanceAfter: number;
  receiptId: string | null;
  receiptReversalId: string | null;
  receivingDocument: { id: string; documentNumber: string } | null;
  createdBy: { id: string; fullName: string };
  createdAt: Date;
}
