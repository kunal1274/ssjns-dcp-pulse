import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthContext } from '../auth/auth-context';
import {
  AuthorizationService,
  forbidden,
  notFound,
  type ScopeFilter,
} from '../authz/authorization.service';
import { mapDbError } from '../common/db-errors';
import { audit, badRequest, conflict, versionConflict } from '../common/http';
import { PrismaService } from '../prisma/prisma.service';
import { AlertEngineService } from './alert-engine.service';
import type {
  AlertNoteDto,
  AlertQuery,
  AssignAlertDto,
  CreateAlertRuleDto,
  ResolveAlertDto,
  UpdateAlertRuleDto,
} from './dto';
import { DEDUP_TEMPLATES, SLA_DAYS, thresholdError, type RuleCode } from './rules';

export const ACTIVE_ALERT = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS'] as const;
const OPEN_CA = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'REOPENED'] as const;
const DAY = 86_400_000;

const alertInclude = {
  scheme: {
    select: {
      id: true,
      schemeCode: true,
      name: true,
      jurisdictionId: true,
      agencyId: true,
      jurisdiction: { select: { name: true, code: true } },
    },
  },
  assignee: { select: { id: true, name: true, email: true } },
  rule: {
    select: {
      id: true,
      description: true,
      thresholdJson: true,
      isIllustrative: true,
      ownerRoleCode: true,
    },
  },
  _count: { select: { correctiveActions: true } },
} satisfies Prisma.AlertInclude;

/** Scheme-visible alerts; tenant-level alerts (no scheme) only for tenant-wide scope. */
export function alertWhere(
  authz: AuthorizationService,
  scope: ScopeFilter,
): Prisma.AlertWhereInput {
  return scope.all ? {} : { scheme: authz.schemeWhere(scope) };
}

export const subtree = (id: string): Prisma.SchemeWhereInput => ({
  OR: [{ jurisdictionId: id }, { jurisdiction: { ancestry: { has: id } } }],
});

