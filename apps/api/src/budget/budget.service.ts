import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { BudgetAllocation, BudgetVersion, Prisma } from '@prisma/client';
import type { AuthContext } from '../auth/auth-context';
import {
  AuthorizationService,
  forbidden,
  notFound,
  type ScopeFilter,
} from '../authz/authorization.service';
import { mapDbError } from '../common/db-errors';
import { audit, badRequest, conflict, versionConflict } from '../common/http';
import { idempotent } from '../common/idempotency';
import { fmt, money } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AllocationQuery,
  CancelDto,
  CreateAllocationDto,
  CreateCeilingDto,
  CreateFundingRequestDto,
  CreateRevisionDto,
  DecisionDto,
  ReviewFundingRequestDto,
} from './dto';

const exceeds = (available: Prisma.Decimal, amount: Prisma.Decimal) =>
  new UnprocessableEntityException({
    error: 'ALLOCATION_EXCEEDS_AVAILABLE',
    message: `Requested ${fmt(amount)} exceeds the available balance ${fmt(available)}.`,
    available: fmt(available),
  });
const selfApproval = () =>
  forbidden('SELF_APPROVAL_FORBIDDEN', 'You cannot approve your own submission.');

/**
 * Budget hierarchy: ceiling (budget_version with no scheme) → top-level
 * allocations (e.g. districts) → child allocations (co-districts) → scheme
 * leaf allocations. Balances are computed server-side from APPROVED rows of the
 * immediate level only, so parent and leaf amounts are never double counted.
 * DRAFT rows are pending maker-checker approval and reserve balance.
 */
