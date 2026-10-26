import { loadTestEnv } from './env';

// Runs before each test file, ahead of Prisma loading backend/.env.
loadTestEnv();
