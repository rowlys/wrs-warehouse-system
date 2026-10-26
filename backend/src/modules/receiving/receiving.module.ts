import { Module } from '@nestjs/common';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';
import { ReceivingDocumentsController } from './receiving-documents.controller';
import { ReceivingDocumentsService } from './receiving-documents.service';

@Module({
  controllers: [ReceivingDocumentsController, ReceiptsController],
  providers: [ReceivingDocumentsService, ReceiptsService],
})
export class ReceivingModule {}
