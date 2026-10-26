import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { PageQuery } from '../../common/pagination/pagination';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateProductRequest {
  // BR-01: trimmed and upper-cased before validation.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Length(3, 50)
  @Matches(/^[A-Z0-9][A-Z0-9-]*$/, {
    message:
      'sku may contain only letters, digits and hyphens, and must not start with a hyphen',
  })
  sku!: string;

  // BR-03: 1–200 characters after trimming.
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsString()
  @Length(1, 20)
  unitOfMeasure!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;
}

export class ListProductsQuery extends PageQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  unitOfMeasure: string;
  description: string | null;
  quantityOnHand: number;
  createdAt: Date;
  updatedAt: Date;
}
