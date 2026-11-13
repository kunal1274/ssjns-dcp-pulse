import type { Prisma } from '@prisma/client';
import type { AuthContext } from '../auth/auth-context';
import { forbidden } from '../authz/authorization.service';

export type WorkflowEntity = 'fund_release' | 'expenditure_record' | 'progress_submission';

const DEFINITIONS: Record<WorkflowEntity, { code: string; states: string[] }> = {
  fund_release: { code: 'FUND_RELEASE', states: ['PENDING', 'VERIFIED', 'REJECTED'] },
  expenditure_record: {
    code: 'EXPENDITURE',
    states: ['SUBMITTED', 'VERIFIED', 'RETURNED', 'REJECTED'],
  },
  progress_submission: {
    code: 'PROGRESS_SUBMISSION',
    states: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'RETURNED', 'RESUBMITTED'],
  },
};

export const selfDecision = () =>
  forbidden('SELF_APPROVAL_FORBIDDEN', 'You cannot verify or decide your own submission.');

/**
 * Records a maker-checker step in workflow_instances / approval_decisions inside the
 * caller's transaction. The instance is created on first use with the tenant's active definition.
 */
export async function recordStep(
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  entityType: WorkflowEntity,
  entityId: string,
  step: string,
  decision: string,
  state: string,
  reason?: string | null,
) {
  const def = DEFINITIONS[entityType];
  const definition =
    (await tx.workflowDefinition.findFirst({
      where: { code: def.code, entityType, isActive: true },
      orderBy: { version: 'desc' },
    })) ??
    (await tx.workflowDefinition.create({
      data: {
        tenantId: auth.tenantId,
        code: def.code,
        entityType,
        definitionJson: { illustrative: true, states: def.states, selfApproval: false },
        createdBy: auth.userId,
      },
    }));
  const instance = await tx.workflowInstance.upsert({
    where: { tenantId_entityType_entityId: { tenantId: auth.tenantId, entityType, entityId } },
    create: {
      tenantId: auth.tenantId,
      entityType,
      entityId,
      definitionId: definition.id,
      currentState: state,
      createdBy: auth.userId,
    },
    update: { currentState: state, version: { increment: 1 } },
  });
  await tx.approvalDecision.create({
    data: {
      tenantId: auth.tenantId,
      workflowInstanceId: instance.id,
      step,
      actorId: auth.userId,
      decision,
      reason: reason ?? null,
      createdBy: auth.userId,
    },
  });
}

export async function history(
  tx: Prisma.TransactionClient,
  entityType: WorkflowEntity,
  entityId: string,
) {
  const instance = await tx.workflowInstance.findFirst({
    where: { entityType, entityId },
    include: {
      decisions: {
        orderBy: { decidedAt: 'asc' },
        include: { actor: { select: { id: true, name: true } } },
      },
    },
  });
  return (instance?.decisions ?? []).map((d) => ({
    step: d.step,
    decision: d.decision,
    reason: d.reason,
    actor: d.actor,
    decidedAt: d.decidedAt,
  }));
}
