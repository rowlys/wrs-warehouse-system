import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/auth/auth.decorators';
import { uuidParam } from '../../common/errors/validation';
import { Page } from '../../common/pagination/pagination';
import {
  CreateProductRequest,
  ListProductsQuery,
  Product,
} from './products.dto';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(@Query() query: ListProductsQuery): Promise<Page<Product>> {
    return this.products.list(query);
  }

  @Get(':productId')
  get(
    @Param('productId', uuidParam('productId')) id: string,
  ): Promise<Product> {
    return this.products.get(id);
  }

  @Roles(UserRole.SUPERVISOR)
  @Post()
  create(@Body() body: CreateProductRequest): Promise<Product> {
    return this.products.create(body);
  }
}
