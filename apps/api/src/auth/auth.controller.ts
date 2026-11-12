import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { CookieOptions, Response } from 'express';
import { APP_ENV, type AppEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationService } from '../authz/authorization.service';
import {
  CSRF_COOKIE,
  CurrentAuth,
  Public,
  SESSION_COOKIE,
  type AuthContext,
  type AuthedRequest,
} from './auth-context';
import type { RequestMeta } from './auth-events';
import { AuthService } from './auth.service';
import { ForgotPasswordDto, InviteUserDto, LoginDto, ResetPasswordDto } from './dto';

export const requestMeta = (req: AuthedRequest): RequestMeta => ({
  ip: req.ip,
  userAgent: req.headers['user-agent'],
  requestId: typeof req.id === 'string' ? req.id : undefined,
});

@ApiTags('auth')
@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  private cookieOptions(httpOnly: boolean, expires?: Date): CookieOptions {
    return { httpOnly, secure: this.env.auth.cookieSecure, sameSite: 'lax', path: '/', expires };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: {} })
  @Post('auth/login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(dto.tenantCode, dto.email, dto.password, requestMeta(req));
    res.cookie(
      SESSION_COOKIE,
      result.sessionToken,
      this.cookieOptions(true, result.absoluteExpiresAt),
    );
    res.cookie(CSRF_COOKIE, result.csrfToken, this.cookieOptions(false, result.absoluteExpiresAt));
    return { user: result.user, csrfToken: result.csrfToken, expiresAt: result.absoluteExpiresAt };
  }

  @Post('auth/logout')
  @HttpCode(204)
  async logout(
    @CurrentAuth() a: AuthContext,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(a, requestMeta(req));
    res.clearCookie(SESSION_COOKIE, this.cookieOptions(true));
    res.clearCookie(CSRF_COOKIE, this.cookieOptions(false));
  }

  @Post('auth/logout-all')
  @HttpCode(200)
  async logoutAll(
    @CurrentAuth() a: AuthContext,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const revoked = await this.auth.logoutAll(a, requestMeta(req));
    res.clearCookie(SESSION_COOKIE, this.cookieOptions(true));
    res.clearCookie(CSRF_COOKIE, this.cookieOptions(false));
    return { revoked };
  }

  @Get(['auth/me', 'me'])
  me(@CurrentAuth() a: AuthContext) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const [tenant, grants] = await Promise.all([
        tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId } }),
        this.authz.grants(tx, a.userId),
      ]);
      const permissions = new Set<string>();
      grants.forEach((g) => g.permissions.forEach((p) => permissions.add(p)));
      return {
        user: { id: a.userId, email: a.email, name: a.name },
        tenant: { id: tenant.id, code: tenant.code, name: tenant.name },
        roles: grants.map((g) => ({
          roleCode: g.roleCode,
          scopeType: g.scopeType,
          scopeId: g.scopeId,
        })),
        permissions: [...permissions].sort(),
      };
    });
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: {} })
  @Post('auth/forgot-password')
  @HttpCode(202)
  async forgot(@Body() dto: ForgotPasswordDto, @Req() req: AuthedRequest) {
    await this.auth.forgotPassword(dto.tenantCode, dto.email, requestMeta(req));
    return { message: 'If the account exists, a reset link has been sent.' };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: {} })
  @Post(['auth/reset-password', 'auth/accept-invite'])
  @HttpCode(204)
  async reset(@Body() dto: ResetPasswordDto, @Req() req: AuthedRequest) {
    await this.auth.resetPassword(dto.token, dto.newPassword, requestMeta(req));
  }

  @Post('users/invite')
  @HttpCode(201)
  async invite(
    @CurrentAuth() a: AuthContext,
    @Body() dto: InviteUserDto,
    @Req() req: AuthedRequest,
  ) {
    await this.prisma.withTenant(a.tenantId, (tx) =>
      this.authz.require(tx, a.userId, 'user.manage'),
    );
    return this.auth.invite(a, dto.email, dto.name, requestMeta(req));
  }
}
