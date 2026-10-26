import { Controller, INestApplication, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User, UserRole } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { Roles } from '../src/common/auth/auth.decorators';
import {
  createTestApp,
  createUser,
  loginAs,
  TEST_PASSWORD,
  truncateAll,
} from './helpers';

// Mounted only in this test: a route only supervisors may call.
@Controller('test/supervisor-only')
class SupervisorOnlyController {
  @Roles(UserRole.SUPERVISOR)
  @Post()
  run() {
    return { ok: true };
  }
}

describe('auth', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp(undefined, [SupervisorOnlyController]);
  });
  afterAll(() => app.close());
  beforeEach(() => truncateAll());

  describe('POST /api/v1/auth/login', () => {
    let operator: User;
    beforeEach(async () => {
      operator = await createUser(UserRole.OPERATOR);
    });

    it('AC-01.1 issues a token for valid credentials that /auth/me accepts', async () => {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ username: operator.username, password: TEST_PASSWORD });
      expect(res.status).toBe(200);
      const user = {
        id: operator.id,
        username: operator.username,
        fullName: operator.fullName,
        role: 'OPERATOR',
      };
      expect(res.body).toEqual({
        accessToken: expect.any(String) as string,
        expiresIn: 8 * 60 * 60,
        user,
      });

      const me = await http()
        .get('/api/v1/auth/me')
        .set(
          'Authorization',
          `Bearer ${(res.body as { accessToken: string }).accessToken}`,
        );
      expect(me.status).toBe(200);
      expect(me.body).toEqual(user);
    });

    it('AC-01.2 unknown username and wrong password give identical 401 INVALID_CREDENTIALS', async () => {
      const unknown = await http()
        .post('/api/v1/auth/login')
        .send({ username: 'nobody', password: TEST_PASSWORD });
      const wrong = await http()
        .post('/api/v1/auth/login')
        .send({ username: operator.username, password: 'wrong-password' });
      for (const res of [unknown, wrong]) {
        expect(res.status).toBe(401);
        expect(res.body).toEqual({
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid username or password',
          },
        });
        expect(res.body).not.toHaveProperty('accessToken');
      }
    });

    it('rejects a missing password with 400 VALIDATION_ERROR', async () => {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ username: operator.username });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          details: {
            fields: expect.arrayContaining([
              expect.objectContaining({ field: 'password' }),
            ]) as unknown,
          },
        },
      });
    });
  });

  describe('AC-01.3 protected endpoints without a valid token', () => {
    const cases: [string, () => Promise<string | undefined>][] = [
      ['no token', () => Promise.resolve(undefined)],
      ['a malformed token', () => Promise.resolve('not-a-jwt')],
      [
        'an expired token',
        async () => {
          const user = await createUser(UserRole.OPERATOR);
          return new JwtService().sign(
            {
              sub: user.id,
              username: user.username,
              role: user.role,
              exp: Math.floor(Date.now() / 1000) - 60,
            },
            { secret: process.env.JWT_SECRET },
          );
        },
      ],
      [
        'a token signed with another secret',
        async () => {
          const user = await createUser(UserRole.OPERATOR);
          return new JwtService().sign(
            { sub: user.id, username: user.username, role: user.role },
            { secret: 'x'.repeat(40) },
          );
        },
      ],
    ];

    it.each(cases)('AC-01.3 %s → 401 UNAUTHENTICATED', async (_, makeToken) => {
      const token = await makeToken();
      const req = http().get('/api/v1/auth/me');
      if (token) req.set('Authorization', `Bearer ${token}`);
      const res = await req;
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    });
  });

  describe('AC-01.4 role enforcement', () => {
    it('AC-01.4 operator on a supervisor-only route → 403 FORBIDDEN', async () => {
      const res = await http()
        .post('/api/v1/test/supervisor-only')
        .set('Authorization', `Bearer ${await loginAs(UserRole.OPERATOR)}`);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
    });

    it('AC-01.4 supervisor on the same route is allowed', async () => {
      const res = await http()
        .post('/api/v1/test/supervisor-only')
        .set('Authorization', `Bearer ${await loginAs(UserRole.SUPERVISOR)}`);
      expect(res.status).toBe(201);
    });
  });

  it('FR-02 health and login need no token', async () => {
    expect((await http().get('/health')).status).toBe(200);
    expect(
      (
        await http()
          .post('/api/v1/auth/login')
          .send({ username: 'a', password: 'b' })
      ).status,
    ).toBe(401);
  });
});
