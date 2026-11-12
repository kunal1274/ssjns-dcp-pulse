import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export interface Grant {
  id: string;
  roleId: string;
  roleCode: string;
  scopeType: 'TENANT' | 'JURISDICTION' | 'AGENCY' | 'SCHEME';
  scopeId: string;
  includeDescendants: boolean;
  permissions: Set<string>;
}

/** Records a user may act on for one permission. `all` = tenant-wide. */
export interface ScopeFilter {
  all: boolean;
  jurisdictionIds: Set<string>;
  agencyIds: Set<string>;
  schemeIds: Set<string>;
}

export const forbidden = (
  error = 'FORBIDDEN',
  message = 'You do not have permission for this action.',
) => new ForbiddenException({ error, message });
export const notFound = (what = 'Record') =>
  new NotFoundException({ error: 'NOT_FOUND', message: `${what} not found.` });

/**
 * Loads a user's active role scopes and effective permissions on every call
 * (no caching), so revoked assignments take effect on the next request.
 * DENY entries on a role remove that permission from the same role grant.
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
        id: s.id,
        roleId: s.roleId,
        roleCode: s.role.code,
        scopeType: s.scopeType,
        scopeId: s.scopeId,
        includeDescendants: s.includeDescendants,
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
    if (!(await this.permissions(tx, userId)).has(permission)) throw forbidden();
  }

  /** Scope in which the user holds `permission`; null when they do not hold it anywhere. */
  async scopeFor(
    tx: Prisma.TransactionClient,
    userId: string,
    permission: string,
  ): Promise<ScopeFilter | null> {
    const grants = (await this.grants(tx, userId)).filter((g) => g.permissions.has(permission));
    if (grants.length === 0) return null;
    const filter: ScopeFilter = {
      all: grants.some((g) => g.scopeType === 'TENANT'),
      jurisdictionIds: new Set(),
      agencyIds: new Set(),
      schemeIds: new Set(),
    };
    const exact: string[] = [];
    const subtree: string[] = [];
    for (const g of grants) {
      if (g.scopeType === 'JURISDICTION') (g.includeDescendants ? subtree : exact).push(g.scopeId);
      if (g.scopeType === 'AGENCY') filter.agencyIds.add(g.scopeId);
      if (g.scopeType === 'SCHEME') filter.schemeIds.add(g.scopeId);
    }
    exact.forEach((id) => filter.jurisdictionIds.add(id));
    if (subtree.length) {
      const nodes = await tx.jurisdiction.findMany({
        where: { OR: [{ id: { in: subtree } }, { ancestry: { hasSome: subtree } }] },
        select: { id: true },
      });
      nodes.forEach((n) => filter.jurisdictionIds.add(n.id));
    }
    return filter;
  }

  async requireScope(tx: Prisma.TransactionClient, userId: string, permission: string) {
    const filter = await this.scopeFor(tx, userId, permission);
    if (!filter) throw forbidden();
    return filter;
  }

  /** Prisma filter restricting schemes to the scope. */
  schemeWhere(filter: ScopeFilter): Prisma.SchemeWhereInput {
    if (filter.all) return {};
    return {
      OR: [
        { jurisdictionId: { in: [...filter.jurisdictionIds] } },
        { agencyId: { in: [...filter.agencyIds] } },
        { id: { in: [...filter.schemeIds] } },
      ],
    };
  }

  schemeInScope(
    filter: ScopeFilter,
    s: { id: string; jurisdictionId: string; agencyId: string },
  ): boolean {
    return (
      filter.all ||
      filter.jurisdictionIds.has(s.jurisdictionId) ||
      filter.agencyIds.has(s.agencyId) ||
      filter.schemeIds.has(s.id)
    );
  }

  jurisdictionInScope(filter: ScopeFilter, jurisdictionId: string): boolean {
    return filter.all || filter.jurisdictionIds.has(jurisdictionId);
  }
}
