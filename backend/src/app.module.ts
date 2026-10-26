import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config';
import { PrismaModule } from './prisma/prisma.service';

@Module({
  imports: [ConfigModule, PrismaModule],
})
export class AppModule {}
