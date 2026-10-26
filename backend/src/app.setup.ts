import { INestApplication, Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { createValidationPipe } from './common/errors/validation';

export function configureApp(app: INestApplication): void {
  const logger = new Logger('HTTP');
  // Logs method, path, status and duration only; never bodies or query strings.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      const path = req.originalUrl.split('?')[0];
      logger.log(
        `${req.method} ${path} ${res.statusCode} ${Date.now() - start}ms`,
      );
    });
    next();
  });
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
}
