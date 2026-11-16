import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { KPI_DEFINITIONS } from '@dcp/shared';
import type { AuthContext } from '../auth/auth-context';
import { AuthorizationService, notFound, type ScopeFilter } from '../authz/authorization.service';
import { mapDbError } from '../common/db-errors';
import { badRequest } from '../common/http';
import { percent } from '../finance/calculations';
import { PrismaService } from '../prisma/prisma.service';
import {
  AGGREGATES,
  type AggregateRow,
  type MetricsFilter,
  SCHEME_COLUMNS,
  type SchemeRow,
  scopeSql,
  withMetrics,
} from './kpi.sql';
import type { DashboardQuery, SchemeListQuery } from './dto';

const D = (v: string | null) => (v === null ? null : new Prisma.Decimal(v));
const money = (d: Prisma.Decimal) => d.toFixed(2);

/** Derived KPIs from summed figures, with the denominator and data basis alongside. */
export function kpis(a: AggregateRow) {
  const approved = D(a.approved_budget)!;
  const allocated = D(a.allocated)!;
  const released = D(a.verified_releases)!;
  const spent = D(a.verified_expenditure)!;
  return {
    schemeCount: a.scheme_count,
    activeSchemes: a.active_count,
    approvedBudget: a.approved_budget,
    originalBudget: a.original_budget,
    allocatedBudget: a.allocated,
    verifiedReleases: a.verified_releases,
    verifiedExpenditure: a.verified_expenditure,
    reportedExpenditure: a.reported_expenditure,
    openCommitments: a.open_commitments,
    financialUtilisationPercent: percent(spent, approved),
    financialUtilisationDenominator: a.approved_budget,
    releaseUtilisationPercent: percent(spent, released),
    releaseUtilisationDenominator: a.verified_releases,
    budgetRemaining: money(approved.sub(spent)),
    unreleasedAllocation: money(allocated.sub(released)),
    unspentReleasedFunds: money(released.sub(spent)),
    pendingProgressSubmissions: a.pending_progress,
    pendingFinancialVerification: a.pending_financial,
    openAlerts: a.open_alerts,
    delayedSchemes: a.delayed_count,
    delayedMilestones: a.milestones_delayed,
    schemesRequiringAction: a.corrective_count,
    progressBands: {
      notAvailable: a.band_na,
      '0-25': a.band_0_25,
      '25-50': a.band_25_50,
      '50-75': a.band_50_75,
      '75-100': a.band_75_100,
      '100': a.band_100,
    },
    lastVerifiedAt: a.last_verified_at,
  };
}

export function schemeView(r: SchemeRow) {
  const fin = r.fin_util;
  const phys = r.physical;
  const diff = fin !== null && phys !== null ? D(fin)!.sub(D(phys)!).toFixed(2) : null;
  const variance =
    phys !== null && r.planned !== null ? D(phys)!.sub(D(r.planned)!).toFixed(2) : null;
  return {
    id: r.id,
    schemeCode: r.scheme_code,
    name: r.name,
    category: r.category,
    status: r.status,
    department: r.department,
    jurisdictionId: r.jurisdiction_id,
    approvedBudget: r.approved_budget,
    allocatedBudget: r.allocated,
    verifiedReleases: r.verified_releases,
    verifiedExpenditure: r.verified_expenditure,
    reportedExpenditure: r.reported_expenditure,
    openCommitments: r.open_commitments,
    financialUtilisationPercent: fin,
    releaseUtilisationPercent: percent(D(r.verified_expenditure)!, D(r.verified_releases)),
    physicalCompletionPercent: phys,
    plannedProgressPercent: r.planned,
    scheduleVariancePoints: variance,
    physicalFinancialDifferencePoints: diff,
    milestones: r.milestones,
    milestonesCompleted: r.milestones_done,
    milestonesDelayed: r.milestones_delayed,
    delayed: r.delayed,
    pendingFinancialVerification: r.pending_financial,
    pendingProgressSubmissions: r.pending_progress,
    openAlerts: r.open_alerts,
    lastVerifiedPeriod: r.last_verified_period,
    targetEndDate: r.target_end_date,
  };
}

