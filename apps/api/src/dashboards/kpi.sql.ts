import { Prisma } from '@prisma/client';
import type { ScopeFilter } from '../authz/authorization.service';

/** Schemes counted by monitoring dashboards (post-approval lifecycle). */
export const MONITORED = ['APPROVED', 'ACTIVE', 'SUSPENDED', 'COMPLETED', 'CLOSED'] as const;

export interface MetricsFilter {
  scope: ScopeFilter;
  /** Restrict to a jurisdiction and its descendants. */
  subtreeOf?: string;
  financialYearId?: string;
  category?: string;
  department?: string;
  agencyId?: string;
  schemeId?: string;
  /** Cumulative cut-off (reporting period end date); null = everything recorded so far. */
  cutoff?: Date | null;
}

const uuids = (s: Set<string>) => Prisma.sql`${[...s]}::uuid[]`;

export function scopeSql(f: ScopeFilter): Prisma.Sql {
  if (f.all) return Prisma.sql`TRUE`;
  return Prisma.sql`(sc.jurisdiction_id = ANY(${uuids(f.jurisdictionIds)})
    OR sc.agency_id = ANY(${uuids(f.agencyIds)}) OR sc.id = ANY(${uuids(f.schemeIds)}))`;
}

function where(f: MetricsFilter): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    Prisma.sql`sc.status::text IN (${Prisma.join([...MONITORED])})`,
    scopeSql(f.scope),
  ];
  if (f.subtreeOf)
    parts.push(
      // Semi-join on the (small) jurisdiction subtree keeps row estimates realistic; an OR on
      // j.ancestry made the planner expect one scheme and pick nested loops (seconds at 2,000 schemes).
      Prisma.sql`sc.jurisdiction_id IN (SELECT jx.id FROM jurisdictions jx
        WHERE jx.id = ${f.subtreeOf}::uuid OR ${f.subtreeOf}::uuid = ANY(jx.ancestry))`,
    );
  if (f.financialYearId) parts.push(Prisma.sql`sc.financial_year_id = ${f.financialYearId}::uuid`);
  if (f.category) parts.push(Prisma.sql`sc.category = ${f.category}`);
  if (f.department) parts.push(Prisma.sql`sc.department = ${f.department}`);
  if (f.agencyId) parts.push(Prisma.sql`sc.agency_id = ${f.agencyId}::uuid`);
  if (f.schemeId) parts.push(Prisma.sql`sc.id = ${f.schemeId}::uuid`);
  return Prisma.join(parts, ' AND ');
}

/**
 * `WITH … m AS (one row per scheme) <tail>`. All money stays NUMERIC in SQL; callers aggregate
 * in SQL so statewide figures never load every scheme into memory. Verified figures follow the
 * same rules as the scheme finance summary: a verified correction replaces the record it
 * supersedes, only top-level approved allocations count, reported and verified stay separate.
 */
