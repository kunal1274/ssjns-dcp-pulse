import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

describe('F04 login rate limiting (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.AUTH_RATE_LIMIT_PER_MINUTE = '3';
    const { createApp } = await import('./helpers');
    ({ app } = await createApp());
  });
  afterAll(async () => app.close());

  it('returns 429 after the per-minute limit on /auth/login and /auth/forgot-password', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push(
        (
          await request(app.getHttpServer())
            .post('/api/v1/auth/login')
            .send({ email: 'nobody@example.test', password: 'x' })
        ).status,
      );
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
    const health = await request(app.getHttpServer()).get('/api/v1/health/live');
    expect(health.status).toBe(200);
  });
});
