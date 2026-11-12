/**
 * Loads the synthetic ASSAM-DEMO tenant. Idempotent: exits without changes if
 * the tenant already exists (use `pnpm db:reset` for a clean database).
 *
 * Runs as the database owner (MIGRATION_DATABASE_URL), inside one transaction.
 * Demo passwords come from SEED_DEMO_PASSWORD and are stored only as bcrypt hashes.
 */
import { PERMISSIONS, ROLE_TEMPLATES, SYNTHETIC_DATA_DISCLAIMER } from '@dcp/shared';
import { Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  AGENCIES,
  AGENCY_JURISDICTIONS,
  ALERT_RULES,
  ALERTS,
  DEMO_USERS,
  FINANCIAL_YEAR,
  JURISDICTION_TYPES,
  JURISDICTIONS,
  REPORTING_PERIODS,
  SCHEMES,
  SEED_REFERENCE_DATE,
  SUBMISSIONS,
  TENANT_CODE,
  lakh,
  milestonesFor,
} from './data';

type Tx = Prisma.TransactionClient;
const date = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const ts = (iso: string): Date => new Date(iso);

function demoPassword(): string {
  const value = process.env.SEED_DEMO_PASSWORD;
  if (!value || value.length < 12) {
    throw new Error(
      'SEED_DEMO_PASSWORD must be set to a non-default value of at least 12 characters',
    );
  }
  return value;
}