export function withMetrics(f: MetricsFilter, tail: Prisma.Sql): Prisma.Sql {
  const cutoff = f.cutoff ?? null;
  return Prisma.sql`
WITH params AS (SELECT ${cutoff}::date AS cutoff, COALESCE(${cutoff}::date, current_date) AS asof),
s AS (
  SELECT sc.id, sc.scheme_code, sc.name, sc.category, sc.status::text AS status, sc.department,
         sc.agency_id, sc.jurisdiction_id, sc.start_date, sc.target_end_date, j.ancestry
  FROM schemes sc JOIN jurisdictions j ON j.id = sc.jurisdiction_id
  WHERE ${where(f)}
),
bud AS (
  SELECT DISTINCT ON (bv.scheme_id) bv.scheme_id, bv.total_amount
  FROM budget_versions bv JOIN s ON s.id = bv.scheme_id
  WHERE bv.status = 'APPROVED' ORDER BY bv.scheme_id, bv.version_number DESC
),
orig AS (
  SELECT DISTINCT ON (bv.scheme_id) bv.scheme_id, bv.total_amount
  FROM budget_versions bv JOIN s ON s.id = bv.scheme_id
  WHERE bv.status IN ('APPROVED', 'SUPERSEDED') ORDER BY bv.scheme_id, bv.version_number ASC
),
alloc AS (
  SELECT a.scheme_id, SUM(a.amount) AS amount
  FROM budget_allocations a JOIN s ON s.id = a.scheme_id
  WHERE a.status = 'APPROVED' AND NOT EXISTS (
    SELECT 1 FROM budget_allocations p
    WHERE p.id = a.parent_allocation_id AND p.scheme_id = a.scheme_id AND p.status = 'APPROVED')
  GROUP BY a.scheme_id
),
rel AS (
  SELECT r.scheme_id,
    SUM(r.amount) FILTER (WHERE r.verification_status = 'VERIFIED' AND NOT EXISTS (
      SELECT 1 FROM fund_releases c WHERE c.supersedes_id = r.id AND c.verification_status = 'VERIFIED'
        AND ((SELECT cutoff FROM params) IS NULL OR c.release_date <= (SELECT cutoff FROM params)))) AS verified,
    COUNT(*) FILTER (WHERE r.verification_status = 'PENDING') AS pending_n,
    MAX(r.verified_at) AS last_verified_at
  FROM fund_releases r JOIN s ON s.id = r.scheme_id
  WHERE (SELECT cutoff FROM params) IS NULL OR r.release_date <= (SELECT cutoff FROM params)
  GROUP BY r.scheme_id
),
exp AS (
  SELECT e.scheme_id,
    SUM(e.amount) FILTER (WHERE e.status = 'VERIFIED' AND NOT EXISTS (
      SELECT 1 FROM expenditure_records c JOIN reporting_periods cp ON cp.id = c.period_id
      WHERE c.supersedes_id = e.id AND c.status = 'VERIFIED'
        AND ((SELECT cutoff FROM params) IS NULL OR cp.end_date <= (SELECT cutoff FROM params)))) AS verified,
    SUM(e.amount) FILTER (WHERE e.status = 'SUBMITTED') AS submitted,
    COUNT(*) FILTER (WHERE e.status = 'SUBMITTED') AS pending_n,
    MAX(e.verified_at) AS last_verified_at
  FROM expenditure_records e JOIN s ON s.id = e.scheme_id JOIN reporting_periods p ON p.id = e.period_id
  WHERE (SELECT cutoff FROM params) IS NULL OR p.end_date <= (SELECT cutoff FROM params)
  GROUP BY e.scheme_id
),
com AS (
  SELECT c.scheme_id, SUM(c.amount) AS amount FROM commitments c JOIN s ON s.id = c.scheme_id
  WHERE c.status = 'OPEN' GROUP BY c.scheme_id
),
vsub AS (
  SELECT ps.id, ps.scheme_id, ps.submission_version, ps.verified_at, p.code, p.start_date
  FROM progress_submissions ps JOIN s ON s.id = ps.scheme_id JOIN reporting_periods p ON p.id = ps.period_id
  WHERE ps.status = 'VERIFIED'
    AND ((SELECT cutoff FROM params) IS NULL OR p.end_date <= (SELECT cutoff FROM params))
),
qty AS (
  SELECT DISTINCT ON (pm.milestone_id) pm.milestone_id, pm.quantity_completed
  FROM progress_measurements pm JOIN vsub v ON v.id = pm.submission_id
  ORDER BY pm.milestone_id, v.start_date DESC, v.submission_version DESC
),
lastp AS (
  SELECT DISTINCT ON (v.scheme_id) v.scheme_id, v.code, v.verified_at
  FROM vsub v ORDER BY v.scheme_id, v.start_date DESC, v.submission_version DESC
),
phys AS (
  SELECT ms.scheme_id,
    SUM(ms.weight) FILTER (WHERE ms.weight > 0) AS total_weight,
    COALESCE(SUM(ms.weight * LEAST(COALESCE(q.quantity_completed, 0) / ms.target_quantity, 1))
      FILTER (WHERE ms.weight > 0 AND ms.target_quantity > 0), 0) AS achieved,
    SUM(ms.weight * CASE
      WHEN ms.target_date <= (SELECT asof FROM params) THEN 1
      WHEN s.start_date IS NULL OR (SELECT asof FROM params) <= s.start_date OR ms.target_date <= s.start_date THEN 0
      ELSE ((SELECT asof FROM params) - s.start_date)::numeric / (ms.target_date - s.start_date) END)
      FILTER (WHERE ms.weight > 0) AS planned,
    COUNT(*) AS milestones,
    COUNT(*) FILTER (WHERE COALESCE(q.quantity_completed, 0) >= ms.target_quantity) AS milestones_done,
    COUNT(*) FILTER (WHERE ms.target_date < (SELECT asof FROM params)
      AND COALESCE(q.quantity_completed, 0) < ms.target_quantity) AS milestones_delayed
  FROM scheme_milestones ms JOIN s ON s.id = ms.scheme_id LEFT JOIN qty q ON q.milestone_id = ms.id
  GROUP BY ms.scheme_id
),
pend AS (
  SELECT ps.scheme_id, COUNT(*) AS n FROM progress_submissions ps JOIN s ON s.id = ps.scheme_id
  WHERE ps.status IN ('SUBMITTED', 'RESUBMITTED', 'UNDER_REVIEW') GROUP BY ps.scheme_id
),
al AS (
  SELECT a.scheme_id, COUNT(*) AS n FROM alerts a JOIN s ON s.id = a.scheme_id
  WHERE a.status NOT IN ('RESOLVED', 'CLOSED') GROUP BY a.scheme_id
),
m AS (
  SELECT s.id, s.scheme_code, s.name, s.category, s.status, s.department, s.agency_id,
    s.jurisdiction_id, s.ancestry, s.target_end_date,
    bud.total_amount AS approved_budget,
    orig.total_amount AS original_budget,
    COALESCE(alloc.amount, 0::numeric(18, 2)) AS allocated,
    COALESCE(rel.verified, 0::numeric(18, 2)) AS verified_releases,
    COALESCE(exp.verified, 0::numeric(18, 2)) AS verified_expenditure,
    COALESCE(exp.verified, 0::numeric(18, 2)) + COALESCE(exp.submitted, 0::numeric(18, 2)) AS reported_expenditure,
    COALESCE(com.amount, 0::numeric(18, 2)) AS open_commitments,
    COALESCE(rel.pending_n, 0) + COALESCE(exp.pending_n, 0) AS pending_financial,
    COALESCE(pend.n, 0) AS pending_progress,
    COALESCE(al.n, 0) AS open_alerts,
    CASE WHEN phys.total_weight > 0 THEN ROUND(phys.achieved * 100 / phys.total_weight, 2) END AS physical,
    CASE WHEN phys.total_weight > 0 THEN ROUND(phys.planned * 100 / phys.total_weight, 2) END AS planned,
    CASE WHEN bud.total_amount > 0 THEN ROUND(COALESCE(exp.verified, 0::numeric(18, 2)) * 100 / bud.total_amount, 2) END AS fin_util,
    COALESCE(phys.milestones, 0) AS milestones,
    COALESCE(phys.milestones_done, 0) AS milestones_done,
    COALESCE(phys.milestones_delayed, 0) AS milestones_delayed,
    (COALESCE(phys.milestones_delayed, 0) > 0 OR (s.target_end_date < (SELECT asof FROM params)
      AND s.status NOT IN ('COMPLETED', 'CLOSED'))) AS delayed,
    lastp.code AS last_verified_period,
    GREATEST(rel.last_verified_at, exp.last_verified_at, lastp.verified_at) AS last_verified_at
  FROM s
  LEFT JOIN bud ON bud.scheme_id = s.id LEFT JOIN orig ON orig.scheme_id = s.id
  LEFT JOIN alloc ON alloc.scheme_id = s.id LEFT JOIN rel ON rel.scheme_id = s.id
  LEFT JOIN exp ON exp.scheme_id = s.id LEFT JOIN com ON com.scheme_id = s.id
  LEFT JOIN phys ON phys.scheme_id = s.id LEFT JOIN lastp ON lastp.scheme_id = s.id
  LEFT JOIN pend ON pend.scheme_id = s.id LEFT JOIN al ON al.scheme_id = s.id
)
${tail}`;
}

