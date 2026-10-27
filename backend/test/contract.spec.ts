import { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers';

const OPENAPI_FILE = join(__dirname, '..', '..', 'docs', 'openapi.yaml');
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/**
 * "METHOD /path" for every operation under `paths:`. Reads the two indentation levels the
 * file uses (`  /path:` and `    method:`); no YAML library needed for that.
 */
function documentedOperations(): string[] {
  const lines = readFileSync(OPENAPI_FILE, 'utf8').split(/\r?\n/);
  const ops: string[] = [];
  let inPaths = false;
  let path = '';
  for (const line of lines) {
    if (/^\S/.test(line)) inPaths = line.startsWith('paths:');
    if (!inPaths) continue;
    const pathKey = /^ {2}(\/\S*):\s*$/.exec(line);
    if (pathKey) path = pathKey[1];
    const methodKey = /^ {4}(\w+):/.exec(line);
    if (methodKey && METHODS.includes(methodKey[1])) {
      ops.push(`${methodKey[1].toUpperCase()} ${path}`);
    }
  }
  return ops.sort();
}

/** `/health` has no prefix (spec §4.1); everything else lives under /api/v1. */
const toAppPath = (path: string) =>
  (path === '/health' ? '' : '/api/v1') + path;

// The Express app behind Nest; its router lists every registered route.
interface ExpressLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

describe('OpenAPI contract (NFR-07)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());

  it('openapi.yaml lists the 20 operations of spec §4.1', () => {
    expect(documentedOperations()).toHaveLength(20);
  });

  it('every documented operation is routed and no undocumented route exists', () => {
    const express = app.getHttpAdapter().getInstance() as {
      router: { stack: ExpressLayer[] };
    };
    const routed = express.router.stack
      .flatMap(({ route }) =>
        route
          ? Object.keys(route.methods).map(
              (m) => `${m.toUpperCase()} ${route.path}`,
            )
          : [],
      )
      .sort();
    const documented = documentedOperations().map((op) => {
      const [method, path] = op.split(' ');
      return `${method} ${toAppPath(path).replace(/\{(\w+)\}/g, ':$1')}`;
    });
    expect(routed).toEqual(documented.sort());
  });

  it.each(documentedOperations())(
    '%s answers without 404 (no token, placeholder ids)',
    async (op) => {
      const [method, path] = op.split(' ');
      const url = toAppPath(path).replace(
        /\{\w+\}/g,
        '00000000-0000-4000-8000-000000000000',
      );
      const res = await request(app.getHttpServer())[
        method.toLowerCase() as 'get'
      ](url);
      expect(res.status).not.toBe(404);
    },
  );
});
