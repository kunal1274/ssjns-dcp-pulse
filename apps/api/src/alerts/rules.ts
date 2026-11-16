import { Prisma } from '@prisma/client';

export const RULE_CODES = [
  'REPORT_OVERDUE',
  'MILESTONE_LATE',
  'PHYSICAL_FINANCIAL_GAP',
  'RELEASE_EXCEEDED',
  'ALLOCATION_EXCEEDED',
  'APPROVAL_AGED',
  'EVIDENCE_MISSING',
  'DATA_STALE',
] as const;
export type RuleCode = (typeof RULE_CODES)[number];
export const FREQUENCIES = ['HOURLY', 'DAILY', 'WEEKLY', 'ON_EVENT'] as const;
export const FREQUENCY_MS: Record<string, number | null> = {
  HOURLY: 3_600_000,
  DAILY: 86_400_000,
  WEEKLY: 604_800_000,
  ON_EVENT: null,
};
/** Days to respond before an unacknowledged alert escalates. */
export const SLA_DAYS: Record<string, number> = { CRITICAL: 1, HIGH: 3, MEDIUM: 7, LOW: 14 };
export const MAX_ESCALATION = 3;
/** Rules that flag something to look at; the others report a breached financial control. */
export const REVIEW_INDICATOR: Record<RuleCode, boolean> = {
  REPORT_OVERDUE: true,
  MILESTONE_LATE: true,
  PHYSICAL_FINANCIAL_GAP: true,
  RELEASE_EXCEEDED: false,
  ALLOCATION_EXCEEDED: false,
  APPROVAL_AGED: true,
  EVIDENCE_MISSING: true,
  DATA_STALE: true,
};

const MONEY = /^\d{1,16}(\.\d{1,2})?$/;
const intIn = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Validates a rule's threshold object; returns an error message or null. */
export function thresholdError(code: RuleCode, t: unknown): string | null {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return 'threshold must be an object';
  const o = t as Record<string, unknown>;
  const only = (keys: string[]) =>
    Object.keys(o).every((k) => keys.includes(k)) ? null : `allowed keys: ${keys.join(', ')}`;
  switch (code) {
    case 'REPORT_OVERDUE':
    case 'MILESTONE_LATE':
      return intIn(o.graceDays, 0, 365) ? only(['graceDays']) : 'graceDays must be 0–365';
    case 'PHYSICAL_FINANCIAL_GAP':
      return intIn(o.gapPercentagePoints, 1, 100)
        ? only(['gapPercentagePoints'])
        : 'gapPercentagePoints must be an integer 1–100';
    case 'RELEASE_EXCEEDED':
    case 'ALLOCATION_EXCEEDED':
      return typeof o.toleranceAmount === 'string' && MONEY.test(o.toleranceAmount)
        ? only(['toleranceAmount'])
        : 'toleranceAmount must be a money string such as "0.00"';
    case 'APPROVAL_AGED':
      return intIn(o.maxDaysPending, 1, 365)
        ? only(['maxDaysPending'])
        : 'maxDaysPending must be 1–365';
    case 'EVIDENCE_MISSING':
      return o.requiredForStatus === 'SUBMITTED' || o.requiredForStatus === 'VERIFIED'
        ? only(['requiredForStatus'])
        : 'requiredForStatus must be SUBMITTED or VERIFIED';
    case 'DATA_STALE':
      return intIn(o.maxDaysSinceVerifiedUpdate, 1, 730)
        ? only(['maxDaysSinceVerifiedUpdate'])
        : 'maxDaysSinceVerifiedUpdate must be 1–730';
  }
}

export interface RuleRow {
  id: string;
  ruleCode: string;
  scopeType: string;
  scopeId: string;
  severity: string;
  thresholdJson: unknown;
  enabled: boolean;
  evaluationFrequency: string;
  lastEvaluatedAt: Date | null;
  effectiveFrom: Date;
  updatedAt: Date;
}
export interface SchemeScope {
  id: string;
  jurisdictionId: string;
  agencyId: string;
  ancestry: string[];
}

/**
 * The most specific effective rule for a scheme: SCHEME > AGENCY > deepest JURISDICTION > TENANT,
 * then the latest effective date. A disabled specific rule suppresses broader ones for that scheme.
 */
