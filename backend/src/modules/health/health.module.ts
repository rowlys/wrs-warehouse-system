import {
  Controller,
  Get,
  Injectable,
  Logger,
  Module,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/auth/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';

export interface HealthResponse {
  status: 'ok' | 'error';
  database: 'up' | 'down';
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up' };
    } catch (e) {
      this.logger.warn(`Database check failed: ${(e as Error).message}`);
      return { status: 'error', database: 'down' };
    }
  }
}

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  // 503 is set directly: a thrown 5xx would become the 500 INTERNAL_ERROR envelope.
  @Public()
  @Get()
  async get(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthResponse> {
    const result = await this.health.check();
    res.status(result.status === 'ok' ? 200 : 503);
    return result;
  }
}

@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
