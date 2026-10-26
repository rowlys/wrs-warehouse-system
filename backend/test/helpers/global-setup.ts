import { execSync } from 'node:child_process';
import { loadTestEnv } from './env';

// Applies pending migrations to wrs_test once per run. Non-destructive: each test
// gets a clean state from truncateAll() instead of a reset.
export default function globalSetup(): void {
  loadTestEnv();
  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: process.env });
}
