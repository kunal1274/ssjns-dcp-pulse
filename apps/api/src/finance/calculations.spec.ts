import { Prisma } from '@prisma/client';
import { physicalCompletion } from '../progress/completion';
import { effectiveVerified, percent } from './calculations';

const d = (v: string) => new Prisma.Decimal(v);

describe('effectiveVerified', () => {
  it('counts only verified rows', () => {
    const rows = [
      { id: 'a', amount: d('100.00'), supersedesId: null, verified: true },
      { id: 'b', amount: d('50.00'), supersedesId: null, verified: false },
    ];
    expect(effectiveVerified(rows).toFixed(2)).toBe('100.00');
  });
  it('replaces a record with its verified correction, but not with a pending one', () => {
    const original = { id: 'a', amount: d('350000.00'), supersedesId: null, verified: true };
    const pending = { id: 'b', amount: d('340000.00'), supersedesId: 'a', verified: false };
    expect(effectiveVerified([original, pending]).toFixed(2)).toBe('350000.00');
    expect(effectiveVerified([original, { ...pending, verified: true }]).toFixed(2)).toBe(
      '340000.00',
    );
  });
  it('follows a chain of verified corrections', () => {
    const rows = [
      { id: 'a', amount: d('10.00'), supersedesId: null, verified: true },
      { id: 'b', amount: d('11.00'), supersedesId: 'a', verified: true },
      { id: 'c', amount: d('12.00'), supersedesId: 'b', verified: true },
    ];
    expect(effectiveVerified(rows).toFixed(2)).toBe('12.00');
  });
});

describe('percent', () => {
  it('is exact to two decimals with half-up rounding', () => {
    expect(percent(d('340000'), d('700000'))).toBe('48.57');
    expect(percent(d('5500000'), d('10000000'))).toBe('55.00');
    expect(percent(d('1'), d('8'))).toBe('12.50');
  });
  it('is N/A (null) for a missing or zero denominator', () => {
    expect(percent(d('1'), null)).toBeNull();
    expect(percent(d('1'), d('0'))).toBeNull();
  });
});

describe('physicalCompletion', () => {
  const ms = [
    { id: 'm1', weight: d('60'), targetQuantity: d('10') },
    { id: 'm2', weight: d('40'), targetQuantity: d('5') },
  ];
  it('weights milestone ratios', () => {
    expect(
      physicalCompletion(
        ms,
        new Map([
          ['m1', d('4')],
          ['m2', d('5')],
        ]),
      ),
    ).toBe('64.00');
  });
  it('caps each milestone at 100%', () => {
    expect(
      physicalCompletion(
        ms,
        new Map([
          ['m1', d('25')],
          ['m2', d('5')],
        ]),
      ),
    ).toBe('100.00');
  });
  it('treats unmeasured milestones as zero', () => {
    expect(physicalCompletion(ms, new Map())).toBe('0.00');
  });
  it('is N/A when no milestone carries weight', () => {
    expect(
      physicalCompletion([{ id: 'x', weight: d('0'), targetQuantity: d('1') }], new Map()),
    ).toBeNull();
    expect(physicalCompletion([], new Map())).toBeNull();
  });
});
