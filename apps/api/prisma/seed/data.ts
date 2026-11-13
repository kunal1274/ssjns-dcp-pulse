/**
 * Synthetic Assam-style demo data (specification §13).
 * Every name and figure here is fictitious. District/co-district names are
 * deliberately generic and are not official Assam administrative units.
 */

export const SEED_REFERENCE_DATE = '2026-11-11';
export const TENANT_CODE = 'ASSAM-DEMO';

export const JURISDICTION_TYPES = [
  { code: 'STATE', displayName: 'State', sortOrder: 1 },
  { code: 'DISTRICT', displayName: 'District', sortOrder: 2 },
  { code: 'CO_DISTRICT', displayName: 'Co-district', sortOrder: 3 },
] as const;

export const JURISDICTIONS = [
  { code: 'AS-DEMO', name: 'Assam (synthetic demo state)', type: 'STATE', parent: null },
  { code: 'DIST-A', name: 'District A', type: 'DISTRICT', parent: 'AS-DEMO' },
  { code: 'DIST-B', name: 'District B', type: 'DISTRICT', parent: 'AS-DEMO' },
  { code: 'CD-A1', name: 'Co-district A1', type: 'CO_DISTRICT', parent: 'DIST-A' },
  { code: 'CD-A2', name: 'Co-district A2', type: 'CO_DISTRICT', parent: 'DIST-A' },
  { code: 'CD-B1', name: 'Co-district B1', type: 'CO_DISTRICT', parent: 'DIST-B' },
  { code: 'CD-B2', name: 'Co-district B2', type: 'CO_DISTRICT', parent: 'DIST-B' },
] as const;

export type JurisdictionCode = (typeof JURISDICTIONS)[number]['code'];

export const AGENCIES = [
  { code: 'AG-ROADS', name: 'Demo Roads Implementing Agency', agencyType: 'IMPLEMENTING' },
  { code: 'AG-WATER', name: 'Demo Water Supply Implementing Agency', agencyType: 'IMPLEMENTING' },
  {
    code: 'AG-FACILITIES',
    name: 'Demo Public Facilities Implementing Agency',
    agencyType: 'IMPLEMENTING',
  },
  { code: 'PLAN-CELL', name: 'Demo State Planning Cell', agencyType: 'PLANNING_AUTHORITY' },
] as const;

export type AgencyCode = (typeof AGENCIES)[number]['code'];

export const AGENCY_JURISDICTIONS: {
  agency: AgencyCode;
  jurisdiction: JurisdictionCode;
  relationshipType: string;
}[] = [
  { agency: 'AG-ROADS', jurisdiction: 'DIST-A', relationshipType: 'OPERATES_IN' },
  { agency: 'AG-ROADS', jurisdiction: 'DIST-B', relationshipType: 'OPERATES_IN' },
  { agency: 'AG-WATER', jurisdiction: 'DIST-A', relationshipType: 'OPERATES_IN' },
  { agency: 'AG-WATER', jurisdiction: 'DIST-B', relationshipType: 'OPERATES_IN' },
  { agency: 'AG-FACILITIES', jurisdiction: 'DIST-A', relationshipType: 'OPERATES_IN' },
  { agency: 'AG-FACILITIES', jurisdiction: 'DIST-B', relationshipType: 'OPERATES_IN' },
  { agency: 'PLAN-CELL', jurisdiction: 'AS-DEMO', relationshipType: 'PLANNING_OVERSIGHT' },
];

