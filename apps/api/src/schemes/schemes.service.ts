import { Injectable } from '@nestjs/common';
import type { Prisma, SchemeStatus } from '@prisma/client';
import type { AuthContext } from '../auth/auth-context';
import { AuthorizationService, forbidden, notFound } from '../authz/authorization.service';
import { audit, badRequest, conflict, versionConflict } from '../common/http';
import { fmt, money } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { coordinateIssue } from '../alerts/gis.service';
import { schemeAllocatedTotal } from './totals';
import type {
  CreateMilestoneDto,
  SchemeLocationDto,
  CreateSchemeDto,
  SchemeDecisionDto,
  SchemeQuery,
  SchemeTransitionDto,
  UpdateSchemeDto,
} from './dto';

/** Allowed post-approval lifecycle moves. Draft → submitted → approved is handled by submit/decide. */
export const TRANSITIONS: Record<string, SchemeStatus[]> = {
  APPROVED: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['SUSPENDED', 'COMPLETED', 'CANCELLED'],
  SUSPENDED: ['ACTIVE', 'CANCELLED'],
  COMPLETED: ['CLOSED'],
};
const REASON_REQUIRED: SchemeStatus[] = ['SUSPENDED', 'CANCELLED'];

const include = {
  jurisdiction: { select: { id: true, code: true, name: true } },
  agency: { select: { id: true, code: true, name: true } },
  financialYear: { select: { id: true, code: true } },
  budgetVersions: { orderBy: { versionNumber: 'asc' as const } },
  budgetAllocations: {
    where: { status: 'APPROVED' as const },
    select: { id: true, parentAllocationId: true, amount: true },
  },
} satisfies Prisma.SchemeInclude;
type Row = Prisma.SchemeGetPayload<{ include: typeof include }>;

const view = (s: Row) => {
  const approved = s.budgetVersions.find((v) => v.status === 'APPROVED');
  const proposed = s.budgetVersions.find((v) => v.status === 'DRAFT');
  return {
    id: s.id,
    schemeCode: s.schemeCode,
    name: s.name,
    category: s.category,
    department: s.department,
    description: s.description,
    objectives: s.objectives,
    status: s.status,
    statusReason: s.statusReason,
    startDate: s.startDate,
    targetEndDate: s.targetEndDate,
    financialYear: s.financialYear,
    jurisdiction: s.jurisdiction,
    agency: s.agency,
    approvedBudget: approved ? fmt(approved.totalAmount) : null,
    proposedBudget: proposed ? fmt(proposed.totalAmount) : null,
    allocatedAmount: fmt(schemeAllocatedTotal(s.budgetAllocations)),
    createdBy: s.createdBy,
    submittedBy: s.submittedById,
    submittedAt: s.submittedAt,
    approvedBy: s.approvedById,
    approvedAt: s.approvedAt,
    version: s.version,
  };
};

