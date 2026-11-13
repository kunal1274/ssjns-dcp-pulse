import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthContext } from '../auth/auth-context';
import { AuthorizationService, notFound, type ScopeFilter } from '../authz/authorization.service';
import { mapDbError } from '../common/db-errors';
import { audit, badRequest, conflict, versionConflict } from '../common/http';
import { idempotent } from '../common/idempotency';
import { history, recordStep, selfDecision } from '../finance/workflow';
import { PrismaService } from '../prisma/prisma.service';
import { physicalCompletion } from './completion';
import type {
  CreateProgressDto,
  MeasurementDto,
  ProgressQuery,
  ProgressReturnDto,
  UpdateProgressDto,
} from './dto';

const include = {
  scheme: { select: { id: true, schemeCode: true, name: true } },
  period: { select: { id: true, code: true } },
  measurements: {
    include: {
      milestone: {
        select: { id: true, name: true, unit: true, targetQuantity: true, weight: true },
      },
    },
  },
} satisfies Prisma.ProgressSubmissionInclude;
type Row = Prisma.ProgressSubmissionGetPayload<{ include: typeof include }>;

const view = (p: Row) => ({
  ...p,
  measurements: p.measurements.map((m) => ({
    id: m.id,
    milestoneId: m.milestoneId,
    milestone: {
      ...m.milestone,
      targetQuantity: m.milestone.targetQuantity.toFixed(3),
      weight: m.milestone.weight.toFixed(2),
    },
    quantityCompleted: m.quantityCompleted.toFixed(3),
    notes: m.measurementNotes,
  })),
});

const OPEN_FOR_EDIT = ['DRAFT', 'RETURNED'] as const;
const REVIEWABLE = ['SUBMITTED', 'RESUBMITTED', 'UNDER_REVIEW'] as const;

