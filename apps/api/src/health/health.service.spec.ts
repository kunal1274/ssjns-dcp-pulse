import { HealthService } from './health.service';
import type { PrismaService } from '../prisma/prisma.service';

const prismaWith = (impl: jest.Mock): PrismaService =>
  ({ $queryRaw: impl }) as unknown as PrismaService;

describe('HealthService', () => {
  it('reports liveness without touching the database', () => {
    const query = jest.fn();
    const result = new HealthService(prismaWith(query)).liveness();
    expect(result.status).toBe('ok');
    expect(query).not.toHaveBeenCalled();
  });

  it('is ready when PostGIS responds and no migrations are pending', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ version: '3.4.2' }])
      .mockResolvedValueOnce([{ applied: 2n, pending: 0n }]);
    const result = await new HealthService(prismaWith(query)).readiness();
    expect(result.status).toBe('ok');
    expect(result.checks.database).toEqual({ status: 'up', postgisVersion: '3.4.2' });
    expect(result.checks.migrations).toEqual({ status: 'up', applied: 2, pending: 0 });
  });

  it('is not ready when migrations are pending', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ version: '3.4.2' }])
      .mockResolvedValueOnce([{ applied: 1n, pending: 1n }]);
    const result = await new HealthService(prismaWith(query)).readiness();
    expect(result.status).toBe('error');
    expect(result.checks.migrations.status).toBe('down');
  });

  it('does not expose raw database errors', async () => {
    const query = jest
      .fn()
      .mockRejectedValue(new Error('password authentication failed for user x'));
    const result = await new HealthService(prismaWith(query)).readiness();
    expect(result.status).toBe('error');
    expect(JSON.stringify(result)).not.toContain('password');
  });
});
