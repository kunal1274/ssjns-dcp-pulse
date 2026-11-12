import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { loadEnv } from '../../src/config/env';
import { configureApp } from '../../src/configure-app';

describe('health endpoints (e2e, real database)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, loadEnv());
    await app.init();
  });
  afterAll(async () => app.close());

  it('GET /api/v1/health/live returns ok and a correlation id', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('x-request-id', 'e2e-live-1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'dcp-pulse-api' });
    expect(res.headers['x-request-id']).toBe('e2e-live-1');
  });

  it('GET /api/v1/health/ready reports database, PostGIS and migrations', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.database).toMatchObject({ status: 'up' });
    expect(res.body.checks.database.postgisVersion).toMatch(/^3\./);
    expect(res.body.checks.migrations).toMatchObject({ status: 'up', pending: 0 });
    expect(res.body.checks.migrations.applied).toBeGreaterThanOrEqual(2);
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ statusCode: 404 });
  });
});