async function seedTenant(tx: Tx, passwordHash: string): Promise<void> {
  const tenant = await tx.tenant.create({
    data: {
      code: TENANT_CODE,
      name: 'Assam demo tenant (synthetic)',
      settingsJson: {
        currency: 'INR',
        synthetic: true,
        disclaimer: SYNTHETIC_DATA_DISCLAIMER,
        seedReferenceDate: SEED_REFERENCE_DATE,
      },
    },
  });
  const tenantId = tenant.id;

  // Global permission catalogue (upsert: shared by all tenants).
  const permissionIds = new Map<string, string>();
  for (const perm of PERMISSIONS) {
    const row = await tx.permission.upsert({
      where: { code: perm.code },
      update: { resource: perm.resource, action: perm.action, description: perm.description },
      create: perm,
    });
    permissionIds.set(perm.code, row.id);
  }

  const roleIds = new Map<string, string>();
  for (const template of ROLE_TEMPLATES) {
    const role = await tx.role.create({
      data: { tenantId, code: template.code, name: template.name, isSystemTemplate: true },
    });
    roleIds.set(template.code, role.id);
    await tx.rolePermission.createMany({
      data: template.permissions.map((code) => ({
        tenantId,
        roleId: role.id,
        permissionId: permissionIds.get(code)!,
      })),
    });
  }

  const typeIds = new Map<string, string>();
  for (const type of JURISDICTION_TYPES) {
    const row = await tx.jurisdictionType.create({ data: { tenantId, ...type } });
    typeIds.set(type.code, row.id);
  }

  const jurisdictionIds = new Map<string, string>();
  for (const j of JURISDICTIONS) {
    const row = await tx.jurisdiction.create({
      data: {
        tenantId,
        code: j.code,
        name: j.name,
        typeId: typeIds.get(j.type)!,
        parentId: j.parent ? jurisdictionIds.get(j.parent)! : null,
      },
    });
    jurisdictionIds.set(j.code, row.id);
  }
  const districtOf = (coDistrict: string): string =>
    JURISDICTIONS.find((j) => j.code === coDistrict)!.parent!;

  const agencyIds = new Map<string, string>();
  for (const a of AGENCIES) {
    const row = await tx.agency.create({ data: { tenantId, ...a } });
    agencyIds.set(a.code, row.id);
  }
  await tx.agencyJurisdiction.createMany({
    data: AGENCY_JURISDICTIONS.map((aj) => ({
      tenantId,
      agencyId: agencyIds.get(aj.agency)!,
      jurisdictionId: jurisdictionIds.get(aj.jurisdiction)!,
      relationshipType: aj.relationshipType,
      effectiveFrom: date(FINANCIAL_YEAR.startDate),
    })),
  });

  const userIds = new Map<string, string>();
  for (const u of DEMO_USERS) {
    const user = await tx.user.create({
      data: { tenantId, email: u.email, name: u.name, credentialRef: 'local:user_credentials' },
    });
    userIds.set(u.email, user.id);
    await tx.userCredential.create({ data: { tenantId, userId: user.id, passwordHash } });
    for (const scope of u.scopes) {
      await tx.userRoleScope.create({
        data: {
          tenantId,
          userId: user.id,
          roleId: roleIds.get(u.role)!,
          scopeType: scope.type,
          scopeId: scope.type === 'TENANT' ? tenantId : jurisdictionIds.get(scope.code)!,
          validFrom: date(FINANCIAL_YEAR.startDate),
        },
      });
    }
  }
  const user = (email: string): string => userIds.get(email)!;
  const planner = user('state.planner@example.test');
  const fieldOfficer = user('field.officer@example.test');
  const financeReviewer = user('finance.reviewer@example.test');
  const districtReviewer = user('district.reviewer@example.test');

  const fy = await tx.financialYear.create({
    data: {
      tenantId,
      code: FINANCIAL_YEAR.code,
      startDate: date(FINANCIAL_YEAR.startDate),
      endDate: date(FINANCIAL_YEAR.endDate),
      status: 'OPEN',
    },
  });

  const periodIds = new Map<string, string>();
  for (const p of REPORTING_PERIODS) {
    const row = await tx.reportingPeriod.create({
      data: {
        tenantId,
        financialYearId: fy.id,
        code: p.code,
        startDate: date(p.startDate),
        endDate: date(p.endDate),
        submissionDueAt: ts(p.submissionDueAt),
      },
    });
    periodIds.set(p.code, row.id);
  }

  const schemeIds = new Map<string, string>();
  const milestoneIds = new Map<string, string[]>();
  for (const s of SCHEMES) {
    const scheme = await tx.scheme.create({
      data: {
        tenantId,
        schemeCode: s.code,
        name: s.name,
        category: s.category,
        financialYearId: fy.id,
        agencyId: agencyIds.get(s.agency)!,
        jurisdictionId: jurisdictionIds.get(s.coDistrict)!,
        status: s.status,
        startDate: date('2026-05-01'),
        targetEndDate: date('2027-03-31'),
        createdBy: planner,
      },
    });
    schemeIds.set(s.code, scheme.id);

    await tx.$executeRaw`
      INSERT INTO scheme_locations (tenant_id, scheme_id, geometry, location_accuracy, source, created_by)
      VALUES (${tenantId}::uuid, ${scheme.id}::uuid,
              ST_SetSRID(ST_MakePoint(${s.point[0]}, ${s.point[1]}), 4326)::geography,
              'SYNTHETIC_APPROXIMATE', 'synthetic-seed', ${planner}::uuid)`;

    const ids: string[] = [];
    for (const m of milestonesFor(s)) {
      const row = await tx.schemeMilestone.create({
        data: { tenantId, schemeId: scheme.id, ...m, targetDate: date(m.targetDate) },
      });
      ids.push(row.id);
    }
    milestoneIds.set(s.code, ids);

    // Budget versions: optional superseded original, then the approved (revised) version.
    let versionNumber = 1;
    if (s.originalBudgetLakh !== undefined) {
      await tx.budgetVersion.create({
        data: {
          tenantId,
          financialYearId: fy.id,
          schemeId: scheme.id,
          versionNumber: versionNumber++,
          status: 'SUPERSEDED',
          totalAmount: lakh(s.originalBudgetLakh),
          approvedAt: ts('2026-04-20T10:00:00+05:30'),
          approvalReference: `SYN-BUD-${s.code}-V1`,
          approvedById: planner,
        },
      });
    }
    const approved = await tx.budgetVersion.create({
      data: {
        tenantId,
        financialYearId: fy.id,
        schemeId: scheme.id,
        versionNumber,
        status: 'APPROVED',
        totalAmount: lakh(s.budgetLakh),
        revisionReason:
          s.originalBudgetLakh !== undefined ? 'Synthetic mid-year scope revision' : null,
        approvedAt: ts('2026-07-15T10:00:00+05:30'),
        approvalReference: `SYN-BUD-${s.code}-V${versionNumber}`,
        approvedById: planner,
      },
    });

    // Top-level allocation to the district, leaf allocation to the co-district.
    const top = await tx.budgetAllocation.create({
      data: {
        tenantId,
        budgetVersionId: approved.id,
        recipientJurisdictionId: jurisdictionIds.get(districtOf(s.coDistrict))!,
        schemeId: scheme.id,
        amount: lakh(s.budgetLakh),
        status: 'APPROVED',
        approvedById: planner,
        approvedAt: ts('2026-07-16T10:00:00+05:30'),
      },
    });
    await tx.budgetAllocation.create({
      data: {
        tenantId,
        budgetVersionId: approved.id,
        parentAllocationId: top.id,
        recipientJurisdictionId: jurisdictionIds.get(s.coDistrict)!,
        schemeId: scheme.id,
        amount: lakh(s.budgetLakh),
        status: 'APPROVED',
        approvedById: planner,
        approvedAt: ts('2026-07-17T10:00:00+05:30'),
      },
    });

    for (const [i, amount] of s.releasesLakh.entries()) {
      await tx.fundRelease.create({
        data: {
          tenantId,
          schemeId: scheme.id,
          amount: lakh(amount),
          releaseDate: date(i === 0 ? '2026-08-05' : '2026-10-05'),
          reference: `SYN-REL-${s.code}-${i + 1}`,
          sourceSystem: 'MANUAL_DEMO',
          verificationStatus: 'VERIFIED',
          createdBy: financeReviewer,
        },
      });
    }

    for (const [i, amount] of s.verifiedExpenditureLakh.entries()) {
      const period = i === 0 ? '2026-09' : '2026-10';
      await tx.expenditureRecord.create({
        data: {
          tenantId,
          schemeId: scheme.id,
          periodId: periodIds.get(period)!,
          amount: lakh(amount),
          expenditureDate: date(`${period}-25`),
          reference: `SYN-EXP-${s.code}-${i + 1}`,
          status: 'VERIFIED',
          source: 'MANUAL_DEMO',
          submittedById: fieldOfficer,
          verifiedById: financeReviewer,
          verifiedAt: ts(`${period}-28T12:00:00+05:30`),
        },
      });
    }
  }
  const scheme = (code: string): string => schemeIds.get(code)!;

  // Reported (unverified) records illustrating the verified-vs-reported basis.
  await tx.fundRelease.create({
    data: {
      tenantId,
      schemeId: scheme('DEMO-002'),
      amount: lakh(10),
      releaseDate: date('2026-11-05'),
      reference: 'SYN-REL-DEMO-002-PENDING',
      sourceSystem: 'MANUAL_DEMO',
      verificationStatus: 'PENDING',
    },
  });
  await tx.expenditureRecord.create({
    data: {
      tenantId,
      schemeId: scheme('DEMO-003'),
      periodId: periodIds.get('2026-10')!,
      amount: lakh(5),
      expenditureDate: date('2026-10-20'),
      reference: 'SYN-EXP-DEMO-003-REPORTED',
      status: 'SUBMITTED',
      source: 'MANUAL_DEMO',
      submittedById: fieldOfficer,
    },
  });

  await tx.commitment.createMany({
    data: [
      {
        tenantId,
        schemeId: scheme('DEMO-001'),
        amount: lakh(10),
        reference: 'SYN-COM-DEMO-001-1',
        recordedAt: ts('2026-10-10T10:00:00+05:30'),
      },
      {
        tenantId,
        schemeId: scheme('DEMO-004'),
        amount: lakh(5),
        reference: 'SYN-COM-DEMO-004-1',
        recordedAt: ts('2026-10-12T10:00:00+05:30'),
      },
    ],
  });

  await tx.budgetRequest.createMany({
    data: [
      {
        tenantId,
        schemeId: scheme('DEMO-007'),
        requestingAgencyId: agencyIds.get('AG-ROADS')!,
        periodId: periodIds.get('2026-11')!,
        amount: lakh(25),
        justification: 'Synthetic request: next release for approach road works.',
        status: 'SUBMITTED',
        submittedById: fieldOfficer,
      },
      {
        tenantId,
        schemeId: scheme('DEMO-004'),
        requestingAgencyId: agencyIds.get('AG-ROADS')!,
        periodId: periodIds.get('2026-11')!,
        amount: lakh(15),
        justification: 'Synthetic request: stage 2 earthwork.',
        status: 'DISTRICT_REVIEW',
        submittedById: fieldOfficer,
      },
      {
        tenantId,
        schemeId: scheme('DEMO-010'),
        requestingAgencyId: agencyIds.get('AG-ROADS')!,
        periodId: periodIds.get('2026-10')!,
        amount: lakh(10),
        justification: 'Synthetic request: culvert works.',
        status: 'APPROVED',
        submittedById: fieldOfficer,
      },
    ],
  });

  // Progress submissions with maker-checker workflow history.
  const definition = await tx.workflowDefinition.create({
    data: {
      tenantId,
      code: 'PROGRESS_SUBMISSION',
      entityType: 'progress_submission',
      definitionJson: {
        illustrative: true,
        states: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'RETURNED', 'RESUBMITTED'],
        transitions: [
          ['DRAFT', 'SUBMITTED'],
          ['SUBMITTED', 'UNDER_REVIEW'],
          ['UNDER_REVIEW', 'VERIFIED'],
          ['UNDER_REVIEW', 'RETURNED'],
          ['RETURNED', 'RESUBMITTED'],
          ['RESUBMITTED', 'UNDER_REVIEW'],
        ],
        selfApproval: false,
      },
    },
  });

  for (const sub of SUBMISSIONS) {
    // Created as SUBMITTED so measurements can be attached before verification locks them.
    const submission = await tx.progressSubmission.create({
      data: {
        tenantId,
        schemeId: scheme(sub.scheme),
        periodId: periodIds.get(sub.period)!,
        status: 'SUBMITTED',
        submittedById: fieldOfficer,
        submittedAt: ts('2026-11-05T11:00:00+05:30'),
        remarks: sub.remarks,
      },
    });
    await tx.progressMeasurement.create({
      data: {
        tenantId,
        submissionId: submission.id,
        milestoneId: milestoneIds.get(sub.scheme)![0],
        quantityCompleted: sub.stage1Quantity,
      },
    });
    if (sub.status !== 'SUBMITTED') {
      await tx.progressSubmission.update({
        where: { id: submission.id },
        data: { status: sub.status },
      });
    }

    const instance = await tx.workflowInstance.create({
      data: {
        tenantId,
        entityType: 'progress_submission',
        entityId: submission.id,
        definitionId: definition.id,
        currentState: sub.status,
      },
    });
    if (sub.decision) {
      await tx.approvalDecision.create({
        data: {
          tenantId,
          workflowInstanceId: instance.id,
          step: 'DISTRICT_VERIFICATION',
          actorId: districtReviewer,
          decision: sub.decision.decision,
          reason: sub.decision.reason ?? null,
          decidedAt: ts('2026-11-08T15:00:00+05:30'),
        },
      });
    }
  }

  const ruleIds = new Map<string, string>();
  for (const rule of ALERT_RULES) {
    const row = await tx.alertRule.create({
      data: {
        tenantId,
        ruleCode: rule.ruleCode,
        scopeType: 'TENANT',
        scopeId: tenantId,
        effectiveFrom: date(FINANCIAL_YEAR.startDate),
        thresholdJson: rule.threshold,
        severity: rule.severity,
        ownerRoleCode: 'DISTRICT_REVIEWER',
        notificationChannel: 'IN_APP',
        dedupKeyTemplate: `${rule.ruleCode}:{schemeCode}:{periodOrMilestone}`,
        isIllustrative: true,
      },
    });
    ruleIds.set(rule.ruleCode, row.id);
  }

  for (const alert of ALERTS) {
    await tx.alert.create({
      data: {
        tenantId,
        schemeId: scheme(alert.scheme),
        ruleId: ruleIds.get(alert.ruleCode)!,
        ruleCode: alert.ruleCode,
        dedupKey: alert.dedupKey,
        severity: alert.severity,
        status: alert.status,
        assigneeId: alert.status === 'ACKNOWLEDGED' ? districtReviewer : null,
        detectedAt: ts('2026-11-10T06:00:00+05:30'),
        contextJson: { ...alert.context, seeded: true, illustrative: true },
      },
    });
  }

  await tx.auditEvent.create({
    data: {
      tenantId,
      action: 'SEED_LOADED',
      entityType: 'tenant',
      entityId: tenantId,
      afterJson: { schemes: SCHEMES.length, users: DEMO_USERS.length, synthetic: true },
      reason: 'Synthetic demo data loaded by prisma/seed/seed.ts',
    },
  });
}

async function main(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL is required');
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const existing = await prisma.tenant.findUnique({ where: { code: TENANT_CODE } });
    if (existing) {
      console.info(`Tenant ${TENANT_CODE} already seeded; no changes made.`);
      return;
    }
    const passwordHash = await bcrypt.hash(demoPassword(), 12);
    await prisma.$transaction((tx) => seedTenant(tx, passwordHash), { timeout: 120_000 });
    console.info(
      `Seeded tenant ${TENANT_CODE}: ${SCHEMES.length} schemes, ${DEMO_USERS.length} users.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
