import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthContext } from '../auth/auth-context';
import { AuthorizationService, notFound } from '../authz/authorization.service';
import { mapDbError } from '../common/db-errors';
import { audit, badRequest, conflict } from '../common/http';
import { money, sum } from '../common/money';
import { FUNDABLE, FinanceService } from '../finance/finance.service';
import { PrismaService } from '../prisma/prisma.service';
import { ADAPTERS } from './adapters/csv-fund-release.adapter';
import type { CanonicalRelease, ImportRowError } from './adapters/types';
import type { ImportCommitDto, ImportPreviewDto } from './dto';

type RowStatus = 'NEW' | 'ALREADY_IMPORTED';
interface StagedRow extends CanonicalRelease {
  rowNumber: number;
  schemeId: string;
  status: RowStatus;
}

const PREVIEW_LIMIT = 200;

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly finance: FinanceService,
  ) {}

  private run<T>(auth: AuthContext, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.withTenant(auth.tenantId, fn, { timeout: 60_000 }).catch(mapDbError);
  }

  sources(auth: AuthContext) {
    return this.run(auth, async (tx) => {
      await this.authz.requireScope(tx, auth.userId, 'integration.manage');
      return tx.integrationSource.findMany({ orderBy: { code: 'asc' } });
    });
  }

  preview(auth: AuthContext, dto: ImportPreviewDto, requestId?: string) {
    return this.run(auth, async (tx) => {
      const scope = await this.authz.requireScope(tx, auth.userId, 'integration.manage');
      const source = await tx.integrationSource.findUnique({ where: { id: dto.sourceId } });
      if (!source) throw notFound('Import source');
      if (!source.enabled) throw conflict('SOURCE_DISABLED', 'This import source is disabled.');
      const adapter = ADAPTERS[source.adapter];
      if (!adapter)
        throw conflict('ADAPTER_UNAVAILABLE', `No adapter "${source.adapter}" is installed.`);
      const sha = createHash('sha256').update(dto.content, 'utf8').digest('hex');

      let parsed: ReturnType<typeof adapter.parse>;
      try {
        parsed = adapter.parse(dto.content, source.configJson);
      } catch (e) {
        throw badRequest('SOURCE_MISCONFIGURED', (e as Error).message);
      }
      const errors: ImportRowError[] = [...parsed.errors];
      let duplicates = 0;

      const codes = [...new Set(parsed.rows.map((r) => r.value.schemeCode))];
      const schemes = await tx.scheme.findMany({ where: { schemeCode: { in: codes } } });
      const byCode = new Map(schemes.map((s) => [s.schemeCode, s]));
      const mappings = await tx.externalRecordMapping.findMany({
        where: {
          sourceSystem: source.code,
          entityType: source.entityType,
          externalId: { in: parsed.rows.map((r) => r.value.externalId) },
        },
      });
      const mapped = new Map(mappings.map((m) => [m.externalId, m.internalId]));
      const prior = await tx.fundRelease.findMany({ where: { id: { in: [...mapped.values()] } } });
      const priorById = new Map(prior.map((p) => [p.id, p]));
      const today = new Date().toISOString().slice(0, 10);

      const seen = new Set<string>();
      const staged: StagedRow[] = [];
      for (const { rowNumber, value: v, raw } of parsed.rows) {
        const err = (field: string, code: string, message: string) =>
          errors.push({ rowNumber, field, code, message, raw });
        if (seen.has(v.externalId)) {
          duplicates++;
          err(
            'externalId',
            'DUPLICATE_IN_FILE',
            `External ID ${v.externalId} appears more than once in this file.`,
          );
          continue;
        }
        seen.add(v.externalId);
        const s = byCode.get(v.schemeCode);
        if (!s || !this.authz.schemeInScope(scope, s)) {
          err(
            'schemeCode',
            'UNKNOWN_SCHEME',
            `Scheme ${v.schemeCode} does not exist in your scope.`,
          );
          continue;
        }
        const existing = mapped.get(v.externalId);
        if (existing) {
          const p = priorById.get(existing);
          const same =
            p &&
            p.schemeId === s.id &&
            p.amount.equals(money(v.amount)) &&
            p.releaseDate.toISOString().slice(0, 10) === v.releaseDate;
          if (!same) {
            err(
              'externalId',
              'EXTERNAL_ID_CONFLICT',
              `External ID ${v.externalId} was imported earlier with different values.`,
            );
            continue;
          }
          staged.push({ ...v, rowNumber, schemeId: s.id, status: 'ALREADY_IMPORTED' });
          continue;
        }
        if (!FUNDABLE.includes(s.status)) {
          err(
            'schemeCode',
            'SCHEME_NOT_FUNDABLE',
            `Funds cannot be released to a ${s.status} scheme.`,
          );
          continue;
        }
        if (v.releaseDate > today) {
          err('releaseDate', 'RELEASE_DATE_IN_FUTURE', 'Release date cannot be in the future.');
          continue;
        }
        staged.push({ ...v, rowNumber, schemeId: s.id, status: 'NEW' });
      }

      const fresh = staged.filter((r) => r.status === 'NEW');
      const status = errors.length ? 'FAILED' : 'VALIDATED';
      const rowCount = parsed.rows.length + parsed.errors.filter((e) => e.rowNumber > 1).length;
      const previous = await tx.importBatch.findFirst({
        where: { sourceId: source.id, fileSha256: sha, status: 'COMMITTED' },
        orderBy: { committedAt: 'desc' },
        select: { id: true, committedAt: true },
      });
      const batch = await tx.importBatch.create({
        data: {
          tenantId: auth.tenantId,
          source: source.code,
          sourceId: source.id,
          filename: dto.filename,
          fileSha256: sha,
          status,
          rowCount,
          validCount: staged.length,
          errorCount: errors.length,
          duplicateCount: duplicates,
          alreadyImportedCount: staged.length - fresh.length,
          rowsJson: staged as unknown as Prisma.InputJsonValue,
          errorSummary: summarise(errors),
          createdBy: auth.userId,
        },
      });
      if (errors.length)
        await tx.importError.createMany({
          data: errors.map((e) => ({
            tenantId: auth.tenantId,
            batchId: batch.id,
            rowNumber: e.rowNumber,
            field: e.field ?? null,
            code: e.code,
            message: e.message.slice(0, 500),
            rawJson: (e.raw ?? undefined) as Prisma.InputJsonValue | undefined,
          })),
        });
      await audit(tx, auth, requestId, {
        action: 'IMPORT_PREVIEWED',
        entityType: 'import_batch',
        entityId: batch.id,
        after: {
          source: source.code,
          filename: dto.filename,
          sha256: sha,
          status,
          rows: rowCount,
          errors: errors.length,
        },
      });
      return {
        batch: batchView(batch),
        previouslyCommittedBatch: previous,
        totals: {
          newRecords: fresh.length,
          newAmount: sum(fresh.map((r) => money(r.amount))).toFixed(2),
        },
        rows: staged.slice(0, PREVIEW_LIMIT),
        errors: errors.slice(0, PREVIEW_LIMIT),
      };
    });
  }

  commit(auth: AuthContext, id: string, dto: ImportCommitDto, requestId?: string) {
    return this.run(auth, async (tx) => {
      const scope = await this.authz.requireScope(tx, auth.userId, 'integration.manage');
      const batch = await tx.importBatch.findUnique({
        where: { id },
        include: { integrationSource: true },
      });
      if (!batch || !batch.integrationSource) throw notFound('Import batch');
      if (batch.status !== 'VALIDATED')
        throw conflict('BATCH_NOT_COMMITTABLE', `A ${batch.status} batch cannot be committed.`);
      const claimed = await tx.importBatch.updateMany({
        where: { id, version: dto.version, status: 'VALIDATED' },
        data: { version: { increment: 1 } },
      });
      if (claimed.count === 0)
        throw conflict(
          'VERSION_CONFLICT',
          'The batch was changed by someone else. Reload and try again.',
        );
      const source = batch.integrationSource;
      if (!source.enabled) throw conflict('SOURCE_DISABLED', 'This import source is disabled.');

      const rows = (batch.rowsJson ?? []) as unknown as StagedRow[];
      const schemes = await tx.scheme.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.schemeId))] } },
      });
      const byId = new Map(schemes.map((s) => [s.id, s]));
      let created = 0;
      let skipped = 0;
      const createdAmounts: Prisma.Decimal[] = [];
      for (const r of rows) {
        const already = await tx.externalRecordMapping.findUnique({
          where: {
            tenantId_sourceSystem_entityType_externalId: {
              tenantId: auth.tenantId,
              sourceSystem: source.code,
              entityType: source.entityType,
              externalId: r.externalId,
            },
          },
        });
        if (already) {
          skipped++;
          continue;
        }
        const s = byId.get(r.schemeId);
        if (!s || !this.authz.schemeInScope(scope, s)) throw notFound('Scheme');
        const rel = await this.finance.recordRelease(tx, auth, requestId, {
          scheme: s,
          amount: money(r.amount),
          releaseDate: new Date(r.releaseDate),
          reference: r.reference,
          sourceSystem: source.code,
        });
        await tx.externalRecordMapping.create({
          data: {
            tenantId: auth.tenantId,
            sourceSystem: source.code,
            entityType: source.entityType,
            externalId: r.externalId,
            internalId: rel.id,
            createdBy: auth.userId,
          },
        });
        created++;
        createdAmounts.push(money(r.amount));
      }
      const reconciliation = {
        rowsInFile: batch.rowCount,
        validRows: batch.validCount,
        createdReleases: created,
        alreadyImported: skipped,
        createdAmount: sum(createdAmounts).toFixed(2),
        fileAmount: sum(rows.map((r) => money(r.amount))).toFixed(2),
        createdStatus: 'PENDING finance verification',
      };
      const done = await tx.importBatch.update({
        where: { id },
        data: {
          status: 'COMMITTED',
          committedAt: new Date(),
          committedBy: auth.userId,
          committedCount: created,
          alreadyImportedCount: skipped,
          reconciliationJson: reconciliation,
        },
      });
      await audit(tx, auth, requestId, {
        action: 'IMPORT_COMMITTED',
        entityType: 'import_batch',
        entityId: id,
        after: reconciliation,
      });
      return { batch: batchView(done), reconciliation };
    });
  }

  list(auth: AuthContext) {
    return this.run(auth, async (tx) => {
      await this.authz.requireScope(tx, auth.userId, 'integration.manage');
      const rows = await tx.importBatch.findMany({ orderBy: { receivedAt: 'desc' }, take: 100 });
      return rows.map(batchView);
    });
  }

  get(auth: AuthContext, id: string) {
    return this.run(auth, async (tx) => {
      await this.authz.requireScope(tx, auth.userId, 'integration.manage');
      const b = await tx.importBatch.findUnique({
        where: { id },
        include: { errors: { orderBy: [{ rowNumber: 'asc' }], take: 500 } },
      });
      if (!b) throw notFound('Import batch');
      const users = await tx.user.findMany({
        where: { id: { in: [b.createdBy, b.committedBy].filter((x): x is string => !!x) } },
        select: { id: true, name: true },
      });
      const name = (u: string | null) => users.find((x) => x.id === u)?.name ?? null;
      return {
        ...batchView(b),
        createdByName: name(b.createdBy),
        committedByName: name(b.committedBy),
        rows: ((b.rowsJson ?? []) as unknown as StagedRow[]).slice(0, PREVIEW_LIMIT),
        errors: b.errors.map((e) => ({
          rowNumber: e.rowNumber,
          field: e.field,
          code: e.code,
          message: e.message,
        })),
      };
    });
  }
}

