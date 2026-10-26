import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
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
  ReceivingItemInput,
  UpdateReceivingItemRequest,
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

  @Roles(UserRole.SUPERVISOR)
  @Post(':documentId/items')
  addItem(
    @Param('documentId', uuidParam('documentId')) documentId: string,
    @Body() body: ReceivingItemInput,
  ): Promise<ReceivingDocumentDetail> {
    return this.documents.addItem(documentId, body);
  }

  @Roles(UserRole.SUPERVISOR)
  @Patch(':documentId/items/:itemId')
  updateItem(
    @Param('documentId', uuidParam('documentId')) documentId: string,
    @Param('itemId', uuidParam('itemId')) itemId: string,
    @Body() body: UpdateReceivingItemRequest,
  ): Promise<ReceivingDocumentDetail> {
    return this.documents.updateItem(documentId, itemId, body);
  }

  @Roles(UserRole.SUPERVISOR)
  @Delete(':documentId/items/:itemId')
  @HttpCode(204)
  removeItem(
    @Param('documentId', uuidParam('documentId')) documentId: string,
    @Param('itemId', uuidParam('itemId')) itemId: string,
  ): Promise<void> {
    return this.documents.removeItem(documentId, itemId);
  }
}
