import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

// Loads backend/.env.test over process.env. Refuses any database other than wrs_test,
// because the harness truncates every table.
export function loadTestEnv(): void {
  const file = join(__dirname, '..', '..', '.env.test');
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    throw new Error(
      `Missing ${file}. Copy .env.test.example to .env.test before running tests.`,
    );
  }
  Object.assign(process.env, parseEnv(content));
  const db = new URL(process.env.DATABASE_URL ?? '').pathname.slice(1);
  if (db !== 'wrs_test') {
    throw new Error(`Tests must use the wrs_test database, not "${db}"`);
  }
}
