import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthContext } from '../auth/auth-context';
import { AuthorizationService, notFound, type ScopeFilter } from '../authz/authorization.service';
import { mapDbError } from '../common/db-errors';
import { audit, badRequest } from '../common/http';
import { kpis, schemeView } from '../dashboards/dashboards.service';
import {
  AGGREGATES,
  type AggregateRow,
  type MetricsFilter,
  SCHEME_COLUMNS,
  type SchemeRow,
  withMetrics,
} from '../dashboards/kpi.sql';
import { PrismaService } from '../prisma/prisma.service';
import { REPORT_BY_CODE, REPORTS, type ReportDefinition } from './definitions';
import { type Cell, type ReportOutput, toCsv, toXlsx } from './export';
import type { ReportQuery } from './dto';

type Tx = Prisma.TransactionClient;
type Row = Record<string, Cell>;

export const BASIS =
  'Verified records only; a verified correction replaces the record it supersedes. Reported expenditure = verified + submitted. ' +
  'Physical progress is per scheme and counted in bands; no statewide average. Zero denominators are shown as N/A.';
const NOTICE = 'Synthetic demonstration data. Not official government figures.';
const PREVIEW_ROWS = 200;
const MAX_ROWS = 10_000;
const ACTIVE_ALERT = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS'];
const OPEN_ACTION = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'REOPENED'];

const forbidden = (message: string) => new ForbiddenException({ error: 'FORBIDDEN', message });

function kpiRow(a: AggregateRow): Row {
  const k = kpis(a);
  return {
    schemeCount: k.schemeCount,
    approvedBudget: k.approvedBudget,
    allocatedBudget: k.allocatedBudget,
    verifiedReleases: k.verifiedReleases,
    verifiedExpenditure: k.verifiedExpenditure,
    reportedExpenditure: k.reportedExpenditure,
    financialUtilisationPercent: k.financialUtilisationPercent,
    releaseUtilisationPercent: k.releaseUtilisationPercent,
    budgetRemaining: k.budgetRemaining,
    unreleasedAllocation: k.unreleasedAllocation,
    unspentReleasedFunds: k.unspentReleasedFunds,
    bandNotAvailable: k.progressBands.notAvailable,
    band0to25: k.progressBands['0-25'],
    band25to50: k.progressBands['25-50'],
    band50to75: k.progressBands['50-75'],
    band75to100: k.progressBands['75-100'],
    band100: k.progressBands['100'],
    delayedSchemes: k.delayedSchemes,
    delayedMilestones: k.delayedMilestones,
    openAlerts: k.openAlerts,
  };
}

