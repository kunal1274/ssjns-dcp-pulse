import { pickRule, schemeFinding, thresholdError, type RuleRow, type SchemeFacts } from './rules';

const now = new Date('2026-11-15T00:00:00Z');
const facts: SchemeFacts = {
  schemeCode: 'DEMO-001',
  approved: '10000000.00',
  allocated: '10000000.00',
  releases: '7000000.00',
  expenditure: '5500000.00',
  physical: '40.00',
  finUtil: '55.00',
  lastVerifiedAt: new Date('2026-11-01T00:00:00Z'),
  startDate: new Date('2026-05-01T00:00:00Z'),
};
const rule = (p: Partial<RuleRow>): RuleRow => ({
  id: 'r',
  ruleCode: 'PHYSICAL_FINANCIAL_GAP',
  scopeType: 'TENANT',
  scopeId: 't',
  severity: 'MEDIUM',
  thresholdJson: {},
  enabled: true,
  evaluationFrequency: 'DAILY',
  lastEvaluatedAt: null,
  effectiveFrom: new Date('2026-04-01'),
  updatedAt: now,
  ...p,
});

describe('alert rules', () => {
  it('PHYSICAL_FINANCIAL_GAP fires at exactly the configured 15-point gap and not above it', () => {
    const f = schemeFinding('PHYSICAL_FINANCIAL_GAP', { gapPercentagePoints: 15 }, facts, now);
    expect(f?.key).toBe('PHYSICAL_FINANCIAL_GAP:DEMO-001');
    expect(f?.context.gapPercentagePoints).toBe('15.00');
    expect(f?.context.direction).toBe('SPENDING_AHEAD_OF_PROGRESS');
    expect(
      schemeFinding('PHYSICAL_FINANCIAL_GAP', { gapPercentagePoints: 16 }, facts, now),
    ).toBeNull();
    expect(
      schemeFinding(
        'PHYSICAL_FINANCIAL_GAP',
        { gapPercentagePoints: 15 },
        { ...facts, physical: null },
        now,
      ),
    ).toBeNull();
  });

  it('RELEASE_EXCEEDED and ALLOCATION_EXCEEDED compare exact decimals with tolerance', () => {
    const t = { toleranceAmount: '0.00' };
    expect(schemeFinding('RELEASE_EXCEEDED', t, facts, now)).toBeNull();
    const over = schemeFinding('RELEASE_EXCEEDED', t, { ...facts, expenditure: '7000000.01' }, now);
    expect(over?.context.excess).toBe('0.01');
    expect(
      schemeFinding(
        'RELEASE_EXCEEDED',
        { toleranceAmount: '0.01' },
        { ...facts, expenditure: '7000000.01' },
        now,
      ),
    ).toBeNull();
    expect(schemeFinding('ALLOCATION_EXCEEDED', t, facts, now)).toBeNull();
    expect(
      schemeFinding('ALLOCATION_EXCEEDED', t, { ...facts, releases: '10000000.50' }, now)?.context
        .releasesOverAllocation,
    ).toBe('0.50');
  });

  it('DATA_STALE uses the last verified update, or the start date when nothing is verified', () => {
    const t = { maxDaysSinceVerifiedUpdate: 45 };
    expect(schemeFinding('DATA_STALE', t, facts, now)).toBeNull();
    const stale = schemeFinding('DATA_STALE', t, { ...facts, lastVerifiedAt: null }, now);
    expect(stale?.context.daysSinceVerifiedUpdate).toBe(198);
  });

  it('validates thresholds per rule', () => {
    expect(thresholdError('PHYSICAL_FINANCIAL_GAP', { gapPercentagePoints: 15 })).toBeNull();
    expect(thresholdError('PHYSICAL_FINANCIAL_GAP', { gapPercentagePoints: 0 })).toMatch(/1–100/);
    expect(thresholdError('RELEASE_EXCEEDED', { toleranceAmount: 1 })).toMatch(/money/);
    expect(thresholdError('REPORT_OVERDUE', { graceDays: 5, extra: 1 })).toMatch(/allowed keys/);
    expect(thresholdError('EVIDENCE_MISSING', { requiredForStatus: 'DRAFT' })).toMatch(/SUBMITTED/);
  });

  it('picks the most specific rule; a disabled specific rule still wins', () => {
    const s = { id: 's', jurisdictionId: 'cd', agencyId: 'a', ancestry: ['state', 'dist'] };
    const tenant = rule({ id: 'tenant' });
    const dist = rule({ id: 'dist', scopeType: 'JURISDICTION', scopeId: 'dist' });
    const cd = rule({ id: 'cd', scopeType: 'JURISDICTION', scopeId: 'cd', enabled: false });
    const other = rule({ id: 'other', scopeType: 'JURISDICTION', scopeId: 'elsewhere' });
    expect(pickRule([tenant, other], s)?.id).toBe('tenant');
    expect(pickRule([tenant, dist, other], s)?.id).toBe('dist');
    expect(pickRule([cd, tenant, dist], s)?.id).toBe('cd');
    expect(pickRule([rule({ id: 'sch', scopeType: 'SCHEME', scopeId: 's' }), cd], s)?.id).toBe(
      'sch',
    );
    expect(pickRule([other], s)).toBeNull();
  });
});
