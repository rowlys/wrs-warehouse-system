import { INestApplication, Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { join } from 'node:path';
import swaggerUi from 'swagger-ui-express';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { createValidationPipe } from './common/errors/validation';

// Repo-root docs/openapi.yaml, from both src/ (dev, tests) and dist/ (build).
const OPENAPI_FILE = join(__dirname, '..', '..', 'docs', 'openapi.yaml');

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
  // Spec §0: the hand-written contract, read-only, public (Express routes skip the Nest guards).
  app.use('/api/docs/openapi.yaml', (_req: Request, res: Response) =>
    res.sendFile(OPENAPI_FILE),
  );
  app.use(
    '/api/docs',
    swaggerUi.serve,
    swaggerUi.setup(undefined, { swaggerUrl: '/api/docs/openapi.yaml' }),
  );
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
}
