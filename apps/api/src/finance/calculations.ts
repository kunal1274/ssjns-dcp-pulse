import { Prisma } from '@prisma/client';
import { sum } from '../common/money';

/**
 * Sum of verified records, where a verified correction replaces the record it supersedes,
 * so each financial fact is counted once.
 */
export function effectiveVerified(
  rows: { id: string; amount: Prisma.Decimal; supersedesId: string | null; verified: boolean }[],
) {
  const replaced = new Set(
    rows.filter((r) => r.verified && r.supersedesId).map((r) => r.supersedesId),
  );
  return sum(rows.filter((r) => r.verified && !replaced.has(r.id)).map((r) => r.amount));
}

/** numerator / denominator × 100 to 2 decimals; null (N/A) for a missing or zero denominator. */
export function percent(numerator: Prisma.Decimal, denominator: Prisma.Decimal | null) {
  if (!denominator || denominator.isZero()) return null;
  return numerator
    .mul(100)
    .div(denominator)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    .toFixed(2);
}