/** Aggregate columns shared by totals and per-jurisdiction comparisons. Money as text. */
export const AGGREGATES = Prisma.sql`
  COUNT(*)::int AS scheme_count,
  COUNT(*) FILTER (WHERE m.status = 'ACTIVE')::int AS active_count,
  COALESCE(SUM(m.approved_budget), 0::numeric(18, 2))::text AS approved_budget,
  COALESCE(SUM(m.original_budget), 0::numeric(18, 2))::text AS original_budget,
  COALESCE(SUM(m.allocated), 0::numeric(18, 2))::text AS allocated,
  COALESCE(SUM(m.verified_releases), 0::numeric(18, 2))::text AS verified_releases,
  COALESCE(SUM(m.verified_expenditure), 0::numeric(18, 2))::text AS verified_expenditure,
  COALESCE(SUM(m.reported_expenditure), 0::numeric(18, 2))::text AS reported_expenditure,
  COALESCE(SUM(m.open_commitments), 0::numeric(18, 2))::text AS open_commitments,
  COALESCE(SUM(m.pending_financial), 0)::int AS pending_financial,
  COALESCE(SUM(m.pending_progress), 0)::int AS pending_progress,
  COALESCE(SUM(m.open_alerts), 0)::int AS open_alerts,
  COUNT(*) FILTER (WHERE m.delayed)::int AS delayed_count,
  COUNT(*) FILTER (WHERE m.open_alerts > 0 OR m.delayed)::int AS corrective_count,
  COALESCE(SUM(m.milestones_delayed), 0)::int AS milestones_delayed,
  COUNT(*) FILTER (WHERE m.physical IS NULL)::int AS band_na,
  COUNT(*) FILTER (WHERE m.physical < 25)::int AS band_0_25,
  COUNT(*) FILTER (WHERE m.physical >= 25 AND m.physical < 50)::int AS band_25_50,
  COUNT(*) FILTER (WHERE m.physical >= 50 AND m.physical < 75)::int AS band_50_75,
  COUNT(*) FILTER (WHERE m.physical >= 75 AND m.physical < 100)::int AS band_75_100,
  COUNT(*) FILTER (WHERE m.physical >= 100)::int AS band_100,
  MAX(m.last_verified_at) AS last_verified_at`;