export function pickRule<R extends RuleRow>(rules: R[], s: SchemeScope): R | null {
  const lineage = [...s.ancestry, s.jurisdictionId];
  const rank = (r: R): number => {
    if (r.scopeType === 'SCHEME') return r.scopeId === s.id ? 1000 : -1;
    if (r.scopeType === 'AGENCY') return r.scopeId === s.agencyId ? 900 : -1;
    if (r.scopeType === 'JURISDICTION') {
      const i = lineage.indexOf(r.scopeId);
      return i < 0 ? -1 : 100 + i;
    }
    return r.scopeType === 'TENANT' ? 1 : -1;
  };
  let best: R | null = null;
  let bestRank = -1;
  for (const r of rules) {
    const k = rank(r);
    if (
      k > bestRank ||
      (k === bestRank && k >= 0 && best && r.effectiveFrom > best.effectiveFrom)
    ) {
      best = k >= 0 ? r : best;
      bestRank = Math.max(k, bestRank);
    }
  }
  return best;
}

export interface SchemeFacts {
  schemeCode: string;
  approved: string | null;
  allocated: string;
  releases: string;
  expenditure: string;
  physical: string | null;
  finUtil: string | null;
  lastVerifiedAt: Date | null;
  startDate: Date | null;
}
export interface Finding {
  key: string;
  context: Record<string, unknown>;
}

const D = (v: string) => new Prisma.Decimal(v);
const days = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / 86_400_000);

/** Scheme-level rules that only need the dashboard KPI row. */
export function schemeFinding(
  code: RuleCode,
  threshold: Record<string, unknown>,
  f: SchemeFacts,
  now: Date,
): Finding | null {
  const key = `${code}:${f.schemeCode}`;
  switch (code) {
    case 'PHYSICAL_FINANCIAL_GAP': {
      if (f.physical == null || f.finUtil == null) return null;
      const gap = D(f.finUtil).minus(D(f.physical));
      const limit = Number(threshold.gapPercentagePoints);
      if (gap.abs().lessThan(limit)) return null;
      return {
        key,
        context: {
          financialUtilisationPct: f.finUtil,
          physicalCompletionPct: f.physical,
          gapPercentagePoints: gap.toFixed(2),
          thresholdPercentagePoints: limit,
          direction: gap.isPositive() ? 'SPENDING_AHEAD_OF_PROGRESS' : 'PROGRESS_AHEAD_OF_SPENDING',
          note: 'Review indicator only; not evidence of misuse.',
        },
      };
    }
    case 'RELEASE_EXCEEDED': {
      const excess = D(f.expenditure).minus(D(f.releases));
      if (!excess.greaterThan(D(String(threshold.toleranceAmount)))) return null;
      return {
        key,
        context: {
          verifiedExpenditure: f.expenditure,
          verifiedReleases: f.releases,
          excess: excess.toFixed(2),
          toleranceAmount: threshold.toleranceAmount,
        },
      };
    }
    case 'ALLOCATION_EXCEEDED': {
      const tol = D(String(threshold.toleranceAmount));
      const overRelease = D(f.releases).minus(D(f.allocated));
      const overBudget = f.approved == null ? null : D(f.allocated).minus(D(f.approved));
      const breached = overRelease.greaterThan(tol) || (overBudget?.greaterThan(tol) ?? false);
      if (!breached) return null;
      return {
        key,
        context: {
          approvedBudget: f.approved,
          allocatedBudget: f.allocated,
          verifiedReleases: f.releases,
          releasesOverAllocation: overRelease.toFixed(2),
          allocationOverBudget: overBudget?.toFixed(2) ?? null,
          toleranceAmount: threshold.toleranceAmount,
        },
      };
    }
    case 'DATA_STALE': {
      const ref = f.lastVerifiedAt ?? f.startDate;
      if (!ref || ref > now) return null;
      const age = days(ref, now);
      const max = Number(threshold.maxDaysSinceVerifiedUpdate);
      if (age <= max) return null;
      return {
        key,
        context: {
          lastVerifiedAt: f.lastVerifiedAt?.toISOString() ?? null,
          referenceDate: ref.toISOString(),
          daysSinceVerifiedUpdate: age,
          maxDaysSinceVerifiedUpdate: max,
        },
      };
    }
    default:
      return null;
  }
}

export const DEDUP_TEMPLATES: Record<RuleCode, string> = {
  REPORT_OVERDUE: 'REPORT_OVERDUE:{schemeCode}',
  MILESTONE_LATE: 'MILESTONE_LATE:{schemeCode}:{milestoneId}',
  PHYSICAL_FINANCIAL_GAP: 'PHYSICAL_FINANCIAL_GAP:{schemeCode}',
  RELEASE_EXCEEDED: 'RELEASE_EXCEEDED:{schemeCode}',
  ALLOCATION_EXCEEDED: 'ALLOCATION_EXCEEDED:{schemeCode}',
  APPROVAL_AGED: 'APPROVAL_AGED:{schemeCode}:{entityType}:{entityId}',
  EVIDENCE_MISSING: 'EVIDENCE_MISSING:{schemeCode}:{submissionId}',
  DATA_STALE: 'DATA_STALE:{schemeCode}',
};