@Injectable()
export class BudgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
  ) {}

  private run<T>(auth: AuthContext, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.withTenant(auth.tenantId, fn).catch(mapDbError);
  }

  private async within(tx: Prisma.TransactionClient, jurisdictionId: string, ancestorId: string) {
    if (jurisdictionId === ancestorId) return true;
    const j = await tx.jurisdiction.findUnique({
      where: { id: jurisdictionId },
      select: { ancestry: true },
    });
    return !!j?.ancestry.includes(ancestorId);
  }

  /** Approved and pending (DRAFT) amounts directly under a ceiling or parent allocation. */
  private async childTotals(
    tx: Prisma.TransactionClient,
    versionId: string,
    parentId: string | null,
    excludeId?: string,
  ) {
    const rows = await tx.budgetAllocation.groupBy({
      by: ['status'],
      where: {
        budgetVersionId: versionId,
        parentAllocationId: parentId,
        status: { in: ['APPROVED', 'DRAFT'] },
        id: excludeId ? { not: excludeId } : undefined,
      },
      _sum: { amount: true },
    });
    const get = (s: string) => rows.find((r) => r.status === s)?._sum.amount ?? money(0);
    return { approved: get('APPROVED'), pending: get('DRAFT') };
  }

  financialYears(auth: AuthContext) {
    return this.run(auth, (tx) => tx.financialYear.findMany({ orderBy: { startDate: 'desc' } }));
  }

  periods(auth: AuthContext) {
    return this.run(auth, (tx) =>
      tx.reportingPeriod.findMany({
        orderBy: { startDate: 'asc' },
        select: { id: true, code: true, startDate: true, endDate: true },
      }),
    );
  }

  private async ceilingView(
    tx: Prisma.TransactionClient,
    v: BudgetVersion & { jurisdiction?: { code: string; name: string } | null },
  ) {
    const t = await this.childTotals(tx, v.id, null);
    return {
      id: v.id,
      financialYearId: v.financialYearId,
      jurisdictionId: v.jurisdictionId,
      jurisdiction: v.jurisdiction ?? null,
      versionNumber: v.versionNumber,
      status: v.status,
      totalAmount: fmt(v.totalAmount),
      allocatedApproved: fmt(t.approved),
      allocatedPending: fmt(t.pending),
      remaining: fmt(v.totalAmount.sub(t.approved)),
      available: fmt(v.totalAmount.sub(t.approved).sub(t.pending)),
      approvalReference: v.approvalReference,
      createdBy: v.createdBy,
      approvedBy: v.approvedById,
      approvedAt: v.approvedAt,
      version: v.version,
    };
  }

  private async viewScope(tx: Prisma.TransactionClient, auth: AuthContext): Promise<ScopeFilter> {
    return (
      (await this.authz.scopeFor(tx, auth.userId, 'budget.allocate')) ??
      (await this.authz.requireScope(tx, auth.userId, 'scheme.view'))
    );
  }

  listCeilings(auth: AuthContext, financialYearId?: string) {
    return this.run(auth, async (tx) => {
      const f = await this.viewScope(tx, auth);
      const rows = await tx.budgetVersion.findMany({
        where: {
          schemeId: null,
          financialYearId,
          jurisdictionId: f.all ? undefined : { in: [...f.jurisdictionIds] },
        },
        include: { jurisdiction: { select: { code: true, name: true } } },
        orderBy: [{ createdAt: 'desc' }],
      });
      return Promise.all(rows.map((r) => this.ceilingView(tx, r)));
    });
  }

  createCeiling(
    auth: AuthContext,
    dto: CreateCeilingDto,
    key: string | undefined,
    requestId?: string,
  ) {
    return this.run(auth, (tx) =>
      idempotent(tx, auth, key, 'POST /budget/ceilings', dto, async () => {
        const f = await this.authz.requireScope(tx, auth.userId, 'budget.allocate');
        if (!this.authz.jurisdictionInScope(f, dto.jurisdictionId))
          throw forbidden(
            'SCOPE_OUTSIDE_AUTHORITY',
            'You cannot register a ceiling for this jurisdiction.',
          );
        const [fy, j] = await Promise.all([
          tx.financialYear.findUnique({ where: { id: dto.financialYearId } }),
          tx.jurisdiction.findUnique({ where: { id: dto.jurisdictionId } }),
        ]);
        if (!fy || !j)
          throw badRequest('INVALID_REFERENCE', 'Financial year or jurisdiction not found.');
        if (
          await tx.budgetVersion.findFirst({
            where: {
              schemeId: null,
              financialYearId: fy.id,
              jurisdictionId: j.id,
              status: { in: ['DRAFT', 'APPROVED'] },
            },
          })
        )
          throw conflict(
            'CEILING_EXISTS',
            'A ceiling already exists for this jurisdiction and year; request a revision instead.',
          );
        const last = await tx.budgetVersion.aggregate({
          where: { schemeId: null, financialYearId: fy.id, jurisdictionId: j.id },
          _max: { versionNumber: true },
        });
        const v = await tx.budgetVersion.create({
          data: {
            tenantId: auth.tenantId,
            financialYearId: fy.id,
            jurisdictionId: j.id,
            versionNumber: (last._max.versionNumber ?? 0) + 1,
            totalAmount: money(dto.totalAmount),
            approvalReference: dto.approvalReference,
            createdBy: auth.userId,
          },
          include: { jurisdiction: { select: { code: true, name: true } } },
        });
        const out = await this.ceilingView(tx, v);
        await audit(tx, auth, requestId, {
          action: 'BUDGET_CEILING_CREATED',
          entityType: 'budget_version',
          entityId: v.id,
          after: out,
        });
        return out;
      }),
    );
  }

  approveCeiling(
    auth: AuthContext,
    id: string,
    version: number,
    key: string | undefined,
    requestId?: string,
  ) {
    return this.run(auth, (tx) =>
      idempotent(tx, auth, key, `POST /budget/ceilings/${id}/approve`, { version }, async () => {
        const f = await this.authz.requireScope(tx, auth.userId, 'budget.allocate');
        const v = await tx.budgetVersion.findFirst({ where: { id, schemeId: null } });
        if (!v || !v.jurisdictionId || !this.authz.jurisdictionInScope(f, v.jurisdictionId))
          throw notFound('Ceiling');
        if (v.status !== 'DRAFT') throw conflict('INVALID_STATE', `Ceiling is ${v.status}.`);
        if (v.createdBy === auth.userId) throw selfApproval();
        const res = await tx.budgetVersion.updateMany({
          where: { id, version, status: 'DRAFT' },
          data: {
            status: 'APPROVED',
            approvedById: auth.userId,
            approvedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (res.count !== 1) throw versionConflict();
        const out = await this.ceilingView(
          tx,
          await tx.budgetVersion.findUniqueOrThrow({
            where: { id },
            include: { jurisdiction: { select: { code: true, name: true } } },
          }),
        );
        await audit(tx, auth, requestId, {
          action: 'BUDGET_CEILING_APPROVED',
          entityType: 'budget_version',
          entityId: id,
          before: { status: 'DRAFT' },
          after: out,
        });
        return out;
      }),
    );
  }

  private async allocationView(tx: Prisma.TransactionClient, a: BudgetAllocation) {
    const t = await this.childTotals(tx, a.budgetVersionId, a.id);
    const j = await tx.jurisdiction.findUnique({
      where: { id: a.recipientJurisdictionId },
      select: { code: true, name: true },
    });
    const s = a.schemeId
      ? await tx.scheme.findUnique({
          where: { id: a.schemeId },
          select: { schemeCode: true, name: true },
        })
      : null;
    return {
      id: a.id,
      budgetVersionId: a.budgetVersionId,
      parentAllocationId: a.parentAllocationId,
      recipientJurisdictionId: a.recipientJurisdictionId,
      recipient: j,
      schemeId: a.schemeId,
      scheme: s,
      level: a.schemeId ? 'SCHEME' : a.parentAllocationId ? 'SUB_JURISDICTION' : 'JURISDICTION',
      amount: fmt(a.amount),
      status: a.status,
      allocatedApproved: fmt(t.approved),
      allocatedPending: fmt(t.pending),
      remaining: fmt(a.amount.sub(t.approved)),
      available: fmt(a.amount.sub(t.approved).sub(t.pending)),
      createdBy: a.createdBy,
      approvedBy: a.approvedById,
      approvedAt: a.approvedAt,
      createdAt: a.createdAt,
      version: a.version,
    };
  }

  listAllocations(auth: AuthContext, q: AllocationQuery) {
    return this.run(auth, async (tx) => {
      const f = await this.viewScope(tx, auth);
      const rows = await tx.budgetAllocation.findMany({
        where: {
          budgetVersionId: q.budgetVersionId,
          status: q.status,
          recipientJurisdictionId: f.all ? undefined : { in: [...f.jurisdictionIds] },
        },
        orderBy: [{ createdAt: 'asc' }],
        take: 500,
      });
      return Promise.all(rows.map((r) => this.allocationView(tx, r)));
    });
  }

  createAllocation(
    auth: AuthContext,
    dto: CreateAllocationDto,
    key: string | undefined,
    requestId?: string,
  ) {
    return this.run(auth, (tx) =>
      idempotent(tx, auth, key, 'POST /budget/allocations', dto, async () => {
        const f = await this.authz.requireScope(tx, auth.userId, 'budget.allocate');
        const amount = money(dto.amount);
        if (amount.lte(0)) throw badRequest('INVALID_AMOUNT', 'Amount must be greater than zero.');
        if (!this.authz.jurisdictionInScope(f, dto.recipientJurisdictionId))
          throw forbidden('SCOPE_OUTSIDE_AUTHORITY', 'You cannot allocate to this jurisdiction.');

        // Lock the ceiling (or parent) row so concurrent allocations under it are serialised.
        let ceiling: Prisma.Decimal;
        let parentRecipient: string;
        if (dto.parentAllocationId) {
          const locked = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM budget_allocations WHERE id = ${dto.parentAllocationId}::uuid FOR UPDATE`;
          const parent = locked.length
            ? await tx.budgetAllocation.findUnique({ where: { id: dto.parentAllocationId } })
            : null;
          if (!parent || parent.budgetVersionId !== dto.budgetVersionId)
            throw badRequest('INVALID_PARENT', 'Parent allocation not found in this budget.');
          if (parent.status !== 'APPROVED')
            throw conflict('PARENT_NOT_APPROVED', 'The parent allocation must be approved first.');
          if (parent.schemeId)
            throw badRequest('INVALID_PARENT', 'Scheme allocations cannot be subdivided.');
          ceiling = parent.amount;
          parentRecipient = parent.recipientJurisdictionId;
        } else {
          const locked = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM budget_versions WHERE id = ${dto.budgetVersionId}::uuid FOR UPDATE`;
          const v = locked.length
            ? await tx.budgetVersion.findUnique({ where: { id: dto.budgetVersionId } })
            : null;
          if (!v || v.schemeId || !v.jurisdictionId)
            throw badRequest('INVALID_CEILING', 'Budget ceiling not found.');
          if (v.status !== 'APPROVED')
            throw conflict('CEILING_NOT_APPROVED', 'The ceiling must be approved first.');
          ceiling = v.totalAmount;
          parentRecipient = v.jurisdictionId;
        }
        if (!(await this.within(tx, dto.recipientJurisdictionId, parentRecipient)))
          throw badRequest(
            'RECIPIENT_OUTSIDE_PARENT',
            'Recipient must be inside the parent jurisdiction.',
          );
        if (!dto.schemeId && dto.recipientJurisdictionId === parentRecipient)
          throw badRequest(
            'RECIPIENT_OUTSIDE_PARENT',
            'A jurisdiction allocation must go to a sub-jurisdiction.',
          );
        if (dto.schemeId) {
          const s = await tx.scheme.findUnique({ where: { id: dto.schemeId } });
          if (!s) throw badRequest('INVALID_REFERENCE', 'Scheme not found.');
          if (!['APPROVED', 'ACTIVE'].includes(s.status))
            throw conflict(
              'SCHEME_NOT_APPROVED',
              'Only approved or active schemes can receive allocations.',
            );
          if (!(await this.within(tx, s.jurisdictionId, dto.recipientJurisdictionId)))
            throw badRequest(
              'SCHEME_OUTSIDE_RECIPIENT',
              'The scheme is not located in the recipient jurisdiction.',
            );
        }
        const t = await this.childTotals(tx, dto.budgetVersionId, dto.parentAllocationId ?? null);
        const available = ceiling.sub(t.approved).sub(t.pending);
        if (amount.gt(available)) throw exceeds(available, amount);

        const a = await tx.budgetAllocation.create({
          data: {
            tenantId: auth.tenantId,
            budgetVersionId: dto.budgetVersionId,
            parentAllocationId: dto.parentAllocationId ?? null,
            recipientJurisdictionId: dto.recipientJurisdictionId,
            schemeId: dto.schemeId ?? null,
            amount,
            createdBy: auth.userId,
          },
        });
        const out = await this.allocationView(tx, a);
        await audit(tx, auth, requestId, {
          action: 'BUDGET_ALLOCATION_CREATED',
          entityType: 'budget_allocation',
          entityId: a.id,
          after: out,
        });
        return out;
      }),
    );
  }

  private async loadAllocation(tx: Prisma.TransactionClient, auth: AuthContext, id: string) {
    const f = await this.authz.requireScope(tx, auth.userId, 'budget.allocate');
    const a = await tx.budgetAllocation.findUnique({ where: { id } });
    if (!a || !this.authz.jurisdictionInScope(f, a.recipientJurisdictionId))
      throw notFound('Allocation');
    return a;
  }

  approveAllocation(
    auth: AuthContext,
    id: string,
    version: number,
    key: string | undefined,
    requestId?: string,
  ) {
    return this.run(auth, (tx) =>
      idempotent(tx, auth, key, `POST /budget/allocations/${id}/approve`, { version }, async () => {
        const a = await this.loadAllocation(tx, auth, id);
        if (a.status !== 'DRAFT') throw conflict('INVALID_STATE', `Allocation is ${a.status}.`);
        if (a.createdBy === auth.userId) throw selfApproval();
        // The ceiling trigger re-checks the balance under a row lock at approval time.
        const res = await tx.budgetAllocation.updateMany({
          where: { id, version, status: 'DRAFT' },
          data: {
            status: 'APPROVED',
            approvedById: auth.userId,
            approvedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (res.count !== 1) throw versionConflict();
        const out = await this.allocationView(
          tx,
          await tx.budgetAllocation.findUniqueOrThrow({ where: { id } }),
        );
        await audit(tx, auth, requestId, {
          action: 'BUDGET_ALLOCATION_APPROVED',
          entityType: 'budget_allocation',
          entityId: id,
          before: { status: 'DRAFT' },
          after: out,
        });
        return out;
      }),
    );
  }

  cancelAllocation(auth: AuthContext, id: string, dto: CancelDto, requestId?: string) {
    return this.run(auth, async (tx) => {
      const a = await this.loadAllocation(tx, auth, id);
      if (a.status !== 'DRAFT')
        throw conflict(
          'INVALID_STATE',
          'Only pending allocations can be cancelled; use a revision for approved ones.',
        );
      const res = await tx.budgetAllocation.updateMany({
        where: { id, version: dto.version, status: 'DRAFT' },
        data: { status: 'CANCELLED', version: { increment: 1 } },
      });
      if (res.count !== 1) throw versionConflict();
      await audit(tx, auth, requestId, {
        action: 'BUDGET_ALLOCATION_CANCELLED',
        entityType: 'budget_allocation',
        entityId: id,
        before: { status: 'DRAFT' },
        after: { status: 'CANCELLED' },
        reason: dto.reason,
      });
      return this.allocationView(
        tx,
        await tx.budgetAllocation.findUniqueOrThrow({ where: { id } }),
      );
    });
  }

  allocationHistory(auth: AuthContext, id: string) {
    return this.run(auth, async (tx) => {
      const f = await this.viewScope(tx, auth);
      const a = await tx.budgetAllocation.findUnique({ where: { id } });
      if (!a || !this.authz.jurisdictionInScope(f, a.recipientJurisdictionId))
        throw notFound('Allocation');
      const [events, revisions] = await Promise.all([
        tx.auditEvent.findMany({
          where: { entityType: 'budget_allocation', entityId: id },
          orderBy: { occurredAt: 'asc' },
          select: { action: true, actorId: true, occurredAt: true, reason: true },
        }),
        tx.budgetRevision.findMany({ where: { allocationId: id }, orderBy: { createdAt: 'asc' } }),
      ]);
      return {
        allocation: await this.allocationView(tx, a),
        events,
        revisions: revisions.map(revisionView),
      };
    });
  }

  listRevisions(auth: AuthContext, status?: string) {
    return this.run(auth, async (tx) => {
      await this.authz.requireScope(tx, auth.userId, 'budget.revise');
      const rows = await tx.budgetRevision.findMany({
        where: { status },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return rows.map(revisionView);
    });
  }

  createRevision(
    auth: AuthContext,
    dto: CreateRevisionDto,
    key: string | undefined,
    requestId?: string,
  ) {
    return this.run(auth, (tx) =>
      idempotent(tx, auth, key, 'POST /budget/revisions', dto, async () => {
        const f = await this.authz.requireScope(tx, auth.userId, 'budget.revise');
        const requested = money(dto.requestedAmount);
        let previous: Prisma.Decimal;
        if (dto.targetType === 'BUDGET_VERSION') {
          const v = await tx.budgetVersion.findUnique({ where: { id: dto.targetId } });
          if (!v || (v.jurisdictionId && !this.authz.jurisdictionInScope(f, v.jurisdictionId)))
            throw notFound('Budget version');
          if (v.status !== 'APPROVED')
            throw conflict('INVALID_STATE', 'Only approved budgets can be revised.');
          previous = v.totalAmount;
        } else {
          const a = await tx.budgetAllocation.findUnique({ where: { id: dto.targetId } });
          if (!a || !this.authz.jurisdictionInScope(f, a.recipientJurisdictionId))
            throw notFound('Allocation');
          if (a.status !== 'APPROVED')
            throw conflict('INVALID_STATE', 'Only approved allocations can be revised.');
          previous = a.amount;
        }
        if (requested.eq(previous))
          throw badRequest('NO_CHANGE', 'Requested amount equals the current amount.');
        if (
          await tx.budgetRevision.findFirst({
            where: {
              status: 'PENDING',
              OR: [{ budgetVersionId: dto.targetId }, { allocationId: dto.targetId }],
            },
          })
        )
          throw conflict('REVISION_PENDING', 'A revision is already pending for this record.');
        const r = await tx.budgetRevision.create({
          data: {
            tenantId: auth.tenantId,
            targetType: dto.targetType,
            budgetVersionId: dto.targetType === 'BUDGET_VERSION' ? dto.targetId : null,
            allocationId: dto.targetType === 'ALLOCATION' ? dto.targetId : null,
            previousAmount: previous,
            requestedAmount: requested,
            reason: dto.reason,
            requestedById: auth.userId,
          },
        });
        await audit(tx, auth, requestId, {
          action: 'BUDGET_REVISION_REQUESTED',
          entityType: 'budget_revision',
          entityId: r.id,
          after: revisionView(r),
          reason: dto.reason,
        });
        return revisionView(r);
      }),
    );
  }

  decideRevision(
    auth: AuthContext,
    id: string,
    dto: DecisionDto,
    key: string | undefined,
    requestId?: string,
  ) {
    return this.run(auth, (tx) =>
      idempotent(tx, auth, key, `POST /budget/revisions/${id}/decision`, dto, async () => {
        await this.authz.requireScope(tx, auth.userId, 'budget.revise');
        const r = await tx.budgetRevision.findUnique({ where: { id } });
        if (!r) throw notFound('Revision');
        if (r.status !== 'PENDING') throw conflict('INVALID_STATE', `Revision is ${r.status}.`);
        if (r.requestedById === auth.userId) throw selfApproval();
        if (dto.decision === 'APPROVE') {
          if (r.budgetVersionId) {
            await tx.$queryRaw`SELECT id FROM budget_versions WHERE id = ${r.budgetVersionId}::uuid FOR UPDATE`;
            const v = await tx.budgetVersion.findUniqueOrThrow({
              where: { id: r.budgetVersionId },
            });
            if (!v.totalAmount.eq(r.previousAmount))
              throw conflict(
                'STALE_REVISION',
                'The budget changed since this revision was requested.',
              );
            const t = await this.childTotals(tx, v.id, null);
            if (r.requestedAmount.lt(t.approved.add(t.pending)))
              throw new UnprocessableEntityException({
                error: 'REVISION_BELOW_ALLOCATED',
                message: `Ceiling cannot go below allocated ${fmt(t.approved.add(t.pending))}.`,
              });
            await tx.budgetVersion.update({
              where: { id: v.id },
              data: {
                totalAmount: r.requestedAmount,
                revisionReason: r.reason,
                version: { increment: 1 },
              },
            });
          } else {
            await tx.$queryRaw`SELECT id FROM budget_allocations WHERE id = ${r.allocationId}::uuid FOR UPDATE`;
            const a = await tx.budgetAllocation.findUniqueOrThrow({
              where: { id: r.allocationId! },
            });
            if (!a.amount.eq(r.previousAmount))
              throw conflict(
                'STALE_REVISION',
                'The allocation changed since this revision was requested.',
              );
            const t = await this.childTotals(tx, a.budgetVersionId, a.id);
            if (r.requestedAmount.lt(t.approved.add(t.pending)))
              throw new UnprocessableEntityException({
                error: 'REVISION_BELOW_ALLOCATED',
                message: `Allocation cannot go below sub-allocated ${fmt(t.approved.add(t.pending))}.`,
              });
            if (r.requestedAmount.gt(a.amount)) {
              const siblings = await this.childTotals(
                tx,
                a.budgetVersionId,
                a.parentAllocationId,
                a.id,
              );
              const cap = a.parentAllocationId
                ? (
                    await tx.budgetAllocation.findUniqueOrThrow({
                      where: { id: a.parentAllocationId },
                    })
                  ).amount
                : (await tx.budgetVersion.findUniqueOrThrow({ where: { id: a.budgetVersionId } }))
                    .totalAmount;
              const available = cap.sub(siblings.approved).sub(siblings.pending);
              if (r.requestedAmount.gt(available)) throw exceeds(available, r.requestedAmount);
            }
            // The ceiling trigger re-validates this update against the parent and children.
            await tx.budgetAllocation.update({
              where: { id: a.id },
              data: { amount: r.requestedAmount, version: { increment: 1 } },
            });
          }
        }
        const status = dto.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
        const updated = await tx.budgetRevision.update({
          where: { id },
          data: {
            status,
            decidedById: auth.userId,
            decidedAt: new Date(),
            decisionComment: dto.comment,
            version: { increment: 1 },
          },
        });
        await audit(tx, auth, requestId, {
          action: `BUDGET_REVISION_${status}`,
          entityType: 'budget_revision',
          entityId: id,
          before: { status: 'PENDING' },
          after: revisionView(updated),
          reason: dto.comment,
        });
        return revisionView(updated);
      }),
    );
  }

  listFundingRequests(auth: AuthContext) {
    return this.run(auth, async (tx) => {
      const f = await this.authz.requireScope(tx, auth.userId, 'scheme.view');
      const rows = await tx.budgetRequest.findMany({
        where: { scheme: this.authz.schemeWhere(f) },
        include: {
          scheme: { select: { schemeCode: true, name: true } },
          period: { select: { code: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return rows.map((r) => ({ ...r, amount: fmt(r.amount) }));
    });
  }

  createFundingRequest(
    auth: AuthContext,
    dto: CreateFundingRequestDto,
    key: string | undefined,
    requestId?: string,
  ) {
    return this.run(auth, (tx) =>
      idempotent(tx, auth, key, 'POST /budget/requests', dto, async () => {
        const f = await this.authz.requireScope(tx, auth.userId, 'budget.request.create');
        const s = await tx.scheme.findUnique({ where: { id: dto.schemeId } });
        if (!s || !this.authz.schemeInScope(f, s)) throw notFound('Scheme');
        const period = await tx.reportingPeriod.findUnique({ where: { id: dto.periodId } });
        if (!period) throw badRequest('INVALID_REFERENCE', 'Reporting period not found.');
        const amount = money(dto.amount);
        if (amount.lte(0)) throw badRequest('INVALID_AMOUNT', 'Amount must be greater than zero.');
        const r = await tx.budgetRequest.create({
          data: {
            tenantId: auth.tenantId,
            schemeId: s.id,
            requestingAgencyId: s.agencyId,
            periodId: period.id,
            amount,
            justification: dto.justification,
            status: 'SUBMITTED',
            submittedById: auth.userId,
            createdBy: auth.userId,
          },
        });
        await audit(tx, auth, requestId, {
          action: 'BUDGET_REQUEST_SUBMITTED',
          entityType: 'budget_request',
          entityId: r.id,
          after: { ...r, amount: fmt(r.amount) },
        });
        return { ...r, amount: fmt(r.amount) };
      }),
    );
  }

  reviewFundingRequest(
    auth: AuthContext,
    id: string,
    dto: ReviewFundingRequestDto,
    key: string | undefined,
    requestId?: string,
  ) {
    return this.run(auth, (tx) =>
      idempotent(tx, auth, key, `POST /budget/requests/${id}/review`, dto, async () => {
        const f = await this.authz.requireScope(tx, auth.userId, 'budget.request.review');
        const r = await tx.budgetRequest.findUnique({ where: { id }, include: { scheme: true } });
        if (!r || !this.authz.schemeInScope(f, r.scheme)) throw notFound('Budget request');
        if (r.status !== 'SUBMITTED') throw conflict('INVALID_STATE', `Request is ${r.status}.`);
        if (r.submittedById === auth.userId || r.createdBy === auth.userId) throw selfApproval();
        if (dto.decision !== 'APPROVED' && !dto.comment)
          throw badRequest('REASON_REQUIRED', 'A comment is required when rejecting or returning.');
        const res = await tx.budgetRequest.updateMany({
          where: { id, version: dto.version, status: 'SUBMITTED' },
          data: {
            status: dto.decision,
            reviewedById: auth.userId,
            reviewedAt: new Date(),
            reviewComment: dto.comment,
            version: { increment: 1 },
          },
        });
        if (res.count !== 1) throw versionConflict();
        await audit(tx, auth, requestId, {
          action: `BUDGET_REQUEST_${dto.decision}`,
          entityType: 'budget_request',
          entityId: id,
          before: { status: 'SUBMITTED' },
          after: { status: dto.decision },
          reason: dto.comment,
        });
        const out = await tx.budgetRequest.findUniqueOrThrow({ where: { id } });
        return { ...out, amount: fmt(out.amount) };
      }),
    );
  }
}

function revisionView(r: Prisma.BudgetRevisionGetPayload<object>) {
  return {
    id: r.id,
    targetType: r.targetType,
    budgetVersionId: r.budgetVersionId,
    allocationId: r.allocationId,
    previousAmount: fmt(r.previousAmount),
    requestedAmount: fmt(r.requestedAmount),
    reason: r.reason,
    status: r.status,
    requestedBy: r.requestedById,
    decidedBy: r.decidedById,
    decidedAt: r.decidedAt,
    decisionComment: r.decisionComment,
    createdAt: r.createdAt,
    version: r.version,
  };
}
