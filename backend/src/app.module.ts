import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config';
import { HealthModule } from './modules/health/health.module';
import { PrismaModule } from './prisma/prisma.service';

@Module({
  imports: [ConfigModule, PrismaModule, HealthModule],
})
export class AppModule {}
