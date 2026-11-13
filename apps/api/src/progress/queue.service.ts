import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthContext } from '../auth/auth-context';
import { AuthorizationService } from '../authz/authorization.service';
import { fmt } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';

const scheme = { select: { id: true, schemeCode: true, name: true } } as const;

/**
 * F09 verification queue: pending items the caller may decide, within their scope,
 * never including records they created or submitted themselves.
 */
@Injectable()
export class QueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
  ) {}

  queue(auth: AuthContext) {
    return this.prisma.withTenant(auth.tenantId, async (tx: Prisma.TransactionClient) => {
      const [fin, prog] = await Promise.all([
        this.authz.scopeFor(tx, auth.userId, 'expenditure.verify'),
        this.authz.scopeFor(tx, auth.userId, 'progress.verify'),
      ]);
      const me = auth.userId;
      const [releases, expenditure, progress] = await Promise.all([
        fin
          ? tx.fundRelease.findMany({
              where: {
                verificationStatus: 'PENDING',
                createdBy: { not: me },
                scheme: this.authz.schemeWhere(fin),
              },
              include: { scheme },
              orderBy: { createdAt: 'asc' },
              take: 100,
            })
          : [],
        fin
          ? tx.expenditureRecord.findMany({
              where: {
                status: 'SUBMITTED',
                submittedById: { not: me },
                createdBy: { not: me },
                scheme: this.authz.schemeWhere(fin),
              },
              include: { scheme, period: { select: { code: true } } },
              orderBy: { createdAt: 'asc' },
              take: 100,
            })
          : [],
        prog
          ? tx.progressSubmission.findMany({
              where: {
                status: { in: ['SUBMITTED', 'RESUBMITTED', 'UNDER_REVIEW'] },
                createdBy: { not: me },
                OR: [{ submittedById: null }, { submittedById: { not: me } }],
                scheme: this.authz.schemeWhere(prog),
              },
              include: { scheme, period: { select: { code: true } } },
              orderBy: { submittedAt: 'asc' },
              take: 100,
            })
          : [],
      ]);
      return {
        items: [
          ...releases.map((r) => ({
            kind: 'FUND_RELEASE' as const,
            id: r.id,
            scheme: r.scheme,
            status: r.verificationStatus,
            amount: fmt(r.amount),
            reference: r.reference,
            isCorrection: !!r.supersedesId,
            correctionReason: r.correctionReason,
            submittedAt: r.createdAt,
            version: r.version,
          })),
          ...expenditure.map((e) => ({
            kind: 'EXPENDITURE' as const,
            id: e.id,
            scheme: e.scheme,
            status: e.status,
            amount: fmt(e.amount),
            reference: e.reference,
            period: e.period.code,
            isCorrection: !!e.supersedesId,
            correctionReason: e.correctionReason,
            submittedAt: e.createdAt,
            version: e.version,
          })),
          ...progress.map((p) => ({
            kind: 'PROGRESS' as const,
            id: p.id,
            scheme: p.scheme,
            status: p.status,
            period: p.period.code,
            submissionVersion: p.submissionVersion,
            isCorrection: !!p.supersedesId,
            submittedAt: p.submittedAt,
            version: p.version,
          })),
        ],
      };
    });
  }
}
