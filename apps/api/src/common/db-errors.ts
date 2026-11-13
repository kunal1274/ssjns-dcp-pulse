import { UnprocessableEntityException } from '@nestjs/common';

const RULES = [
  'ALLOCATION_CEILING_EXCEEDED',
  'ALLOCATION_BELOW_CHILD_TOTAL',
  'ALLOCATION_REQUIRES_APPROVED_BUDGET_VERSION',
  'ALLOCATION_REQUIRES_APPROVED_PARENT',
  'ALLOCATION_PARENT_VERSION_MISMATCH',
  'ALLOCATION_PARENT_IS_SCHEME_LEAF',
];

/** Turns database financial-rule violations (raised by triggers) into 422 responses. */
export function mapDbError(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  const rule = RULES.find((r) => msg.includes(r));
  if (rule)
    throw new UnprocessableEntityException({
      error: rule,
      message: 'The database rejected this change: ' + rule,
    });
  if (/_no_self_(approval|review|decision)/.test(msg))
    throw new UnprocessableEntityException({
      error: 'SELF_APPROVAL_FORBIDDEN',
      message: 'You cannot approve your own submission.',
    });
  throw e;
}
