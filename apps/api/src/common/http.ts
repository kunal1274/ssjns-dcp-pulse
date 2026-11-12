import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthContext } from '../auth/auth-context';

export const conflict = (error: string, message: string) =>
  new ConflictException({ error, message });
export const badRequest = (error: string, message: string) =>
  new BadRequestException({ error, message });
export const versionConflict = () =>
  conflict('VERSION_CONFLICT', 'The record was changed by someone else. Reload and try again.');

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/** Writes an audit event in the caller's transaction, so it commits or rolls back with the change. */
export function audit(
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  requestId: string | undefined,
  e: AuditInput,
) {
  return tx.auditEvent.create({
    data: {
      tenantId: auth.tenantId,
      actorId: auth.userId,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      requestId: requestId?.slice(0, 100),
      beforeJson: (e.before ?? undefined) as Prisma.InputJsonValue | undefined,
      afterJson: (e.after ?? undefined) as Prisma.InputJsonValue | undefined,
      reason: e.reason ?? null,
    },
  });
}
