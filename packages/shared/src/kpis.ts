export interface KpiDefinition {
  code: string;
  name: string;
  formula: string;
  numerator: string;
  denominator: string | null;
  basis: 'VERIFIED' | 'REPORTED' | 'PLANNED' | 'COUNT';
  nullRule: string;
}

/**
 * Central KPI catalogue (§5, §9). Financial and physical percentages are not inherently
 * comparable; the physical–financial difference is a review indicator only.
 */
export const KPI_DEFINITIONS: readonly KpiDefinition[] = [
  {
    code: 'FINANCIAL_UTILISATION',
    name: 'Financial utilisation',
    formula: 'verified expenditure / revised approved budget × 100',
    numerator: 'Verified expenditure (verified corrections replace the record they supersede)',
    denominator: 'Revised approved budget (current APPROVED budget version)',
    basis: 'VERIFIED',
    nullRule: 'N/A when the approved budget is missing or zero',
  },
  {
    code: 'RELEASE_UTILISATION',
    name: 'Release utilisation',
    formula: 'verified expenditure / verified funds released × 100',
    numerator: 'Verified expenditure',
    denominator: 'Verified fund releases',
    basis: 'VERIFIED',
    nullRule: 'N/A when no verified release exists',
  },
  {
    code: 'BUDGET_REMAINING',
    name: 'Budget remaining',
    formula: 'revised approved budget − verified expenditure',
    numerator: 'Revised approved budget − verified expenditure',
    denominator: null,
    basis: 'VERIFIED',
    nullRule: 'N/A when the approved budget is missing',
  },
  {
    code: 'UNRELEASED_ALLOCATION',
    name: 'Unreleased allocation',
    formula: 'allocated budget − verified funds released',
    numerator: 'Approved top-level scheme allocations (child allocations are not added again)',
    denominator: null,
    basis: 'VERIFIED',
    nullRule: 'Zero when nothing is allocated',
  },
  {
    code: 'UNSPENT_RELEASED_FUNDS',
    name: 'Unspent released funds',
    formula: 'verified funds released − verified expenditure',
    numerator: 'Verified releases − verified expenditure',
    denominator: null,
    basis: 'VERIFIED',
    nullRule: 'Negative values indicate expenditure above releases (see RELEASE_EXCEEDED)',
  },
  {
    code: 'REPORTED_EXPENDITURE',
    name: 'Reported expenditure',
    formula: 'verified expenditure + submitted (not yet verified) expenditure',
    numerator: 'Verified and submitted expenditure records',
    denominator: null,
    basis: 'REPORTED',
    nullRule: 'Zero when nothing is reported',
  },
  {
    code: 'PHYSICAL_COMPLETION',
    name: 'Physical completion (per scheme)',
    formula: 'Σ weight × min(verified quantity / target quantity, 1) / Σ weight × 100',
    numerator: 'Latest verified cumulative quantity per milestone',
    denominator: 'Sum of milestone weights',
    basis: 'VERIFIED',
    nullRule: 'N/A when no milestone carries weight; never derived from expenditure',
  },
  {
    code: 'PLANNED_PROGRESS',
    name: 'Planned physical progress (per scheme)',
    formula:
      'Σ weight × planned ratio / Σ weight × 100; planned ratio = 1 after the milestone target date, otherwise linear from scheme start date to target date',
    numerator: 'Weighted planned milestone ratio at the cut-off date',
    denominator: 'Sum of milestone weights',
    basis: 'PLANNED',
    nullRule: 'N/A when no milestone carries weight',
  },
  {
    code: 'SCHEDULE_VARIANCE',
    name: 'Schedule variance (per scheme)',
    formula: 'physical completion − planned physical progress (percentage points)',
    numerator: 'Physical completion − planned progress',
    denominator: null,
    basis: 'VERIFIED',
    nullRule: 'N/A when either side is N/A',
  },
  {
    code: 'PHYSICAL_FINANCIAL_DIFFERENCE',
    name: 'Physical–financial difference (per scheme)',
    formula: 'financial utilisation − physical completion (percentage points)',
    numerator: 'Financial utilisation − physical completion',
    denominator: null,
    basis: 'VERIFIED',
    nullRule: 'N/A when either side is N/A. Review indicator, not evidence of misuse',
  },
  {
    code: 'PROGRESS_BANDS',
    name: 'Schemes by physical progress band',
    formula: 'count of schemes per band (0–25, 25–50, 50–75, 75–100, 100, N/A)',
    numerator: 'Scheme count',
    denominator: null,
    basis: 'COUNT',
    nullRule:
      'Used instead of an average because schemes measure incompatible units; no statewide physical percentage is shown',
  },
  {
    code: 'DELAYED_SCHEME',
    name: 'Delayed schemes',
    formula:
      'schemes with a milestone past its target date and below target verified quantity, or past target end date and not completed',
    numerator: 'Scheme count',
    denominator: null,
    basis: 'COUNT',
    nullRule: 'Zero when none',
  },
  {
    code: 'REPORTING_COMPLETENESS',
    name: 'Reporting completeness',
    formula:
      'monitored schemes with a submitted progress report for the period / monitored schemes × 100',
    numerator: 'Schemes with a non-draft submission for the period',
    denominator: 'APPROVED and ACTIVE schemes in scope',
    basis: 'COUNT',
    nullRule: 'N/A when no scheme is in scope',
  },
];
