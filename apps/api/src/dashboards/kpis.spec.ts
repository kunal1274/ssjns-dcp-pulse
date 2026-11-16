import { kpis, schemeView } from './dashboards.service';
import type { AggregateRow, SchemeRow } from './kpi.sql';

const agg = (o: Partial<AggregateRow>): AggregateRow => ({
  scheme_count: 1,
  active_count: 1,
  approved_budget: '0.00',
  original_budget: '0.00',
  allocated: '0.00',
  verified_releases: '0.00',
  verified_expenditure: '0.00',
  reported_expenditure: '0.00',
  open_commitments: '0.00',
  pending_financial: 0,
  pending_progress: 0,
  open_alerts: 0,
  delayed_count: 0,
  corrective_count: 0,
  milestones_delayed: 0,
  band_na: 0,
  band_0_25: 0,
  band_25_50: 0,
  band_50_75: 0,
  band_75_100: 0,
  band_100: 0,
  last_verified_at: null,
  ...o,
});

describe('dashboard KPI derivation', () => {
  it('reproduces the DEMO-001 example with exact decimals', () => {
    const k = kpis(
      agg({
        approved_budget: '10000000.00',
        allocated: '10000000.00',
        verified_releases: '7000000.00',
        verified_expenditure: '5500000.00',
      }),
    );
    expect(k.financialUtilisationPercent).toBe('55.00');
    expect(k.releaseUtilisationPercent).toBe('78.57');
    expect(k.budgetRemaining).toBe('4500000.00');
    expect(k.unreleasedAllocation).toBe('3000000.00');
    expect(k.unspentReleasedFunds).toBe('1500000.00');
  });

  it('returns null for zero denominators', () => {
    const k = kpis(agg({ verified_expenditure: '10.00' }));
    expect(k.financialUtilisationPercent).toBeNull();
    expect(k.releaseUtilisationPercent).toBeNull();
  });

  it('avoids binary floating point error', () => {
    const k = kpis(
      agg({ approved_budget: '0.30', verified_expenditure: '0.10', verified_releases: '0.20' }),
    );
    expect(k.budgetRemaining).toBe('0.20');
    expect(k.unspentReleasedFunds).toBe('0.10');
  });

  it('computes the physical–financial difference only when both sides exist', () => {
    const base = {
      id: 'x',
      scheme_code: 'X',
      name: 'X',
      category: 'c',
      status: 'ACTIVE',
      department: null,
      jurisdiction_id: 'j',
      approved_budget: '100.00',
      allocated: '100.00',
      verified_releases: '70.00',
      verified_expenditure: '55.00',
      reported_expenditure: '55.00',
      open_commitments: '0.00',
      physical: '40.00',
      planned: '50.00',
      fin_util: '55.00',
      pending_financial: 0,
      pending_progress: 0,
      open_alerts: 0,
      milestones: 1,
      milestones_done: 0,
      milestones_delayed: 0,
      delayed: false,
      last_verified_period: null,
      target_end_date: null,
    } satisfies SchemeRow;
    expect(schemeView(base).physicalFinancialDifferencePoints).toBe('15.00');
    expect(schemeView(base).scheduleVariancePoints).toBe('-10.00');
    expect(schemeView({ ...base, physical: null }).physicalFinancialDifferencePoints).toBeNull();
  });
});
