import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ScopeFilter } from '../authz/authorization.service';
import { SCHEME_COLUMNS, type SchemeRow, withMetrics } from '../dashboards/kpi.sql';
import { PrismaService } from '../prisma/prisma.service';
import {
  FREQUENCY_MS,
  MAX_ESCALATION,
  pickRule,
  REVIEW_INDICATOR,
  RULE_CODES,
  type RuleCode,
  type RuleRow,
  schemeFinding,
  SLA_DAYS,
  type Finding,
} from './rules';

const ALL: ScopeFilter = {
  all: true,
  jurisdictionIds: new Set(),
  agencyIds: new Set(),
  schemeIds: new Set(),
};
const ACTIVE_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS'];
const LIVE_SCHEME = new Set(['APPROVED', 'ACTIVE', 'SUSPENDED']);
const DAY = 86_400_000;

export interface EvaluationSummary {
  tenantId: string;
  trigger: 'SCHEDULED' | 'MANUAL' | 'EVENT';
  skipped?: 'LOCKED';
  rulesEvaluated: string[];
  schemesEvaluated: number;
  detected: number;
  created: number;
  reopened: number;
  autoResolved: number;
  escalated: number;
  evaluatedAt: string;
}

type Facts = SchemeRow & {
  agency_id: string;
  ancestry: string[];
  start_date: Date | null;
  last_verified_at: Date | null;
};
interface Detection extends Finding {
  ruleCode: RuleCode;
  rule: RuleRow;
  schemeId: string;
}

/**
 * Evaluates the eight §10 rules inside one tenant transaction guarded by an advisory lock,
 * so concurrent runs (several API instances, scheduler + manual) never double-insert.
 * Deduplication relies on the (tenant_id, dedup_key) unique key.
 */
