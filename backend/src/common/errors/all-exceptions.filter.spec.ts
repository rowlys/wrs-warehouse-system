import { ArgumentsHost, Logger, NotFoundException } from '@nestjs/common';
import { IsInt, IsString, Min } from 'class-validator';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { AppError } from './app-error';
import { ErrorCode } from './error-code';
import { createValidationPipe } from './validation';

function run(exception: unknown) {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const host = {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  const [status] = res.status.mock.calls[0] as [number];
  const [body] = res.json.mock.calls[0] as [unknown];
  return { status, body };
}

function prismaError(code: string, meta?: Record<string, unknown>) {
  return Object.assign(new Error('prisma'), {
    name: 'PrismaClientKnownRequestError',
    code,
    meta,
  });
}

class SampleDto {
  @IsString() sku!: string;
  @IsInt() @Min(1) quantity!: number;
}

describe('AllExceptionsFilter', () => {
  let errorLog: jest.SpyInstance;
  beforeEach(() => {
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('AppError → its status, code, message and details', () => {
    const { status, body } = run(
      new AppError(
        ErrorCode.QUANTITY_EXCEEDS_REMAINING,
        422,
        'Cannot receive 61 units; only 60 remaining for FRZ-CHK-001.',
        { remainingQuantity: 60, requestedQuantity: 61 },
      ),
    );
    expect(status).toBe(422);
    expect(body).toEqual({
      error: {
        code: 'QUANTITY_EXCEEDS_REMAINING',
        message: 'Cannot receive 61 units; only 60 remaining for FRZ-CHK-001.',
        details: { remainingQuantity: 60, requestedQuantity: 61 },
      },
    });
  });

  it('validation error → 400 VALIDATION_ERROR with details.fields[]', async () => {
    const pipe = createValidationPipe();
    const error: unknown = await pipe
      .transform(
        { sku: 5, quantity: 0, extra: 'x' },
        { type: 'body', metatype: SampleDto },
      )
      .catch((e: unknown) => e);
    const { status, body } = run(error);
    expect(status).toBe(400);
    expect(body).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: expect.any(String) as string,
        details: {
          fields: expect.arrayContaining([
            { field: 'sku', message: expect.any(String) as string },
            { field: 'quantity', message: expect.any(String) as string },
            { field: 'extra', message: expect.any(String) as string },
          ]) as unknown,
        },
      },
    });
  });

  it('P2002 on products_sku_key → 409 DUPLICATE_SKU', () => {
    const { status, body } = run(
      prismaError('P2002', { target: 'products_sku_key' }),
    );
    expect(status).toBe(409);
    expect(body).toMatchObject({ error: { code: 'DUPLICATE_SKU' } });
  });

  it('P2002 on ri_document_product_uq → 409 DUPLICATE_PRODUCT_IN_DOCUMENT', () => {
    const { status, body } = run(
      prismaError('P2002', { target: 'ri_document_product_uq' }),
    );
    expect(status).toBe(409);
    expect(body).toMatchObject({
      error: { code: 'DUPLICATE_PRODUCT_IN_DOCUMENT' },
    });
  });

  it('P2002 as Prisma 6 reports it (modelName + column list) → 409 DUPLICATE_SKU', () => {
    const { status, body } = run(
      prismaError('P2002', { modelName: 'Product', target: ['sku'] }),
    );
    expect(status).toBe(409);
    expect(body).toMatchObject({ error: { code: 'DUPLICATE_SKU' } });
  });

  it('P2002 on inventory_transactions.receipt_id is a bug → 500, not RECEIPT_ALREADY_REVERSED', () => {
    const { status, body } = run(
      prismaError('P2002', {
        modelName: 'InventoryTransaction',
        target: ['receipt_id'],
      }),
    );
    expect(status).toBe(500);
    expect(body).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
  });

  it('P2025 → 404 NOT_FOUND', () => {
    const { status, body } = run(prismaError('P2025'));
    expect(status).toBe(404);
    expect(body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('HttpException 404 → NOT_FOUND envelope', () => {
    const { status, body } = run(new NotFoundException('Cannot GET /nope'));
    expect(status).toBe(404);
    expect(body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Cannot GET /nope' },
    });
  });

  it('unknown error → 500 INTERNAL_ERROR with generic message, logged with stack', () => {
    const { status, body } = run(new Error('secret db detail'));
    expect(status).toBe(500);
    expect(body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
    expect(errorLog).toHaveBeenCalledWith(
      'secret db detail',
      expect.stringContaining('Error: secret db detail'),
    );
  });

  it('CHECK violation reaching the filter → 500, logged', () => {
    const { status, body } = run(
      prismaError('P2010', { code: '23514', message: 'check violation' }),
    );
    expect(status).toBe(500);
    expect(body).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
    expect(errorLog).toHaveBeenCalled();
  });
});