export interface AggregateRow {
  scheme_count: number;
  active_count: number;
  approved_budget: string;
  original_budget: string;
  allocated: string;
  verified_releases: string;
  verified_expenditure: string;
  reported_expenditure: string;
  open_commitments: string;
  pending_financial: number;
  pending_progress: number;
  open_alerts: number;
  delayed_count: number;
  corrective_count: number;
  milestones_delayed: number;
  band_na: number;
  band_0_25: number;
  band_25_50: number;
  band_50_75: number;
  band_75_100: number;
  band_100: number;
  last_verified_at: Date | null;
}

/** Per-scheme columns for lists (money and percentages as text to keep them exact). */
export const SCHEME_COLUMNS = Prisma.sql`
  m.id, m.scheme_code, m.name, m.category, m.status, m.department, m.jurisdiction_id,
  m.approved_budget::text, m.allocated::text, m.verified_releases::text,
  m.verified_expenditure::text, m.reported_expenditure::text, m.open_commitments::text,
  m.physical::text, m.planned::text, m.fin_util::text, m.pending_financial::int,
  m.pending_progress::int, m.open_alerts::int, m.milestones::int, m.milestones_done::int,
  m.milestones_delayed::int, m.delayed, m.last_verified_period, m.target_end_date`;

export interface SchemeRow {
  id: string;
  scheme_code: string;
  name: string;
  category: string;
  status: string;
  department: string | null;
  jurisdiction_id: string;
  approved_budget: string | null;
  allocated: string;
  verified_releases: string;
  verified_expenditure: string;
  reported_expenditure: string;
  open_commitments: string;
  physical: string | null;
  planned: string | null;
  fin_util: string | null;
  pending_financial: number;
  pending_progress: number;
  open_alerts: number;
  milestones: number;
  milestones_done: number;
  milestones_delayed: number;
  delayed: boolean;
  last_verified_period: string | null;
  target_end_date: Date | null;
}
