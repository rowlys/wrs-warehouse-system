import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  type AuthUser,
  CurrentUser,
  Roles,
} from '../../common/auth/auth.decorators';
import { uuidParam } from '../../common/errors/validation';
import { Page } from '../../common/pagination/pagination';
import {
  CreateReceivingDocumentRequest,
  ListReceivingDocumentsQuery,
  ReceivingDocumentDetail,
  ReceivingDocumentSummary,
} from './receiving-documents.dto';
import { ReceivingDocumentsService } from './receiving-documents.service';

@Controller('receiving-documents')
export class ReceivingDocumentsController {
  constructor(private readonly documents: ReceivingDocumentsService) {}

  @Get()
  list(
    @Query() query: ListReceivingDocumentsQuery,
  ): Promise<Page<ReceivingDocumentSummary>> {
    return this.documents.list(query);
  }

  @Get(':documentId')
  get(
    @Param('documentId', uuidParam('documentId')) id: string,
  ): Promise<ReceivingDocumentDetail> {
    return this.documents.getDetail(id);
  }

  @Roles(UserRole.SUPERVISOR)
  @Post()
  create(
    @Body() body: CreateReceivingDocumentRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<ReceivingDocumentDetail> {
    return this.documents.create(body, user.id);
  }
}
