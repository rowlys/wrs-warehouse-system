import { loadConfig } from './config';

const valid = {
  DATABASE_URL: 'postgresql://wrs:pw@localhost:5432/wrs',
  JWT_SECRET: 'x'.repeat(32),
};

describe('loadConfig', () => {
  it('applies defaults for optional variables', () => {
    expect(loadConfig(valid)).toEqual({
      databaseUrl: valid.DATABASE_URL,
      jwtSecret: valid.JWT_SECRET,
      jwtExpiresIn: '8h',
      port: 3000,
      seedOnStart: false,
    });
  });

  it('fails fast listing every invalid variable', () => {
    expect(() =>
      loadConfig({ JWT_SECRET: 'short', PORT: 'abc', SEED_ON_START: 'yes' }),
    ).toThrow(
      /DATABASE_URL is required[\s\S]*JWT_SECRET must be at least 32 characters[\s\S]*PORT must be[\s\S]*SEED_ON_START must be/,
    );
  });
});
