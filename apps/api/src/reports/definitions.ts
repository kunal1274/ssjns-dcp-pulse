export type ColumnType = 'text' | 'money' | 'percent' | 'int' | 'date' | 'datetime' | 'bool';
export interface Column {
  key: string;
  label: string;
  type: ColumnType;
}
export interface ReportDefinition {
  code: string;
  title: string;
  description: string;
  /** Permissions needed in addition to report.view / report.export. */
  extraPermission?: 'alert.view' | 'audit.view';
  requiresScheme?: boolean;
  columns: Column[];
}

const c = (key: string, label: string, type: ColumnType = 'text'): Column => ({ key, label, type });

const KPI_COLUMNS: Column[] = [
  c('schemeCount', 'Schemes', 'int'),
  c('approvedBudget', 'Revised approved budget (INR)', 'money'),
  c('allocatedBudget', 'Allocated budget (INR)', 'money'),
  c('verifiedReleases', 'Verified funds released (INR)', 'money'),
  c('verifiedExpenditure', 'Verified expenditure (INR)', 'money'),
  c('reportedExpenditure', 'Reported expenditure (INR)', 'money'),
  c(
    'financialUtilisationPercent',
    'Financial utilisation % (verified exp / approved budget)',
    'percent',
  ),
  c(
    'releaseUtilisationPercent',
    'Release utilisation % (verified exp / verified releases)',
    'percent',
  ),
  c('budgetRemaining', 'Budget remaining (INR)', 'money'),
  c('unreleasedAllocation', 'Unreleased allocation (INR)', 'money'),
  c('unspentReleasedFunds', 'Unspent released funds (INR)', 'money'),
  c('bandNotAvailable', 'Schemes: physical N/A', 'int'),
  c('band0to25', 'Schemes: physical 0–25%', 'int'),
  c('band25to50', 'Schemes: physical 25–50%', 'int'),
  c('band50to75', 'Schemes: physical 50–75%', 'int'),
  c('band75to100', 'Schemes: physical 75–<100%', 'int'),
  c('band100', 'Schemes: physical 100%', 'int'),
  c('delayedSchemes', 'Delayed schemes', 'int'),
  c('delayedMilestones', 'Delayed milestones', 'int'),
  c('openAlerts', 'Open alerts', 'int'),
];

const SCHEME_ID: Column[] = [
  c('schemeCode', 'Scheme code'),
  c('schemeName', 'Scheme name'),
  c('jurisdiction', 'Jurisdiction'),
  c('category', 'Category'),
  c('status', 'Status'),
];