@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly engine: AlertEngineService,
  ) {}

  private run<T>(auth: AuthContext, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.withTenant(auth.tenantId, fn).catch(mapDbError);
  }

  // ---------------------------------------------------------------- rules

  listRules(auth: AuthContext) {
    return this.run(auth, async (tx) => {
      const canManage = !!(await this.authz.scopeFor(tx, auth.userId, 'alert.rule.manage'));
      if (!canManage) await this.authz.requireScope(tx, auth.userId, 'alert.view');
      const items = await tx.alertRule.findMany({
        orderBy: [{ ruleCode: 'asc' }, { scopeType: 'asc' }, { effectiveFrom: 'asc' }],
      });
      return { canManage, items };
    });
  }

  private async assertRuleScope(
    tx: Prisma.TransactionClient,
    scope: ScopeFilter,
    scopeType: string,
    scopeId: string,
    tenantId: string,
  ) {
    if (scopeType === 'TENANT') {
      if (!scope.all || scopeId !== tenantId)
        throw forbidden('RULE_SCOPE_FORBIDDEN', 'Tenant-wide rules need tenant-wide authority.');
      return;
    }
    if (scopeType === 'JURISDICTION') {
      if (!(await tx.jurisdiction.findUnique({ where: { id: scopeId } })))
        throw notFound('Jurisdiction');
      if (!this.authz.jurisdictionInScope(scope, scopeId))
        throw forbidden('RULE_SCOPE_FORBIDDEN', 'Jurisdiction is outside your scope.');
      return;
    }
    if (scopeType === 'AGENCY') {
      if (!(await tx.agency.findUnique({ where: { id: scopeId } }))) throw notFound('Agency');
      if (!scope.all && !scope.agencyIds.has(scopeId))
        throw forbidden('RULE_SCOPE_FORBIDDEN', 'Agency is outside your scope.');
      return;
    }
    const s = await tx.scheme.findUnique({ where: { id: scopeId } });
    if (!s) throw notFound('Scheme');
    if (!this.authz.schemeInScope(scope, s))
      throw forbidden('RULE_SCOPE_FORBIDDEN', 'Scheme is outside your scope.');
  }

  createRule(auth: AuthContext, dto: CreateAlertRuleDto, requestId?: string) {
    return this.run(auth, async (tx) => {
      const scope = await this.authz.requireScope(tx, auth.userId, 'alert.rule.manage');
      const scopeId = dto.scopeType === 'TENANT' ? auth.tenantId : dto.scopeId;
      if (!scopeId)
        throw badRequest('SCOPE_ID_REQUIRED', 'scopeId is required for this scope type.');
      const err = thresholdError(dto.ruleCode, dto.threshold);
      if (err) throw badRequest('INVALID_THRESHOLD', err);
      if (dto.effectiveTo && dto.effectiveTo < dto.effectiveFrom)
        throw badRequest('INVALID_DATES', 'effectiveTo must not be before effectiveFrom.');
      await this.assertRuleScope(tx, scope, dto.scopeType, scopeId, auth.tenantId);
      if (!(await tx.role.findFirst({ where: { code: dto.ownerRoleCode } })))
        throw badRequest('UNKNOWN_ROLE', `Role ${dto.ownerRoleCode} does not exist.`);
      const rule = await tx.alertRule.create({
        data: {
          tenantId: auth.tenantId,
          ruleCode: dto.ruleCode,
          scopeType: dto.scopeType,
          scopeId,
          effectiveFrom: new Date(dto.effectiveFrom),
          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
          thresholdJson: dto.threshold as Prisma.InputJsonValue,
          severity: dto.severity,
          ownerRoleCode: dto.ownerRoleCode,
          notificationChannel: 'IN_APP',
          dedupKeyTemplate: DEDUP_TEMPLATES[dto.ruleCode],
          enabled: dto.enabled ?? true,
          evaluationFrequency: dto.evaluationFrequency ?? 'DAILY',
          description: dto.description,
          isIllustrative: true,
          createdBy: auth.userId,
        },
      });
      await audit(tx, auth, requestId, {
        action: 'alert_rule.created',
        entityType: 'alert_rule',
        entityId: rule.id,
        after: rule,
      });
      return rule;
    });
  }

  updateRule(auth: AuthContext, id: string, dto: UpdateAlertRuleDto, requestId?: string) {
    return this.run(auth, async (tx) => {
      const scope = await this.authz.requireScope(tx, auth.userId, 'alert.rule.manage');
      const rule = await tx.alertRule.findUnique({ where: { id } });
      if (!rule) throw notFound('Alert rule');
      await this.assertRuleScope(tx, scope, rule.scopeType, rule.scopeId, auth.tenantId);
      if (dto.threshold) {
        const err = thresholdError(rule.ruleCode as RuleCode, dto.threshold);
        if (err) throw badRequest('INVALID_THRESHOLD', err);
      }
      if (dto.ownerRoleCode && !(await tx.role.findFirst({ where: { code: dto.ownerRoleCode } })))
        throw badRequest('UNKNOWN_ROLE', `Role ${dto.ownerRoleCode} does not exist.`);
      if (dto.effectiveTo && new Date(dto.effectiveTo) < rule.effectiveFrom)
        throw badRequest('INVALID_DATES', 'effectiveTo must not be before effectiveFrom.');
      const res = await tx.alertRule.updateMany({
        where: { id, version: dto.version },
        data: {
          thresholdJson: dto.threshold as Prisma.InputJsonValue | undefined,
          severity: dto.severity,
          ownerRoleCode: dto.ownerRoleCode,
          enabled: dto.enabled,
          evaluationFrequency: dto.evaluationFrequency,
          description: dto.description,
          effectiveTo:
            dto.effectiveTo === undefined
              ? undefined
              : dto.effectiveTo
                ? new Date(dto.effectiveTo)
                : null,
          version: { increment: 1 },
        },
      });
      if (res.count === 0) throw versionConflict();
      const after = await tx.alertRule.findUniqueOrThrow({ where: { id } });
      await audit(tx, auth, requestId, {
        action: 'alert_rule.updated',
        entityType: 'alert_rule',
        entityId: id,
        before: rule,
        after,
        reason: dto.reason,
      });
      return after;
    });
  }

  async evaluateNow(auth: AuthContext, requestId?: string) {
    await this.run(auth, (tx) => this.authz.requireScope(tx, auth.userId, 'alert.rule.manage'));
    const summary = await this.engine.evaluate(auth.tenantId, { trigger: 'MANUAL' });
    await this.run(auth, (tx) =>
      audit(tx, auth, requestId, {
        action: 'alert.evaluation.run',
        entityType: 'alert_rule',
        after: summary,
      }),
    );
    return summary;
  }

  // ---------------------------------------------------------------- alerts

  list(auth: AuthContext, q: AlertQuery) {
    return this.run(auth, async (tx) => {
      const scope = await this.authz.requireScope(tx, auth.userId, 'alert.view');
      const where: Prisma.AlertWhereInput = {
        AND: [
          alertWhere(this.authz, scope),
          q.status ? { status: q.status as never } : {},
          q.active ? { status: { in: [...ACTIVE_ALERT] } } : {},
          q.severity ? { severity: q.severity as never } : {},
          q.ruleCode ? { ruleCode: q.ruleCode } : {},
          q.schemeId ? { schemeId: q.schemeId } : {},
          q.jurisdictionId ? { scheme: subtree(q.jurisdictionId) } : {},
          q.assignedToMe ? { assigneeId: auth.userId } : {},
        ],
      };
      const [total, items, bySeverity, byStatus] = await Promise.all([
        tx.alert.count({ where }),
        tx.alert.findMany({
          where,
          include: alertInclude,
          orderBy: [{ detectedAt: 'desc' }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.alert.groupBy({
          by: ['severity'],
          where: { AND: [where, { status: { in: [...ACTIVE_ALERT] } }] },
          _count: true,
        }),
        tx.alert.groupBy({ by: ['status'], where, _count: true }),
      ]);
      return {
        total,
        page: q.page,
        pageSize: q.pageSize,
        summary: {
          activeBySeverity: Object.fromEntries(bySeverity.map((r) => [r.severity, r._count])),
          byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])),
        },
        items,
      };
    });
  }

  private async load(tx: Prisma.TransactionClient, scope: ScopeFilter, id: string) {
    const a = await tx.alert.findFirst({
      where: { AND: [{ id }, alertWhere(this.authz, scope)] },
      include: alertInclude,
    });
    if (!a) throw notFound('Alert');
    return a;
  }

  get(auth: AuthContext, id: string) {
    return this.run(auth, async (tx) => {
      const scope = await this.authz.requireScope(tx, auth.userId, 'alert.view');
      const a = await this.load(tx, scope, id);
      const [events, actions] = await Promise.all([
        tx.alertEvent.findMany({ where: { alertId: id }, orderBy: { createdAt: 'asc' } }),
        tx.correctiveAction.findMany({
          where: { alertId: id },
          include: { owner: { select: { id: true, name: true, email: true } } },
          orderBy: { createdAt: 'asc' },
        }),
      ]);
      const actorIds = [...new Set(events.map((e) => e.actorId).filter((x): x is string => !!x))];
      const actors = new Map(
        (
          await tx.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, name: true },
          })
        ).map((u) => [u.id, u.name]),
      );
      const perms = await this.authz.permissions(tx, auth.userId);
      return {
        ...a,
        events: events.map((e) => ({
          ...e,
          actorName: e.actorId ? (actors.get(e.actorId) ?? null) : 'System (rule evaluation)',
        })),
        correctiveActions: actions,
        allowed: {
          acknowledge: perms.has('alert.assign') && a.status === 'OPEN',
          assign: perms.has('alert.assign') && ACTIVE_ALERT.includes(a.status as never),
          resolve: perms.has('alert.resolve') && ACTIVE_ALERT.includes(a.status as never),
          reopen: perms.has('alert.resolve') && (a.status === 'RESOLVED' || a.status === 'CLOSED'),
          createCorrectiveAction:
            perms.has('alert.assign') && ACTIVE_ALERT.includes(a.status as never),
        },
      };
    });
  }

  /** Active users who can see the alert's scheme: candidates for assignment or corrective-action ownership. */
  assignees(auth: AuthContext, id: string) {
    return this.run(auth, async (tx) => {
      const scope = await this.authz.requireScope(tx, auth.userId, 'alert.assign');
      const a = await this.load(tx, scope, id);
      const scheme = a.schemeId ? await tx.scheme.findUnique({ where: { id: a.schemeId } }) : null;
      const users = await tx.user.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' },
      });
      const out: typeof users = [];
      for (const u of users) {
        const s = await this.authz.scopeFor(tx, u.id, 'scheme.view');
        if (s && (scheme ? this.authz.schemeInScope(s, scheme) : s.all)) out.push(u);
      }
      return out;
    });
  }

  private async transition(
    auth: AuthContext,
    id: string,
    permission: string,
    requestId: string | undefined,
    step: (
      tx: Prisma.TransactionClient,
      a: Awaited<ReturnType<AlertsService['load']>>,
    ) => Promise<{
      event: string;
      data: Prisma.AlertUpdateManyMutationInput;
      version: number;
      note?: string;
      detail?: object;
    }>,
  ) {
    return this.run(auth, async (tx) => {
      const scope = await this.authz.requireScope(tx, auth.userId, permission);
      const a = await this.load(tx, scope, id);
      const s = await step(tx, a);
      const res = await tx.alert.updateMany({
        where: { id, version: s.version },
        data: { ...s.data, version: { increment: 1 } },
      });
      if (res.count === 0) throw versionConflict();
      const after = await tx.alert.findUniqueOrThrow({ where: { id } });
      await tx.alertEvent.create({
        data: {
          tenantId: auth.tenantId,
          alertId: id,
          eventType: s.event,
          fromStatus: a.status,
          toStatus: after.status,
          actorId: auth.userId,
          note: s.note,
          detailJson: (s.detail ?? {}) as Prisma.InputJsonValue,
        },
      });
      await audit(tx, auth, requestId, {
        action: `alert.${s.event.toLowerCase()}`,
        entityType: 'alert',
        entityId: id,
        before: { status: a.status, assigneeId: a.assigneeId, escalationLevel: a.escalationLevel },
        after: {
          status: after.status,
          assigneeId: after.assigneeId,
          escalationLevel: after.escalationLevel,
        },
        reason: s.note ?? null,
      });
      return after;
    });
  }

  private requireState(a: { status: string }, allowed: readonly string[]) {
    if (!allowed.includes(a.status))
      throw conflict(
        'INVALID_ALERT_STATE',
        `Alert is ${a.status}; this action needs ${allowed.join(' or ')}.`,
      );
  }

  acknowledge(auth: AuthContext, id: string, dto: AlertNoteDto, requestId?: string) {
    return this.transition(auth, id, 'alert.assign', requestId, async (_tx, a) => {
      this.requireState(a, ['OPEN']);
      return {
        event: 'ACKNOWLEDGED',
        version: dto.version,
        note: dto.note,
        data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date(), acknowledgedBy: auth.userId },
      };
    });
  }

  assign(auth: AuthContext, id: string, dto: AssignAlertDto, requestId?: string) {
    return this.transition(auth, id, 'alert.assign', requestId, async (tx, a) => {
      this.requireState(a, ACTIVE_ALERT);
      const user = await tx.user.findUnique({ where: { id: dto.assigneeId } });
      if (!user || user.status !== 'ACTIVE')
        throw badRequest('INVALID_ASSIGNEE', 'Assignee must be an active user.');
      const theirs = await this.authz.scopeFor(tx, dto.assigneeId, 'alert.view');
      if (!theirs || (a.scheme ? !this.authz.schemeInScope(theirs, a.scheme) : !theirs.all))
        throw badRequest('ASSIGNEE_OUT_OF_SCOPE', 'Assignee cannot view alerts for this scheme.');
      return {
        event: 'ASSIGNED',
        version: dto.version,
        note: dto.note,
        detail: { assigneeId: dto.assigneeId, assigneeName: user.name },
        data: {
          assigneeId: dto.assigneeId,
          ...(a.status === 'OPEN'
            ? { status: 'ACKNOWLEDGED', acknowledgedAt: new Date(), acknowledgedBy: auth.userId }
            : {}),
        },
      };
    });
  }

  resolve(auth: AuthContext, id: string, dto: ResolveAlertDto, requestId?: string) {
    return this.transition(auth, id, 'alert.resolve', requestId, async (tx, a) => {
      this.requireState(a, ACTIVE_ALERT);
      const open = await tx.correctiveAction.count({
        where: { alertId: id, status: { in: [...OPEN_CA] } },
      });
      if (open > 0)
        throw conflict(
          'CORRECTIVE_ACTIONS_OPEN',
          `${open} corrective action(s) must be closed before resolving.`,
        );
      return {
        event: 'RESOLVED',
        version: dto.version,
        note: dto.reason,
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          resolvedBy: auth.userId,
          resolutionReason: dto.reason,
        },
      };
    });
  }

  reopen(auth: AuthContext, id: string, dto: ResolveAlertDto, requestId?: string) {
    return this.transition(auth, id, 'alert.resolve', requestId, async (_tx, a) => {
      this.requireState(a, ['RESOLVED', 'CLOSED']);
      return {
        event: 'REOPENED',
        version: dto.version,
        note: dto.reason,
        data: {
          status: 'OPEN',
          resolvedAt: null,
          resolvedBy: null,
          resolutionReason: null,
          escalationLevel: 0,
          dueAt: new Date(Date.now() + (SLA_DAYS[a.severity] ?? 7) * DAY),
        },
      };
    });
  }

  escalate(auth: AuthContext, id: string, dto: AlertNoteDto, requestId?: string) {
    return this.transition(auth, id, 'alert.assign', requestId, async (_tx, a) => {
      this.requireState(a, ACTIVE_ALERT);
      if (a.escalationLevel >= 3)
        throw conflict('MAX_ESCALATION', 'Alert is already at the highest escalation level.');
      return {
        event: 'ESCALATED',
        version: dto.version,
        note: dto.note ?? 'Escalated manually',
        detail: { escalationLevel: a.escalationLevel + 1 },
        data: { escalationLevel: a.escalationLevel + 1 },
      };
    });
  }
}
