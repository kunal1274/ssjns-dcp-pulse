import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthContext } from '../auth/auth-context';
import { AuthorizationService, notFound, type ScopeFilter } from '../authz/authorization.service';
import { mapDbError } from '../common/db-errors';
import { audit, badRequest, conflict, versionConflict } from '../common/http';
import { idempotent } from '../common/idempotency';
import { fmt, money, sum } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CorrectionDto,
  CreateCommitmentDto,
  CreateExpenditureDto,
  CreateReleaseDto,
  FinanceDecisionDto,
  FinanceQuery,
  ResubmitExpenditureDto,
} from './dto';
import { effectiveVerified, percent } from './calculations';
import { history, recordStep, selfDecision } from './workflow';

const correctionExists = () =>
  conflict('CORRECTION_EXISTS', 'This record already has a correction in progress or verified.');
/** The partial unique index *_one_correction backs the pre-check under concurrent writes. */
const onDuplicateCorrection = (e: unknown): never => {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
    throw correctionExists();
  throw e;
};

const FUNDABLE = ['APPROVED', 'ACTIVE', 'SUSPENDED', 'COMPLETED'];
const schemeSelect = { id: true, schemeCode: true, name: true } as const;

const releaseView = (
  r: Prisma.FundReleaseGetPayload<{ include: { scheme: { select: typeof schemeSelect } } }>,
) => ({
  ...r,
  amount: fmt(r.amount),
});
const expenditureView = (
  e: Prisma.ExpenditureRecordGetPayload<{
    include: {
      scheme: { select: typeof schemeSelect };
      period: { select: { id: true; code: true } };
    };
  }>,
) => ({ ...e, amount: fmt(e.amount) });

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
  ) {}

  private run<T>(auth: AuthContext, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.withTenant(auth.tenantId, fn).catch(mapDbError);
  }

  /** Loads a scheme the caller may act on for `permission`; 404 when it is outside their scope. */
  private async scheme(tx: Prisma.TransactionClient, f: ScopeFilter, id: string) {
    const s = await tx.scheme.findUnique({ where: { id } });
    if (!s || !this.authz.schemeInScope(f, s)) throw notFound('Scheme');
    return s;
  }

  private positive(amount: string) {
    const a = money(amount);
    if (a.lte(0)) throw badRequest('INVALID_AMOUNT', 'Amount must be greater than zero.');
    return a;
  }

  private page(q: FinanceQuery) {
    return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
  }

  // ------------------------------------------------------------------ releases

  listReleases(auth: AuthContext, q: FinanceQuery) {
    return this.run(auth, async (tx) => {
      const f = await this.authz.requireScope(tx, auth.userId, 'scheme.view');
      const where: Prisma.FundReleaseWhereInput = {
        scheme: this.authz.schemeWhere(f),
        ...(q.schemeId && { schemeId: q.schemeId }),
        ...(q.status && {
          verificationStatus: q.status as Prisma.EnumVerificationStatusFilter['equals'],
        }),
      };
      const [total, rows] = await Promise.all([
        tx.fundRelease.count({ where }),
        tx.fundRelease.findMany({
          where,
          include: { scheme: { select: schemeSelect } },
          orderBy: [{ releaseDate: 'desc' }, { createdAt: 'desc' }],
          ...this.page(q),
        }),
      ]);
      return { total, page: q.page, pageSize: q.pageSize, items: rows.map(releaseView) };
    });
  }

  createRelease(auth: AuthContext, dto: CreateReleaseDto, key?: string, requestId?: string) {
    return this.run(auth, (tx) =>
      idempotent(tx, auth, key, 'POST /fund-releases', dto, async () => {
        const f = await this.authz.requireScope(tx, auth.userId, 'release.record');
        const s = await this.scheme(tx, f, dto.schemeId);
        if (!FUNDABLE.includes(s.status))
          throw conflict(
            'SCHEME_NOT_FUNDABLE',
            `Funds cannot be released to a ${s.status} scheme.`,
          );
        const r = await tx.fundRelease.create({
          data: {
            tenantId: auth.tenantId,
            schemeId: s.id,
            amount: this.positive(dto.amount),
            releaseDate: new Date(dto.releaseDate),
            reference: dto.reference,
            sourceSystem: 'MANUAL',
            createdBy: auth.userId,
          },
          include: { scheme: { select: schemeSelect } },
        });
        await recordStep(tx, auth, 'fund_release', r.id, 'RECORD', 'RECORDED', 'PENDING');
        await audit(tx, auth, requestId, {
          action: 'FUND_RELEASE_RECORDED',
          entityType: 'fund_release',
          entityId: r.id,
          after: releaseView(r),
        });
        return releaseView(r);
      }),
    );
  }

  correctRelease(
    auth: AuthContext,
    id: string,
    dto: CorrectionDto,
    key?: string,
    requestId?: string,
  ) {
    return this.run(auth, (tx) =>
      idempotent(tx, auth, key, `POST /fund-releases/${id}/corrections`, dto, async () => {
        const f = await this.authz.requireScope(tx, auth.userId, 'release.record');
        const o = await tx.fundRelease.findUnique({ where: { id } });
        if (!o) throw notFound('Release');
        await this.scheme(tx, f, o.schemeId).catch(() => {
          throw notFound('Release');
        });
        if (o.verificationStatus !== 'VERIFIED')
          throw conflict(
            'INVALID_STATE',
            'Only verified releases are corrected; edit or reject pending ones.',
          );
        const live = await tx.fundRelease.count({
          where: { supersedesId: o.id, verificationStatus: { not: 'REJECTED' } },
        });
        if (live) throw correctionExists();
        const r = await tx.fundRelease
          .create({
            data: {
              tenantId: auth.tenantId,
              schemeId: o.schemeId,
              amount: this.positive(dto.amount),
              releaseDate: o.releaseDate,
              reference: dto.reference ?? `${o.reference}-CORR`,
              sourceSystem: 'MANUAL_CORRECTION',
              supersedesId: o.id,
              correctionReason: dto.reason,
              createdBy: auth.userId,
            },
            include: { scheme: { select: schemeSelect } },
          })
          .catch(onDuplicateCorrection);
        await recordStep(
          tx,
          auth,
          'fund_release',
          r.id,
          'RECORD',
          'CORRECTION_RECORDED',
          'PENDING',
          dto.reason,
        );
        await audit(tx, auth, requestId, {
          action: 'FUND_RELEASE_CORRECTION_RECORDED',
          entityType: 'fund_release',
          entityId: r.id,
          before: { ...o, amount: fmt(o.amount) },
          after: releaseView(r),
          reason: dto.reason,
        });
        return releaseView(r);
      }),
    );
  }

  decideRelease(
    auth: AuthContext,
    id: string,
    dto: FinanceDecisionDto,
    key?: string,
    requestId?: string,
  ) {
    return this.run(auth, (tx) =>
      idempotent(tx, auth, key, `POST /fund-releases/${id}/decision`, dto, async () => {
        const f = await this.authz.requireScope(tx, auth.userId, 'expenditure.verify');
        const r = await tx.fundRelease.findUnique({ where: { id } });
        if (!r) throw notFound('Release');
        await this.scheme(tx, f, r.schemeId).catch(() => {
          throw notFound('Release');
        });
        if (dto.decision === 'RETURN')
          throw badRequest('INVALID_DECISION', 'Releases are verified or rejected.');
        if (r.verificationStatus !== 'PENDING')
          throw conflict('INVALID_STATE', `Release is ${r.verificationStatus}.`);
        if (r.createdBy === auth.userId) throw selfDecision();
        if (dto.decision === 'REJECT' && !dto.reason?.trim())
          throw badRequest('REASON_REQUIRED', 'A reason is required to reject.');
        const status = dto.decision === 'VERIFY' ? 'VERIFIED' : 'REJECTED';
        const res = await tx.fundRelease.updateMany({
          where: { id, version: dto.version, verificationStatus: 'PENDING' },
          data: {
            verificationStatus: status,
            verifiedById: dto.decision === 'VERIFY' ? auth.userId : null,
            verifiedAt: dto.decision === 'VERIFY' ? new Date() : null,
            decisionReason: dto.reason ?? null,
            version: { increment: 1 },
          },
        });
        if (res.count !== 1) throw versionConflict();
        const after = await tx.fundRelease.findUniqueOrThrow({
          where: { id },
          include: { scheme: { select: schemeSelect } },
        });
        await recordStep(tx, auth, 'fund_release', id, 'VERIFY', dto.decision, status, dto.reason);
        await audit(tx, auth, requestId, {
          action: `FUND_RELEASE_${status}`,
          entityType: 'fund_release',
          entityId: id,
          before: { verificationStatus: r.verificationStatus, version: r.version },
          after: { verificationStatus: status, version: after.version },
          reason: dto.reason,
        });
        return releaseView(after);
      }),
    );
  }

  // --------------------------------------------------------------- expenditure

  listExpenditure(auth: AuthContext, q: FinanceQuery) {
    return this.run(auth, async (tx) => {
      const f = await this.authz.requireScope(tx, auth.userId, 'scheme.view');
      const where: Prisma.ExpenditureRecordWhereInput = {
        scheme: this.authz.schemeWhere(f),
        ...(q.schemeId && { schemeId: q.schemeId }),
        ...(q.status && { status: q.status as Prisma.EnumExpenditureStatusFilter['equals'] }),
      };
      const [total, rows] = await Promise.all([
        tx.expenditureRecord.count({ where }),
        tx.expenditureRecord.findMany({
          where,
          include: {
            scheme: { select: schemeSelect },
            period: { select: { id: true, code: true } },
          },
          orderBy: [{ expenditureDate: 'desc' }, { createdAt: 'desc' }],
          ...this.page(q),
        }),
      ]);
      return { total, page: q.page, pageSize: q.pageSize, items: rows.map(expenditureView) };
    });
  }

  private async period(tx: Prisma.TransactionClient, periodId: string, financialYearId: string) {
    const p = await tx.reportingPeriod.findUnique({ where: { id: periodId } });
    if (!p) throw badRequest('INVALID_REFERENCE', 'Reporting period not found.');
    if (p.financialYearId !== financialYearId)
      throw badRequest(
        'FINANCIAL_YEAR_MISMATCH',
        "The reporting period is not in the scheme's financial year.",
      );
    return p;
  }

  private async loadExpenditure(tx: Prisma.TransactionClient, f: ScopeFilter, id: string) {
    const e = await tx.expenditureRecord.findUnique({ where: { id } });
    if (!e) throw notFound('Expenditure record');
    await this.scheme(tx, f, e.schemeId).catch(() => {
      throw notFound('Expenditure record');
    });
    return e;
  }

  private readonly expInclude = {
    scheme: { select: schemeSelect },
    period: { select: { id: true, code: true } },
  } as const;

  createExpenditure(
    auth: AuthContext,
    dto: CreateExpenditureDto,
    key?: string,
    requestId?: string,
  ) {
    return this.run(auth, (tx) =>
      idempotent(tx, auth, key, 'POST /expenditure', dto, async () => {
        const f = await this.authz.requireScope(tx, auth.userId, 'expenditure.submit');
        const s = await this.scheme(tx, f, dto.schemeId);
        if (!FUNDABLE.includes(s.status))
          throw conflict(
            'SCHEME_NOT_FUNDABLE',
            `Expenditure cannot be booked to a ${s.status} scheme.`,
          );
        await this.period(tx, dto.periodId, s.financialYearId);
        if (dto.progressSubmissionId) {
          const p = await tx.progressSubmission.findUnique({
            where: { id: dto.progressSubmissionId },
          });
          if (!p || p.schemeId !== s.id)
            throw badRequest('INVALID_REFERENCE', 'Progress submission not found for this scheme.');
        }
        const e = await tx.expenditureRecord.create({
          data: {
            tenantId: auth.tenantId,
            schemeId: s.id,
            periodId: dto.periodId,
            progressSubmissionId: dto.progressSubmissionId ?? null,
            amount: this.positive(dto.amount),
            expenditureDate: new Date(dto.expenditureDate),
            reference: dto.reference,
            status: 'SUBMITTED',
            source: 'MANUAL',
            submittedById: auth.userId,
            createdBy: auth.userId,
          },
          include: this.expInclude,
        });
        await recordStep(tx, auth, 'expenditure_record', e.id, 'SUBMIT', 'SUBMITTED', 'SUBMITTED');
        await audit(tx, auth, requestId, {
          action: 'EXPENDITURE_SUBMITTED',
          entityType: 'expenditure_record',
          entityId: e.id,
          after: expenditureView(e),
        });
        return expenditureView(e);
      }),
    );
  }

  resubmitExpenditure(
    auth: AuthContext,
    id: string,
    dto: ResubmitExpenditureDto,
    key?: string,
    requestId?: string,
  ) {
    return this.run(auth, (tx) =>
      idempotent(tx, auth, key, `POST /expenditure/${id}/resubmit`, dto, async () => {
        const f = await this.authz.requireScope(tx, auth.userId, 'expenditure.submit');
        const e = await this.loadExpenditure(tx, f, id);
        if (e.status !== 'RETURNED') throw conflict('INVALID_STATE', `Record is ${e.status}.`);
        if (e.submittedById !== auth.userId)
          throw conflict(
            'NOT_SUBMITTER',
            'Only the original submitter can resubmit a returned record.',
          );
        const res = await tx.expenditureRecord.updateMany({
          where: { id, version: dto.version, status: 'RETURNED' },
          data: {
            status: 'SUBMITTED',
            ...(dto.amount && { amount: this.positive(dto.amount) }),
            ...(dto.expenditureDate && { expenditureDate: new Date(dto.expenditureDate) }),
            ...(dto.reference && { reference: dto.reference }),
            version: { increment: 1 },
          },
        });
        if (res.count !== 1) throw versionConflict();
        const after = await tx.expenditureRecord.findUniqueOrThrow({
          where: { id },
          include: this.expInclude,
        });
        await recordStep(tx, auth, 'expenditure_record', id, 'SUBMIT', 'RESUBMITTED', 'SUBMITTED');
        await audit(tx, auth, requestId, {
          action: 'EXPENDITURE_RESUBMITTED',
          entityType: 'expenditure_record',
          entityId: id,
          before: { ...e, amount: fmt(e.amount) },
          after: expenditureView(after),
        });
        return expenditureView(after);
      }),
    );
  }

  decideExpenditure(
    auth: AuthContext,
    id: string,
    dto: FinanceDecisionDto,
    key?: string,
    requestId?: string,
  ) {
    return this.run(auth, (tx) =>
      idempotent(tx, auth, key, `POST /expenditure/${id}/decision`, dto, async () => {
        const f = await this.authz.requireScope(tx, auth.userId, 'expenditure.verify');
        const e = await this.loadExpenditure(tx, f, id);
        if (e.status !== 'SUBMITTED') throw conflict('INVALID_STATE', `Record is ${e.status}.`);
        if (e.submittedById === auth.userId || e.createdBy === auth.userId) throw selfDecision();
        if (dto.decision !== 'VERIFY' && !dto.reason?.trim())
          throw badRequest('REASON_REQUIRED', 'A reason is required to return or reject.');
        const status = ({ VERIFY: 'VERIFIED', RETURN: 'RETURNED', REJECT: 'REJECTED' } as const)[
          dto.decision
        ];
        const res = await tx.expenditureRecord.updateMany({
          where: { id, version: dto.version, status: 'SUBMITTED' },
          data: {
            status,
            verifiedById: status === 'VERIFIED' ? auth.userId : null,
            verifiedAt: status === 'VERIFIED' ? new Date() : null,
            decisionReason: dto.reason ?? null,
            version: { increment: 1 },
          },
        });
        if (res.count !== 1) throw versionConflict();
        const after = await tx.expenditureRecord.findUniqueOrThrow({
          where: { id },
          include: this.expInclude,
        });
        await recordStep(
          tx,
          auth,
          'expenditure_record',
          id,
          'VERIFY',
          dto.decision,
          status,
          dto.reason,
        );
        await audit(tx, auth, requestId, {
          action: `EXPENDITURE_${status}`,
          entityType: 'expenditure_record',
          entityId: id,
          before: { status: e.status, version: e.version },
          after: { status, version: after.version },
          reason: dto.reason,
        });
        return expenditureView(after);
      }),
    );
  }

  correctExpenditure(
    auth: AuthContext,
    id: string,
    dto: CorrectionDto,
    key?: string,
    requestId?: string,
  ) {
    return this.run(auth, (tx) =>
      idempotent(tx, auth, key, `POST /expenditure/${id}/corrections`, dto, async () => {
        const f = await this.authz.requireScope(tx, auth.userId, 'expenditure.submit');
        const o = await this.loadExpenditure(tx, f, id);
        if (o.status !== 'VERIFIED')
          throw conflict(
            'INVALID_STATE',
            'Only verified expenditure is corrected; returned records are resubmitted.',
          );
        const live = await tx.expenditureRecord.count({
          where: { supersedesId: o.id, status: { not: 'REJECTED' } },
        });
        if (live) throw correctionExists();
        const e = await tx.expenditureRecord
          .create({
            data: {
              tenantId: auth.tenantId,
              schemeId: o.schemeId,
              periodId: o.periodId,
              progressSubmissionId: o.progressSubmissionId,
              amount: this.positive(dto.amount),
              expenditureDate: o.expenditureDate,
              reference: dto.reference ?? `${o.reference}-CORR`,
              status: 'SUBMITTED',
              source: 'MANUAL_CORRECTION',
              submittedById: auth.userId,
              supersedesId: o.id,
              correctionReason: dto.reason,
              createdBy: auth.userId,
            },
            include: this.expInclude,
          })
          .catch(onDuplicateCorrection);
        await recordStep(
          tx,
          auth,
          'expenditure_record',
          e.id,
          'SUBMIT',
          'CORRECTION_SUBMITTED',
          'SUBMITTED',
          dto.reason,
        );
        await audit(tx, auth, requestId, {
          action: 'EXPENDITURE_CORRECTION_SUBMITTED',
          entityType: 'expenditure_record',
          entityId: e.id,
          before: { ...o, amount: fmt(o.amount) },
          after: expenditureView(e),
          reason: dto.reason,
        });
        return expenditureView(e);
      }),
    );
  }

  // --------------------------------------------------------------- commitments

  listCommitments(auth: AuthContext, q: FinanceQuery) {
    return this.run(auth, async (tx) => {
      const f = await this.authz.requireScope(tx, auth.userId, 'scheme.view');
      const where: Prisma.CommitmentWhereInput = {
        scheme: this.authz.schemeWhere(f),
        ...(q.schemeId && { schemeId: q.schemeId }),
      };
      const [total, rows] = await Promise.all([
        tx.commitment.count({ where }),
        tx.commitment.findMany({
          where,
          include: { scheme: { select: schemeSelect } },
          orderBy: { recordedAt: 'desc' },
          ...this.page(q),
        }),
      ]);
      return {
        total,
        page: q.page,
        pageSize: q.pageSize,
        items: rows.map((c) => ({ ...c, amount: fmt(c.amount) })),
      };
    });
  }

  createCommitment(auth: AuthContext, dto: CreateCommitmentDto, key?: string, requestId?: string) {
    return this.run(auth, (tx) =>
      idempotent(tx, auth, key, 'POST /commitments', dto, async () => {
        const f = await this.authz.requireScope(tx, auth.userId, 'release.record');
        const s = await this.scheme(tx, f, dto.schemeId);
        const c = await tx.commitment.create({
          data: {
            tenantId: auth.tenantId,
            schemeId: s.id,
            amount: this.positive(dto.amount),
            reference: dto.reference,
            recordedAt: new Date(),
            createdBy: auth.userId,
          },
        });
        const view = { ...c, amount: fmt(c.amount) };
        await audit(tx, auth, requestId, {
          action: 'COMMITMENT_RECORDED',
          entityType: 'commitment',
          entityId: c.id,
          after: view,
        });
        return view;
      }),
    );
  }

  cancelCommitment(
    auth: AuthContext,
    id: string,
    version: number,
    key?: string,
    requestId?: string,
  ) {
    return this.run(auth, (tx) =>
      idempotent(tx, auth, key, `POST /commitments/${id}/cancel`, { version }, async () => {
        const f = await this.authz.requireScope(tx, auth.userId, 'release.record');
        const c = await tx.commitment.findUnique({ where: { id } });
        if (!c) throw notFound('Commitment');
        await this.scheme(tx, f, c.schemeId).catch(() => {
          throw notFound('Commitment');
        });
        if (c.status !== 'OPEN') throw conflict('INVALID_STATE', `Commitment is ${c.status}.`);
        const res = await tx.commitment.updateMany({
          where: { id, version, status: 'OPEN' },
          data: { status: 'CANCELLED', version: { increment: 1 } },
        });
        if (res.count !== 1) throw versionConflict();
        await audit(tx, auth, requestId, {
          action: 'COMMITMENT_CANCELLED',
          entityType: 'commitment',
          entityId: id,
          before: { status: 'OPEN', version },
          after: { status: 'CANCELLED', version: version + 1 },
        });
        return { id, status: 'CANCELLED', version: version + 1 };
      }),
    );
  }

  // ------------------------------------------------------------------- summary

  /** Scheme 360 finance figures (§5): verified basis, superseded records counted once. */
  schemeFinance(auth: AuthContext, schemeId: string) {
    return this.run(auth, async (tx) => {
      const f = await this.authz.requireScope(tx, auth.userId, 'scheme.view');
      const s = await this.scheme(tx, f, schemeId);
      const [budget, releases, expenditure, commitments] = await Promise.all([
        tx.budgetVersion.findFirst({ where: { schemeId: s.id, status: 'APPROVED' } }),
        tx.fundRelease.findMany({
          where: { schemeId: s.id },
          select: { id: true, amount: true, supersedesId: true, verificationStatus: true },
        }),
        tx.expenditureRecord.findMany({
          where: { schemeId: s.id },
          select: { id: true, amount: true, supersedesId: true, status: true },
        }),
        tx.commitment.findMany({
          where: { schemeId: s.id, status: 'OPEN' },
          select: { amount: true },
        }),
      ]);
      const verifiedReleases = effectiveVerified(
        releases.map((r) => ({ ...r, verified: r.verificationStatus === 'VERIFIED' })),
      );
      const verifiedExpenditure = effectiveVerified(
        expenditure.map((e) => ({ ...e, verified: e.status === 'VERIFIED' })),
      );
      const pendingReleases = sum(
        releases.filter((r) => r.verificationStatus === 'PENDING').map((r) => r.amount),
      );
      const reported = sum(
        expenditure.filter((e) => e.status === 'SUBMITTED').map((e) => e.amount),
      );
      const approved = budget?.totalAmount ?? null;
      return {
        schemeId: s.id,
        currency: 'INR',
        basis: 'Verified records only; a verified correction replaces the record it supersedes.',
        approvedBudget: approved ? fmt(approved) : null,
        verifiedReleases: fmt(verifiedReleases),
        pendingReleases: fmt(pendingReleases),
        verifiedExpenditure: fmt(verifiedExpenditure),
        reportedUnverifiedExpenditure: fmt(reported),
        openCommitments: fmt(sum(commitments.map((c) => c.amount))),
        budgetBalance: approved ? fmt(approved.sub(verifiedExpenditure)) : null,
        releaseBalance: fmt(verifiedReleases.sub(verifiedExpenditure)),
        budgetUtilisationPercent: percent(verifiedExpenditure, approved),
        releaseUtilisationPercent: percent(verifiedExpenditure, verifiedReleases),
      };
    });
  }

  decisions(auth: AuthContext, entityType: 'fund_release' | 'expenditure_record', id: string) {
    return this.run(auth, async (tx) => {
      const f = await this.authz.requireScope(tx, auth.userId, 'scheme.view');
      const rec =
        entityType === 'fund_release'
          ? await tx.fundRelease.findUnique({ where: { id }, select: { schemeId: true } })
          : await tx.expenditureRecord.findUnique({ where: { id }, select: { schemeId: true } });
      if (!rec) throw notFound('Record');
      await this.scheme(tx, f, rec.schemeId).catch(() => {
        throw notFound('Record');
      });
      return history(tx, entityType, id);
    });
  }
}
