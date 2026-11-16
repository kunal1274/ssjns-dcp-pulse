import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { Client } from 'pg';
import { ownerClient } from '../integration/db';
import { createApp, login, type Session } from './helpers';

/**
 * F13 financial reconciliation. An independent ledger is rebuilt from raw table rows using
 * integer paise (BigInt), with no shared code or SQL with the KPI service, and compared with
 * the dashboard API, the MIS report API and the CSV export. Set RECON_EVIDENCE_DIR to save the
 * result as evidence.
 */
const paise = (v: string | null): bigint => {
  if (v === null) return 0n;
  const m = /^(-?)(\d+)\.(\d{2})$/.exec(v);
  if (!m) throw new Error(`not a 2-decimal amount: ${v}`);
  return (m[1] ? -1n : 1n) * (BigInt(m[2]) * 100n + BigInt(m[3]));
};
const rupees = (p: bigint): string => {
  const a = p < 0n ? -p : p;
  return `${p < 0n ? '-' : ''}${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`;
};
/** n / d as a percentage with 2 decimals, rounded half away from zero; null when d is not positive. */
const percent = (n: bigint, d: bigint): string | null =>
  d > 0n ? rupees((2n * n * 10000n + d) / (2n * d)) : null;

interface Ledger {
  schemeCode: string;
  originalBudget: bigint | null;
  approvedBudget: bigint | null;
  allocated: bigint;
  requested: bigint;
  pendingReleases: bigint;
  verifiedReleases: bigint;
  submittedExpenditure: bigint;
  verifiedExpenditure: bigint;
  adjustmentsSuperseded: bigint;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\ufeff/, '').split('\r\n');
  const start = lines.indexOf('') + 1;
  const split = (l: string) =>
    [...l.matchAll(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)]
      .slice(0, -1)
      .map((m) => (m[1].startsWith('"') ? m[1].slice(1, -1).replace(/""/g, '"') : m[1]));
  const head = split(lines[start]);
  return lines
    .slice(start + 1)
    .filter((l) => l.length > 0)
    .map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v])));
}

