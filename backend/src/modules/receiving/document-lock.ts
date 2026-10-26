import { Prisma, ReceivingStatus } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-code';

/**
 * Locks the document row (`SELECT … FOR UPDATE`) for the rest of the transaction and
 * returns its status. Always the first lock taken: document → item → balance.
 */
export async function lockDocument(
  tx: Prisma.TransactionClient,
  documentId: string,
): Promise<ReceivingStatus> {
  const rows = await tx.$queryRaw<{ status: ReceivingStatus }[]>`
    SELECT status FROM receiving_documents WHERE id = ${documentId}::uuid FOR UPDATE`;
  if (!rows.length) {
    throw new AppError(
      ErrorCode.NOT_FOUND,
      404,
      'Receiving document not found',
    );
  }
  return rows[0].status;
}
