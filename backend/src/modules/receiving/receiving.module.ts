import { Module } from '@nestjs/common';
import { ReceivingDocumentsController } from './receiving-documents.controller';
import { ReceivingDocumentsService } from './receiving-documents.service';

@Module({
  controllers: [ReceivingDocumentsController],
  providers: [ReceivingDocumentsService],
})
export class ReceivingModule {}