@Injectable()
export class ProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
  ) {}

  private run<T>(auth: AuthContext, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.withTenant(auth.tenantId, fn).catch(mapDbError);
  }

  private async scheme(tx: Prisma.TransactionClient, f: ScopeFilter, id: string) {
    const s = await tx.scheme.findUnique({ where: { id } });
    if (!s || !this.authz.schemeInScope(f, s)) throw notFound('Scheme');
    return s;
  }

  private async load(tx: Prisma.TransactionClient, f: ScopeFilter, id: string) {
    const p = await tx.progressSubmission.findUnique({ where: { id }, include });
    if (!p) throw notFound('Progress submission');
    const s = await tx.scheme.findUniqueOrThrow({ where: { id: p.schemeId } });
    if (!this.authz.schemeInScope(f, s)) throw notFound('Progress submission');
    return p;
  }

  private async validateMeasurements(
    tx: Prisma.TransactionClient,
    schemeId: string,
    ms: MeasurementDto[],
  ) {
    const ids = ms.map((m) => m.milestoneId);
    if (new Set(ids).size !== ids.length)
      throw badRequest(
        'DUPLICATE_MILESTONE',
        'Each milestone may be measured once per submission.',
      );
    const found = await tx.schemeMilestone.count({ where: { id: { in: ids }, schemeId } });
    if (found !== ids.length)
      throw badRequest('INVALID_MILESTONE', 'A milestone does not belong to this scheme.');
  }

  private measurementRows(auth: AuthContext, submissionId: string, ms: MeasurementDto[]) {
    return ms.map((m) => ({
      tenantId: auth.tenantId,
      submissionId,
      milestoneId: m.milestoneId,
      quantityCompleted: new Prisma.Decimal(m.quantityCompleted),
      measurementNotes: m.notes ?? null,
      createdBy: auth.userId,
    }));
  }

  list(auth: AuthContext, q: ProgressQuery) {
    return this.run(auth, async (tx) => {
      const f = await this.authz.requireScope(tx, auth.userId, 'scheme.view');
      const where: Prisma.ProgressSubmissionWhereInput = {
        scheme: this.authz.schemeWhere(f),
        ...(q.schemeId && { schemeId: q.schemeId }),
        ...(q.status && { status: q.status as Row['status'] }),
      };
      const [total, rows] = await Promise.all([
        tx.progressSubmission.count({ where }),
        tx.progressSubmission.findMany({
          where,
          include,
          orderBy: [{ updatedAt: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return { total, page: q.page, pageSize: q.pageSize, items: rows.map(view) };
    });
  }

  get(auth: AuthContext, id: string) {
    return this.run(auth, async (tx) => {
      const f = await this.authz.requireScope(tx, auth.userId, 'scheme.view');
      const p = await this.load(tx, f, id);
      return { ...view(p), history: await history(tx, 'progress_submission', id) };
    });
  }

  create(auth: AuthContext, dto: CreateProgressDto, key?: string, requestId?: string) {
    return this.run(auth, (tx) =>
      idempotent(tx, auth, key, 'POST /progress-submissions', dto, async () => {
        const f = await this.authz.requireScope(tx, auth.userId, 'progress.submit');
        const s = await this.scheme(tx, f, dto.schemeId);
        if (s.status !== 'ACTIVE' && s.status !== 'APPROVED')
          throw conflict(
            'SCHEME_NOT_ACTIVE',
            `Progress cannot be reported for a ${s.status} scheme.`,
          );
        const period = await tx.reportingPeriod.findUnique({ where: { id: dto.periodId } });
        if (!period || period.financialYearId !== s.financialYearId)
          throw badRequest(
            'FINANCIAL_YEAR_MISMATCH',
            "The reporting period is not in the scheme's financial year.",
          );
        await this.validateMeasurements(tx, s.id, dto.measurements);
        const existing = await tx.progressSubmission.findFirst({
          where: { schemeId: s.id, periodId: period.id },
          orderBy: { submissionVersion: 'desc' },
        });
        if (existing)
          throw conflict(
            'SUBMISSION_EXISTS',
            existing.status === 'VERIFIED'
              ? 'This period is already verified; record a correction instead.'
              : 'A submission for this period already exists; continue that one.',
          );
        const p = await tx.progressSubmission.create({
          data: {
            tenantId: auth.tenantId,
            schemeId: s.id,
            periodId: period.id,
            remarks: dto.remarks ?? null,
            createdBy: auth.userId,
          },
        });
        await tx.progressMeasurement.createMany({
          data: this.measurementRows(auth, p.id, dto.measurements),
        });
        await recordStep(tx, auth, 'progress_submission', p.id, 'DRAFT', 'CREATED', 'DRAFT');
        const full = await tx.progressSubmission.findUniqueOrThrow({
          where: { id: p.id },
          include,
        });
        await audit(tx, auth, requestId, {
          action: 'PROGRESS_DRAFT_CREATED',
          entityType: 'progress_submission',
          entityId: p.id,
          after: view(full),
        });
        return view(full);
      }),
    );
  }

  update(auth: AuthContext, id: string, dto: UpdateProgressDto, requestId?: string) {
    return this.run(auth, async (tx) => {
      const f = await this.authz.requireScope(tx, auth.userId, 'progress.submit');
      const p = await this.load(tx, f, id);
      if (!(OPEN_FOR_EDIT as readonly string[]).includes(p.status))
        throw conflict('INVALID_STATE', `Submission is ${p.status}.`);
      if (p.createdBy !== auth.userId)
        throw conflict('NOT_SUBMITTER', 'Only the author can edit this submission.');
      const res = await tx.progressSubmission.updateMany({
        where: { id, version: dto.version, status: p.status },
        data: {
          ...(dto.remarks !== undefined && { remarks: dto.remarks }),
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw versionConflict();
      if (dto.measurements) {
        await this.validateMeasurements(tx, p.schemeId, dto.measurements);
        await tx.progressMeasurement.deleteMany({ where: { submissionId: id } });
        await tx.progressMeasurement.createMany({
          data: this.measurementRows(auth, id, dto.measurements),
        });
      }
      const after = await tx.progressSubmission.findUniqueOrThrow({ where: { id }, include });
      await audit(tx, auth, requestId, {
        action: 'PROGRESS_DRAFT_UPDATED',
        entityType: 'progress_submission',
        entityId: id,
        before: view(p),
        after: view(after),
      });
      return view(after);
    });
  }

  submit(auth: AuthContext, id: string, version: number, key?: string, requestId?: string) {
    return this.run(auth, (tx) =>
      idempotent(
        tx,
        auth,
        key,
        `POST /progress-submissions/${id}/submit`,
        { version },
        async () => {
          const f = await this.authz.requireScope(tx, auth.userId, 'progress.submit');
          const p = await this.load(tx, f, id);
          if (!(OPEN_FOR_EDIT as readonly string[]).includes(p.status))
            throw conflict('INVALID_STATE', `Submission is ${p.status}.`);
          if (p.createdBy !== auth.userId)
            throw conflict('NOT_SUBMITTER', 'Only the author can submit this submission.');
          if (p.measurements.length === 0)
            throw badRequest(
              'MEASUREMENTS_REQUIRED',
              'Add at least one milestone measurement before submitting.',
            );
          const status = p.status === 'RETURNED' ? 'RESUBMITTED' : 'SUBMITTED';
          const res = await tx.progressSubmission.updateMany({
            where: { id, version, status: p.status },
            data: {
              status,
              submittedById: auth.userId,
              submittedAt: new Date(),
              version: { increment: 1 },
            },
          });
          if (res.count !== 1) throw versionConflict();
          return this.after(tx, auth, requestId, p, status, 'SUBMIT', status);
        },
      ),
    );
  }

  private async after(
    tx: Prisma.TransactionClient,
    auth: AuthContext,
    requestId: string | undefined,
    before: Row,
    status: string,
    step: string,
    decision: string,
    reason?: string,
  ) {
    const after = await tx.progressSubmission.findUniqueOrThrow({
      where: { id: before.id },
      include,
    });
    await recordStep(tx, auth, 'progress_submission', before.id, step, decision, status, reason);
    await audit(tx, auth, requestId, {
      action: `PROGRESS_${decision}`,
      entityType: 'progress_submission',
      entityId: before.id,
      before: { status: before.status, version: before.version },
      after: { status, version: after.version },
      reason,
    });
    return view(after);
  }

  /** Reviewer checks shared by start-review, verify and return. */
  private async reviewable(tx: Prisma.TransactionClient, auth: AuthContext, id: string) {
    const f = await this.authz.requireScope(tx, auth.userId, 'progress.verify');
    const p = await this.load(tx, f, id);
    if (!(REVIEWABLE as readonly string[]).includes(p.status))
      throw conflict('INVALID_STATE', `Submission is ${p.status}.`);
    if (p.submittedById === auth.userId || p.createdBy === auth.userId) throw selfDecision();
    return p;
  }

  startReview(auth: AuthContext, id: string, version: number, key?: string, requestId?: string) {
    return this.run(auth, (tx) =>
      idempotent(
        tx,
        auth,
        key,
        `POST /progress-submissions/${id}/start-review`,
        { version },
        async () => {
          const p = await this.reviewable(tx, auth, id);
          if (p.status === 'UNDER_REVIEW')
            throw conflict('INVALID_STATE', 'Submission is already under review.');
          const res = await tx.progressSubmission.updateMany({
            where: { id, version, status: p.status },
            data: { status: 'UNDER_REVIEW', version: { increment: 1 } },
          });
          if (res.count !== 1) throw versionConflict();
          return this.after(tx, auth, requestId, p, 'UNDER_REVIEW', 'REVIEW', 'REVIEW_STARTED');
        },
      ),
    );
  }

  verify(auth: AuthContext, id: string, version: number, key?: string, requestId?: string) {
    return this.run(auth, (tx) =>
      idempotent(
        tx,
        auth,
        key,
        `POST /progress-submissions/${id}/verify`,
        { version },
        async () => {
          const p = await this.reviewable(tx, auth, id);
          const res = await tx.progressSubmission.updateMany({
            where: { id, version, status: p.status },
            data: {
              status: 'VERIFIED',
              verifiedById: auth.userId,
              verifiedAt: new Date(),
              version: { increment: 1 },
            },
          });
          if (res.count !== 1) throw versionConflict();
          return this.after(tx, auth, requestId, p, 'VERIFIED', 'VERIFY', 'VERIFIED');
        },
      ),
    );
  }

  returnSubmission(
    auth: AuthContext,
    id: string,
    dto: ProgressReturnDto,
    key?: string,
    requestId?: string,
  ) {
    return this.run(auth, (tx) =>
      idempotent(tx, auth, key, `POST /progress-submissions/${id}/return`, dto, async () => {
        if (!dto.reason.trim())
          throw badRequest('REASON_REQUIRED', 'A reason is required to return.');
        const p = await this.reviewable(tx, auth, id);
        const res = await tx.progressSubmission.updateMany({
          where: { id, version: dto.version, status: p.status },
          data: { status: 'RETURNED', decisionReason: dto.reason, version: { increment: 1 } },
        });
        if (res.count !== 1) throw versionConflict();
        return this.after(tx, auth, requestId, p, 'RETURNED', 'VERIFY', 'RETURNED', dto.reason);
      }),
    );
  }

  /** A verified submission is never edited: a correction is a new draft version that supersedes it. */
  correct(auth: AuthContext, id: string, key?: string, requestId?: string) {
    return this.run(auth, (tx) =>
      idempotent(tx, auth, key, `POST /progress-submissions/${id}/corrections`, {}, async () => {
        const f = await this.authz.requireScope(tx, auth.userId, 'progress.submit');
        const o = await this.load(tx, f, id);
        if (o.status !== 'VERIFIED')
          throw conflict('INVALID_STATE', 'Only verified submissions are corrected.');
        const latest = await tx.progressSubmission.findFirst({
          where: { schemeId: o.schemeId, periodId: o.periodId },
          orderBy: { submissionVersion: 'desc' },
        });
        if (latest && latest.id !== o.id)
          throw conflict('CORRECTION_EXISTS', 'A newer version of this submission already exists.');
        const p = await tx.progressSubmission.create({
          data: {
            tenantId: auth.tenantId,
            schemeId: o.schemeId,
            periodId: o.periodId,
            submissionVersion: o.submissionVersion + 1,
            supersedesId: o.id,
            remarks: o.remarks,
            createdBy: auth.userId,
          },
        });
        await tx.progressMeasurement.createMany({
          data: o.measurements.map((m) => ({
            tenantId: auth.tenantId,
            submissionId: p.id,
            milestoneId: m.milestoneId,
            quantityCompleted: m.quantityCompleted,
            measurementNotes: m.measurementNotes,
            createdBy: auth.userId,
          })),
        });
        await recordStep(
          tx,
          auth,
          'progress_submission',
          p.id,
          'DRAFT',
          'CORRECTION_CREATED',
          'DRAFT',
        );
        const full = await tx.progressSubmission.findUniqueOrThrow({
          where: { id: p.id },
          include,
        });
        await audit(tx, auth, requestId, {
          action: 'PROGRESS_CORRECTION_CREATED',
          entityType: 'progress_submission',
          entityId: p.id,
          before: { supersedes: o.id, submissionVersion: o.submissionVersion },
          after: view(full),
        });
        return view(full);
      }),
    );
  }

  /** Physical completion from verified submissions only; latest verified version per period wins. */
  schemeProgress(auth: AuthContext, schemeId: string) {
    return this.run(auth, async (tx) => {
      const f = await this.authz.requireScope(tx, auth.userId, 'scheme.view');
      const s = await this.scheme(tx, f, schemeId);
      const [milestones, verified] = await Promise.all([
        tx.schemeMilestone.findMany({ where: { schemeId: s.id }, orderBy: { targetDate: 'asc' } }),
        tx.progressSubmission.findMany({
          where: { schemeId: s.id, status: 'VERIFIED' },
          include: { period: { select: { startDate: true, code: true } }, measurements: true },
          orderBy: [{ period: { startDate: 'asc' } }, { submissionVersion: 'asc' }],
        }),
      ]);
      // Later periods and later versions overwrite earlier cumulative quantities.
      const completed = new Map<string, Prisma.Decimal>();
      for (const sub of verified)
        for (const m of sub.measurements) completed.set(m.milestoneId, m.quantityCompleted);
      return {
        schemeId: s.id,
        basis:
          'Verified progress submissions only; weighted by milestone weight; not derived from expenditure.',
        physicalCompletionPercent: physicalCompletion(milestones, completed),
        lastVerifiedPeriod: verified.at(-1)?.period.code ?? null,
        milestones: milestones.map((m) => ({
          id: m.id,
          name: m.name,
          unit: m.unit,
          weight: m.weight.toFixed(2),
          targetQuantity: m.targetQuantity.toFixed(3),
          targetDate: m.targetDate,
          status: m.status,
          verifiedQuantity: completed.get(m.id)?.toFixed(3) ?? null,
        })),
      };
    });
  }
}
