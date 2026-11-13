import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { APP_ENV, type AppEnv } from '../config/env';
import { MailSender } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthContext } from './auth-context';
import { authEvent, type RequestMeta } from './auth-events';
import { PasswordService } from './password.service';
import { SessionService, type IssuedSession } from './session.service';
import { newToken, sha256 } from './tokens';

const INVALID_CREDENTIALS = { error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' };
const INVALID_TOKEN = { error: 'INVALID_TOKEN', message: 'This link is invalid or has expired.' };

export interface LoginResult extends IssuedSession {
  user: { id: string; email: string; name: string; tenantId: string };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly mail: MailSender,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  private async resolveTenant(code: string | undefined): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ tenant_id: string; tenant_status: string }[]>`
      SELECT * FROM auth_resolve_tenant(${code ?? this.env.auth.defaultTenantCode})`;
    return rows[0]?.tenant_status === 'ACTIVE' ? rows[0].tenant_id : null;
  }

  async login(
    tenantCode: string | undefined,
    emailInput: string,
    password: string,
    meta: RequestMeta,
  ): Promise<LoginResult> {
    const email = emailInput.trim().toLowerCase();
    const tenantId = await this.resolveTenant(tenantCode);
    if (!tenantId) {
      await this.passwords.dummyVerify(password);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    // Failure events must persist, so the transaction returns an outcome instead of throwing.
    const outcome = await this.prisma.withTenant(tenantId, async (tx) => {
      const user = await tx.user.findUnique({
        where: { tenantId_email: { tenantId, email } },
        include: { credential: true },
      });
      const cred = user?.credential;
      if (!user || !cred) {
        await this.passwords.dummyVerify(password);
        await authEvent(tx, tenantId, null, 'LOGIN', 'FAILURE', meta, { reason: 'UNKNOWN_USER' });
        return null;
      }
      if (cred.lockedUntil && cred.lockedUntil > new Date()) {
        await authEvent(tx, tenantId, user.id, 'LOGIN', 'DENIED', meta, { reason: 'LOCKED' });
        return null;
      }
      const { ok, needsRehash } = await this.passwords.verify(cred.passwordHash, password);
      if (!ok) {
        const attempts = cred.failedAttempts + 1;
        const lock = attempts >= this.env.auth.maxFailedLogins;
        await tx.userCredential.update({
          where: { id: cred.id },
          data: {
            failedAttempts: lock ? 0 : attempts,
            lockedUntil: lock
              ? new Date(Date.now() + this.env.auth.lockoutMinutes * 60_000)
              : undefined,
          },
        });
        await authEvent(tx, tenantId, user.id, 'LOGIN', 'FAILURE', meta, {
          reason: 'BAD_PASSWORD',
          lockedOut: lock,
        });
        return null;
      }
      if (user.status !== 'ACTIVE') {
        await authEvent(tx, tenantId, user.id, 'LOGIN', 'DENIED', meta, {
          reason: `STATUS_${user.status}`,
        });
        return null;
      }
      await tx.userCredential.update({
        where: { id: cred.id },
        data: {
          failedAttempts: 0,
          lockedUntil: null,
          ...(needsRehash
            ? { passwordHash: await this.passwords.hash(password), algorithm: 'argon2id' }
            : {}),
        },
      });
      const session = await this.sessions.issue(tx, tenantId, user.id, meta);
      await authEvent(tx, tenantId, user.id, 'LOGIN', 'SUCCESS', meta, {
        sessionId: session.sessionId,
      });
      return { ...session, user: { id: user.id, email: user.email, name: user.name, tenantId } };
    });
    if (!outcome) throw new UnauthorizedException(INVALID_CREDENTIALS);
    return outcome;
  }

  logout(auth: AuthContext, meta: RequestMeta) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      await this.sessions.revoke(tx, auth.sessionId, 'LOGOUT');
      await authEvent(tx, auth.tenantId, auth.userId, 'LOGOUT', 'SUCCESS', meta);
    });
  }

  logoutAll(auth: AuthContext, meta: RequestMeta) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const { count } = await this.sessions.revokeAllForUser(tx, auth.userId, 'LOGOUT_ALL');
      await authEvent(tx, auth.tenantId, auth.userId, 'LOGOUT_ALL', 'SUCCESS', meta, {
        revoked: count,
      });
      return count;
    });
  }

  /** Always resolves without revealing whether the account exists. */
  async forgotPassword(tenantCode: string | undefined, emailInput: string, meta: RequestMeta) {
    const email = emailInput.trim().toLowerCase();
    const tenantId = await this.resolveTenant(tenantCode);
    if (!tenantId) return;
    const mail = await this.prisma.withTenant(tenantId, async (tx) => {
      const user = await tx.user.findUnique({ where: { tenantId_email: { tenantId, email } } });
      if (!user || user.status !== 'ACTIVE') {
        await authEvent(tx, tenantId, null, 'PASSWORD_RESET_REQUEST', 'DENIED', meta);
        return null;
      }
      const token = await this.createToken(tx, tenantId, user.id, 'PASSWORD_RESET', null);
      await authEvent(tx, tenantId, user.id, 'PASSWORD_RESET_REQUEST', 'SUCCESS', meta);
      return {
        to: user.email,
        subject: 'DCP Pulse (synthetic demo) — password reset',
        body: `Use this single-use link within ${this.env.auth.resetTokenMinutes} minutes:\n${this.env.auth.appBaseUrl}/reset-password?token=${token}`,
      };
    });
    if (mail) await this.mail.send(mail);
  }

  async resetPassword(token: string, newPassword: string, meta: RequestMeta) {
    const weakness = this.passwords.validateStrength(newPassword);
    if (weakness) throw new BadRequestException({ error: 'WEAK_PASSWORD', message: weakness });
    const rows = await this.prisma.$queryRaw<
      {
        token_id: string;
        tenant_id: string;
        user_id: string;
        purpose: 'PASSWORD_RESET' | 'INVITE';
      }[]
    >`SELECT * FROM auth_resolve_reset_token(${sha256(token)})`;
    const row = rows[0];
    if (!row) throw new BadRequestException(INVALID_TOKEN);
    const hash = await this.passwords.hash(newPassword);
    const ok = await this.prisma.withTenant(row.tenant_id, async (tx) => {
      // Single use: only the first concurrent redemption flips used_at.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: row.token_id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) return false;
      const user = await tx.user.findUnique({ where: { id: row.user_id } });
      if (!user) return false;
      if (row.purpose === 'INVITE' && user.status !== 'INVITED') return false;
      if (row.purpose === 'PASSWORD_RESET' && user.status !== 'ACTIVE') return false;
      await tx.userCredential.upsert({
        where: { userId: user.id },
        create: {
          tenantId: row.tenant_id,
          userId: user.id,
          passwordHash: hash,
          passwordChangedAt: new Date(),
        },
        update: {
          passwordHash: hash,
          algorithm: 'argon2id',
          failedAttempts: 0,
          lockedUntil: null,
          passwordChangedAt: new Date(),
        },
      });
      if (row.purpose === 'INVITE') {
        await tx.user.update({
          where: { id: user.id },
          data: { status: 'ACTIVE', version: { increment: 1 } },
        });
      }
      await this.sessions.revokeAllForUser(tx, user.id, 'PASSWORD_CHANGED');
      await authEvent(
        tx,
        row.tenant_id,
        user.id,
        row.purpose === 'INVITE' ? 'INVITE_ACCEPTED' : 'PASSWORD_RESET',
        'SUCCESS',
        meta,
      );
      return true;
    });
    if (!ok) throw new BadRequestException(INVALID_TOKEN);
  }

  async invite(auth: AuthContext, emailInput: string, name: string, meta: RequestMeta) {
    const email = emailInput.trim().toLowerCase();
    const result = await this.prisma.withTenant(auth.tenantId, async (tx) => {
      const existing = await tx.user.findUnique({
        where: { tenantId_email: { tenantId: auth.tenantId, email } },
      });
      if (existing) return null;
      const user = await tx.user.create({
        data: { tenantId: auth.tenantId, email, name, status: 'INVITED', createdBy: auth.userId },
      });
      const token = await this.createToken(tx, auth.tenantId, user.id, 'INVITE', auth.userId);
      await tx.auditEvent.create({
        data: {
          tenantId: auth.tenantId,
          actorId: auth.userId,
          action: 'USER_INVITED',
          entityType: 'user',
          entityId: user.id,
          requestId: meta.requestId,
          afterJson: { email, name, status: 'INVITED' },
        },
      });
      return { user, token };
    });
    if (!result)
      throw new ConflictException({
        error: 'USER_EXISTS',
        message: 'A user with this email already exists.',
      });
    await this.mail.send({
      to: email,
      subject: 'DCP Pulse (synthetic demo) — invitation',
      body: `You have been invited. Set your password within ${this.env.auth.inviteTokenHours} hours:\n${this.env.auth.appBaseUrl}/accept-invite?token=${result.token}`,
    });
    return { id: result.user.id, email, name, status: result.user.status };
  }

  private async createToken(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    purpose: 'PASSWORD_RESET' | 'INVITE',
    createdBy: string | null,
  ): Promise<string> {
    await tx.passwordResetToken.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: new Date() },
    });
    const token = newToken();
    const ttl =
      purpose === 'INVITE'
        ? this.env.auth.inviteTokenHours * 3_600_000
        : this.env.auth.resetTokenMinutes * 60_000;
    await tx.passwordResetToken.create({
      data: {
        tenantId,
        userId,
        tokenHash: sha256(token),
        purpose,
        expiresAt: new Date(Date.now() + ttl),
        createdBy,
      },
    });
    return token;
  }
}
