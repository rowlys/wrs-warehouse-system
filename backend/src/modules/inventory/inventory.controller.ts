import { Controller, Get, Query } from '@nestjs/common';
import { Page } from '../../common/pagination/pagination';
import {
  InventoryBalance,
  InventoryTransaction,
  ListInventoryQuery,
  ListInventoryTransactionsQuery,
} from './inventory.dto';
import { InventoryService } from './inventory.service';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  list(@Query() query: ListInventoryQuery): Promise<Page<InventoryBalance>> {
    return this.inventory.listBalances(query);
  }

  @Get('transactions')
  transactions(
    @Query() query: ListInventoryTransactionsQuery,
  ): Promise<Page<InventoryTransaction>> {
    return this.inventory.listTransactions(query);
  }
}
