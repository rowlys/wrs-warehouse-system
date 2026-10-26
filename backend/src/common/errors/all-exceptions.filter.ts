import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from './app-error';
import { ErrorCode } from './error-code';

interface PrismaKnownError extends Error {
  code: string;
  meta?: { target?: unknown };
}

// Matched by name so this file does not depend on the generated Prisma client.
function isPrismaKnownError(e: unknown): e is PrismaKnownError {
  return e instanceof Error && e.name === 'PrismaClientKnownRequestError';
}

// P2002 meta.target is the constraint name or the list of columns, depending on the index.
const UNIQUE_VIOLATIONS: {
  constraint: string;
  columns: string;
  code: ErrorCode;
  message: string;
}[] = [
  {
    constraint: 'products_sku_key',
    columns: 'sku',
    code: ErrorCode.DUPLICATE_SKU,
    message: 'A product with this SKU already exists.',
  },
  {
    constraint: 'ri_document_product_uq',
    columns: 'receiving_document_id,product_id',
    code: ErrorCode.DUPLICATE_PRODUCT_IN_DOCUMENT,
    message: 'This product is already on the document.',
  },
  {
    constraint: 'receipt_reversals_receipt_id_key',
    columns: 'receipt_id',
    code: ErrorCode.RECEIPT_ALREADY_REVERSED,
    message: 'This receipt has already been reversed.',
  },
];

const HTTP_CODES: Record<number, ErrorCode> = {
  400: ErrorCode.VALIDATION_ERROR,
  401: ErrorCode.UNAUTHENTICATED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
};

interface Mapped {
  status: number;
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const { status, code, message, details } = this.map(exception);
    const error = details ? { code, message, details } : { code, message };
    host.switchToHttp().getResponse<Response>().status(status).json({ error });
  }

  private map(e: unknown): Mapped {
    if (e instanceof AppError) {
      return {
        status: e.httpStatus,
        code: e.code,
        message: e.message,
        details: e.details,
      };
    }
    if (e instanceof HttpException && e.getStatus() < 500) {
      const status = e.getStatus();
      // Other 4xx (e.g. 413) have no dedicated code; the request itself is unacceptable.
      const code = HTTP_CODES[status] ?? ErrorCode.VALIDATION_ERROR;
      return { status, code, message: e.message };
    }
    if (isPrismaKnownError(e)) {
      if (e.code === 'P2025') {
        return {
          status: 404,
          code: ErrorCode.NOT_FOUND,
          message: 'Resource not found.',
        };
      }
      if (e.code === 'P2002') {
        const target = e.meta?.target;
        const key = Array.isArray(target) ? target.join(',') : target;
        const hit = UNIQUE_VIOLATIONS.find(
          (u) => key === u.constraint || key === u.columns,
        );
        if (hit) return { status: 409, code: hit.code, message: hit.message };
      }
    }
    // Anything else, including an unmapped P2002 or a CHECK violation (23514), is a bug.
    const err = e instanceof Error ? e : new Error(String(e));
    this.logger.error(err.message, err.stack);
    return {
      status: 500,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
    };
  }
}
