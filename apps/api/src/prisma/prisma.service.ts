import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { TENANT_CONTEXT_SETTING } from '@dcp/shared';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  /**
   * Runs `fn` in a transaction whose tenant context is set transaction-locally,
   * so PostgreSQL row-level security restricts every statement to `tenantId`
   * and the setting cannot leak to the next user of the pooled connection.
   */
  async withTenant<T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number },
  ): Promise<T> {
    if (!UUID_RE.test(tenantId)) throw new Error('tenantId must be a UUID');
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config(${TENANT_CONTEXT_SETTING}, ${tenantId}, true)`;
      return fn(tx);
    }, options);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
