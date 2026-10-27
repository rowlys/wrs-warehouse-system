import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ProductsModule } from './modules/products/products.module';
import { ReceivingModule } from './modules/receiving/receiving.module';
import { PrismaModule } from './prisma/prisma.service';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuthModule,
    HealthModule,
    InventoryModule,
    ProductsModule,
    ReceivingModule,
  ],
})
export class AppModule {}
