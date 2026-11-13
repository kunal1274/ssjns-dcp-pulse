import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthContext } from '../auth/auth-context';
import { SessionService } from '../auth/session.service';
import { AuthorizationService, forbidden, notFound } from '../authz/authorization.service';
import { audit, badRequest, conflict, versionConflict } from '../common/http';
import { PrismaService } from '../prisma/prisma.service';
import type { AssignRoleScopeDto, CreateRoleDto, UpdateRoleDto, UserStatusDto } from './dto';

/** Permissions that only holders of the same permission may hand out. */
const SELF_GATED = ['role.manage', 'user.manage'];

const roleView = (r: {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystemTemplate: boolean;
  status: string;
  version: number;
  permissions: { effect: string; permission: { code: string } }[];
  _count?: { userScopes: number };
}) => ({
  id: r.id,
  code: r.code,
  name: r.name,
  description: r.description,
  isSystemTemplate: r.isSystemTemplate,
  status: r.status,
  version: r.version,
  permissions: r.permissions
    .filter((p) => p.effect === 'ALLOW')
    .map((p) => p.permission.code)
    .sort(),
  assignmentCount: r._count?.userScopes,
});

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly sessions: SessionService,
  ) {}

  permissionCatalogue() {
    return this.prisma.permission.findMany({
      orderBy: { code: 'asc' },
      select: { id: true, code: true, resource: true, action: true, description: true },
    });
  }

  listRoles(auth: AuthContext) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const roles = await tx.role.findMany({
        orderBy: { code: 'asc' },
        include: {
          permissions: { include: { permission: true } },
          _count: {
            select: {
              userScopes: { where: { OR: [{ validTo: null }, { validTo: { gt: new Date() } }] } },
            },
          },
        },
      });
      return roles.map(roleView);
    });
  }

  /** Role editing is reserved to tenant-wide role.manage holders. */
  private async requireTenantRoleManager(tx: Prisma.TransactionClient, auth: AuthContext) {
    const f = await this.authz.requireScope(tx, auth.userId, 'role.manage');
    if (!f.all)
      throw forbidden(
        'ROLE_MANAGE_REQUIRES_TENANT_SCOPE',
        'Role management requires tenant-wide scope.',
      );
  }

  private async resolvePermissions(tx: Prisma.TransactionClient, codes: string[]) {
    const unique = [...new Set(codes)];
    const perms = await tx.permission.findMany({ where: { code: { in: unique } } });
    if (perms.length !== unique.length) {
      const known = new Set(perms.map((p) => p.code));
      throw badRequest(
        'UNKNOWN_PERMISSION',
        `Unknown permission(s): ${unique.filter((c) => !known.has(c)).join(', ')}`,
      );
    }
    return perms;
  }

  private async assertCanGrantPermissions(
    tx: Prisma.TransactionClient,
    auth: AuthContext,
    codes: string[],
  ) {
    const held = await this.authz.permissions(tx, auth.userId);
    const blocked = codes.filter((c) => SELF_GATED.includes(c) && !held.has(c));
    if (blocked.length)
      throw forbidden('DELEGATION_EXCEEDS_AUTHORITY', `You cannot grant: ${blocked.join(', ')}`);
  }

  createRole(auth: AuthContext, dto: CreateRoleDto, requestId?: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      await this.requireTenantRoleManager(tx, auth);
      if (
        await tx.role.findUnique({
          where: { tenantId_code: { tenantId: auth.tenantId, code: dto.code } },
        })
      )
        throw conflict('ROLE_CODE_EXISTS', 'A role with this code already exists.');
      const perms = await this.resolvePermissions(tx, dto.permissions);
      await this.assertCanGrantPermissions(
        tx,
        auth,
        perms.map((p) => p.code),
      );
      const role = await tx.role.create({
        data: {
          tenantId: auth.tenantId,
          code: dto.code,
          name: dto.name,
          description: dto.description,
          createdBy: auth.userId,
        },
      });
      await tx.rolePermission.createMany({
        data: perms.map((p) => ({
          tenantId: auth.tenantId,
          roleId: role.id,
          permissionId: p.id,
          createdBy: auth.userId,
        })),
      });
      const view = roleView(
        await tx.role.findUniqueOrThrow({
          where: { id: role.id },
          include: { permissions: { include: { permission: true } } },
        }),
      );
      await audit(tx, auth, requestId, {
        action: 'ROLE_CREATED',
        entityType: 'role',
        entityId: role.id,
        after: view,
      });
      return view;
    });
  }

  updateRole(auth: AuthContext, roleId: string, dto: UpdateRoleDto, requestId?: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      await this.requireTenantRoleManager(tx, auth);
      const role = await tx.role.findUnique({
        where: { id: roleId },
        include: { permissions: { include: { permission: true } } },
      });
      if (!role) throw notFound('Role');
      if (role.isSystemTemplate && (dto.permissions || dto.status))
        throw forbidden(
          'TEMPLATE_READ_ONLY',
          'System template roles cannot change permissions or status; create a custom role instead.',
        );
      const held = await this.authz.grants(tx, auth.userId);
      if (held.some((g) => g.roleId === roleId))
        throw forbidden('ROLE_SELF_MODIFICATION_FORBIDDEN', 'You cannot modify a role you hold.');
      const before = roleView(role);
      const claimed = await tx.role.updateMany({
        where: { id: roleId, version: dto.version },
        data: {
          name: dto.name,
          description: dto.description,
          status: dto.status,
          version: { increment: 1 },
        },
      });
      if (claimed.count !== 1) throw versionConflict();
      if (dto.permissions) {
        const perms = await this.resolvePermissions(tx, dto.permissions);
        const added = perms.map((p) => p.code).filter((c) => !before.permissions.includes(c));
        await this.assertCanGrantPermissions(tx, auth, added);
        await tx.rolePermission.deleteMany({ where: { roleId } });
        await tx.rolePermission.createMany({
          data: perms.map((p) => ({
            tenantId: auth.tenantId,
            roleId,
            permissionId: p.id,
            createdBy: auth.userId,
          })),
        });
      }
      const after = roleView(
        await tx.role.findUniqueOrThrow({
          where: { id: roleId },
          include: { permissions: { include: { permission: true } } },
        }),
      );
      await audit(tx, auth, requestId, {
        action: 'ROLE_UPDATED',
        entityType: 'role',
        entityId: roleId,
        before,
        after,
      });
      return after;
    });
  }

  listUsers(auth: AuthContext) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const f = await this.authz.requireScope(tx, auth.userId, 'user.manage');
      const now = new Date();
      const active = { validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] };
      const users = await tx.user.findMany({
        where: f.all
          ? {}
          : {
              roleScopes: {
                some: {
                  ...active,
                  scopeType: 'JURISDICTION',
                  scopeId: { in: [...f.jurisdictionIds] },
                },
                none: {
                  ...active,
                  OR: [
                    { scopeType: { not: 'JURISDICTION' } },
                    { scopeId: { notIn: [...f.jurisdictionIds] } },
                  ],
                },
              },
            },
        orderBy: { email: 'asc' },
        include: {
          roleScopes: { where: active, include: { role: { select: { code: true, name: true } } } },
        },
      });
      return users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        status: u.status,
        version: u.version,
        roleScopes: u.roleScopes.map((s) => ({
          id: s.id,
          roleId: s.roleId,
          roleCode: s.role.code,
          roleName: s.role.name,
          scopeType: s.scopeType,
          scopeId: s.scopeId,
          includeDescendants: s.includeDescendants,
          validFrom: s.validFrom,
          validTo: s.validTo,
        })),
      }));
    });
  }

  private async managedUser(tx: Prisma.TransactionClient, auth: AuthContext, userId: string) {
    const f = await this.authz.requireScope(tx, auth.userId, 'user.manage');
    const user = await tx.user.findUnique({ where: { id: userId }, include: { roleScopes: true } });
    if (!user) throw notFound('User');
    if (!f.all) {
      // Scoped managers manage users whose every active assignment is inside their jurisdictions,
      // plus users with no active assignment.
      const now = new Date();
      const active = user.roleScopes.filter(
        (s) => s.validFrom <= now && (!s.validTo || s.validTo > now),
      );
      const visible =
        active.length === 0 ||
        active.every((s) => s.scopeType === 'JURISDICTION' && f.jurisdictionIds.has(s.scopeId));
      if (!visible) throw notFound('User');
    }
    return { f, user };
  }

  setUserStatus(auth: AuthContext, userId: string, dto: UserStatusDto, requestId?: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      if (userId === auth.userId)
        throw forbidden(
          'SELF_MODIFICATION_FORBIDDEN',
          'You cannot change your own account status.',
        );
      const { user } = await this.managedUser(tx, auth, userId);
      if (user.status === 'INVITED' && dto.status === 'ACTIVE')
        throw badRequest(
          'INVITE_PENDING',
          'Invited users become active by accepting their invitation.',
        );
      await tx.user.update({
        where: { id: userId },
        data: { status: dto.status, version: { increment: 1 } },
      });
      if (dto.status !== 'ACTIVE')
        await this.sessions.revokeAllForUser(tx, userId, `STATUS_${dto.status}`);
      await audit(tx, auth, requestId, {
        action: 'USER_STATUS_CHANGED',
        entityType: 'user',
        entityId: userId,
        before: { status: user.status },
        after: { status: dto.status },
        reason: dto.reason,
      });
      return { id: userId, status: dto.status };
    });
  }

  assignRoleScope(auth: AuthContext, userId: string, dto: AssignRoleScopeDto, requestId?: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      if (userId === auth.userId)
        throw forbidden(
          'SELF_ASSIGNMENT_FORBIDDEN',
          'You cannot change your own role assignments.',
        );
      const { f } = await this.managedUser(tx, auth, userId);
      const role = await tx.role.findUnique({
        where: { id: dto.roleId },
        include: { permissions: { include: { permission: true } } },
      });
      if (!role || role.status !== 'ACTIVE') throw notFound('Role');
      const roleCodes = role.permissions
        .filter((p) => p.effect === 'ALLOW')
        .map((p) => p.permission.code);
      await this.assertCanGrantPermissions(tx, auth, roleCodes);

      const scopeId = dto.scopeType === 'TENANT' ? auth.tenantId : dto.scopeId;
      if (!scopeId)
        throw badRequest('SCOPE_ID_REQUIRED', 'scopeId is required for this scope type.');
      if (dto.includeDescendants && dto.scopeType !== 'JURISDICTION')
        throw badRequest(
          'INVALID_SCOPE',
          'includeDescendants applies only to jurisdiction scopes.',
        );
      const target =
        dto.scopeType === 'JURISDICTION'
          ? await tx.jurisdiction.findUnique({ where: { id: scopeId } })
          : dto.scopeType === 'AGENCY'
            ? await tx.agency.findUnique({ where: { id: scopeId } })
            : dto.scopeType === 'SCHEME'
              ? await tx.scheme.findUnique({ where: { id: scopeId } })
              : { id: scopeId };
      if (!target) throw notFound('Scope target');

      if (!f.all) {
        // Scoped managers delegate only what they hold, only inside their own jurisdictions.
        const held = await this.authz.permissions(tx, auth.userId);
        const excess = roleCodes.filter((c) => !held.has(c));
        if (excess.length)
          throw forbidden('DELEGATION_EXCEEDS_AUTHORITY', `You cannot grant: ${excess.join(', ')}`);
        if (dto.scopeType !== 'JURISDICTION' || !f.jurisdictionIds.has(scopeId))
          throw forbidden(
            'SCOPE_OUTSIDE_AUTHORITY',
            'You can only assign roles within your own jurisdictions.',
          );
        if (dto.includeDescendants) {
          const subtree = await tx.jurisdiction.findMany({
            where: { ancestry: { has: scopeId } },
            select: { id: true },
          });
          if (subtree.some((j) => !f.jurisdictionIds.has(j.id)))
            throw forbidden(
              'SCOPE_OUTSIDE_AUTHORITY',
              'You can only assign roles within your own jurisdictions.',
            );
        }
      }
      const created = await tx.userRoleScope.create({
        data: {
          tenantId: auth.tenantId,
          userId,
          roleId: role.id,
          scopeType: dto.scopeType,
          scopeId,
          includeDescendants: dto.includeDescendants ?? false,
          validTo: dto.validTo ? new Date(dto.validTo) : null,
          createdBy: auth.userId,
        },
      });
      await audit(tx, auth, requestId, {
        action: 'ROLE_SCOPE_GRANTED',
        entityType: 'user_role_scope',
        entityId: created.id,
        after: {
          userId,
          roleCode: role.code,
          scopeType: dto.scopeType,
          scopeId,
          includeDescendants: created.includeDescendants,
        },
      });
      return created;
    });
  }

  revokeRoleScope(
    auth: AuthContext,
    userId: string,
    scopeRowId: string,
    reason: string | undefined,
    requestId?: string,
  ) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      if (userId === auth.userId)
        throw forbidden(
          'SELF_ASSIGNMENT_FORBIDDEN',
          'You cannot change your own role assignments.',
        );
      const { f } = await this.managedUser(tx, auth, userId);
      const row = await tx.userRoleScope.findFirst({
        where: { id: scopeRowId, userId },
        include: { role: true },
      });
      if (!row) throw notFound('Role assignment');
      if (!f.all && !(row.scopeType === 'JURISDICTION' && f.jurisdictionIds.has(row.scopeId)))
        throw forbidden(
          'SCOPE_OUTSIDE_AUTHORITY',
          'You can only revoke assignments within your own jurisdictions.',
        );
      if (row.validTo && row.validTo <= new Date())
        throw conflict('ALREADY_REVOKED', 'Assignment is already inactive.');
      const now = new Date();
      await tx.userRoleScope.update({
        where: { id: row.id },
        data: {
          validTo: now < row.validFrom ? row.validFrom : now,
          revokedBy: auth.userId,
          revocationReason: reason,
          version: { increment: 1 },
        },
      });
      await audit(tx, auth, requestId, {
        action: 'ROLE_SCOPE_REVOKED',
        entityType: 'user_role_scope',
        entityId: row.id,
        before: { userId, roleCode: row.role.code, scopeType: row.scopeType, scopeId: row.scopeId },
        reason,
      });
      return { id: row.id, revoked: true };
    });
  }

  jurisdictions(auth: AuthContext) {
    return this.prisma.withTenant(auth.tenantId, (tx) =>
      tx.jurisdiction.findMany({
        orderBy: [{ code: 'asc' }],
        select: {
          id: true,
          code: true,
          name: true,
          parentId: true,
          ancestry: true,
          type: { select: { code: true, displayName: true, sortOrder: true } },
        },
      }),
    );
  }

  agencies(auth: AuthContext) {
    return this.prisma.withTenant(auth.tenantId, (tx) =>
      tx.agency.findMany({
        orderBy: { code: 'asc' },
        select: { id: true, code: true, name: true, agencyType: true, status: true },
      }),
    );
  }
}
