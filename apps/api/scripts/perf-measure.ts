/**
 * Adds a bulk synthetic scheme set (PERF-xxxxx, idempotent) to a demo database and measures API
 * timings through the real HTTP stack. Numbers are printed as measured; nothing is estimated.
 *
 *   PERF_CONFIRM=ADD-SYNTHETIC-PERF-DATA MIGRATION_DATABASE_URL=... SEED_DEMO_PASSWORD=... \
 *   PERF_BASE_URL=http://localhost:8080 PERF_SCHEMES=2000 pnpm --filter @dcp/api perf
 *
 * Restore the plain demo afterwards with `pnpm db:demo-reset`.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { Prisma, PrismaClient } from '@prisma/client';
import { TENANT_CODE } from '../prisma/seed/data';

const N = Number(process.env.PERF_SCHEMES ?? 2000);
const BASE = (process.env.PERF_BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '') + '/api/v1';
const D = (v: number) => new Prisma.Decimal(v.toFixed(2));
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function bulk(prisma: PrismaClient) {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { code: TENANT_CODE } });
  const tenantId = tenant.id;
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      if (await tx.scheme.findFirst({ where: { schemeCode: 'PERF-00001' } }))
        return 'already present';
      const fy = await tx.financialYear.findFirstOrThrow({ where: { code: '2026-27' } });
      const periods = new Map((await tx.reportingPeriod.findMany()).map((p) => [p.code, p.id]));
      const js = await tx.jurisdiction.findMany({ include: { type: true } });
      const cds = js.filter((j) => j.type.code === 'CO_DISTRICT');
      const agencies = await tx.agency.findMany();
      const user = async (email: string) =>
        (await tx.user.findFirstOrThrow({ where: { email } })).id;
      const [planner, finance, officer, district] = await Promise.all([
        user('state.planner@example.test'),
        user('finance.reviewer@example.test'),
        user('field.officer@example.test'),
        user('district.reviewer@example.test'),
      ]);
      const cats = ['ROADS', 'WATER', 'HEALTH', 'EDUCATION', 'SANITATION'];
      const rows = {
        schemes: [] as Prisma.SchemeCreateManyInput[],
        versions: [] as Prisma.BudgetVersionCreateManyInput[],
        allocations: [] as Prisma.BudgetAllocationCreateManyInput[],
        releases: [] as Prisma.FundReleaseCreateManyInput[],
        spend: [] as Prisma.ExpenditureRecordCreateManyInput[],
        milestones: [] as Prisma.SchemeMilestoneCreateManyInput[],
        progress: [] as Prisma.ProgressSubmissionCreateManyInput[],
        measures: [] as Prisma.ProgressMeasurementCreateManyInput[],
      };
      for (let i = 1; i <= N; i++) {
        const cd = cds[i % cds.length];
        const id = randomUUID();
        const budget = 2_000_000 + (i % 40) * 500_000;
        rows.schemes.push({
          id,
          tenantId,
          schemeCode: `PERF-${String(i).padStart(5, '0')}`,
          name: `Synthetic performance scheme ${i}`,
          category: cats[i % cats.length],
          financialYearId: fy.id,
          agencyId: agencies[i % agencies.length].id,
          jurisdictionId: cd.id,
          status: 'ACTIVE',
          startDate: day('2026-05-01'),
          targetEndDate: day('2027-03-31'),
          createdBy: planner,
        });
        const v = randomUUID();
        rows.versions.push({
          id: v,
          tenantId,
          financialYearId: fy.id,
          schemeId: id,
          versionNumber: 1,
          status: 'APPROVED',
          totalAmount: D(budget),
          approvedAt: day('2026-07-15'),
          approvedById: planner,
          approvalReference: `SYN-PERF-${i}`,
        });
        const top = randomUUID();
        rows.allocations.push({
          id: top,
          tenantId,
          budgetVersionId: v,
          recipientJurisdictionId: cd.parentId!,
          schemeId: id,
          amount: D(budget),
          status: 'APPROVED',
          approvedById: planner,
          approvedAt: day('2026-07-16'),
        });
        rows.allocations.push({
          tenantId,
          budgetVersionId: v,
          parentAllocationId: top,
          recipientJurisdictionId: cd.id,
          schemeId: id,
          amount: D(budget),
          status: 'APPROVED',
          approvedById: planner,
          approvedAt: day('2026-07-17'),
        });
        const released = budget * (0.3 + (i % 5) * 0.1);
        rows.releases.push({
          tenantId,
          schemeId: id,
          amount: D(released),
          releaseDate: day('2026-08-05'),
          reference: `SYN-PERF-REL-${i}`,
          sourceSystem: 'PERF_SYNTHETIC',
          verificationStatus: 'VERIFIED',
          verifiedById: planner,
          verifiedAt: day('2026-08-20'),
          createdBy: finance,
        });
        rows.spend.push({
          tenantId,
          schemeId: id,
          periodId: periods.get('2026-09')!,
          amount: D(released * (0.2 + (i % 7) * 0.1)),
          expenditureDate: day('2026-09-25'),
          reference: `SYN-PERF-EXP-${i}`,
          status: 'VERIFIED',
          source: 'PERF_SYNTHETIC',
          submittedById: officer,
          verifiedById: finance,
          verifiedAt: day('2026-09-28'),
        });
        const ms = [randomUUID(), randomUUID(), randomUUID()];
        ms.forEach((m, k) =>
          rows.milestones.push({
            id: m,
            tenantId,
            schemeId: id,
            name: `Stage ${k + 1}`,
            targetDate: day(['2026-12-31', '2027-02-15', '2027-03-25'][k]),
            targetQuantity: new Prisma.Decimal(10),
            unit: 'units',
            weight: new Prisma.Decimal([40, 30, 30][k]),
            status: k ? 'NOT_STARTED' : 'IN_PROGRESS',
          }),
        );
        if (i % 4 !== 0) {
          const sub = randomUUID();
          rows.progress.push({
            id: sub,
            tenantId,
            schemeId: id,
            periodId: periods.get('2026-10')!,
            status: 'SUBMITTED',
            submittedById: officer,
            submittedAt: day('2026-11-03'),
            remarks: 'Synthetic performance data',
          });
          rows.measures.push({
            tenantId,
            submissionId: sub,
            milestoneId: ms[0],
            quantityCompleted: new Prisma.Decimal(i % 11),
          });
        }
      }
      const chunk = async <T>(items: T[], fn: (c: T[]) => Promise<unknown>) => {
        for (let k = 0; k < items.length; k += 1000) await fn(items.slice(k, k + 1000));
      };
      await chunk(rows.schemes, (c) => tx.scheme.createMany({ data: c }));
      await chunk(rows.versions, (c) => tx.budgetVersion.createMany({ data: c }));
      await chunk(
        rows.allocations.filter((a) => !a.parentAllocationId),
        (c) => tx.budgetAllocation.createMany({ data: c }),
      );
      await chunk(
        rows.allocations.filter((a) => a.parentAllocationId),
        (c) => tx.budgetAllocation.createMany({ data: c }),
      );
      await chunk(rows.releases, (c) => tx.fundRelease.createMany({ data: c }));
      await chunk(rows.spend, (c) => tx.expenditureRecord.createMany({ data: c }));
      await chunk(rows.milestones, (c) => tx.schemeMilestone.createMany({ data: c }));
      await chunk(rows.progress, (c) => tx.progressSubmission.createMany({ data: c }));
      await chunk(rows.measures, (c) => tx.progressMeasurement.createMany({ data: c }));
      // Verified only after measurements exist (verified submissions are immutable).
      await tx.progressSubmission.updateMany({
        where: { id: { in: rows.progress.map((p) => p.id!) } },
        data: { status: 'VERIFIED', verifiedById: district, verifiedAt: day('2026-11-06') },
      });
      await tx.$executeRaw`
        INSERT INTO scheme_locations (tenant_id, scheme_id, geometry, location_accuracy, source, created_by)
        SELECT tenant_id, id, ST_SetSRID(ST_MakePoint(90.0 + random() * 5.8, 24.5 + random() * 3.2), 4326)::geography,
               'SYNTHETIC_APPROXIMATE', 'perf-synthetic', created_by
        FROM schemes WHERE scheme_code LIKE 'PERF-%'`;
      return `inserted ${N} schemes`;
    },
    { timeout: 600_000 },
  );
}

async function login(email: string) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: process.env.SEED_DEMO_PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${email}: ${res.status}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return { cookie, csrf: csrfToken };
}

type S = Awaited<ReturnType<typeof login>>;
async function timed(s: S, path: string, method = 'GET') {
  const t = performance.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { cookie: s.cookie, 'x-csrf-token': s.csrf },
  });
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, ms: performance.now() - t, bytes: body.length, body };
}
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  return {
    n: s.length,
    minMs: +s[0].toFixed(1),
    medianMs: +q(0.5).toFixed(1),
    p95Ms: +q(0.95).toFixed(1),
    maxMs: +s[s.length - 1].toFixed(1),
  };
};

async function main() {
  if (process.env.PERF_CONFIRM !== 'ADD-SYNTHETIC-PERF-DATA')
    throw new Error('Set PERF_CONFIRM=ADD-SYNTHETIC-PERF-DATA');
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL is required');
  const prisma = new PrismaClient({ datasourceUrl: url });
  const tBulk = performance.now();
  const bulkResult = await bulk(prisma);
  const bulkMs = performance.now() - tBulk;
  // A one-transaction bulk load leaves planner statistics stale until autovacuum runs (about a
  // minute), during which the dashboard query can exceed its 5 s transaction limit.
  if (bulkResult !== 'already present') await prisma.$executeRawUnsafe('ANALYZE');
  const [{ version }] = await prisma.$queryRaw<{ version: string }[]>`SELECT version()`;
  const counts = await prisma.$queryRaw<{ t: string; n: number }[]>`
    SELECT 'schemes' t, COUNT(*)::int n FROM schemes UNION ALL SELECT 'fund_releases', COUNT(*)::int FROM fund_releases
    UNION ALL SELECT 'expenditure_records', COUNT(*)::int FROM expenditure_records UNION ALL SELECT 'progress_submissions', COUNT(*)::int FROM progress_submissions
    UNION ALL SELECT 'alerts', COUNT(*)::int FROM alerts`;
  const distA = (await prisma.jurisdiction.findFirstOrThrow({ where: { code: 'DIST-A' } })).id;

  const monitor = await login('state.monitor@example.test');
  const planner = await login('state.planner@example.test');
  const results: Record<string, unknown> = {};
  const repeat = async (name: string, s: S, path: string, n = 10) => {
    const runs = [];
    for (let k = 0; k < n; k++) runs.push(await timed(s, path));
    if (runs.some((r) => r.status !== 200))
      throw new Error(`${name}: status ${runs.map((r) => r.status).join(',')}`);
    results[name] = {
      path,
      firstMs: +runs[0].ms.toFixed(1),
      bytes: runs[0].bytes,
      ...stats(runs.slice(1).map((r) => r.ms)),
    };
  };
  await repeat('dashboard_state', monitor, '/dashboards/state');
  await repeat('dashboard_district_A', monitor, `/dashboards/district/${distA}`);
  await repeat('scheme_list_page1_100', monitor, '/dashboards/schemes?pageSize=100&page=1');
  await repeat('scheme_list_page15_100', monitor, '/dashboards/schemes?pageSize=100&page=15');
  await repeat(
    'scheme_list_filtered',
    monitor,
    '/dashboards/schemes?pageSize=100&category=WATER&delayedOnly=true',
  );
  await repeat('gis_all_points', monitor, '/gis/schemes', 5);
  await repeat('report_preview_budget_vs_exp', monitor, '/reports/budget-vs-expenditure', 5);
  await repeat('report_export_csv', monitor, '/reports/budget-vs-expenditure/export?format=csv', 3);
  await repeat(
    'report_export_xlsx',
    monitor,
    '/reports/budget-vs-expenditure/export?format=xlsx',
    3,
  );

  const t = performance.now();
  const conc = await Promise.all(
    Array.from({ length: 20 }, () => timed(monitor, '/dashboards/state')),
  );
  results.concurrent_20_dashboard_state = {
    wallMs: +(performance.now() - t).toFixed(1),
    allOk: conc.every((r) => r.status === 200),
    identicalBodies:
      new Set(conc.map((r) => JSON.parse(r.body.toString()).totals.verifiedExpenditure)).size === 1,
    ...stats(conc.map((r) => r.ms)),
  };
  const ev1 = await timed(planner, '/alert-rules/evaluate', 'POST');
  const ev2 = await timed(planner, '/alert-rules/evaluate', 'POST');
  const j = (b: Buffer) =>
    JSON.parse(b.toString()) as {
      created: number;
      refreshed?: number;
      reopened: number;
      autoResolved: number;
    };
  results.alert_evaluation = {
    first: { status: ev1.status, ms: +ev1.ms.toFixed(1), ...j(ev1.body) },
    secondDedupCheck: { status: ev2.status, ms: +ev2.ms.toFixed(1), ...j(ev2.body) },
  };
  const nf = await timed(monitor, `/dashboards/district/${randomUUID()}`);
  const bad = await timed(monitor, '/dashboards/district/not-a-uuid');
  const anon = await fetch(`${BASE}/dashboards/state`);
  results.error_handling = {
    unknownJurisdiction: nf.status,
    malformedId: bad.status,
    unauthenticated: anon.status,
    errorBodyLeaksSql: /select|prisma|postgres/i.test(nf.body.toString() + bad.body.toString()),
  };

  const out = {
    measuredAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: `${os.type()} ${os.release()}`,
      cpus: `${os.cpus().length} × ${os.cpus()[0]?.model}`,
      memoryGb: +(os.totalmem() / 1e9).toFixed(1),
      postgres: version.split(',')[0],
      baseUrl: BASE,
    },
    dataset: {
      bulk: bulkResult,
      bulkInsertMs: +bulkMs.toFixed(0),
      counts: Object.fromEntries(counts.map((c) => [c.t, c.n])),
    },
    results,
  };
  console.info(JSON.stringify(out, null, 2));
  if (process.env.PERF_OUTPUT)
    writeFileSync(process.env.PERF_OUTPUT, JSON.stringify(out, null, 2) + '\n');
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
