import { Injectable } from '@nestjs/common';
import type { LivenessResponse, ReadinessResponse } from '@dcp/shared';
import { PrismaService } from '../prisma/prisma.service';

export const SERVICE_NAME = 'dcp-pulse-api';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  liveness(): LivenessResponse {
    return { status: 'ok', service: SERVICE_NAME, timestamp: new Date().toISOString() };
  }

  async readiness(): Promise<ReadinessResponse> {
    const checks: ReadinessResponse['checks'] = {
      database: { status: 'down' },
      migrations: { status: 'down' },
    };

    try {
      const [row] = await this.prisma.$queryRaw<
        { version: string }[]
      >`SELECT postgis_lib_version() AS version`;
      checks.database = { status: 'up', postgisVersion: row?.version };
    } catch {
      checks.database = { status: 'down', error: 'database or PostGIS unavailable' };
    }

    if (checks.database.status === 'up') {
      try {
        const [row] = await this.prisma.$queryRaw<{ applied: bigint; pending: bigint }[]>`
          SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS applied,
                 count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS pending
            FROM _prisma_migrations`;
        const applied = Number(row?.applied ?? 0);
        const pending = Number(row?.pending ?? 0);
        checks.migrations = {
          status: applied > 0 && pending === 0 ? 'up' : 'down',
          applied,
          pending,
        };
      } catch {
        checks.migrations = { status: 'down', error: 'migration history unavailable' };
      }
    }

    const ok = checks.database.status === 'up' && checks.migrations.status === 'up';
    return {
      status: ok ? 'ok' : 'error',
      service: SERVICE_NAME,
      timestamp: new Date().toISOString(),
      checks,
    };
  }
}