export const FINANCIAL_YEAR = { code: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' };

/** Monthly reporting periods for FY 2026-27; submissions due on the 10th of the following month. */
export const REPORTING_PERIODS = Array.from({ length: 12 }, (_, i) => {
  const year = 2026 + Math.floor((3 + i) / 12);
  const month = ((3 + i) % 12) + 1;
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dueYear = month === 12 ? year + 1 : year;
  const dueMonth = String((month % 12) + 1).padStart(2, '0');
  return {
    code: `${year}-${mm}`,
    startDate: `${year}-${mm}-01`,
    endDate: `${year}-${mm}-${lastDay}`,
    submissionDueAt: `${dueYear}-${dueMonth}-10T18:00:00+05:30`,
  };
});

export const DEMO_USERS = [
  {
    email: 'state.monitor@example.test',
    name: 'Demo State Monitor',
    role: 'STATE_MONITOR',
    scopes: [{ type: 'TENANT' }],
  },
  {
    email: 'state.planner@example.test',
    name: 'Demo State Planner',
    role: 'STATE_PLANNER',
    scopes: [{ type: 'TENANT' }],
  },
  {
    // Second planner so budget and scheme approvals can be demonstrated under maker-checker.
    email: 'budget.checker@example.test',
    name: 'Demo State Budget Checker',
    role: 'STATE_PLANNER',
    scopes: [{ type: 'TENANT' }],
  },
  {
    email: 'district.reviewer@example.test',
    name: 'Demo District Reviewer (District A)',
    role: 'DISTRICT_REVIEWER',
    scopes: [{ type: 'JURISDICTION', code: 'DIST-A' }],
  },
  {
    email: 'codistrict.reviewer@example.test',
    name: 'Demo Co-district Reviewer (A1)',
    role: 'CO_DISTRICT_REVIEWER',
    scopes: [{ type: 'JURISDICTION', code: 'CD-A1' }],
  },
  {
    email: 'field.officer@example.test',
    name: 'Demo Implementing Officer',
    role: 'IMPLEMENTING_OFFICER',
    scopes: [
      { type: 'JURISDICTION', code: 'DIST-A' },
      { type: 'JURISDICTION', code: 'DIST-B' },
    ],
  },
  {
    email: 'finance.reviewer@example.test',
    name: 'Demo Finance Reviewer',
    role: 'FINANCE_REVIEWER',
    scopes: [{ type: 'TENANT' }],
  },
  {
    email: 'auditor@example.test',
    name: 'Demo Auditor',
    role: 'AUDITOR',
    scopes: [{ type: 'TENANT' }],
  },
  {
    email: 'admin@example.test',
    name: 'Demo System Administrator',
    role: 'SYSTEM_ADMIN',
    scopes: [{ type: 'TENANT' }],
  },
] as const satisfies readonly {
  email: string;
  name: string;
  role: string;
  scopes: readonly ({ type: 'TENANT' } | { type: 'JURISDICTION'; code: JurisdictionCode })[];
}[];

/** Rupees helper: lakh(70) => "7000000.00". Integer arithmetic only. */
export const lakh = (n: number): string => {
  if (!Number.isInteger(n)) throw new Error('lakh() expects an integer');
  return `${n * 100000}.00`;
};

export interface SchemeSeed {
  code: string;
  name: string;
  category: 'ROAD' | 'WATER' | 'PUBLIC_FACILITY';
  agency: AgencyCode;
  coDistrict: JurisdictionCode;
  status: 'APPROVED' | 'ACTIVE';
  /** Approved (revised) budget in lakh INR. */
  budgetLakh: number;
  /** Optional original budget superseded by the revision. */
  originalBudgetLakh?: number;
  /** Verified releases in lakh INR. */
  releasesLakh: number[];
  /** Verified expenditure in lakh INR. */
  verifiedExpenditureLakh: number[];
  /** Synthetic point (lon, lat) inside a generic Assam-like bounding box. */
  point: [number, number];
}

export const SCHEMES: SchemeSeed[] = [
  // DEMO-001 is the worked example from §5: budget 1 crore, released 70 L, verified expenditure 55 L, physical 40%.
  {
    code: 'DEMO-001',
    name: 'Synthetic rural road upgrade 001',
    category: 'ROAD',
    agency: 'AG-ROADS',
    coDistrict: 'CD-A1',
    status: 'ACTIVE',
    budgetLakh: 100,
    originalBudgetLakh: 90,
    releasesLakh: [40, 30],
    verifiedExpenditureLakh: [30, 25],
    point: [91.7362, 26.1445],
  },
  {
    code: 'DEMO-002',
    name: 'Synthetic piped water scheme 002',
    category: 'WATER',
    agency: 'AG-WATER',
    coDistrict: 'CD-A1',
    status: 'ACTIVE',
    budgetLakh: 60,
    releasesLakh: [30],
    verifiedExpenditureLakh: [18],
    point: [91.7801, 26.1802],
  },
  {
    code: 'DEMO-003',
    name: 'Synthetic community hall 003',
    category: 'PUBLIC_FACILITY',
    agency: 'AG-FACILITIES',
    coDistrict: 'CD-A2',
    status: 'ACTIVE',
    budgetLakh: 45,
    releasesLakh: [20],
    verifiedExpenditureLakh: [12],
    point: [91.6203, 26.2101],
  },
  {
    code: 'DEMO-004',
    name: 'Synthetic link road 004',
    category: 'ROAD',
    agency: 'AG-ROADS',
    coDistrict: 'CD-A2',
    status: 'ACTIVE',
    budgetLakh: 75,
    releasesLakh: [35],
    verifiedExpenditureLakh: [20],
    point: [91.6544, 26.2533],
  },
  // DEMO-005: deliberate variance — verified expenditure exceeds verified releases.
  {
    code: 'DEMO-005',
    name: 'Synthetic water treatment unit 005',
    category: 'WATER',
    agency: 'AG-WATER',
    coDistrict: 'CD-B1',
    status: 'ACTIVE',
    budgetLakh: 50,
    releasesLakh: [20],
    verifiedExpenditureLakh: [14, 10],
    point: [92.7905, 26.6338],
  },
  {
    code: 'DEMO-006',
    name: 'Synthetic health sub-centre 006',
    category: 'PUBLIC_FACILITY',
    agency: 'AG-FACILITIES',
    coDistrict: 'CD-B1',
    status: 'ACTIVE',
    budgetLakh: 40,
    releasesLakh: [15],
    verifiedExpenditureLakh: [9],
    point: [92.8122, 26.6601],
  },
  // DEMO-007: deliberate variance — low release against budget.
  {
    code: 'DEMO-007',
    name: 'Synthetic bridge approach road 007',
    category: 'ROAD',
    agency: 'AG-ROADS',
    coDistrict: 'CD-B2',
    status: 'ACTIVE',
    budgetLakh: 80,
    releasesLakh: [10],
    verifiedExpenditureLakh: [6],
    point: [92.9013, 26.7255],
  },
  {
    code: 'DEMO-008',
    name: 'Synthetic tube-well cluster 008',
    category: 'WATER',
    agency: 'AG-WATER',
    coDistrict: 'CD-B2',
    status: 'ACTIVE',
    budgetLakh: 30,
    releasesLakh: [15],
    verifiedExpenditureLakh: [11],
    point: [92.942, 26.7019],
  },
  {
    code: 'DEMO-009',
    name: 'Synthetic school sanitation block 009',
    category: 'PUBLIC_FACILITY',
    agency: 'AG-FACILITIES',
    coDistrict: 'CD-A1',
    status: 'ACTIVE',
    budgetLakh: 25,
    releasesLakh: [10],
    verifiedExpenditureLakh: [7],
    point: [91.7522, 26.1103],
  },
  {
    code: 'DEMO-010',
    name: 'Synthetic village road 010',
    category: 'ROAD',
    agency: 'AG-ROADS',
    coDistrict: 'CD-B1',
    status: 'ACTIVE',
    budgetLakh: 55,
    releasesLakh: [25],
    verifiedExpenditureLakh: [15],
    point: [92.7514, 26.6012],
  },
  {
    code: 'DEMO-011',
    name: 'Synthetic overhead tank 011',
    category: 'WATER',
    agency: 'AG-WATER',
    coDistrict: 'CD-A2',
    status: 'ACTIVE',
    budgetLakh: 35,
    releasesLakh: [12],
    verifiedExpenditureLakh: [5],
    point: [91.6018, 26.2407],
  },
  // DEMO-012: approved, not yet active — no releases or expenditure.
  {
    code: 'DEMO-012',
    name: 'Synthetic market shed 012',
    category: 'PUBLIC_FACILITY',
    agency: 'AG-FACILITIES',
    coDistrict: 'CD-B2',
    status: 'APPROVED',
    budgetLakh: 20,
    releasesLakh: [],
    verifiedExpenditureLakh: [],
    point: [92.9655, 26.748],
  },
];

export interface MilestoneSeed {
  name: string;
  targetDate: string;
  targetQuantity: string;
  unit: string;
  weight: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
}

const UNIT_BY_CATEGORY: Record<SchemeSeed['category'], string> = {
  ROAD: 'km',
  WATER: 'connections',
  PUBLIC_FACILITY: 'percent_works',
};

const QTY_BY_CATEGORY: Record<SchemeSeed['category'], [string, string, string]> = {
  ROAD: ['4.000', '3.000', '3.000'],
  WATER: ['200.000', '150.000', '150.000'],
  PUBLIC_FACILITY: ['40.000', '30.000', '30.000'],
};

/**
 * Three weighted milestones per scheme (40/30/30). Exactly two milestones are
 * overdue relative to SEED_REFERENCE_DATE: DEMO-004 #2 and DEMO-007 #1.
 */
export function milestonesFor(scheme: SchemeSeed): MilestoneSeed[] {
  const unit = UNIT_BY_CATEGORY[scheme.category];
  const qty = QTY_BY_CATEGORY[scheme.category];
  const base: MilestoneSeed[] = [
    {
      name: 'Stage 1 works',
      targetDate: '2026-12-31',
      targetQuantity: qty[0],
      unit,
      weight: '40.00',
      status: 'IN_PROGRESS',
    },
    {
      name: 'Stage 2 works',
      targetDate: '2027-02-15',
      targetQuantity: qty[1],
      unit,
      weight: '30.00',
      status: 'NOT_STARTED',
    },
    {
      name: 'Stage 3 works and handover',
      targetDate: '2027-03-25',
      targetQuantity: qty[2],
      unit,
      weight: '30.00',
      status: 'NOT_STARTED',
    },
  ];
  if (scheme.code === 'DEMO-001')
    base[0] = { ...base[0], targetDate: '2026-08-31', status: 'COMPLETED' };
  if (scheme.code === 'DEMO-004')
    base[1] = { ...base[1], targetDate: '2026-09-30', status: 'IN_PROGRESS' };
  if (scheme.code === 'DEMO-007')
    base[0] = { ...base[0], targetDate: '2026-10-15', status: 'NOT_STARTED' };
  if (scheme.status === 'APPROVED') base[0] = { ...base[0], status: 'NOT_STARTED' };
  return base;
}

export type SubmissionSeed = {
  scheme: string;
  period: string;
  status: 'SUBMITTED' | 'UNDER_REVIEW' | 'VERIFIED' | 'RETURNED';
  remarks: string;
  /** Quantity completed for milestone index 0 (cumulative). */
  stage1Quantity: string;
  decision?: { decision: 'VERIFY' | 'RETURN'; reason?: string };
};

/** 2 verified, 1 returned, 3 pending (submitted / under review). */
export const SUBMISSIONS: SubmissionSeed[] = [
  {
    scheme: 'DEMO-001',
    period: '2026-10',
    status: 'VERIFIED',
    remarks: 'Stage 1 road formation completed (synthetic).',
    stage1Quantity: '4.000',
    decision: { decision: 'VERIFY' },
  },
  {
    scheme: 'DEMO-002',
    period: '2026-10',
    status: 'VERIFIED',
    remarks: 'House connections progressing (synthetic).',
    stage1Quantity: '90.000',
    decision: { decision: 'VERIFY' },
  },
  {
    scheme: 'DEMO-003',
    period: '2026-10',
    status: 'RETURNED',
    remarks: 'Foundation works reported (synthetic).',
    stage1Quantity: '15.000',
    decision: {
      decision: 'RETURN',
      reason: 'Site photographs and measurement book reference missing.',
    },
  },
  {
    scheme: 'DEMO-004',
    period: '2026-10',
    status: 'SUBMITTED',
    remarks: 'Earthwork continuing (synthetic).',
    stage1Quantity: '2.500',
  },
  {
    scheme: 'DEMO-005',
    period: '2026-10',
    status: 'UNDER_REVIEW',
    remarks: 'Treatment unit civil works (synthetic).',
    stage1Quantity: '120.000',
  },
  {
    scheme: 'DEMO-006',
    period: '2026-10',
    status: 'SUBMITTED',
    remarks: 'Plinth level reached (synthetic).',
    stage1Quantity: '20.000',
  },
];

/** Illustrative alert thresholds (§10). Not official rules. */
export const ALERT_RULES = [
  { ruleCode: 'REPORT_OVERDUE', severity: 'MEDIUM', threshold: { graceDays: 5 } },
  { ruleCode: 'MILESTONE_LATE', severity: 'HIGH', threshold: { graceDays: 0 } },
  {
    ruleCode: 'PHYSICAL_FINANCIAL_GAP',
    severity: 'MEDIUM',
    threshold: { gapPercentagePoints: 10 },
  },
  { ruleCode: 'RELEASE_EXCEEDED', severity: 'HIGH', threshold: { toleranceAmount: '0.00' } },
  { ruleCode: 'ALLOCATION_EXCEEDED', severity: 'HIGH', threshold: { toleranceAmount: '0.00' } },
  { ruleCode: 'APPROVAL_AGED', severity: 'LOW', threshold: { maxDaysPending: 7 } },
  { ruleCode: 'EVIDENCE_MISSING', severity: 'LOW', threshold: { requiredForStatus: 'SUBMITTED' } },
  { ruleCode: 'DATA_STALE', severity: 'LOW', threshold: { maxDaysSinceVerifiedUpdate: 45 } },
] as const;

export const ALERTS = [
  {
    ruleCode: 'PHYSICAL_FINANCIAL_GAP',
    scheme: 'DEMO-001',
    severity: 'MEDIUM',
    status: 'OPEN',
    dedupKey: 'PHYSICAL_FINANCIAL_GAP:DEMO-001:2026-10',
    context: {
      budgetUtilisationPct: '55.00',
      physicalCompletionPct: '40.00',
      gapPercentagePoints: '15.00',
      thresholdPercentagePoints: 10,
      note: 'Illustrative review rule only; not evidence of misuse.',
    },
  },
  {
    ruleCode: 'MILESTONE_LATE',
    scheme: 'DEMO-004',
    severity: 'HIGH',
    status: 'ACKNOWLEDGED',
    dedupKey: 'MILESTONE_LATE:DEMO-004:stage-2',
    context: { milestone: 'Stage 2 works', targetDate: '2026-09-30' },
  },
  {
    ruleCode: 'RELEASE_EXCEEDED',
    scheme: 'DEMO-005',
    severity: 'HIGH',
    status: 'OPEN',
    dedupKey: 'RELEASE_EXCEEDED:DEMO-005:2026-10',
    context: { verifiedExpenditure: lakh(24), verifiedReleases: lakh(20) },
  },
] as const;
