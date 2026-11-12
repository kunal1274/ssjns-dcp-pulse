import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export interface Grant {
  roleId: string;
  roleCode: string;
  scopeType: 'TENANT' | 'JURISDICTION' | 'AGENCY' | 'SCHEME';
  scopeId: string;
  permissions: Set<string>;
}

/**
 * Loads a user's active role scopes and effective permissions on every call
 * (no caching), so revoked assignments take effect on the next request.
 */
@Injectable()
export class AuthorizationService {
  async grants(tx: Prisma.TransactionClient, userId: string): Promise<Grant[]> {
    const now = new Date();
    const scopes = await tx.userRoleScope.findMany({
      where: {
        userId,
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gt: now } }],
        role: { status: 'ACTIVE' },
      },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    return scopes.map((s) => {
      const allow = new Set<string>();
      const deny = new Set<string>();
      for (const rp of s.role.permissions)
        (rp.effect === 'DENY' ? deny : allow).add(rp.permission.code);
      for (const d of deny) allow.delete(d);
      return {
        roleId: s.roleId,
        roleCode: s.role.code,
        scopeType: s.scopeType,
        scopeId: s.scopeId,
        permissions: allow,
      };
    });
  }

  async permissions(tx: Prisma.TransactionClient, userId: string): Promise<Set<string>> {
    const all = new Set<string>();
    for (const g of await this.grants(tx, userId)) for (const p of g.permissions) all.add(p);
    return all;
  }

  async require(tx: Prisma.TransactionClient, userId: string, permission: string): Promise<void> {
    if (!(await this.permissions(tx, userId)).has(permission)) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'You do not have permission for this action.',
      });
    }
  }
}
