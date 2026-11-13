import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { APP_ENV, type AppEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthContext } from './auth-context';
import { newToken, safeEqualHex, sha256 } from './tokens';
import type { RequestMeta } from './auth-events';

const TOUCH_INTERVAL_MS = 60_000;

export interface IssuedSession {
  sessionId: string;
  sessionToken: string;
  csrfToken: string;
  absoluteExpiresAt: Date;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async issue(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const sessionToken = newToken();
    const csrfToken = newToken();
    const now = Date.now();
    const absoluteExpiresAt = new Date(now + this.env.auth.sessionAbsoluteHours * 3_600_000);
    const idle = new Date(now + this.env.auth.sessionIdleMinutes * 60_000);
    const session = await tx.userSession.create({
      data: {
        tenantId,
        userId,
        tokenHash: sha256(sessionToken),
        csrfTokenHash: sha256(csrfToken),
        idleExpiresAt: idle < absoluteExpiresAt ? idle : absoluteExpiresAt,
        absoluteExpiresAt,
        ipAddress: meta.ip?.slice(0, 64),
        userAgent: meta.userAgent?.slice(0, 300),
      },
    });
    return { sessionId: session.id, sessionToken, csrfToken, absoluteExpiresAt };
  }

  /**
   * Resolves a session token to an authenticated context. Returns null for
   * unknown, expired or revoked sessions and for users who are not ACTIVE.
   */
  async resolve(
    sessionToken: string,
    csrfToken: string | undefined,
    requireCsrf: boolean,
  ): Promise<{ auth: AuthContext } | { error: 'UNAUTHENTICATED' | 'CSRF' }> {
    const tokenHash = sha256(sessionToken);
    const rows = await this.prisma.$queryRaw<
      { session_id: string; tenant_id: string; user_id: string }[]
    >`SELECT * FROM auth_resolve_session(${tokenHash})`;
    const row = rows[0];
    if (!row) return { error: 'UNAUTHENTICATED' };

    return this.prisma.withTenant(row.tenant_id, async (tx) => {
      const session = await tx.userSession.findUnique({ where: { id: row.session_id } });
      const user = await tx.user.findUnique({ where: { id: row.user_id } });
      const tenant = await tx.tenant.findUnique({ where: { id: row.tenant_id } });
      if (!session || !user || user.status !== 'ACTIVE' || tenant?.status !== 'ACTIVE') {
        return { error: 'UNAUTHENTICATED' as const };
      }
      if (requireCsrf && (!csrfToken || !safeEqualHex(sha256(csrfToken), session.csrfTokenHash))) {
        return { error: 'CSRF' as const };
      }
      const now = Date.now();
      if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
        const idle = new Date(now + this.env.auth.sessionIdleMinutes * 60_000);
        await tx.userSession.update({
          where: { id: session.id },
          data: {
            lastSeenAt: new Date(now),
            idleExpiresAt: idle < session.absoluteExpiresAt ? idle : session.absoluteExpiresAt,
          },
        });
      }
      return {
        auth: {
          tenantId: row.tenant_id,
          userId: user.id,
          sessionId: session.id,
          email: user.email,
          name: user.name,
        },
      };
    });
  }

  revoke(tx: Prisma.TransactionClient, sessionId: string, reason: string) {
    return tx.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  revokeAllForUser(tx: Prisma.TransactionClient, userId: string, reason: string) {
    return tx.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }
}
