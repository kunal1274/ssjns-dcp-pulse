import { Prisma } from '@prisma/client';
import { monthlyPeriods } from '../budget/budget.service';
import { schemeAllocatedTotal } from './totals';

const row = (id: string, parentAllocationId: string | null, amount: string) => ({
  id,
  parentAllocationId,
  amount: new Prisma.Decimal(amount),
});

describe('schemeAllocatedTotal', () => {
  it('counts a fully subdivided parent once', () => {
    expect(
      schemeAllocatedTotal([row('p', null, '100.00'), row('c', 'p', '100.00')]).toFixed(2),
    ).toBe('100.00');
  });

  it('keeps the unassigned remainder of a partially subdivided parent', () => {
    expect(
      schemeAllocatedTotal([row('p', null, '100.00'), row('c', 'p', '20.00')]).toFixed(2),
    ).toBe('100.00');
  });

  it('counts a scheme allocation whose parent is a jurisdiction-only allocation', () => {
    expect(
      schemeAllocatedTotal([row('a', 'district', '30.10'), row('b', 'other', '0.20')]).toFixed(2),
    ).toBe('30.30');
  });
});

describe('monthlyPeriods', () => {
  it('creates one period per month of an April–March year, due on the 10th of the next month', () => {
    const p = monthlyPeriods(new Date('2027-04-01'), new Date('2028-03-31'));
    expect(p.map((x) => x.code)).toEqual([
      '2027-04',
      '2027-05',
      '2027-06',
      '2027-07',
      '2027-08',
      '2027-09',
      '2027-10',
      '2027-11',
      '2027-12',
      '2028-01',
      '2028-02',
      '2028-03',
    ]);
    expect(p[10].endDate.toISOString().slice(0, 10)).toBe('2028-02-29');
    expect(p[11].submissionDueAt.toISOString()).toBe('2028-04-10T12:30:00.000Z');
  });
});