@Injectable()
export class AlertEngineService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AlertEngineService.name);
  private timer?: NodeJS.Timeout;
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private readonly inflight = new Set<Promise<unknown>>();
  private stopping = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const minutes = Number(process.env.ALERT_EVALUATION_INTERVAL_MINUTES ?? 15);
    if (!Number.isFinite(minutes) || minutes <= 0 || process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), minutes * 60_000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
    await Promise.allSettled([...this.inflight]);
  }

  /** Scheduler tick: every active tenant, only rules whose frequency is due. */
  async tick() {
    try {
      const tenants = await this.prisma.$queryRaw<
        { id: string }[]
      >`SELECT id FROM app_active_tenant_ids() AS id`;
      for (const t of tenants) {
        if (this.stopping) return;
        const run = this.evaluate(t.id, { trigger: 'SCHEDULED' });
        this.inflight.add(run);
        await run.finally(() => this.inflight.delete(run));
      }
    } catch (e) {
      this.log.error(`Scheduled alert evaluation failed: ${(e as Error).message}`);
    }
  }

  /** Debounced event-triggered evaluation of one scheme after a verified change. */
  schemeChanged(tenantId: string, schemeId: string | null | undefined) {
    if (!schemeId) return;
    const key = `${tenantId}:${schemeId}`;
    clearTimeout(this.pending.get(key));
    const t = setTimeout(
      () => {
        this.pending.delete(key);
        if (this.stopping) return;
        const run = this.evaluate(tenantId, { trigger: 'EVENT', schemeId })
          .catch((e: Error) =>
            this.log.error(`Event alert evaluation failed for ${schemeId}: ${e.message}`),
          )
          .finally(() => this.inflight.delete(run));
        this.inflight.add(run);
      },
      Number(process.env.ALERT_EVENT_DEBOUNCE_MS ?? 500),
    );
    t.unref();
    this.pending.set(key, t);
  }

  /** Passes a write result through and schedules evaluation of its scheme. */
  async after<T>(tenantId: string, result: Promise<T>): Promise<T> {
    const r = await result;
    const schemeId = (r as { schemeId?: unknown } | null)?.schemeId;
    if (typeof schemeId === 'string') this.schemeChanged(tenantId, schemeId);
    return r;
  }

  evaluate(
    tenantId: string,
    opts: { trigger: EvaluationSummary['trigger']; schemeId?: string; now?: Date },
  ): Promise<EvaluationSummary> {
    return this.prisma.withTenant(tenantId, (tx) => this.run(tx, tenantId, opts), {
      timeout: 120_000,
    });
  }

  private async run(
    tx: Prisma.TransactionClient,
    tenantId: string,
    opts: { trigger: EvaluationSummary['trigger']; schemeId?: string; now?: Date },
  ): Promise<EvaluationSummary> {
    const now = opts.now ?? new Date();
    const summary: EvaluationSummary = {
      tenantId,
      trigger: opts.trigger,
      rulesEvaluated: [],
      schemesEvaluated: 0,
      detected: 0,
      created: 0,
      reopened: 0,
      autoResolved: 0,
      escalated: 0,
      evaluatedAt: now.toISOString(),
    };
    const lockKey = `dcp-alert-eval:${tenantId}`;
    if (opts.trigger === 'SCHEDULED') {
      const [l] = await tx.$queryRaw<
        { ok: boolean }[]
      >`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS ok`;
      if (!l.ok) return { ...summary, skipped: 'LOCKED' };
    } else {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text`;
    }

    const today = new Date(now.toISOString().slice(0, 10));
    const rules = (await tx.alertRule.findMany({
      where: {
        status: 'ACTIVE',
        ruleCode: { in: [...RULE_CODES] },
        effectiveFrom: { lte: today },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
      },
    })) as (RuleRow & { ownerRoleCode: string })[];
    const due = (r: RuleRow) => {
      if (opts.trigger !== 'SCHEDULED') return true;
      const ms = FREQUENCY_MS[r.evaluationFrequency];
      return (
        ms != null &&
        (!r.lastEvaluatedAt || now.getTime() - r.lastEvaluatedAt.getTime() >= ms - 60_000)
      );
    };

    const facts = await tx.$queryRaw<Facts[]>(
      withMetrics(
        { scope: ALL, schemeId: opts.schemeId },
        Prisma.sql`SELECT x.*, sc.agency_id::text AS agency_id, j.ancestry::text[] AS ancestry, sc.start_date
          FROM (SELECT ${SCHEME_COLUMNS}, m.last_verified_at FROM m) x
          JOIN schemes sc ON sc.id = x.id JOIN jurisdictions j ON j.id = sc.jurisdiction_id`,
      ),
    );
    summary.schemesEvaluated = facts.length;
    const byId = new Map(facts.map((f) => [f.id, f]));
    // Per scheme and rule: the applicable rule when it is enabled and due (otherwise not evaluated).
    const applicable = new Map<string, RuleRow>();
    const codesRun = new Set<string>();
    for (const f of facts) {
      const s = {
        id: f.id,
        jurisdictionId: f.jurisdiction_id,
        agencyId: f.agency_id,
        ancestry: f.ancestry,
      };
      for (const code of RULE_CODES) {
        const r = pickRule(
          rules.filter((x) => x.ruleCode === code),
          s,
        );
        if (r && r.enabled && due(r)) {
          applicable.set(`${f.id}|${code}`, r);
          codesRun.add(code);
        }
      }
    }
    const ruleFor = (schemeId: string, code: RuleCode) => applicable.get(`${schemeId}|${code}`);
    const th = (r: RuleRow) => r.thresholdJson as Record<string, unknown>;

    const detections: Detection[] = [];
    const push = (schemeId: string, code: RuleCode, f: Finding | null) => {
      const rule = ruleFor(schemeId, code);
      if (f && rule) detections.push({ ...f, ruleCode: code, rule, schemeId });
    };

    for (const f of facts) {
      const sf = {
        schemeCode: f.scheme_code,
        approved: f.approved_budget,
        allocated: f.allocated,
        releases: f.verified_releases,
        expenditure: f.verified_expenditure,
        physical: f.physical,
        finUtil: f.fin_util,
        lastVerifiedAt: f.last_verified_at,
        startDate: f.start_date,
      };
      for (const code of [
        'PHYSICAL_FINANCIAL_GAP',
        'RELEASE_EXCEEDED',
        'ALLOCATION_EXCEEDED',
      ] as const) {
        const r = ruleFor(f.id, code);
        if (r) push(f.id, code, schemeFinding(code, th(r), sf, now));
      }
      const stale = ruleFor(f.id, 'DATA_STALE');
      if (stale && LIVE_SCHEME.has(f.status))
        push(f.id, 'DATA_STALE', schemeFinding('DATA_STALE', th(stale), sf, now));
    }

    const schemeFilter = opts.schemeId
      ? Prisma.sql`AND sc.id = ${opts.schemeId}::uuid`
      : Prisma.empty;
    const live = Prisma.sql`sc.status::text IN ('APPROVED', 'ACTIVE', 'SUSPENDED')`;

    if (codesRun.has('MILESTONE_LATE')) {
      const rows = await tx.$queryRaw<
        {
          id: string;
          scheme_id: string;
          name: string;
          target_date: Date;
          target: string;
          done: string;
          days_late: number;
        }[]
      >`
        WITH vsub AS (
          SELECT ps.id, ps.submission_version, p.start_date FROM progress_submissions ps
          JOIN reporting_periods p ON p.id = ps.period_id WHERE ps.status = 'VERIFIED'),
        qty AS (
          SELECT DISTINCT ON (pm.milestone_id) pm.milestone_id, pm.quantity_completed
          FROM progress_measurements pm JOIN vsub v ON v.id = pm.submission_id
          ORDER BY pm.milestone_id, v.start_date DESC, v.submission_version DESC)
        SELECT ms.id, ms.scheme_id, ms.name, ms.target_date, ms.target_quantity::text AS target,
          COALESCE(q.quantity_completed, 0)::text AS done, (${today}::date - ms.target_date)::int AS days_late
        FROM scheme_milestones ms JOIN schemes sc ON sc.id = ms.scheme_id
        LEFT JOIN qty q ON q.milestone_id = ms.id
        WHERE ${live} AND ms.target_date < ${today}::date
          AND COALESCE(q.quantity_completed, 0) < ms.target_quantity ${schemeFilter}`;
      for (const m of rows) {
        const r = ruleFor(m.scheme_id, 'MILESTONE_LATE');
        if (!r || m.days_late <= Number(th(r).graceDays)) continue;
        push(m.scheme_id, 'MILESTONE_LATE', {
          key: `MILESTONE_LATE:${byId.get(m.scheme_id)?.scheme_code}:${m.id}`,
          context: {
            milestoneId: m.id,
            milestone: m.name,
            targetDate: m.target_date.toISOString().slice(0, 10),
            targetQuantity: m.target,
            verifiedQuantity: m.done,
            daysLate: m.days_late,
            graceDays: th(r).graceDays,
          },
        });
      }
    }

    if (codesRun.has('REPORT_OVERDUE')) {
      const rows = await tx.$queryRaw<{ scheme_id: string; code: string; due: Date }[]>`
        SELECT sc.id AS scheme_id, p.code, p.submission_due_at AS due
        FROM schemes sc JOIN reporting_periods p ON p.financial_year_id = sc.financial_year_id
        WHERE ${live} AND p.submission_due_at < ${now}
          AND (sc.start_date IS NULL OR p.end_date >= sc.start_date)
          AND NOT EXISTS (SELECT 1 FROM progress_submissions ps
            WHERE ps.scheme_id = sc.id AND ps.period_id = p.id AND ps.status <> 'DRAFT') ${schemeFilter}
        ORDER BY sc.id, p.start_date`;
      const missing = new Map<string, { code: string; due: Date }[]>();
      for (const row of rows) {
        const r = ruleFor(row.scheme_id, 'REPORT_OVERDUE');
        if (!r || now.getTime() - row.due.getTime() <= Number(th(r).graceDays) * DAY) continue;
        missing.set(row.scheme_id, [...(missing.get(row.scheme_id) ?? []), row]);
      }
      for (const [schemeId, list] of missing) {
        const r = ruleFor(schemeId, 'REPORT_OVERDUE')!;
        const latest = list[list.length - 1];
        push(schemeId, 'REPORT_OVERDUE', {
          key: `REPORT_OVERDUE:${byId.get(schemeId)?.scheme_code}`,
          context: {
            missingPeriods: list.map((p) => p.code),
            latestMissingPeriod: latest.code,
            latestDueAt: latest.due.toISOString(),
            daysOverdue: Math.floor((now.getTime() - latest.due.getTime()) / DAY),
            graceDays: th(r).graceDays,
          },
        });
      }
    }

    if (codesRun.has('APPROVAL_AGED')) {
      const rows = await tx.$queryRaw<
        { entity: string; id: string; scheme_id: string; since: Date }[]
      >`
        SELECT x.* FROM (
          SELECT 'FUND_RELEASE' AS entity, r.id, r.scheme_id, r.created_at AS since
            FROM fund_releases r WHERE r.verification_status = 'PENDING'
          UNION ALL SELECT 'EXPENDITURE', e.id, e.scheme_id, e.updated_at
            FROM expenditure_records e WHERE e.status = 'SUBMITTED'
          UNION ALL SELECT 'PROGRESS_SUBMISSION', ps.id, ps.scheme_id, COALESCE(ps.submitted_at, ps.updated_at)
            FROM progress_submissions ps WHERE ps.status IN ('SUBMITTED', 'UNDER_REVIEW', 'RESUBMITTED')
        ) x JOIN schemes sc ON sc.id = x.scheme_id WHERE TRUE ${schemeFilter}`;
      for (const row of rows) {
        const r = ruleFor(row.scheme_id, 'APPROVAL_AGED');
        const age = Math.floor((now.getTime() - row.since.getTime()) / DAY);
        if (!r || age <= Number(th(r).maxDaysPending)) continue;
        push(row.scheme_id, 'APPROVAL_AGED', {
          key: `APPROVAL_AGED:${byId.get(row.scheme_id)?.scheme_code}:${row.entity}:${row.id}`,
          context: {
            entityType: row.entity,
            entityId: row.id,
            pendingSince: row.since.toISOString(),
            daysPending: age,
            maxDaysPending: th(r).maxDaysPending,
          },
        });
      }
    }

    if (codesRun.has('EVIDENCE_MISSING')) {
      const rows = await tx.$queryRaw<
        { id: string; scheme_id: string; code: string; status: string }[]
      >`
        SELECT ps.id, ps.scheme_id, p.code, ps.status::text AS status
        FROM progress_submissions ps JOIN reporting_periods p ON p.id = ps.period_id
        JOIN schemes sc ON sc.id = ps.scheme_id
        WHERE ps.status::text IN ('SUBMITTED', 'UNDER_REVIEW', 'RESUBMITTED', 'VERIFIED')
          AND NOT EXISTS (SELECT 1 FROM evidence_files ef WHERE ef.submission_id = ps.id) ${schemeFilter}`;
      for (const row of rows) {
        const r = ruleFor(row.scheme_id, 'EVIDENCE_MISSING');
        if (!r) continue;
        const stage =
          th(r).requiredForStatus === 'VERIFIED'
            ? ['VERIFIED']
            : ['SUBMITTED', 'UNDER_REVIEW', 'RESUBMITTED'];
        if (!stage.includes(row.status)) continue;
        push(row.scheme_id, 'EVIDENCE_MISSING', {
          key: `EVIDENCE_MISSING:${byId.get(row.scheme_id)?.scheme_code}:${row.id}`,
          context: {
            submissionId: row.id,
            period: row.code,
            submissionStatus: row.status,
            note: 'Evidence upload is not implemented in this build; every submission at this stage is flagged.',
          },
        });
      }
    }

    summary.detected = detections.length;
    summary.rulesEvaluated = [...codesRun].sort();
    await this.reconcile(tx, tenantId, detections, applicable, now, summary);
    if (opts.trigger !== 'EVENT') await this.escalate(tx, now, summary);

    const ruleIds = [...new Set([...applicable.values()].map((r) => r.id))];
    // A scheme-scoped (event) run has not evaluated the rule for other schemes.
    if (ruleIds.length && !opts.schemeId)
      await tx.alertRule.updateMany({
        where: { id: { in: ruleIds } },
        data: { lastEvaluatedAt: now },
      });
    return summary;
  }

  private async reconcile(
    tx: Prisma.TransactionClient,
    tenantId: string,
    detections: Detection[],
    applicable: Map<string, RuleRow>,
    now: Date,
    summary: EvaluationSummary,
  ) {
    const schemeIds = [...new Set([...applicable.keys()].map((k) => k.split('|')[0]))];
    const existing = await tx.alert.findMany({
      where: {
        OR: [
          { dedupKey: { in: detections.map((d) => d.key) } },
          { schemeId: { in: schemeIds }, ruleCode: { in: [...RULE_CODES] } },
        ],
      },
    });
    const byKey = new Map(existing.map((a) => [a.dedupKey, a]));
    const event = (
      alertId: string,
      eventType: string,
      fromStatus: string | null,
      toStatus: string | null,
      detail: object,
      note?: string,
    ) =>
      tx.alertEvent.create({
        data: {
          tenantId,
          alertId,
          eventType,
          fromStatus,
          toStatus,
          note,
          detailJson: detail as Prisma.InputJsonValue,
        },
      });
    const dueAt = (sev: string) => new Date(now.getTime() + (SLA_DAYS[sev] ?? 7) * DAY);

    const seen = new Set<string>();
    for (const d of detections) {
      if (seen.has(d.key)) continue;
      seen.add(d.key);
      const ctx = {
        ...d.context,
        threshold: d.rule.thresholdJson,
        ruleId: d.rule.id,
      } as Prisma.InputJsonValue;
      const a = byKey.get(d.key);
      if (!a) {
        const created = await tx.alert.create({
          data: {
            tenantId,
            schemeId: d.schemeId,
            ruleId: d.rule.id,
            ruleCode: d.ruleCode,
            dedupKey: d.key,
            severity: d.rule.severity as never,
            status: 'OPEN',
            detectedAt: now,
            dueAt: dueAt(d.rule.severity),
            contextJson: ctx,
            reviewIndicator: REVIEW_INDICATOR[d.ruleCode],
            lastEvaluatedAt: now,
          },
        });
        await event(created.id, 'DETECTED', null, 'OPEN', d.context);
        summary.created++;
        continue;
      }
      const prev = (a.contextJson ?? {}) as Record<string, unknown>;
      const clearedSinceResolution = a.resolvedBy === null || prev.conditionCleared === true;
      if ((a.status === 'RESOLVED' || a.status === 'CLOSED') && clearedSinceResolution) {
        await tx.alert.update({
          where: { id: a.id },
          data: {
            status: 'OPEN',
            severity: d.rule.severity as never,
            ruleId: d.rule.id,
            contextJson: ctx,
            reviewIndicator: REVIEW_INDICATOR[d.ruleCode],
            detectedAt: now,
            dueAt: dueAt(d.rule.severity),
            escalationLevel: 0,
            acknowledgedAt: null,
            acknowledgedBy: null,
            resolvedAt: null,
            resolvedBy: null,
            resolutionReason: null,
            lastEvaluatedAt: now,
            version: { increment: 1 },
          },
        });
        await event(
          a.id,
          'REOPENED',
          a.status,
          'OPEN',
          d.context,
          'Condition detected again by rule evaluation',
        );
        summary.reopened++;
      } else {
        // Still active, or manually resolved while the condition persists: refresh figures only.
        await tx.alert.update({
          where: { id: a.id },
          data: {
            contextJson: { ...(ctx as object), conditionCleared: false } as Prisma.InputJsonValue,
            ruleId: d.rule.id,
            reviewIndicator: REVIEW_INDICATOR[d.ruleCode],
            lastEvaluatedAt: now,
            ...(ACTIVE_STATUSES.includes(a.status) ? { severity: d.rule.severity as never } : {}),
          },
        });
      }
    }

    for (const a of existing) {
      if (seen.has(a.dedupKey) || !a.schemeId) continue;
      if (!applicable.has(`${a.schemeId}|${a.ruleCode}`)) continue;
      const prev = (a.contextJson ?? {}) as Record<string, unknown>;
      if (ACTIVE_STATUSES.includes(a.status)) {
        await tx.alert.update({
          where: { id: a.id },
          data: {
            status: 'RESOLVED',
            resolvedAt: now,
            resolvedBy: null,
            resolutionReason: 'Condition no longer detected by rule evaluation',
            contextJson: { ...prev, conditionCleared: true } as Prisma.InputJsonValue,
            lastEvaluatedAt: now,
            version: { increment: 1 },
          },
        });
        await event(
          a.id,
          'AUTO_RESOLVED',
          a.status,
          'RESOLVED',
          {},
          'Condition no longer detected',
        );
        summary.autoResolved++;
      } else if (prev.conditionCleared !== true) {
        await tx.alert.update({
          where: { id: a.id },
          data: {
            contextJson: { ...prev, conditionCleared: true } as Prisma.InputJsonValue,
            lastEvaluatedAt: now,
          },
        });
      }
    }
  }

  /** Unacknowledged alerts past their response window escalate one level (max 3). */
  private async escalate(tx: Prisma.TransactionClient, now: Date, summary: EvaluationSummary) {
    const overdue = await tx.alert.findMany({
      where: { status: 'OPEN', dueAt: { lt: now }, escalationLevel: { lt: MAX_ESCALATION } },
    });
    for (const a of overdue) {
      await tx.alert.update({
        where: { id: a.id },
        data: {
          escalationLevel: a.escalationLevel + 1,
          dueAt: new Date(now.getTime() + (SLA_DAYS[a.severity] ?? 7) * DAY),
          version: { increment: 1 },
        },
      });
      await tx.alertEvent.create({
        data: {
          tenantId: a.tenantId,
          alertId: a.id,
          eventType: 'ESCALATED',
          fromStatus: a.status,
          toStatus: a.status,
          note: `Escalated to level ${a.escalationLevel + 1}: not acknowledged within the response window`,
          detailJson: { escalationLevel: a.escalationLevel + 1 },
        },
      });
      summary.escalated++;
    }
  }
}
