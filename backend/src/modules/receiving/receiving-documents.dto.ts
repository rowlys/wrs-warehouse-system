import { ReceivingStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PageQuery } from '../../common/pagination/pagination';

export class ReceivingItemInput {
  @IsUUID()
  productId!: string;

  // BR-05
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  expectedQuantity!: number;
}

export class UpdateReceivingItemRequest {
  // BR-05
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  expectedQuantity!: number;
}

/** Cancel, close short and reverse (BR-15, BR-17): trimmed, then 3–500 characters. */
export class ReasonRequest {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(3, 500)
  reason!: string;
}

// BR-04
export class CreateReceivingDocumentRequest {
  @IsString()
  @Length(1, 200)
  supplierName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceNumber?: string | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'expectedDate must be a date in YYYY-MM-DD format',
  })
  @IsISO8601({ strict: true })
  expectedDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReceivingItemInput)
  items?: ReceivingItemInput[] = [];
}

export class ListReceivingDocumentsQuery extends PageQuery {
  @IsOptional()
  @IsEnum(ReceivingStatus)
  status?: ReceivingStatus;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export interface UserRef {
  id: string;
  fullName: string;
}

export interface ReceivingItem {
  id: string;
  product: { id: string; sku: string; name: string; unitOfMeasure: string };
  expectedQuantity: number;
  receivedQuantity: number;
  remainingQuantity: number;
  isFullyReceived: boolean;
}

export interface ReceiptReversal {
  id: string;
  reason: string;
  reversedAt: Date;
  reversedBy: UserRef;
}

export interface Receipt {
  id: string;
  receivingItemId: string;
  productSku: string;
  quantity: number;
  receivedAt: Date;
  receivedBy: UserRef;
  reversal: ReceiptReversal | null;
}

export interface ReceivingDocumentSummary {
  id: string;
  documentNumber: string;
  supplierName: string;
  referenceNumber: string | null;
  expectedDate: string | null;
  status: ReceivingStatus;
  itemCount: number;
  totalExpectedQuantity: number;
  totalReceivedQuantity: number;
  createdAt: Date;
  createdBy: UserRef;
}

export interface ReceivingDocumentDetail extends ReceivingDocumentSummary {
  notes: string | null;
  allItemsReceived: boolean;
  items: ReceivingItem[];
  receipts: Receipt[];
  openedAt: Date | null;
  openedBy: UserRef | null;
  completedAt: Date | null;
  completedBy: UserRef | null;
  closedShortAt: Date | null;
  closedShortBy: UserRef | null;
  closeShortReason: string | null;
  cancelledAt: Date | null;
  cancelledBy: UserRef | null;
  cancelReason: string | null;
  updatedAt: Date;
}
