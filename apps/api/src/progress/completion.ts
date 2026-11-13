import { Prisma } from '@prisma/client';

export interface MilestoneInput {
  id: string;
  weight: Prisma.Decimal;
  targetQuantity: Prisma.Decimal;
}

/**
 * Weighted physical completion (§4): Σ weight × min(completed / target, 1) / Σ weight × 100.
 * `completed` holds the latest verified cumulative quantity per milestone. Returns null (N/A)
 * when no milestone carries weight. Never derived from expenditure.
 */
export function physicalCompletion(
  milestones: MilestoneInput[],
  completed: Map<string, Prisma.Decimal>,
) {
  const one = new Prisma.Decimal(1);
  let totalWeight = new Prisma.Decimal(0);
  let achieved = new Prisma.Decimal(0);
  for (const m of milestones) {
    if (m.weight.lte(0)) continue;
    totalWeight = totalWeight.add(m.weight);
    const q = completed.get(m.id);
    if (!q || m.targetQuantity.lte(0)) continue;
    const ratio = Prisma.Decimal.min(q.div(m.targetQuantity), one);
    achieved = achieved.add(m.weight.mul(ratio));
  }
  if (totalWeight.isZero()) return null;
  return achieved
    .mul(100)
    .div(totalWeight)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    .toFixed(2);
}