interface Ctx {
  tx: Tx;
  auth: AuthContext;
  scope: ScopeFilter;
  q: ReportQuery;
  f: MetricsFilter;
  extra: [string, string][];
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
  ) {}

  private run<T>(auth: AuthContext, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.withTenant(auth.tenantId, fn, { timeout: 60_000 }).catch(mapDbError);
  }

  definitions(auth: AuthContext) {
    return this.run(auth, async (tx) => {
      await this.authz.requireScope(tx, auth.userId, 'report.view');
      const [canExport, alerts, auditScope] = await Promise.all([
        this.authz.scopeFor(tx, auth.userId, 'report.export'),
        this.authz.scopeFor(tx, auth.userId, 'alert.view'),
        this.authz.scopeFor(tx, auth.userId, 'audit.view'),
      ]);
      const allowed = (d: ReportDefinition) =>
        d.extraPermission === 'alert.view'
          ? !!alerts
          : d.extraPermission === 'audit.view'
            ? !!auditScope?.all
            : true;
      return {
        canExport: !!canExport,
        basis: BASIS,
        notice: NOTICE,
        items: REPORTS.filter(allowed).map(({ columns, ...d }) => ({ ...d, columns })),
      };
    });
  }

  /** JSON preview (first rows) for screens; same generator as the export. */
  preview(auth: AuthContext, code: string, q: ReportQuery) {
    return this.run(auth, async (tx) => {
      const out = await this.generate(tx, auth, code, q, 'report.view');
      return {
        code,
        title: out.title,
        meta: out.meta,
        columns: out.columns,
        total: out.rows.length,
        truncated: out.rows.length > PREVIEW_ROWS,
        rows: out.rows.slice(0, PREVIEW_ROWS),
      };
    });
  }

  async export(
    auth: AuthContext,
    code: string,
    q: ReportQuery,
    format: 'csv' | 'xlsx',
    requestId?: string,
  ) {
    const started = Date.now();
    return this.run(auth, async (tx) => {
      const out = await this.generate(tx, auth, code, q, 'report.export');
      const body = format === 'csv' ? toCsv(out) : await toXlsx(out);
      const scopeSummary = out.meta.find(([k]) => k === 'Jurisdiction scope')?.[1] ?? '';
      const params = { ...q } as Record<string, unknown>;
      const exec = await tx.reportExecution.create({
        data: {
          tenantId: auth.tenantId,
          reportCode: code,
          format: format.toUpperCase(),
          paramsJson: params as Prisma.InputJsonValue,
          rowCount: out.rows.length,
          scopeSummary: scopeSummary.slice(0, 500),
          durationMs: Date.now() - started,
          generatedBy: auth.userId,
        },
      });
      await audit(tx, auth, requestId, {
        action: 'REPORT_EXPORTED',
        entityType: 'report_execution',
        entityId: exec.id,
        after: { reportCode: code, format, rows: out.rows.length, params },
      });
      const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
      return {
        body,
        filename: `dcp-pulse_${code}_${stamp}.${format}`,
        contentType:
          format === 'csv'
            ? 'text/csv; charset=utf-8'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        rows: out.rows.length,
      };
    });
  }

  executions(auth: AuthContext) {
    return this.run(auth, async (tx) => {
      const own = await this.authz.scopeFor(tx, auth.userId, 'audit.view');
      if (!own) await this.authz.requireScope(tx, auth.userId, 'report.export');
      const rows = await tx.reportExecution.findMany({
        where: own?.all ? {} : { generatedBy: auth.userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      const users = await tx.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.generatedBy))] } },
        select: { id: true, name: true },
      });
      const names = new Map(users.map((u) => [u.id, u.name]));
      return rows.map((r) => ({ ...r, generatedByName: names.get(r.generatedBy) ?? null }));
    });
  }

  // ------------------------------------------------------------------ generation

  private async generate(
    tx: Tx,
    auth: AuthContext,
    code: string,
    q: ReportQuery,
    permission: 'report.view' | 'report.export',
  ): Promise<ReportOutput> {
    const def = REPORT_BY_CODE.get(code);
    if (!def) throw notFound('Report');
    const scope = await this.authz.requireScope(tx, auth.userId, permission);
    if (def.extraPermission === 'alert.view')
      await this.authz.requireScope(tx, auth.userId, 'alert.view');
    if (def.extraPermission === 'audit.view') {
      const a = await this.authz.requireScope(tx, auth.userId, 'audit.view');
      if (!a.all || !scope.all)
        throw forbidden('The audit activity report needs tenant-wide audit access.');
    }
    if (
      q.jurisdictionId &&
      !this.authz.jurisdictionInScope(scope, q.jurisdictionId) &&
      !scope.all
    ) {
      // A user may report on a jurisdiction above their grant only if it is inside their tree.
      throw notFound('Jurisdiction');
    }
    let cutoff: Date | null = null;
    let periodLabel = 'Latest data (no period cutoff)';
    if (q.periodId) {
      const p = await tx.reportingPeriod.findUnique({ where: { id: q.periodId } });
      if (!p) throw badRequest('INVALID_PERIOD', 'Unknown reporting period.');
      cutoff = p.endDate;
      periodLabel = `${p.code} (cumulative to ${p.endDate.toISOString().slice(0, 10)})`;
    }
    const f: MetricsFilter = {
      scope,
      subtreeOf: q.jurisdictionId,
      financialYearId: q.financialYearId,
      category: q.category,
      cutoff,
    };
    const ctx: Ctx = { tx, auth, scope, q, f, extra: [] };
    const rows = await this.rows(def, ctx);
    if (rows.length > MAX_ROWS)
      throw badRequest('REPORT_TOO_LARGE', `More than ${MAX_ROWS} rows; narrow the filters.`);
    const meta = await this.meta(ctx, def, periodLabel, rows.length);
    return { title: def.title, meta: [...meta, ...ctx.extra], columns: def.columns, rows };
  }

  private async meta(
    ctx: Ctx,
    def: ReportDefinition,
    period: string,
    count: number,
  ): Promise<[string, string][]> {
    const { tx, auth, scope, q } = ctx;
    const [tenant, user, fy, jur, cat] = await Promise.all([
      tx.tenant.findUnique({ where: { id: auth.tenantId }, select: { name: true, code: true } }),
      tx.user.findUnique({ where: { id: auth.userId }, select: { name: true } }),
      q.financialYearId ? tx.financialYear.findUnique({ where: { id: q.financialYearId } }) : null,
      q.jurisdictionId ? tx.jurisdiction.findUnique({ where: { id: q.jurisdictionId } }) : null,
      Promise.resolve(q.category ?? null),
    ]);
    let scopeText = 'Tenant-wide';
    if (!scope.all) {
      const js = await tx.jurisdiction.findMany({
        where: { id: { in: [...scope.jurisdictionIds] } },
        select: { id: true, name: true, parentId: true },
      });
      const top = js
        .filter((j) => !j.parentId || !scope.jurisdictionIds.has(j.parentId))
        .map((j) => j.name);
      const parts = [top.length ? `Jurisdictions: ${top.sort().join(', ')}` : null];
      if (scope.agencyIds.size) parts.push(`${scope.agencyIds.size} agency grant(s)`);
      if (scope.schemeIds.size) parts.push(`${scope.schemeIds.size} scheme grant(s)`);
      scopeText = `Restricted — ${parts.filter(Boolean).join('; ') || 'no jurisdictions'}`;
    }
    return [
      ['Report', def.title],
      ['Tenant', tenant ? `${tenant.name} (${tenant.code})` : auth.tenantId],
      ['Jurisdiction scope', scopeText],
      [
        'Jurisdiction filter',
        jur ? `${jur.name} (${jur.code}) and descendants` : 'All within scope',
      ],
      ['Financial year', fy ? fy.code : 'All'],
      ['Reporting period', period],
      ['Scheme category', cat ?? 'All'],
      ['Generated at', new Date().toISOString()],
      ['Generated by', user?.name ?? auth.userId],
      ['Rows', String(count)],
      ['Verification basis', BASIS],
      ['Notice', NOTICE],
    ];
  }

  private async rows(def: ReportDefinition, ctx: Ctx): Promise<Row[]> {
    switch (def.code) {
      case 'state-summary':
        return this.stateSummary(ctx);
      case 'district-progress':
        return this.districtProgress(ctx);
      case 'budget-vs-expenditure':
      case 'release-utilisation':
        return this.schemeRows(ctx, false);
      case 'delayed-schemes':
        return this.schemeRows(ctx, true);
      case 'pending-approvals':
        return this.pending(ctx);
      case 'alert-status':
        return this.alerts(ctx);
      case 'reporting-completeness':
        return this.completeness(ctx);
      case 'scheme-history':
        return this.history(ctx);
      case 'audit-activity':
        return this.auditActivity(ctx);
      default:
        throw notFound('Report');
    }
  }

  private async stateSummary({ tx, f }: Ctx): Promise<Row[]> {
    const [a] = await tx.$queryRaw<AggregateRow[]>(
      withMetrics(f, Prisma.sql`SELECT ${AGGREGATES} FROM m`),
    );
    return [{ level: 'All schemes in scope', ...kpiRow(a) }];
  }

  private async districtProgress({ tx, f, q, scope }: Ctx): Promise<Row[]> {
    const node = q.jurisdictionId
      ? await tx.jurisdiction.findUnique({ where: { id: q.jurisdictionId } })
      : await tx.jurisdiction.findFirst({ where: { parentId: null }, orderBy: { code: 'asc' } });
    if (!node) throw notFound('Jurisdiction');
    const rows = await tx.$queryRaw<(AggregateRow & { jid: string })[]>(
      withMetrics(
        f,
        Prisma.sql`, kids AS (SELECT id FROM jurisdictions WHERE parent_id = ${node.id}::uuid)
        SELECT k.id AS jid, ${AGGREGATES}
        FROM m JOIN kids k ON k.id = m.jurisdiction_id OR k.id = ANY(m.ancestry)
        GROUP BY k.id`,
      ),
    );
    const kids = await tx.jurisdiction.findMany({
      where: { parentId: node.id },
      orderBy: { code: 'asc' },
    });
    const byId = new Map(rows.map((r) => [r.jid, r]));
    return kids
      .filter((k) => byId.has(k.id) || this.authz.jurisdictionInScope(scope, k.id))
      .map((k) => {
        const r = byId.get(k.id);
        return {
          jurisdictionCode: k.code,
          jurisdiction: k.name,
          ...(r ? kpiRow(r) : { schemeCount: 0 }),
        };
      });
  }

  private async schemeRows({ tx, f }: Ctx, delayedOnly: boolean): Promise<Row[]> {
    const cond = delayedOnly ? Prisma.sql`WHERE m.delayed` : Prisma.empty;
    const rows = await tx.$queryRaw<SchemeRow[]>(
      withMetrics(
        f,
        Prisma.sql`SELECT ${SCHEME_COLUMNS} FROM m ${cond} ORDER BY m.scheme_code LIMIT ${MAX_ROWS + 1}`,
      ),
    );
    const names = await this.jurisdictionNames(
      tx,
      rows.map((r) => r.jurisdiction_id),
    );
    return rows.map((r) => {
      const v = schemeView(r);
      const approved = v.approvedBudget === null ? null : new Prisma.Decimal(v.approvedBudget);
      const released = new Prisma.Decimal(v.verifiedReleases);
      const spent = new Prisma.Decimal(v.verifiedExpenditure);
      return {
        schemeCode: v.schemeCode,
        schemeName: v.name,
        jurisdiction: names.get(v.jurisdictionId) ?? '',
        category: v.category,
        status: v.status,
        approvedBudget: v.approvedBudget,
        allocatedBudget: v.allocatedBudget,
        verifiedReleases: v.verifiedReleases,
        verifiedExpenditure: v.verifiedExpenditure,
        reportedExpenditure: v.reportedExpenditure,
        budgetRemaining: approved ? approved.sub(spent).toFixed(2) : null,
        unreleasedAllocation: new Prisma.Decimal(v.allocatedBudget).sub(released).toFixed(2),
        unspentReleasedFunds: released.sub(spent).toFixed(2),
        financialUtilisationPercent: v.financialUtilisationPercent,
        releaseUtilisationPercent: v.releaseUtilisationPercent,
        physicalCompletionPercent: v.physicalCompletionPercent,
        plannedProgressPercent: v.plannedProgressPercent,
        scheduleVariancePoints: v.scheduleVariancePoints,
        milestones: v.milestones,
        milestonesDelayed: v.milestonesDelayed,
        targetEndDate: v.targetEndDate,
        lastVerifiedPeriod: v.lastVerifiedPeriod,
        pendingFinancialVerification: v.pendingFinancialVerification,
      };
    });
  }

  private async jurisdictionNames(tx: Tx, ids: string[]) {
    const js = await tx.jurisdiction.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, name: true },
    });
    return new Map(js.map((j) => [j.id, j.name]));
  }

  /** Prisma scheme filter equivalent to the metrics filter (scope + jurisdiction subtree + FY + category). */
  private schemeWhere({ scope, q }: Ctx): Prisma.SchemeWhereInput {
    const and: Prisma.SchemeWhereInput[] = [this.authz.schemeWhere(scope)];
    if (q.jurisdictionId)
      and.push({
        OR: [
          { jurisdictionId: q.jurisdictionId },
          { jurisdiction: { ancestry: { has: q.jurisdictionId } } },
        ],
      });
    if (q.financialYearId) and.push({ financialYearId: q.financialYearId });
    if (q.category) and.push({ category: q.category });
    return { AND: and };
  }

  private async pending(ctx: Ctx): Promise<Row[]> {
    const { tx } = ctx;
    const scheme = this.schemeWhere(ctx);
    const sel = { schemeCode: true, name: true, jurisdiction: { select: { name: true } } } as const;
    const [schemes, releases, spend, progress] = await Promise.all([
      tx.scheme.findMany({
        where: { AND: [scheme, { status: 'SUBMITTED' }] },
        include: { jurisdiction: { select: { name: true } } },
      }),
      tx.fundRelease.findMany({
        where: { verificationStatus: 'PENDING', scheme },
        include: { scheme: { select: sel } },
      }),
      tx.expenditureRecord.findMany({
        where: { status: 'SUBMITTED', scheme },
        include: {
          scheme: { select: sel },
          period: { select: { code: true } },
          submittedBy: { select: { name: true } },
        },
      }),
      tx.progressSubmission.findMany({
        where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'RESUBMITTED'] }, scheme },
        include: {
          scheme: { select: sel },
          period: { select: { code: true } },
          submittedBy: { select: { name: true } },
        },
      }),
    ]);
    const creators = await tx.user.findMany({
      where: {
        id: {
          in: [...releases.map((r) => r.createdBy), ...schemes.map((s) => s.submittedById)].filter(
            (x): x is string => !!x,
          ),
        },
      },
      select: { id: true, name: true },
    });
    const who = new Map(creators.map((u) => [u.id, u.name]));
    const now = Date.now();
    const age = (d: Date | null) => (d ? Math.floor((now - d.getTime()) / 86_400_000) : null);
    const rows: Row[] = [
      ...schemes.map((s) => ({
        itemType: 'Scheme approval',
        schemeCode: s.schemeCode,
        schemeName: s.name,
        jurisdiction: s.jurisdiction.name,
        period: null,
        amount: null,
        status: s.status,
        submittedBy: who.get(s.submittedById ?? '') ?? null,
        submittedAt: s.submittedAt,
        ageDays: age(s.submittedAt),
      })),
      ...releases.map((r) => ({
        itemType: 'Fund release verification',
        schemeCode: r.scheme.schemeCode,
        schemeName: r.scheme.name,
        jurisdiction: r.scheme.jurisdiction.name,
        period: null,
        amount: r.amount.toFixed(2),
        status: r.verificationStatus,
        submittedBy: who.get(r.createdBy ?? '') ?? null,
        submittedAt: r.createdAt,
        ageDays: age(r.createdAt),
      })),
      ...spend.map((e) => ({
        itemType: 'Expenditure verification',
        schemeCode: e.scheme.schemeCode,
        schemeName: e.scheme.name,
        jurisdiction: e.scheme.jurisdiction.name,
        period: e.period.code,
        amount: e.amount.toFixed(2),
        status: e.status,
        submittedBy: e.submittedBy?.name ?? null,
        submittedAt: e.createdAt,
        ageDays: age(e.createdAt),
      })),
      ...progress.map((p) => ({
        itemType: 'Progress verification',
        schemeCode: p.scheme.schemeCode,
        schemeName: p.scheme.name,
        jurisdiction: p.scheme.jurisdiction.name,
        period: p.period.code,
        amount: null,
        status: p.status,
        submittedBy: p.submittedBy?.name ?? null,
        submittedAt: p.submittedAt,
        ageDays: age(p.submittedAt),
      })),
    ];
    return rows.sort((a, b) => ((b.ageDays as number) ?? -1) - ((a.ageDays as number) ?? -1));
  }

  private async alerts(ctx: Ctx): Promise<Row[]> {
    const { tx, scope } = ctx;
    const filtered = !!(ctx.q.jurisdictionId || ctx.q.financialYearId || ctx.q.category);
    const where: Prisma.AlertWhereInput =
      scope.all && !filtered ? {} : { scheme: this.schemeWhere(ctx) };
    const rows = await tx.alert.findMany({
      where,
      include: {
        scheme: { select: { schemeCode: true, jurisdiction: { select: { name: true } } } },
        assignee: { select: { name: true } },
        correctiveActions: { select: { status: true, dueAt: true } },
      },
      orderBy: [{ detectedAt: 'desc' }],
      take: MAX_ROWS + 1,
    });
    const now = new Date();
    const active = rows.filter((a) => ACTIVE_ALERT.includes(a.status)).length;
    ctx.extra.push(
      ['Active alerts', String(active)],
      [
        'Alert interpretation',
        'Review indicators flag records for review and are not evidence of misuse.',
      ],
    );
    return rows.map((a) => {
      const open = a.correctiveActions.filter((c) => OPEN_ACTION.includes(c.status));
      return {
        ruleCode: a.ruleCode,
        alertType: a.reviewIndicator ? 'Review indicator' : 'Control breach',
        severity: a.severity,
        status: a.status,
        schemeCode: a.scheme?.schemeCode ?? 'Tenant-level',
        jurisdiction: a.scheme?.jurisdiction.name ?? null,
        assignee: a.assignee?.name ?? null,
        escalationLevel: a.escalationLevel,
        detectedAt: a.detectedAt,
        dueAt: a.dueAt,
        actionsTotal: a.correctiveActions.length,
        actionsOpen: open.length,
        actionsOverdue: open.filter((c) => c.dueAt && c.dueAt < now).length,
        actionsClosed: a.correctiveActions.filter((c) => c.status === 'CLOSED').length,
      };
    });
  }

  private async completeness(ctx: Ctx): Promise<Row[]> {
    const { tx, q } = ctx;
    const p = q.periodId
      ? await tx.reportingPeriod.findUnique({ where: { id: q.periodId } })
      : await tx.reportingPeriod.findFirst({
          where: {
            submissionDueAt: { lte: new Date() },
            ...(q.financialYearId && { financialYearId: q.financialYearId }),
          },
          orderBy: { endDate: 'desc' },
        });
    if (!p) {
      ctx.extra.push(['Completeness', 'No reporting period is due yet']);
      return [];
    }
    const schemes = await tx.scheme.findMany({
      where: { AND: [this.schemeWhere(ctx), { status: { in: ['APPROVED', 'ACTIVE'] } }] },
      include: {
        jurisdiction: { select: { name: true } },
        progressSubmissions: {
          where: { periodId: p.id },
          orderBy: { submissionVersion: 'desc' },
          take: 1,
        },
      },
      orderBy: { schemeCode: 'asc' },
    });
    const submitted = schemes.filter(
      (s) => s.progressSubmissions[0] && s.progressSubmissions[0].status !== 'DRAFT',
    ).length;
    ctx.extra.push([
      'Completeness',
      `${submitted} of ${schemes.length} schemes submitted for ${p.code} (due ${p.submissionDueAt.toISOString().slice(0, 10)})` +
        (schemes.length ? ` = ${((submitted * 100) / schemes.length).toFixed(2)}%` : ' = N/A'),
    ]);
    return schemes.map((s) => {
      const sub = s.progressSubmissions[0];
      return {
        schemeCode: s.schemeCode,
        schemeName: s.name,
        jurisdiction: s.jurisdiction.name,
        category: s.category,
        status: s.status,
        period: p.code,
        submissionStatus: sub
          ? sub.status === 'DRAFT'
            ? 'DRAFT (not submitted)'
            : sub.status
          : 'NOT SUBMITTED',
        submittedAt: sub?.submittedAt ?? null,
        verifiedAt: sub?.verifiedAt ?? null,
      };
    });
  }

  private async history(ctx: Ctx): Promise<Row[]> {
    const { tx, scope, q } = ctx;
    if (!q.schemeId)
      throw badRequest('SCHEME_REQUIRED', 'Choose a scheme for the scheme history report.');
    const s = await tx.scheme.findUnique({ where: { id: q.schemeId } });
    if (!s || !this.authz.schemeInScope(scope, s)) throw notFound('Scheme');
    ctx.extra.push(['Scheme', `${s.schemeCode} — ${s.name}`]);
    const rows = await tx.$queryRaw<
      {
        at: Date;
        source: string;
        entity_type: string;
        action: string;
        actor: string | null;
        reason: string | null;
      }[]
    >`
      WITH ids AS (
        SELECT ${s.id}::uuid AS id
        UNION ALL SELECT id FROM fund_releases WHERE scheme_id = ${s.id}::uuid
        UNION ALL SELECT id FROM expenditure_records WHERE scheme_id = ${s.id}::uuid
        UNION ALL SELECT id FROM progress_submissions WHERE scheme_id = ${s.id}::uuid
        UNION ALL SELECT id FROM budget_allocations WHERE scheme_id = ${s.id}::uuid
        UNION ALL SELECT id FROM alerts WHERE scheme_id = ${s.id}::uuid
        UNION ALL SELECT id FROM corrective_actions WHERE scheme_id = ${s.id}::uuid)
      SELECT ae.created_at AS at, 'Audit' AS source, ae.entity_type, ae.action, u.name AS actor, ae.reason
      FROM audit_events ae LEFT JOIN users u ON u.id = ae.actor_id
      WHERE ae.entity_id IN (SELECT id FROM ids)
      UNION ALL
      SELECT ad.decided_at, 'Approval', wi.entity_type, ad.step || ': ' || ad.decision, u.name, ad.reason
      FROM approval_decisions ad JOIN workflow_instances wi ON wi.id = ad.workflow_instance_id
      LEFT JOIN users u ON u.id = ad.actor_id
      WHERE wi.entity_id IN (SELECT id FROM ids)
      ORDER BY 1 DESC
      LIMIT ${MAX_ROWS + 1}`;
    return rows.map((r) => ({
      at: r.at,
      source: r.source,
      entityType: r.entity_type,
      action: r.action,
      actor: r.actor,
      reason: r.reason,
    }));
  }

  private async auditActivity({ tx, q }: Ctx): Promise<Row[]> {
    const to = q.to ? new Date(`${q.to.slice(0, 10)}T23:59:59.999Z`) : new Date();
    const from = q.from
      ? new Date(`${q.from.slice(0, 10)}T00:00:00Z`)
      : new Date(to.getTime() - 30 * 86_400_000);
    if (from > to)
      throw badRequest('INVALID_RANGE', 'The from date must be on or before the to date.');
    const rows = await tx.auditEvent.findMany({
      where: { createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS + 1,
    });
    const users = await tx.user.findMany({
      where: {
        id: { in: [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))] },
      },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({
      at: r.createdAt,
      actor: r.actorId ? (names.get(r.actorId) ?? r.actorId) : 'System',
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      reason: r.reason,
      requestId: r.requestId,
    }));
  }
}
