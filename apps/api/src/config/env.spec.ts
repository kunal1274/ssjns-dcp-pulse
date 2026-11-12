import { loadEnv } from './env';

describe('loadEnv', () => {
  const valid = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

  it('applies defaults', () => {
    expect(loadEnv(valid)).toMatchObject({ port: 3000, logLevel: 'info', corsOrigins: [] });
  });

  it('parses CORS origins', () => {
    expect(loadEnv({ ...valid, CORS_ORIGINS: 'http://a.test, http://b.test' }).corsOrigins).toEqual(
      ['http://a.test', 'http://b.test'],
    );
  });

  it('rejects a missing database URL and invalid values without echoing secrets', () => {
    expect(() => loadEnv({ API_PORT: 'abc', LOG_LEVEL: 'loud' })).toThrow(
      /DATABASE_URL.*API_PORT.*LOG_LEVEL/,
    );
  });
});
