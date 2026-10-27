import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import {
  type AuthUser,
  CurrentUser,
  Roles,
} from '../../common/auth/auth.decorators';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-code';
import { uuidParam } from '../../common/errors/validation';
import { ReceiptsService } from './receipts.service';
import {
  ReasonRequest,
  ReceiptResult,
  ReceivingDocumentDetail,
  RecordReceiptRequest,
} from './receiving-documents.dto';

/** BR-09: Idempotency-Key header present, 8–100 characters of [A-Za-z0-9_-]. */
function parseIdempotencyKey(value: string | undefined): string {
  if (value !== undefined && /^[A-Za-z0-9_-]{8,100}$/.test(value)) {
    return value;
  }
  throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Validation failed', {
    fields: [
      {
        field: 'Idempotency-Key',
        message:
          'Idempotency-Key header is required: 8–100 letters, digits, "-" or "_"',
      },
    ],
  });
}

@Controller('receiving-documents')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Roles(UserRole.OPERATOR, UserRole.SUPERVISOR)
  @Post(':documentId/items/:itemId/receipts')
  async record(
    @Param('documentId', uuidParam('documentId')) documentId: string,
    @Param('itemId', uuidParam('itemId')) itemId: string,
    @Headers('idempotency-key') rawKey: string | undefined,
    @Body() body: RecordReceiptRequest,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReceiptResult> {
    const { result, replayed } = await this.receipts.recordReceipt(
      documentId,
      itemId,
      body.quantity,
      parseIdempotencyKey(rawKey),
      user.id,
    );
    if (replayed) res.status(200).setHeader('Idempotent-Replayed', 'true');
    return result;
  }

  @Roles(UserRole.SUPERVISOR)
  @Post(':documentId/receipts/:receiptId/reverse')
  @HttpCode(200)
  reverse(
    @Param('documentId', uuidParam('documentId')) documentId: string,
    @Param('receiptId', uuidParam('receiptId')) receiptId: string,
    @Body() body: ReasonRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<ReceivingDocumentDetail> {
    return this.receipts.reverseReceipt(
      documentId,
      receiptId,
      body.reason,
      user.id,
    );
  }
}