@Injectable()
export class SchemesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
  ) {}

  list(auth: AuthContext, q: SchemeQuery) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const f = await this.authz.requireScope(tx, auth.userId, 'scheme.view');
      const where: Prisma.SchemeWhereInput = {
        AND: [
          this.authz.schemeWhere(f),
          q.status ? { status: q.status as SchemeStatus } : {},
          q.financialYearId ? { financialYearId: q.financialYearId } : {},
          q.jurisdictionId
            ? {
                jurisdiction: {
                  OR: [{ id: q.jurisdictionId }, { ancestry: { has: q.jurisdictionId } }],
                },
              }
            : {},
          q.q
            ? {
                OR: [
                  { name: { contains: q.q, mode: 'insensitive' } },
                  { schemeCode: { contains: q.q, mode: 'insensitive' } },
                ],
              }
            : {},
        ],
      };
      const [total, rows] = await Promise.all([
        tx.scheme.count({ where }),
        tx.scheme.findMany({
          where,
          include,
          orderBy: { schemeCode: 'asc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return { items: rows.map(view), total, page: q.page, pageSize: q.pageSize };
    });
  }

  /** Loads a scheme the user may act on for `permission`; out-of-scope records look like missing ones. */
  private async load(
    tx: Prisma.TransactionClient,
    auth: AuthContext,
    id: string,
    permission: string,
  ) {
    const f = await this.authz.requireScope(tx, auth.userId, permission);
    const s = await tx.scheme.findUnique({ where: { id }, include });
    if (!s) throw notFound('Scheme');
    if (!this.authz.schemeInScope(f, s)) {
      const viewF = await this.authz.scopeFor(tx, auth.userId, 'scheme.view');
      if (viewF && this.authz.schemeInScope(viewF, s))
        throw forbidden(
          'SCOPE_OUTSIDE_AUTHORITY',
          'This scheme is outside your authority for this action.',
        );
      throw notFound('Scheme');
    }
    return s;
  }

  get(auth: AuthContext, id: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) =>
      view(await this.load(tx, auth, id, 'scheme.view')),
    );
  }

  create(auth: AuthContext, dto: CreateSchemeDto, requestId?: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const f = await this.authz.requireScope(tx, auth.userId, 'scheme.create');
      if (!this.authz.jurisdictionInScope(f, dto.jurisdictionId))
        throw forbidden(
          'SCOPE_OUTSIDE_AUTHORITY',
          'You cannot create schemes in this jurisdiction.',
        );
      const [j, agency, fy] = await Promise.all([
        tx.jurisdiction.findUnique({ where: { id: dto.jurisdictionId } }),
        tx.agency.findUnique({ where: { id: dto.agencyId } }),
        tx.financialYear.findUnique({ where: { id: dto.financialYearId } }),
      ]);
      if (!j || !agency || !fy)
        throw badRequest('INVALID_REFERENCE', 'Jurisdiction, agency or financial year not found.');
      if (dto.startDate && dto.targetEndDate && dto.targetEndDate < dto.startDate)
        throw badRequest('INVALID_DATES', 'Target end date must be on or after the start date.');
      if (
        await tx.scheme.findUnique({
          where: { tenantId_schemeCode: { tenantId: auth.tenantId, schemeCode: dto.schemeCode } },
        })
      )
        throw conflict('SCHEME_CODE_EXISTS', 'A scheme with this reference already exists.');
      const s = await tx.scheme.create({
        data: {
          tenantId: auth.tenantId,
          schemeCode: dto.schemeCode,
          name: dto.name,
          category: dto.category,
          financialYearId: fy.id,
          agencyId: agency.id,
          jurisdictionId: j.id,
          department: dto.department,
          description: dto.description,
          objectives: dto.objectives,
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          targetEndDate: dto.targetEndDate ? new Date(dto.targetEndDate) : null,
          createdBy: auth.userId,
        },
      });
      if (dto.proposedBudget)
        await tx.budgetVersion.create({
          data: {
            tenantId: auth.tenantId,
            financialYearId: fy.id,
            schemeId: s.id,
            versionNumber: 1,
            totalAmount: money(dto.proposedBudget),
            createdBy: auth.userId,
          },
        });
      const out = view(await tx.scheme.findUniqueOrThrow({ where: { id: s.id }, include }));
      await audit(tx, auth, requestId, {
        action: 'SCHEME_CREATED',
        entityType: 'scheme',
        entityId: s.id,
        after: out,
      });
      return out;
    });
  }

  update(auth: AuthContext, id: string, dto: UpdateSchemeDto, requestId?: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const s = await this.load(tx, auth, id, 'scheme.edit');
      if (!['DRAFT', 'RETURNED'].includes(s.status))
        throw conflict(
          'INVALID_STATE',
          `Schemes can only be edited in DRAFT or RETURNED, not ${s.status}.`,
        );
      const { version, ...fields } = dto;
      const start = fields.startDate ? new Date(fields.startDate) : s.startDate;
      const end = fields.targetEndDate ? new Date(fields.targetEndDate) : s.targetEndDate;
      if (start && end && end < start)
        throw badRequest('INVALID_DATES', 'Target end date must be on or after the start date.');
      const res = await tx.scheme.updateMany({
        where: { id, version },
        data: {
          ...fields,
          startDate: fields.startDate ? new Date(fields.startDate) : undefined,
          targetEndDate: fields.targetEndDate ? new Date(fields.targetEndDate) : undefined,
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw versionConflict();
      const out = view(await tx.scheme.findUniqueOrThrow({ where: { id }, include }));
      await audit(tx, auth, requestId, {
        action: 'SCHEME_UPDATED',
        entityType: 'scheme',
        entityId: id,
        before: view(s),
        after: out,
      });
      return out;
    });
  }

  /** Adds a weighted milestone. Allowed until the first verified progress report, so completion stays consistent. */
  addMilestone(auth: AuthContext, id: string, dto: CreateMilestoneDto, requestId?: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const s = await this.load(tx, auth, id, 'scheme.edit');
      if (!['DRAFT', 'RETURNED', 'SUBMITTED', 'APPROVED', 'ACTIVE'].includes(s.status))
        throw conflict('INVALID_STATE', `Milestones cannot be added to a ${s.status} scheme.`);
      const verified = await tx.progressSubmission.count({
        where: { schemeId: id, status: 'VERIFIED' },
      });
      if (verified)
        throw conflict(
          'PROGRESS_ALREADY_VERIFIED',
          'Milestones are fixed once progress has been verified.',
        );
      const weight = money(dto.weight);
      const qty = money(dto.targetQuantity);
      if (weight.lte(0) || weight.gt(100))
        throw badRequest('INVALID_WEIGHT', 'Weight must be greater than 0 and at most 100.');
      if (qty.lte(0))
        throw badRequest('INVALID_QUANTITY', 'Target quantity must be greater than zero.');
      const existing = await tx.schemeMilestone.findMany({
        where: { schemeId: id },
        select: { weight: true },
      });
      const total = existing.reduce((a, m) => a.add(m.weight), weight);
      if (total.gt(100))
        throw conflict(
          'WEIGHT_EXCEEDED',
          `Milestone weights would total ${total.toFixed(2)}; the maximum is 100.`,
        );
      const m = await tx.schemeMilestone.create({
        data: {
          tenantId: auth.tenantId,
          schemeId: id,
          name: dto.name,
          targetDate: new Date(dto.targetDate),
          targetQuantity: qty,
          unit: dto.unit,
          weight,
          createdBy: auth.userId,
        },
      });
      const out = {
        ...m,
        targetQuantity: m.targetQuantity.toFixed(3),
        weight: m.weight.toFixed(2),
      };
      await audit(tx, auth, requestId, {
        action: 'MILESTONE_ADDED',
        entityType: 'scheme',
        entityId: id,
        after: out,
      });
      return out;
    });
  }

  /** Sets the scheme's single synthetic point location (WGS84), validated against the demo state bounds. */
  setLocation(auth: AuthContext, id: string, dto: SchemeLocationDto, requestId?: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const s = await this.load(tx, auth, id, 'scheme.edit');
      if (['CLOSED', 'CANCELLED'].includes(s.status))
        throw conflict('INVALID_STATE', `The location of a ${s.status} scheme cannot change.`);
      const issue = coordinateIssue(dto.longitude, dto.latitude);
      if (issue)
        throw badRequest(
          'INVALID_COORDINATES',
          `Coordinates rejected (${issue}); use a point inside the synthetic Assam bounds.`,
        );
      const before = await tx.$queryRaw<{ lon: number; lat: number }[]>`
        SELECT ST_X(geometry::geometry) AS lon, ST_Y(geometry::geometry) AS lat FROM scheme_locations WHERE scheme_id = ${id}::uuid`;
      await tx.$executeRaw`DELETE FROM scheme_locations WHERE scheme_id = ${id}::uuid`;
      await tx.$executeRaw`
        INSERT INTO scheme_locations (tenant_id, scheme_id, geometry, location_accuracy, source, created_by)
        VALUES (${auth.tenantId}::uuid, ${id}::uuid,
                ST_SetSRID(ST_MakePoint(${dto.longitude}, ${dto.latitude}), 4326)::geography,
                ${dto.locationAccuracy}, 'manual-synthetic', ${auth.userId}::uuid)`;
      const after = {
        longitude: dto.longitude,
        latitude: dto.latitude,
        locationAccuracy: dto.locationAccuracy,
        crs: 'EPSG:4326',
      };
      await audit(tx, auth, requestId, {
        action: 'SCHEME_LOCATION_SET',
        entityType: 'scheme',
        entityId: id,
        before: before[0] ?? null,
        after,
      });
      return after;
    });
  }

  private async move(
    tx: Prisma.TransactionClient,
    id: string,
    version: number,
    from: SchemeStatus[],
    data: Prisma.SchemeUpdateManyMutationInput,
  ) {
    const res = await tx.scheme.updateMany({
      where: { id, version, status: { in: from } },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count !== 1) throw versionConflict();
  }

  submit(auth: AuthContext, id: string, version: number, requestId?: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const s = await this.load(tx, auth, id, 'scheme.submit');
      if (!['DRAFT', 'RETURNED'].includes(s.status))
        throw conflict('INVALID_STATE', `Cannot submit a scheme in ${s.status}.`);
      await this.move(tx, id, version, ['DRAFT', 'RETURNED'], {
        status: 'SUBMITTED',
        submittedById: auth.userId,
        submittedAt: new Date(),
        statusReason: null,
      });
      await audit(tx, auth, requestId, {
        action: 'SCHEME_SUBMITTED',
        entityType: 'scheme',
        entityId: id,
        before: { status: s.status },
        after: { status: 'SUBMITTED' },
      });
      return view(await tx.scheme.findUniqueOrThrow({ where: { id }, include }));
    });
  }

  decide(auth: AuthContext, id: string, dto: SchemeDecisionDto, requestId?: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const s = await this.load(tx, auth, id, 'scheme.approve');
      if (s.status !== 'SUBMITTED')
        throw conflict('INVALID_STATE', `Only SUBMITTED schemes can be decided (is ${s.status}).`);
      if (s.submittedById === auth.userId || s.createdBy === auth.userId)
        throw forbidden(
          'SELF_APPROVAL_FORBIDDEN',
          'You cannot approve or return a scheme you created or submitted.',
        );
      if (dto.decision === 'RETURN' && !dto.comment)
        throw badRequest('REASON_REQUIRED', 'A comment is required when returning a scheme.');
      const now = new Date();
      if (dto.decision === 'APPROVE') {
        await this.move(tx, id, dto.version, ['SUBMITTED'], {
          status: 'APPROVED',
          approvedById: auth.userId,
          approvedAt: now,
          statusReason: dto.comment,
        });
        const proposed = s.budgetVersions.find((v) => v.status === 'DRAFT');
        if (proposed)
          await tx.budgetVersion.update({
            where: { id: proposed.id },
            data: {
              status: 'APPROVED',
              approvedById: auth.userId,
              approvedAt: now,
              approvalReference: `SCHEME-APPROVAL-${s.schemeCode}`,
              version: { increment: 1 },
            },
          });
      } else {
        await this.move(tx, id, dto.version, ['SUBMITTED'], {
          status: 'RETURNED',
          statusReason: dto.comment,
        });
      }
      const status = dto.decision === 'APPROVE' ? 'APPROVED' : 'RETURNED';
      await audit(tx, auth, requestId, {
        action: `SCHEME_${status}`,
        entityType: 'scheme',
        entityId: id,
        before: { status: s.status },
        after: { status },
        reason: dto.comment,
      });
      return view(await tx.scheme.findUniqueOrThrow({ where: { id }, include }));
    });
  }

  transition(auth: AuthContext, id: string, dto: SchemeTransitionDto, requestId?: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const s = await this.load(tx, auth, id, 'scheme.approve');
      if (!(TRANSITIONS[s.status] ?? []).includes(dto.to))
        throw conflict('INVALID_TRANSITION', `Cannot move a scheme from ${s.status} to ${dto.to}.`);
      if (REASON_REQUIRED.includes(dto.to) && !dto.reason)
        throw badRequest('REASON_REQUIRED', `A reason is required to move to ${dto.to}.`);
      await this.move(tx, id, dto.version, [s.status], {
        status: dto.to,
        statusReason: dto.reason ?? null,
      });
      await audit(tx, auth, requestId, {
        action: 'SCHEME_STATUS_CHANGED',
        entityType: 'scheme',
        entityId: id,
        before: { status: s.status },
        after: { status: dto.to },
        reason: dto.reason,
      });
      return view(await tx.scheme.findUniqueOrThrow({ where: { id }, include }));
    });
  }
}