const BASIS =
  'Verified records only (a verified correction replaces the record it supersedes). Reported expenditure = verified + submitted. ' +
  'Physical progress is shown per scheme and as counts by band; no statewide average is computed because measurement units differ.';

@Injectable()
export class DashboardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
  ) {}

  private run<T>(auth: AuthContext, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.withTenant(auth.tenantId, fn).catch(mapDbError);
  }

  private async cutoff(tx: Prisma.TransactionClient, periodId?: string) {
    if (!periodId) return { cutoff: null, period: null };
    const p = await tx.reportingPeriod.findUnique({ where: { id: periodId } });
    if (!p) throw badRequest('INVALID_PERIOD', 'Unknown reporting period.');
    return { cutoff: p.endDate, period: { id: p.id, code: p.code, endDate: p.endDate } };
  }

  private async filter(
    tx: Prisma.TransactionClient,
    scope: ScopeFilter,
    alertScope: ScopeFilter | null,
    q: DashboardQuery,
    subtreeOf?: string,
  ): Promise<{ f: MetricsFilter; period: { id: string; code: string; endDate: Date } | null }> {
    const { cutoff, period } = await this.cutoff(tx, q.periodId);
    return {
      f: {
        scope,
        alertScope,
        subtreeOf: q.coDistrictId ?? q.districtId ?? subtreeOf,
        financialYearId: q.financialYearId,
        category: q.category,
        department: q.department,
        agencyId: q.agencyId,
        cutoff,
      },
      period,
    };
  }

  private async totals(tx: Prisma.TransactionClient, f: MetricsFilter) {
    const [row] = await tx.$queryRaw<AggregateRow[]>(
      withMetrics(f, Prisma.sql`SELECT ${AGGREGATES} FROM m`),
    );
    return kpis(row);
  }

  /** Totals per direct child of `nodeId`; schemes recorded on the node itself form their own row. */
  private async children(tx: Prisma.TransactionClient, f: MetricsFilter, nodeId: string) {
    const rows = await tx.$queryRaw<(AggregateRow & { jid: string | null })[]>(
      withMetrics(
        f,
        Prisma.sql`, kids AS (SELECT id FROM jurisdictions WHERE parent_id = ${nodeId}::uuid)
        SELECT k.id AS jid, ${AGGREGATES}
        FROM m LEFT JOIN kids k ON k.id = m.jurisdiction_id OR k.id = ANY(m.ancestry)
        GROUP BY k.id`,
      ),
    );
    const kids = await tx.jurisdiction.findMany({
      where: { parentId: nodeId },
      include: { type: { select: { code: true, displayName: true } } },
      orderBy: { code: 'asc' },
    });
    const byId = new Map(rows.map((r) => [r.jid, r]));
    const visible = kids.filter(
      (k) => byId.has(k.id) || this.authz.jurisdictionInScope(f.scope, k.id),
    );
    const result = visible.map((k) => {
      const r = byId.get(k.id);
      return {
        jurisdiction: { id: k.id, code: k.code, name: k.name, type: k.type.displayName },
        kpis: r ? kpis(r) : null,
      };
    });
    const direct = byId.get(null);
    return { children: result, direct: direct ? kpis(direct) : null };
  }

  private async statusBreakdown(tx: Prisma.TransactionClient, f: MetricsFilter) {
    return tx.$queryRaw<{ status: string; n: number }[]>(
      withMetrics(
        f,
        Prisma.sql`SELECT m.status, COUNT(*)::int AS n FROM m GROUP BY m.status ORDER BY m.status`,
      ),
    );
  }

  private async schemeList(
    tx: Prisma.TransactionClient,
    f: MetricsFilter,
    opts: { delayedOnly?: boolean; page: number; pageSize: number },
  ) {
    const cond = opts.delayedOnly ? Prisma.sql`WHERE m.delayed` : Prisma.empty;
    const [{ n }] = await tx.$queryRaw<{ n: number }[]>(
      withMetrics(f, Prisma.sql`SELECT COUNT(*)::int AS n FROM m ${cond}`),
    );
    const rows = await tx.$queryRaw<SchemeRow[]>(
      withMetrics(
        f,
        Prisma.sql`SELECT ${SCHEME_COLUMNS} FROM m ${cond} ORDER BY m.delayed DESC, m.scheme_code
        LIMIT ${opts.pageSize} OFFSET ${(opts.page - 1) * opts.pageSize}`,
      ),
    );
    return { total: n, page: opts.page, pageSize: opts.pageSize, items: rows.map(schemeView) };
  }

  private async node(tx: Prisma.TransactionClient, scope: ScopeFilter, id: string) {
    const j = await tx.jurisdiction.findUnique({
      where: { id },
      include: { type: { select: { code: true, displayName: true } } },
    });
    if (!j || !this.authz.jurisdictionInScope(scope, j.id)) throw notFound('Jurisdiction');
    return j;
  }

  private async dashboard(
    tx: Prisma.TransactionClient,
    scope: ScopeFilter,
    alertScope: ScopeFilter | null,
    q: DashboardQuery,
    node: {
      id: string;
      code: string;
      name: string;
      type: { displayName: string };
      parentId: string | null;
    },
  ) {
    const { f, period } = await this.filter(tx, scope, alertScope, q, node.id);
    const [totals, comparison, statuses, delayed] = await Promise.all([
      this.totals(tx, f),
      this.children(tx, f, node.id),
      this.statusBreakdown(tx, f),
      this.schemeList(tx, f, { delayedOnly: true, page: 1, pageSize: 10 }),
    ]);
    const completeness = await this.completeness(tx, f, q.periodId);
    return {
      jurisdiction: {
        id: node.id,
        code: node.code,
        name: node.name,
        type: node.type.displayName,
        parentId: node.parentId,
      },
      scope: scope.all ? 'TENANT' : 'RESTRICTED',
      filters: { ...q, period },
      basis: BASIS,
      currency: 'INR',
      generatedAt: new Date().toISOString(),
      totals,
      comparison: comparison.children,
      directAtThisLevel: comparison.direct,
      statusBreakdown: statuses,
      delayedSchemes: delayed,
      reportingCompleteness: completeness,
    };
  }

  state(auth: AuthContext, q: DashboardQuery) {
    return this.run(auth, async (tx) => {
      const scope = await this.authz.requireScope(tx, auth.userId, 'report.view');
      const root = await tx.jurisdiction.findFirst({
        where: { parentId: null },
        include: { type: { select: { code: true, displayName: true } } },
        orderBy: { code: 'asc' },
      });
      if (!root) throw notFound('Jurisdiction');
      for (const id of [q.districtId, q.coDistrictId])
        if (id && !scope.all && !scope.jurisdictionIds.has(id)) throw notFound('Jurisdiction');
      const alertScope = await this.authz.scopeFor(tx, auth.userId, 'alert.view');
      return this.dashboard(tx, scope, alertScope, q, root);
    });
  }

  jurisdiction(auth: AuthContext, id: string, q: DashboardQuery) {
    return this.run(auth, async (tx) => {
      const scope = await this.authz.requireScope(tx, auth.userId, 'report.view');
      const node = await this.node(tx, scope, id);
      const alertScope = await this.authz.scopeFor(tx, auth.userId, 'alert.view');
      return this.dashboard(
        tx,
        scope,
        alertScope,
        { ...q, districtId: undefined, coDistrictId: undefined },
        node,
      );
    });
  }

  schemes(auth: AuthContext, q: SchemeListQuery) {
    return this.run(auth, async (tx) => {
      const scope = await this.authz.requireScope(tx, auth.userId, 'report.view');
      if (q.jurisdictionId) await this.node(tx, scope, q.jurisdictionId);
      const alertScope = await this.authz.scopeFor(tx, auth.userId, 'alert.view');
      const { f } = await this.filter(tx, scope, alertScope, q, q.jurisdictionId);
      return this.schemeList(tx, f, {
        delayedOnly: q.delayedOnly,
        page: q.page,
        pageSize: q.pageSize,
      });
    });
  }

  scheme(auth: AuthContext, id: string, q: DashboardQuery) {
    return this.run(auth, async (tx) => {
      const scope = await this.authz.requireScope(tx, auth.userId, 'report.view');
      const s = await tx.scheme.findUnique({
        where: { id },
        include: {
          jurisdiction: { select: { id: true, code: true, name: true, ancestry: true } },
          agency: { select: { id: true, code: true, name: true } },
          financialYear: { select: { id: true, code: true } },
          budgetVersions: { orderBy: { versionNumber: 'asc' } },
        },
      });
      if (!s || !this.authz.schemeInScope(scope, s)) throw notFound('Scheme');
      const { cutoff, period } = await this.cutoff(tx, q.periodId);
      const alertScope = await this.authz.scopeFor(tx, auth.userId, 'alert.view');
      const [row] = await tx.$queryRaw<SchemeRow[]>(
        withMetrics(
          { scope, alertScope, schemeId: id, cutoff },
          Prisma.sql`SELECT ${SCHEME_COLUMNS} FROM m`,
        ),
      );
      const canSeeAlerts = !!alertScope && this.authz.schemeInScope(alertScope, s);
      const [alerts, decisions, timeline] = await Promise.all([
        canSeeAlerts
          ? tx.alert.findMany({
              where: { schemeId: id },
              orderBy: { detectedAt: 'desc' },
              take: 20,
            })
          : Promise.resolve([]),
        tx.$queryRaw<
          {
            entity_type: string;
            entity_id: string;
            step: string;
            decision: string;
            reason: string | null;
            decided_at: Date;
            actor: string;
          }[]
        >`
          SELECT wi.entity_type, wi.entity_id, ad.step, ad.decision, ad.reason, ad.decided_at, u.name AS actor
          FROM approval_decisions ad
          JOIN workflow_instances wi ON wi.id = ad.workflow_instance_id
          JOIN users u ON u.id = ad.actor_id
          WHERE wi.entity_id IN (
            SELECT id FROM fund_releases WHERE scheme_id = ${id}::uuid
            UNION ALL SELECT id FROM expenditure_records WHERE scheme_id = ${id}::uuid
            UNION ALL SELECT id FROM progress_submissions WHERE scheme_id = ${id}::uuid)
          ORDER BY ad.decided_at DESC LIMIT 50`,
        tx.progressSubmission.findMany({
          where: { schemeId: id },
          include: { period: { select: { code: true } } },
          orderBy: [{ period: { startDate: 'asc' } }, { submissionVersion: 'asc' }],
        }),
      ]);
      return {
        scheme: {
          id: s.id,
          schemeCode: s.schemeCode,
          name: s.name,
          category: s.category,
          status: s.status,
          department: s.department,
          jurisdiction: {
            id: s.jurisdiction.id,
            code: s.jurisdiction.code,
            name: s.jurisdiction.name,
          },
          drillPath: s.jurisdiction.ancestry,
          agency: s.agency,
          financialYear: s.financialYear,
          startDate: s.startDate,
          targetEndDate: s.targetEndDate,
        },
        filters: { period },
        basis: BASIS,
        currency: 'INR',
        generatedAt: new Date().toISOString(),
        metrics: row ? schemeView(row) : null,
        budgetVersions: s.budgetVersions.map((v) => ({
          versionNumber: v.versionNumber,
          status: v.status,
          totalAmount: v.totalAmount.toFixed(2),
          revisionReason: v.revisionReason,
          approvedAt: v.approvedAt,
        })),
        progressTimeline: timeline.map((t) => ({
          id: t.id,
          period: t.period.code,
          version: t.submissionVersion,
          status: t.status,
          submittedAt: t.submittedAt,
          verifiedAt: t.verifiedAt,
        })),
        approvalHistory: decisions,
        alertsVisible: canSeeAlerts,
        alerts: alerts.map((a) => ({
          id: a.id,
          ruleCode: a.ruleCode,
          severity: a.severity,
          status: a.status,
          detectedAt: a.detectedAt,
        })),
      };
    });
  }

  /** Default period: latest whose submission due date has passed. */
  private async completeness(tx: Prisma.TransactionClient, f: MetricsFilter, periodId?: string) {
    const p = periodId
      ? await tx.reportingPeriod.findUnique({ where: { id: periodId } })
      : await tx.reportingPeriod.findFirst({
          where: {
            submissionDueAt: { lte: new Date() },
            ...(f.financialYearId && { financialYearId: f.financialYearId }),
          },
          orderBy: { endDate: 'desc' },
        });
    if (!p) return { period: null, expected: 0, submitted: 0, percent: null };
    const sub = Prisma.sql`
      FROM schemes sc JOIN jurisdictions j ON j.id = sc.jurisdiction_id
      WHERE sc.status IN ('APPROVED', 'ACTIVE') AND ${scopeSql(f.scope)}
        ${f.subtreeOf ? Prisma.sql`AND (sc.jurisdiction_id = ${f.subtreeOf}::uuid OR ${f.subtreeOf}::uuid = ANY(j.ancestry))` : Prisma.empty}
        ${f.financialYearId ? Prisma.sql`AND sc.financial_year_id = ${f.financialYearId}::uuid` : Prisma.empty}
        ${f.category ? Prisma.sql`AND sc.category = ${f.category}` : Prisma.empty}
        ${f.department ? Prisma.sql`AND sc.department = ${f.department}` : Prisma.empty}
        ${f.agencyId ? Prisma.sql`AND sc.agency_id = ${f.agencyId}::uuid` : Prisma.empty}`;
    const [r] = await tx.$queryRaw<{ expected: number; submitted: number }[]>`
      SELECT COUNT(*)::int AS expected,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM progress_submissions ps
          WHERE ps.scheme_id = sc.id AND ps.period_id = ${p.id}::uuid AND ps.status <> 'DRAFT'))::int AS submitted
      ${sub}`;
    return {
      period: { id: p.id, code: p.code, dueAt: p.submissionDueAt },
      expected: r.expected,
      submitted: r.submitted,
      percent: percent(
        new Prisma.Decimal(r.submitted),
        r.expected ? new Prisma.Decimal(r.expected) : null,
      ),
    };
  }

  reportingCompleteness(auth: AuthContext, q: DashboardQuery) {
    return this.run(auth, async (tx) => {
      const scope = await this.authz.requireScope(tx, auth.userId, 'report.view');
      const { f } = await this.filter(tx, scope, null, q);
      return this.completeness(tx, f, q.periodId);
    });
  }

  filterOptions(auth: AuthContext) {
    return this.run(auth, async (tx) => {
      const scope = await this.authz.requireScope(tx, auth.userId, 'report.view');
      const rows = await tx.scheme.findMany({
        where: this.authz.schemeWhere(scope),
        select: { category: true, department: true },
        distinct: ['category', 'department'],
      });
      const uniq = (v: (string | null)[]) => [...new Set(v.filter((x): x is string => !!x))].sort();
      return {
        categories: uniq(rows.map((r) => r.category)),
        departments: uniq(rows.map((r) => r.department)),
      };
    });
  }

  kpiDefinitions() {
    return { items: KPI_DEFINITIONS };
  }
}
