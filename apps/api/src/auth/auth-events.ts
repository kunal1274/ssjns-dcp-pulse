import type { Prisma } from '@prisma/client';

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

export function authEvent(
  tx: Prisma.TransactionClient,
  tenantId: string,
  userId: string | null,
  eventType: string,
  outcome: 'SUCCESS' | 'FAILURE' | 'DENIED',
  meta: RequestMeta,
  details?: Record<string, unknown>,
) {
  return tx.authenticationEvent.create({
    data: {
      tenantId,
      userId,
      eventType,
      outcome,
      ipAddress: meta.ip?.slice(0, 64),
      userAgent: meta.userAgent?.slice(0, 300),
      requestId: meta.requestId?.slice(0, 100),
      detailsJson: (details ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