export const REPORTS: ReportDefinition[] = [
  {
    code: 'state-summary',
    title: 'State scheme progress summary',
    description: 'Scope-wide totals; matches the statewide dashboard tiles for the same filters.',
    columns: [c('level', 'Level'), ...KPI_COLUMNS],
  },
  {
    code: 'district-progress',
    title: 'District-wise physical and financial progress',
    description: 'One row per child jurisdiction (districts by default) of the selected level.',
    columns: [c('jurisdictionCode', 'Code'), c('jurisdiction', 'Jurisdiction'), ...KPI_COLUMNS],
  },
  {
    code: 'budget-vs-expenditure',
    title: 'Scheme-wise budget versus expenditure',
    description: 'Revised approved budget against verified and reported expenditure per scheme.',
    columns: [
      ...SCHEME_ID,
      c('approvedBudget', 'Revised approved budget (INR)', 'money'),
      c('verifiedExpenditure', 'Verified expenditure (INR)', 'money'),
      c('reportedExpenditure', 'Reported expenditure (INR)', 'money'),
      c('budgetRemaining', 'Budget remaining (INR)', 'money'),
      c('financialUtilisationPercent', 'Financial utilisation %', 'percent'),
      c('physicalCompletionPercent', 'Physical completion % (verified)', 'percent'),
    ],
  },
  {
    code: 'release-utilisation',
    title: 'Fund release and utilisation',
    description: 'Allocations, verified releases and how much of the released money is spent.',
    columns: [
      ...SCHEME_ID,
      c('allocatedBudget', 'Allocated budget (INR)', 'money'),
      c('verifiedReleases', 'Verified funds released (INR)', 'money'),
      c('verifiedExpenditure', 'Verified expenditure (INR)', 'money'),
      c('releaseUtilisationPercent', 'Release utilisation %', 'percent'),
      c('unreleasedAllocation', 'Unreleased allocation (INR)', 'money'),
      c('unspentReleasedFunds', 'Unspent released funds (INR)', 'money'),
      c('pendingFinancialVerification', 'Financial records awaiting verification', 'int'),
    ],
  },
  {
    code: 'delayed-schemes',
    title: 'Delayed schemes and milestones',
    description: 'Schemes with a late milestone or past their target end date.',
    columns: [
      ...SCHEME_ID,
      c('physicalCompletionPercent', 'Physical completion %', 'percent'),
      c('plannedProgressPercent', 'Planned progress %', 'percent'),
      c('scheduleVariancePoints', 'Schedule variance (points)', 'percent'),
      c('milestones', 'Milestones', 'int'),
      c('milestonesDelayed', 'Delayed milestones', 'int'),
      c('targetEndDate', 'Target end date', 'date'),
      c('lastVerifiedPeriod', 'Last verified period'),
    ],
  },
  {
    code: 'pending-approvals',
    title: 'Pending submissions and approvals',
    description: 'Items waiting for a maker-checker decision, oldest first.',
    columns: [
      c('itemType', 'Item'),
      c('schemeCode', 'Scheme code'),
      c('schemeName', 'Scheme name'),
      c('jurisdiction', 'Jurisdiction'),
      c('period', 'Period'),
      c('amount', 'Amount (INR)', 'money'),
      c('status', 'Status'),
      c('submittedBy', 'Submitted by'),
      c('submittedAt', 'Submitted at', 'datetime'),
      c('ageDays', 'Age (days)', 'int'),
    ],
  },
  {
    code: 'alert-status',
    title: 'Alert and corrective-action status',
    description:
      'Alerts with their corrective actions. Review indicators are not evidence of misuse.',
    extraPermission: 'alert.view',
    columns: [
      c('ruleCode', 'Rule'),
      c('alertType', 'Type'),
      c('severity', 'Severity'),
      c('status', 'Status'),
      c('schemeCode', 'Scheme code'),
      c('jurisdiction', 'Jurisdiction'),
      c('assignee', 'Assignee'),
      c('escalationLevel', 'Escalation level', 'int'),
      c('detectedAt', 'Detected at', 'datetime'),
      c('dueAt', 'Response due', 'datetime'),
      c('actionsTotal', 'Corrective actions', 'int'),
      c('actionsOpen', 'Open actions', 'int'),
      c('actionsOverdue', 'Overdue actions', 'int'),
      c('actionsClosed', 'Closed actions', 'int'),
    ],
  },
  {
    code: 'reporting-completeness',
    title: 'Reporting completeness',
    description: 'Progress submission status per approved/active scheme for one reporting period.',
    columns: [
      ...SCHEME_ID,
      c('period', 'Period'),
      c('submissionStatus', 'Submission status'),
      c('submittedAt', 'Submitted at', 'datetime'),
      c('verifiedAt', 'Verified at', 'datetime'),
    ],
  },
  {
    code: 'scheme-history',
    title: 'Scheme 360° history',
    description:
      'Audit and approval history for one scheme and its financial and progress records.',
    requiresScheme: true,
    columns: [
      c('at', 'When', 'datetime'),
      c('source', 'Source'),
      c('entityType', 'Record'),
      c('action', 'Action / decision'),
      c('actor', 'By'),
      c('reason', 'Reason'),
    ],
  },
  {
    code: 'audit-activity',
    title: 'Audit activity',
    description: 'Business audit events in a date range (tenant-wide audit access only).',
    extraPermission: 'audit.view',
    columns: [
      c('at', 'When', 'datetime'),
      c('actor', 'Actor'),
      c('action', 'Action'),
      c('entityType', 'Entity type'),
      c('entityId', 'Entity ID'),
      c('reason', 'Reason'),
      c('requestId', 'Request ID'),
    ],
  },
];

export const REPORT_BY_CODE = new Map(REPORTS.map((r) => [r.code, r]));
