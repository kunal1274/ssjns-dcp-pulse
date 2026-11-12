import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthedRequest } from '../auth/auth-context';
import { AuthorizationService, forbidden } from './authorization.service';

const PERMS = 'dcp:permissions';
/** Route requires at least one of these permissions (in any scope). Services enforce the scope. */
export const RequirePermissions = (...codes: string[]) => SetMetadata(PERMS, codes);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const codes = this.reflector.getAllAndOverride<string[] | undefined>(PERMS, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!codes?.length) return true;
    const auth = context.switchToHttp().getRequest<AuthedRequest>().auth;
    if (!auth) throw forbidden();
    const held = await this.prisma.withTenant(auth.tenantId, (tx) =>
      this.authz.permissions(tx, auth.userId),
    );
    if (!codes.some((c) => held.has(c))) throw forbidden();
    return true;
  }
}
