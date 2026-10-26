import { Global, Module } from '@nestjs/common';

export class AppConfig {
  databaseUrl!: string;
  jwtSecret!: string;
  jwtExpiresIn!: string;
  port!: number;
  seedOnStart!: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const problems: string[] = [];
  if (!env.DATABASE_URL) problems.push('DATABASE_URL is required');
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    problems.push('JWT_SECRET must be at least 32 characters');
  }
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push('PORT must be an integer between 1 and 65535');
  }
  const seed = env.SEED_ON_START ?? 'false';
  if (seed !== 'true' && seed !== 'false') {
    problems.push('SEED_ON_START must be "true" or "false"');
  }
  if (problems.length) {
    throw new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`);
  }
  return {
    databaseUrl: env.DATABASE_URL!,
    jwtSecret: env.JWT_SECRET!,
    jwtExpiresIn: env.JWT_EXPIRES_IN || '8h',
    port,
    seedOnStart: seed === 'true',
  };
}

@Global()
@Module({
  providers: [
    { provide: AppConfig, useFactory: () => loadConfig(process.env) },
  ],
  exports: [AppConfig],
})
export class ConfigModule {}
