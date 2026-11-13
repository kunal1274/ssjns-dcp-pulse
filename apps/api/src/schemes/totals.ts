import type { Prisma } from '@prisma/client';
import { sum } from '../common/money';

/**
 * A scheme's approved allocation total. A child allocation for the same scheme draws from its
 * parent, so only allocations whose parent is not itself one of the scheme's allocations count.
 */
export const schemeAllocatedTotal = (
  rows: { id: string; parentAllocationId: string | null; amount: Prisma.Decimal }[],
) => {
  const ids = new Set(rows.map((a) => a.id));
  return sum(
    rows
      .filter((a) => !a.parentAllocationId || !ids.has(a.parentAllocationId))
      .map((a) => a.amount),
  );
};
