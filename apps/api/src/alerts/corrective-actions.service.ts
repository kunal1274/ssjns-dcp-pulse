import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthContext } from '../auth/auth-context';
import { AuthorizationService, forbidden, notFound } from '../authz/authorization.service';
import { mapDbError } from '../common/db-errors';
import { audit, badRequest, conflict, versionConflict } from '../common/http';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVE_ALERT, alertWhere } from './alerts.service';
import type {
  CloseCorrectiveActionDto,
  CorrectiveActionQuery,
  CreateCorrectiveActionDto,
  SubmitCorrectiveActionDto,
  UpdateCorrectiveActionDto,
} from './dto';

const WORKABLE = ['ASSIGNED', 'IN_PROGRESS', 'REOPENED'];
const include = {
  owner: { select: { id: true, name: true, email: true } },
  scheme: { select: { id: true, schemeCode: true, name: true } },
  alert: { select: { id: true, ruleCode: true, severity: true, status: true, dedupKey: true } },
} satisfies Prisma.CorrectiveActionInclude;

type Row = Prisma.CorrectiveActionGetPayload<{ include: typeof include }>;

@Injectable()
export class CorrectiveActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
  ) {}

  private run<T>(auth: AuthContext, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.withTenant(auth.tenantId, fn).catch(mapDbError);
  }

  /** Visible: owned by the caller, or on an alert the caller can view. */
  private async visibleWhere(
    tx: Prisma.TransactionClient,
    auth: AuthContext,
  ): Promise<Prisma.CorrectiveActionWhereInput> {
    const scope = await this.authz.scopeFor(tx, auth.userId, 'alert.view');
    if (!scope) return { ownerId: auth.userId };
    return { OR: [{ ownerId: auth.userId }, { alert: alertWhere(this.authz, scope) }] };
  }

  private async load(tx: Prisma.TransactionClient, auth: AuthContext, id: string): Promise<Row> {
    const ca = await tx.correctiveAction.findFirst({
      where: { AND: [{ id }, await this.visibleWhere(tx, auth)] },
      include,
    });
    if (!ca) throw notFound('Corrective action');
    return ca;
  }

  private async canOnScheme(
    tx: Prisma.TransactionClient,
    userId: string,
    permission: string,
    schemeId: string | null,
  ) {
    const scope = await this.authz.scopeFor(tx, userId, permission);
    if (!scope) return false;
    if (!schemeId) return scope.all;
    const s = await tx.scheme.findUnique({ where: { id: schemeId } });
    return !!s && this.authz.schemeInScope(scope, s);
  }

  list(auth: AuthContext, q: CorrectiveActionQuery) {
    return this.run(auth, async (tx) => {
      const visible = await this.visibleWhere(tx, auth);
      let verify: Prisma.CorrectiveActionWhereInput = {};
      if (q.toVerify) {
        const scope = await this.authz.scopeFor(tx, auth.userId, 'alert.resolve');
        if (!scope) throw forbidden();
        verify = {
          status: 'PENDING_VERIFICATION',
          ownerId: { not: auth.userId },
          alert: alertWhere(this.authz, scope),
        };
      }
      const where: Prisma.CorrectiveActionWhereInput = {
        AND: [
          visible,
          verify,
          q.status ? { status: q.status as never } : {},
          q.alertId ? { alertId: q.alertId } : {},
          q.schemeId ? { schemeId: q.schemeId } : {},
          q.mine ? { ownerId: auth.userId } : {},
        ],
      };
      const [total, items] = await Promise.all([
        tx.correctiveAction.count({ where }),
        tx.correctiveAction.findMany({
          where,
          include,
          orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      const now = new Date();
      return {
        total,
        page: q.page,
        pageSize: q.pageSize,
        items: items.map((c) => ({
          ...c,
          overdue: !!c.dueAt && c.dueAt < now && c.status !== 'CLOSED' && c.status !== 'CANCELLED',
        })),
      };
    });
  }

  get(auth: AuthContext, id: string) {
    return this.run(auth, async (tx) => {
      const ca = await this.load(tx, auth, id);
      const events = await tx.correctiveActionEvent.findMany({
        where: { correctiveActionId: id },
        orderBy: { createdAt: 'asc' },
      });
      const ids = [
        ...new Set(
          [...events.map((e) => e.actorId), ca.createdBy, ca.verifiedBy].filter(
            (x): x is string => !!x,
          ),
        ),
      ];
      const users = new Map(
        (
          await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
        ).map((u) => [u.id, u.name]),
      );
      const mine = ca.ownerId === auth.userId;
      const independent = !mine;
      const [assign, resolve] = await Promise.all([
        this.canOnScheme(tx, auth.userId, 'alert.assign', ca.schemeId),
        this.canOnScheme(tx, auth.userId, 'alert.resolve', ca.schemeId),
      ]);
      return {
        ...ca,
        createdByName: ca.createdBy ? (users.get(ca.createdBy) ?? null) : null,
        verifiedByName: ca.verifiedBy ? (users.get(ca.verifiedBy) ?? null) : null,
        events: events.map((e) => ({
          ...e,
          actorName: e.actorId ? (users.get(e.actorId) ?? null) : null,
        })),
        allowed: {
          addProgress: mine && WORKABLE.includes(ca.status),
          submitForVerification: mine && WORKABLE.includes(ca.status),
          edit: assign && !['CLOSED', 'CANCELLED', 'PENDING_VERIFICATION'].includes(ca.status),
          verify: resolve && independent && ca.status === 'PENDING_VERIFICATION',
          verifyBlockedReason:
            ca.status === 'PENDING_VERIFICATION' && resolve && !independent
              ? 'The responsible officer cannot verify their own corrective action'
              : null,
        },
      };
    });
  }

  private async event(
    tx: Prisma.TransactionClient,
    auth: AuthContext,
    ca: { id: string },
    eventType: string,
    from: string | null,
    to: string | null,
    note?: string | null,
  ) {
    await tx.correctiveActionEvent.create({
      data: {
        tenantId: auth.tenantId,
        correctiveActionId: ca.id,
        eventType,
        fromStatus: from,
        toStatus: to,
        actorId: auth.userId,
        note: note ?? null,
      },
    });
  }

  private async assertOwner(
    tx: Prisma.TransactionClient,
    ownerId: string,
    schemeId: string | null,
  ) {
    const u = await tx.user.findUnique({ where: { id: ownerId } });
    if (!u || u.status !== 'ACTIVE')
      throw badRequest('INVALID_OWNER', 'Responsible officer must be an active user.');
    if (
      !(await this.canOnScheme(tx, ownerId, 'alert.view', schemeId)) &&
      !(await this.canOnScheme(tx, ownerId, 'scheme.view', schemeId))
    )
      throw badRequest('OWNER_OUT_OF_SCOPE', 'Responsible officer has no access to this scheme.');
  }

  create(auth: AuthContext, dto: CreateCorrectiveActionDto, requestId?: string) {
    return this.run(auth, async (tx) => {
      const scope = await this.authz.requireScope(tx, auth.userId, 'alert.assign');
      const alert = await tx.alert.findFirst({
        where: { AND: [{ id: dto.alertId }, alertWhere(this.authz, scope)] },
      });
      if (!alert) throw notFound('Alert');
      if (!ACTIVE_ALERT.includes(alert.status as never))
        throw conflict(
          'INVALID_ALERT_STATE',
          `Alert is ${alert.status}; corrective actions need an active alert.`,
        );
      if (new Date(dto.dueAt) < new Date(new Date().toISOString().slice(0, 10)))
        throw badRequest('INVALID_DUE_DATE', 'Due date cannot be in the past.');
      await this.assertOwner(tx, dto.ownerId, alert.schemeId);
      const ca = await tx.correctiveAction.create({
        data: {
          tenantId: auth.tenantId,
          alertId: alert.id,
          schemeId: alert.schemeId,
          ownerId: dto.ownerId,
          actionText: dto.actionText,
          dueAt: new Date(dto.dueAt),
          priority: dto.priority ?? 'MEDIUM',
          status: 'ASSIGNED',
          createdBy: auth.userId,
        },
      });
      await this.event(tx, auth, ca, 'CREATED', null, 'ASSIGNED', dto.actionText);
      if (alert.status !== 'IN_PROGRESS') {
        await tx.alert.update({
          where: { id: alert.id },
          data: { status: 'IN_PROGRESS', version: { increment: 1 } },
        });
        await tx.alertEvent.create({
          data: {
            tenantId: auth.tenantId,
            alertId: alert.id,
            eventType: 'CORRECTIVE_ACTION_CREATED',
            fromStatus: alert.status,
            toStatus: 'IN_PROGRESS',
            actorId: auth.userId,
            detailJson: { correctiveActionId: ca.id },
          },
        });
      }
      await audit(tx, auth, requestId, {
        action: 'corrective_action.created',
        entityType: 'corrective_action',
        entityId: ca.id,
        after: ca,
      });
      return tx.correctiveAction.findUniqueOrThrow({ where: { id: ca.id }, include });
    });
  }

  private async save(
    tx: Prisma.TransactionClient,
    auth: AuthContext,
    ca: Row,
    version: number,
    data: Prisma.CorrectiveActionUncheckedUpdateManyInput,
    eventType: string,
    note: string | null | undefined,
    requestId: string | undefined,
  ) {
    const res = await tx.correctiveAction.updateMany({
      where: { id: ca.id, version },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count === 0) throw versionConflict();
    const after = await tx.correctiveAction.findUniqueOrThrow({ where: { id: ca.id }, include });
    await this.event(tx, auth, ca, eventType, ca.status, after.status, note);
    await audit(tx, auth, requestId, {
      action: `corrective_action.${eventType.toLowerCase()}`,
      entityType: 'corrective_action',
      entityId: ca.id,
      before: { status: ca.status, ownerId: ca.ownerId, dueAt: ca.dueAt, priority: ca.priority },
      after: {
        status: after.status,
        ownerId: after.ownerId,
        dueAt: after.dueAt,
        priority: after.priority,
      },
      reason: note ?? null,
    });
    return after;
  }

  update(auth: AuthContext, id: string, dto: UpdateCorrectiveActionDto, requestId?: string) {
    return this.run(auth, async (tx) => {
      const ca = await this.load(tx, auth, id);
      const managing =
        dto.ownerId !== undefined ||
        dto.dueAt !== undefined ||
        dto.priority !== undefined ||
        dto.actionText !== undefined;
      if (!managing && !dto.progressNote)
        throw badRequest('NOTHING_TO_UPDATE', 'Provide a progress note or fields to change.');
      if (managing) {
        if (!(await this.canOnScheme(tx, auth.userId, 'alert.assign', ca.schemeId)))
          throw forbidden();
        if (['CLOSED', 'CANCELLED', 'PENDING_VERIFICATION'].includes(ca.status))
          throw conflict(
            'INVALID_ACTION_STATE',
            `Corrective action is ${ca.status} and cannot be edited.`,
          );
        if (dto.ownerId && dto.ownerId !== ca.ownerId)
          await this.assertOwner(tx, dto.ownerId, ca.schemeId);
        const reassigned = dto.ownerId && dto.ownerId !== ca.ownerId;
        return this.save(
          tx,
          auth,
          ca,
          dto.version,
          {
            ownerId: dto.ownerId,
            dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
            priority: dto.priority,
            actionText: dto.actionText,
            ...(reassigned ? { status: 'ASSIGNED' } : {}),
          },
          reassigned ? 'REASSIGNED' : 'UPDATED',
          dto.progressNote,
          requestId,
        );
      }
      if (ca.ownerId !== auth.userId)
        throw forbidden('NOT_OWNER', 'Only the responsible officer can add progress notes.');
      if (!WORKABLE.includes(ca.status))
        throw conflict(
          'INVALID_ACTION_STATE',
          `Corrective action is ${ca.status}; progress cannot be added.`,
        );
      return this.save(
        tx,
        auth,
        ca,
        dto.version,
        { status: 'IN_PROGRESS' },
        'PROGRESS_NOTE',
        dto.progressNote,
        requestId,
      );
    });
  }

  submit(auth: AuthContext, id: string, dto: SubmitCorrectiveActionDto, requestId?: string) {
    return this.run(auth, async (tx) => {
      const ca = await this.load(tx, auth, id);
      if (ca.ownerId !== auth.userId)
        throw forbidden('NOT_OWNER', 'Only the responsible officer can submit for verification.');
      if (!WORKABLE.includes(ca.status))
        throw conflict(
          'INVALID_ACTION_STATE',
          `Corrective action is ${ca.status}; it cannot be submitted.`,
        );
      return this.save(
        tx,
        auth,
        ca,
        dto.version,
        { status: 'PENDING_VERIFICATION', evidenceNote: dto.evidenceNote, submittedAt: new Date() },
        'SUBMITTED_FOR_VERIFICATION',
        dto.note ?? dto.evidenceNote,
        requestId,
      );
    });
  }

  close(auth: AuthContext, id: string, dto: CloseCorrectiveActionDto, requestId?: string) {
    return this.run(auth, async (tx) => {
      const ca = await this.load(tx, auth, id);
      if (!(await this.canOnScheme(tx, auth.userId, 'alert.resolve', ca.schemeId)))
        throw forbidden();
      if (ca.ownerId === auth.userId)
        throw forbidden(
          'SELF_VERIFICATION_FORBIDDEN',
          'The responsible officer cannot verify their own corrective action.',
        );
      if (ca.status !== 'PENDING_VERIFICATION')
        throw conflict(
          'INVALID_ACTION_STATE',
          `Corrective action is ${ca.status}; only PENDING_VERIFICATION can be verified.`,
        );
      if (dto.decision === 'CLOSE')
        return this.save(
          tx,
          auth,
          ca,
          dto.version,
          {
            status: 'CLOSED',
            verifiedBy: auth.userId,
            verifiedAt: new Date(),
            closureReason: dto.reason,
          },
          'CLOSED',
          dto.reason,
          requestId,
        );
      return this.save(
        tx,
        auth,
        ca,
        dto.version,
        { status: 'REOPENED', submittedAt: null },
        'REOPENED',
        dto.reason,
        requestId,
      );
    });
  }
}