describe('F13 financial reconciliation (e2e, real database)', () => {
  let app: INestApplication;
  let owner: Client;
  let monitor: Session;
  const get = (s: Session, url: string) => s.agent.get(`/api/v1${url}`);
  const ledger = new Map<string, Ledger>();
  const checks: { check: string; compared: number; mismatches: number }[] = [];
  const record = (check: string, compared: number, mismatches: string[]) => {
    checks.push({ check, compared, mismatches: mismatches.length });
    expect([check, mismatches]).toEqual([check, []]);
  };

  beforeAll(async () => {
    ({ app } = await createApp());
    owner = await ownerClient();
    monitor = await login(app, 'state.monitor@example.test');
    const tenant = (await owner.query(`SELECT id FROM tenants WHERE code = 'ASSAM-DEMO'`)).rows[0]
      .id as string;
    const q = async (sql: string) => (await owner.query(sql, [tenant])).rows;

    for (const s of await q(
      `SELECT id, scheme_code FROM schemes WHERE tenant_id = $1
       AND status::text IN ('APPROVED','ACTIVE','SUSPENDED','COMPLETED','CLOSED')`,
    ))
      ledger.set(s.id, {
        schemeCode: s.scheme_code,
        originalBudget: null,
        approvedBudget: null,
        allocated: 0n,
        requested: 0n,
        pendingReleases: 0n,
        verifiedReleases: 0n,
        submittedExpenditure: 0n,
        verifiedExpenditure: 0n,
        adjustmentsSuperseded: 0n,
      });

    const versions = await q(
      `SELECT scheme_id, version_number, status::text AS status, total_amount::text AS amount
       FROM budget_versions WHERE tenant_id = $1 AND scheme_id IS NOT NULL ORDER BY version_number`,
    );
    for (const v of versions) {
      const l = ledger.get(v.scheme_id);
      if (!l) continue;
      if (['APPROVED', 'SUPERSEDED'].includes(v.status) && l.originalBudget === null)
        l.originalBudget = paise(v.amount);
      if (v.status === 'APPROVED') l.approvedBudget = paise(v.amount);
    }

    const allocs = await q(
      `SELECT id, scheme_id, parent_allocation_id, status::text AS status, amount::text AS amount
       FROM budget_allocations WHERE tenant_id = $1 AND scheme_id IS NOT NULL`,
    );
    const approved = new Map(allocs.filter((a) => a.status === 'APPROVED').map((a) => [a.id, a]));
    for (const a of approved.values()) {
      const parent = a.parent_allocation_id ? approved.get(a.parent_allocation_id) : undefined;
      if (parent && parent.scheme_id === a.scheme_id) continue; // child of a counted allocation
      const l = ledger.get(a.scheme_id);
      if (l) l.allocated += paise(a.amount);
    }

    for (const r of await q(
      `SELECT scheme_id, amount::text AS amount FROM budget_requests WHERE tenant_id = $1`,
    )) {
      const l = ledger.get(r.scheme_id);
      if (l) l.requested += paise(r.amount);
    }

    const releases = await q(
      `SELECT id, scheme_id, supersedes_id, verification_status::text AS status, amount::text AS amount
       FROM fund_releases WHERE tenant_id = $1`,
    );
    const replacedRel = new Set(
      releases
        .filter((r) => r.status === 'VERIFIED' && r.supersedes_id)
        .map((r) => r.supersedes_id),
    );
    for (const r of releases) {
      const l = ledger.get(r.scheme_id);
      if (!l) continue;
      if (r.status === 'PENDING') l.pendingReleases += paise(r.amount);
      if (r.status === 'VERIFIED' && !replacedRel.has(r.id)) l.verifiedReleases += paise(r.amount);
    }

    const spend = await q(
      `SELECT id, scheme_id, supersedes_id, status::text AS status, amount::text AS amount
       FROM expenditure_records WHERE tenant_id = $1`,
    );
    const replacedExp = new Set(
      spend.filter((e) => e.status === 'VERIFIED' && e.supersedes_id).map((e) => e.supersedes_id),
    );
    for (const e of spend) {
      const l = ledger.get(e.scheme_id);
      if (!l) continue;
      if (e.status === 'SUBMITTED') l.submittedExpenditure += paise(e.amount);
      if (e.status === 'VERIFIED') {
        if (replacedExp.has(e.id)) l.adjustmentsSuperseded += paise(e.amount);
        else l.verifiedExpenditure += paise(e.amount);
      }
    }
  });

  afterAll(async () => {
    const dir = process.env.RECON_EVIDENCE_DIR;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      const sum = (k: keyof Ledger) =>
        rupees([...ledger.values()].reduce((a, l) => a + ((l[k] as bigint | null) ?? 0n), 0n));
      writeFileSync(
        join(dir, 'financial-reconciliation.json'),
        JSON.stringify(
          {
            notice:
              'Synthetic demonstration data. Generated by financial-reconciliation.e2e-spec.ts.',
            generatedAt: new Date().toISOString(),
            schemesReconciled: ledger.size,
            independentLedgerTotalsInr: {
              originalApprovedBudget: sum('originalBudget'),
              revisedApprovedBudget: sum('approvedBudget'),
              allocated: sum('allocated'),
              fundingRequested: sum('requested'),
              pendingReleases: sum('pendingReleases'),
              verifiedReleases: sum('verifiedReleases'),
              submittedExpenditure: sum('submittedExpenditure'),
              verifiedExpenditure: sum('verifiedExpenditure'),
              verifiedExpenditureReplacedByCorrections: sum('adjustmentsSuperseded'),
            },
            checks,
            allChecksPassed: checks.length > 0 && checks.every((c) => c.mismatches === 0),
          },
          null,
          2,
        ) + '\n',
      );
    }
    await owner.end();
    await app.close();
  });

  it('every scheme row on the dashboard equals the independent ledger', async () => {
    const rows: Record<string, string | null>[] = [];
    for (let page = 1; ; page++) {
      const b = (await get(monitor, `/dashboards/schemes?pageSize=100&page=${page}`).expect(200))
        .body;
      rows.push(...b.items);
      if (rows.length >= b.total || b.items.length === 0) break;
    }
    expect(rows.length).toBe(ledger.size);
    const bad: string[] = [];
    for (const r of rows) {
      const l = ledger.get(r.id as string);
      if (!l) {
        bad.push(`${r.schemeCode}: not in ledger`);
        continue;
      }
      const want: Record<string, string | null> = {
        approvedBudget: l.approvedBudget === null ? null : rupees(l.approvedBudget),
        allocatedBudget: rupees(l.allocated),
        verifiedReleases: rupees(l.verifiedReleases),
        verifiedExpenditure: rupees(l.verifiedExpenditure),
        reportedExpenditure: rupees(l.verifiedExpenditure + l.submittedExpenditure),
        financialUtilisationPercent: percent(l.verifiedExpenditure, l.approvedBudget ?? 0n),
        releaseUtilisationPercent: percent(l.verifiedExpenditure, l.verifiedReleases),
      };
      for (const [k, v] of Object.entries(want))
        if (r[k] !== v) bad.push(`${l.schemeCode}.${k}: api=${r[k]} ledger=${v}`);
    }
    record('Dashboard scheme rows vs independent ledger (7 figures per scheme)', rows.length, bad);
  });

  it('statewide totals and the state-summary report equal the ledger sums', async () => {
    const all = [...ledger.values()];
    const sum = (f: (l: Ledger) => bigint) => all.reduce((a, l) => a + f(l), 0n);
    const approved = sum((l) => l.approvedBudget ?? 0n);
    const allocated = sum((l) => l.allocated);
    const released = sum((l) => l.verifiedReleases);
    const spent = sum((l) => l.verifiedExpenditure);
    const want: Record<string, string | number | null> = {
      schemeCount: all.length,
      originalBudget: rupees(sum((l) => l.originalBudget ?? 0n)),
      approvedBudget: rupees(approved),
      allocatedBudget: rupees(allocated),
      verifiedReleases: rupees(released),
      verifiedExpenditure: rupees(spent),
      reportedExpenditure: rupees(spent + sum((l) => l.submittedExpenditure)),
      financialUtilisationPercent: percent(spent, approved),
      releaseUtilisationPercent: percent(spent, released),
      budgetRemaining: rupees(approved - spent),
      unreleasedAllocation: rupees(allocated - released),
      unspentReleasedFunds: rupees(released - spent),
    };
    const totals = (await get(monitor, '/dashboards/state').expect(200)).body.totals;
    const report = (await get(monitor, '/reports/state-summary').expect(200)).body.rows[0];
    const bad: string[] = [];
    for (const [k, v] of Object.entries(want)) {
      if (k in totals && totals[k] !== v) bad.push(`dashboard.${k}: api=${totals[k]} ledger=${v}`);
      if (k in report && report[k] !== v) bad.push(`report.${k}: api=${report[k]} ledger=${v}`);
    }
    expect(Object.keys(want).filter((k) => k in totals).length).toBeGreaterThanOrEqual(11);
    record('State dashboard totals and state-summary report vs ledger sums', 2, bad);
  });

  it('CSV exports carry the same figures as the ledger', async () => {
    const byCode = new Map([...ledger.values()].map((l) => [l.schemeCode, l]));
    const bve = parseCsv(
      (await get(monitor, '/reports/budget-vs-expenditure/export?format=csv').expect(200)).text,
    );
    const ru = parseCsv(
      (await get(monitor, '/reports/release-utilisation/export?format=csv').expect(200)).text,
    );
    expect(bve.length).toBe(ledger.size);
    expect(ru.length).toBe(ledger.size);
    const bad: string[] = [];
    const cmp = (code: string, label: string, got: string, want: string | null, na = '') => {
      if (got !== (want ?? na)) bad.push(`${code} "${label}": csv=${got} ledger=${want ?? na}`);
    };
    for (const r of bve) {
      const l = byCode.get(r['Scheme code'])!;
      const ab = l.approvedBudget;
      cmp(
        l.schemeCode,
        'approved',
        r['Revised approved budget (INR)'],
        ab === null ? null : rupees(ab),
      );
      cmp(l.schemeCode, 'verified', r['Verified expenditure (INR)'], rupees(l.verifiedExpenditure));
      cmp(
        l.schemeCode,
        'reported',
        r['Reported expenditure (INR)'],
        rupees(l.verifiedExpenditure + l.submittedExpenditure),
      );
      cmp(
        l.schemeCode,
        'utilisation',
        r['Financial utilisation %'],
        percent(l.verifiedExpenditure, ab ?? 0n),
        'N/A',
      );
      if (ab !== null)
        cmp(
          l.schemeCode,
          'remaining',
          r['Budget remaining (INR)'],
          rupees(ab - l.verifiedExpenditure),
        );
    }
    for (const r of ru) {
      const l = byCode.get(r['Scheme code'])!;
      cmp(l.schemeCode, 'allocated', r['Allocated budget (INR)'], rupees(l.allocated));
      cmp(l.schemeCode, 'released', r['Verified funds released (INR)'], rupees(l.verifiedReleases));
      cmp(
        l.schemeCode,
        'release utilisation',
        r['Release utilisation %'],
        percent(l.verifiedExpenditure, l.verifiedReleases),
        'N/A',
      );
      cmp(
        l.schemeCode,
        'unreleased',
        r['Unreleased allocation (INR)'],
        rupees(l.allocated - l.verifiedReleases),
      );
      cmp(
        l.schemeCode,
        'unspent',
        r['Unspent released funds (INR)'],
        rupees(l.verifiedReleases - l.verifiedExpenditure),
      );
    }
    record(
      'CSV exports (budget-vs-expenditure, release-utilisation) vs ledger',
      bve.length + ru.length,
      bad,
    );
  });

  it('database invariants: no approved allocation above its ceiling, no self-verified money records', async () => {
    const bad: string[] = [];
    const n = async (label: string, sql: string) => {
      const c = (await owner.query(sql)).rows[0].n as number;
      if (c !== 0) bad.push(`${label}: ${c} rows`);
    };
    await n(
      'scheme allocations above approved budget',
      `SELECT COUNT(*)::int n FROM (
         SELECT a.scheme_id FROM budget_allocations a
         WHERE a.status = 'APPROVED' AND a.scheme_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM budget_allocations p WHERE p.id = a.parent_allocation_id
             AND p.scheme_id = a.scheme_id AND p.status = 'APPROVED')
         GROUP BY a.scheme_id
         HAVING SUM(a.amount) > (SELECT MAX(bv.total_amount) FROM budget_versions bv
           WHERE bv.scheme_id = a.scheme_id AND bv.status = 'APPROVED')) x`,
    );
    await n(
      'children above parent allocation',
      `SELECT COUNT(*)::int n FROM budget_allocations p WHERE p.status = 'APPROVED' AND p.amount <
         (SELECT COALESCE(SUM(c.amount), 0) FROM budget_allocations c
          WHERE c.parent_allocation_id = p.id AND c.status = 'APPROVED')`,
    );
    await n(
      'expenditure verified by its submitter',
      `SELECT COUNT(*)::int n FROM expenditure_records WHERE status = 'VERIFIED' AND verified_by = submitted_by`,
    );
    await n(
      'release verified by its recorder',
      `SELECT COUNT(*)::int n FROM fund_releases WHERE verification_status = 'VERIFIED' AND verified_by = created_by`,
    );
    await n(
      'money columns with more than 2 decimals',
      `SELECT COUNT(*)::int n FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name IN ('amount', 'total_amount')
         AND NOT (data_type = 'numeric' AND numeric_precision = 18 AND numeric_scale = 2)`,
    );
    record('Database invariants (ceilings, maker-checker, exact NUMERIC(18,2))', 5, bad);
  });
});
