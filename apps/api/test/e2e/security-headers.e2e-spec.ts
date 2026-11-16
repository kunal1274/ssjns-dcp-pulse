import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { loadEnv } from '../../src/config/env';
import { configureApp } from '../../src/configure-app';

async function start(extra: NodeJS.ProcessEnv): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, loadEnv({ ...process.env, ...extra }));
  await app.init();
  return app;
}

describe('security headers and API docs exposure (e2e)', () => {
  let prod: INestApplication;
  let dev: INestApplication;

  beforeAll(async () => {
    prod = await start({ NODE_ENV: 'production', API_DOCS_ENABLED: undefined });
    dev = await start({ NODE_ENV: 'development', API_DOCS_ENABLED: undefined });
  });
  afterAll(async () => {
    await prod.close();
    await dev.close();
  });

  it('sends hardening headers and does not disclose the framework', async () => {
    const res = await request(prod.getHttpServer()).get('/api/v1/health/live');
    expect(res.status).toBe(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['strict-transport-security']).toContain('max-age=');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('does not serve Swagger UI in production unless explicitly enabled', async () => {
    expect((await request(prod.getHttpServer()).get('/api/docs')).status).toBe(404);
    expect((await request(prod.getHttpServer()).get('/api/docs-json')).status).toBe(404);
    expect((await request(dev.getHttpServer()).get('/api/docs')).status).toBe(200);
  });
});