function summarise(errors: ImportRowError[]) {
  const byCode: Record<string, number> = {};
  for (const e of errors) byCode[e.code] = (byCode[e.code] ?? 0) + 1;
  return byCode;
}

function batchView(b: {
  id: string;
  source: string;
  sourceId: string | null;
  filename: string;
  fileSha256: string | null;
  status: string;
  receivedAt: Date;
  rowCount: number;
  validCount: number;
  errorCount: number;
  duplicateCount: number;
  alreadyImportedCount: number;
  committedCount: number;
  errorSummary: Prisma.JsonValue;
  reconciliationJson: Prisma.JsonValue;
  committedAt: Date | null;
  version: number;
}) {
  return {
    id: b.id,
    source: b.source,
    sourceId: b.sourceId,
    filename: b.filename,
    fileSha256: b.fileSha256,
    status: b.status,
    receivedAt: b.receivedAt,
    rowCount: b.rowCount,
    validCount: b.validCount,
    errorCount: b.errorCount,
    duplicateCount: b.duplicateCount,
    alreadyImportedCount: b.alreadyImportedCount,
    committedCount: b.committedCount,
    errorSummary: b.errorSummary,
    reconciliation: b.reconciliationJson,
    committedAt: b.committedAt,
    version: b.version,
  };
}
