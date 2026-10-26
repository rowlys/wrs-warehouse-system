import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers';

describe('GET /health', () => {
  let app: INestApplication<App>;
  afterEach(() => app.close());

  it('AC-07.1 returns 200 ok/up when the database is reachable, without a token', async () => {
    app = await createTestApp();
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('AC-07.2 returns 503 error/down when the database query fails', async () => {
    app = await createTestApp((builder) =>
      builder.overrideProvider(PrismaService).useValue({
        $queryRaw: () => Promise.reject(new Error('connection refused')),
      }),
    );
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', database: 'down' });
  });
});
