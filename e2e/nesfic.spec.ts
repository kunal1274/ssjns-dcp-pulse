import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';

/**
 * F12.4 NESFIC-D-10 demonstration journey (synthetic data only).
 * The fixture (scheme, milestone, location, budget, ₹70 lakh verified release) is created through
 * the real APIs with a fresh scheme code per run; every later step is driven through the UI by the
 * role named in the scenario. Set EVIDENCE_DIR to also keep step screenshots for the evidence pack.
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? '';
const RUN = Date.now().toString(36).toUpperCase();
const CODE = `NJ-${RUN}`;
const NAME = `Rural road improvement ${RUN} (synthetic)`;

interface Actor {
  page: Page;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped JSON fixtures
  api: (method: 'GET' | 'POST' | 'PUT', path: string, body?: object) => Promise<any>;
  close: () => Promise<void>;
}

async function actor(browser: Browser, email: string): Promise<Actor> {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  const api = async (method: 'GET' | 'POST' | 'PUT', path: string, body?: object) => {
    const csrf = (await ctx.cookies()).find((c) => c.name === 'dcp_csrf')?.value ?? '';
    const res = await ctx.request.fetch(`/api/v1${path}`, {
      method,
      data: body,
      headers: { 'x-csrf-token': csrf, 'Idempotency-Key': `nj-${crypto.randomUUID()}` },
    });
    const json = await res.json().catch(() => null);
    if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${JSON.stringify(json)}`);
    return json;
  };
  return { page, api, close: () => ctx.close() };
}

const inr = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function shot(page: Page, info: TestInfo, name: string) {
  const body = await page.screenshot({ fullPage: true });
  await info.attach(name, { body, contentType: 'image/png' });
  if (process.env.EVIDENCE_DIR)
    await page.screenshot({ path: `${process.env.EVIDENCE_DIR}/${name}.png`, fullPage: true });
}

test('NESFIC-D-10 journey: plan → report → verify → alert → corrective action → map → MIS → audit', async ({
  browser,
}, info) => {
  test.setTimeout(180_000);
  if (!PASSWORD) throw new Error('Set SEED_DEMO_PASSWORD to the password used for the demo seed.');
  const planner = await actor(browser, 'state.planner@example.test');
  const checker = await actor(browser, 'budget.checker@example.test');
  const finance = await actor(browser, 'finance.reviewer@example.test');
  const financeChecker = await actor(browser, 'finance.checker@example.test');
  const officer = await actor(browser, 'field.officer@example.test');
  const district = await actor(browser, 'district.reviewer@example.test');
  const monitor = await actor(browser, 'state.monitor@example.test');
  const auditor = await actor(browser, 'auditor@example.test');

  // ---- Fixture through real APIs: ₹1 crore approved scheme with ₹70 lakh verified release.
  const fy = (await planner.api('GET', '/budget/financial-years')).find(
    (f: { code: string }) => f.code === '2026-27',
  );
  const js: { id: string; code: string }[] = await planner.api('GET', '/jurisdictions');
  const jid = (c: string) => js.find((j) => j.code === c)!.id;
  const agency = (await planner.api('GET', '/agencies')).find(
    (a: { code: string }) => a.code === 'AG-ROADS',
  );
  let scheme = await planner.api('POST', '/schemes', {
    schemeCode: CODE,
    name: NAME,
    category: 'ROADS',
    department: 'Public Works (synthetic)',
    financialYearId: fy.id,
    agencyId: agency.id,
    jurisdictionId: jid('CD-A1'),
    startDate: '2026-05-01',
    targetEndDate: '2027-03-31',
    proposedBudget: '10000000.00',
  });
  await planner.api('POST', `/schemes/${scheme.id}/milestones`, {
    name: 'Road improvement 0–10 km',
    targetDate: '2027-03-15',
    targetQuantity: '10.000',
    unit: 'km',
    weight: '100.00',
  });
  await planner.api('PUT', `/schemes/${scheme.id}/location`, {
    latitude: 26.18,
    longitude: 91.62,
    locationAccuracy: 'SYNTHETIC_APPROXIMATE',
  });
  scheme = await planner.api('POST', `/schemes/${scheme.id}/submit`, { version: scheme.version });
  scheme = await checker.api('POST', `/schemes/${scheme.id}/decision`, {
    version: scheme.version,
    decision: 'APPROVE',
  });

  const ceilings = await planner.api('GET', `/budget/ceilings?financialYearId=${fy.id}`);
  let ceiling = ceilings.find(
    (c: { jurisdictionId: string; status: string }) => c.jurisdictionId === jid('AS-DEMO'),
  );
  if (!ceiling) {
    const c = await planner.api('POST', '/budget/ceilings', {
      financialYearId: fy.id,
      jurisdictionId: jid('AS-DEMO'),
      totalAmount: '500000000.00',
      approvalReference: 'SYNTHETIC-DEMO-CEILING',
    });
    ceiling = await checker.api('POST', `/budget/ceilings/${c.id}/approve`, { version: c.version });
  }
  test.skip(
    Number(ceiling.available) < 10_000_000,
    'Demo ceiling exhausted on this database; run pnpm db:demo-reset.',
  );
  const allocate = async (body: object) => {
    const a = await planner.api('POST', '/budget/allocations', {
      budgetVersionId: ceiling.id,
      amount: '10000000.00',
      ...body,
    });
    return checker.api('POST', `/budget/allocations/${a.id}/approve`, { version: a.version });
  };
  const dist = await allocate({ recipientJurisdictionId: jid('DIST-A') });
  const cd = await allocate({ parentAllocationId: dist.id, recipientJurisdictionId: jid('CD-A1') });
  await allocate({
    parentAllocationId: cd.id,
    recipientJurisdictionId: jid('CD-A1'),
    schemeId: scheme.id,
  });

  const release = await finance.api('POST', '/fund-releases', {
    schemeId: scheme.id,
    amount: '7000000.00',
    releaseDate: '2026-06-15',
    reference: `SYN/REL/${RUN}`,
  });
  await financeChecker.api('POST', `/fund-releases/${release.id}/decision`, {
    version: release.version,
    decision: 'VERIFY',
  });

  const today = new Date().toISOString().slice(0, 10);
  const periods: {
    id: string;
    code: string;
    financialYearId: string;
    startDate: string;
    endDate: string;
  }[] = await planner.api('GET', '/budget/periods');
  const period =
    periods.filter((p) => p.financialYearId === fy.id && p.startDate.slice(0, 10) <= today).pop() ??
    periods.find((p) => p.financialYearId === fy.id)!;
  const spendDate = period.endDate.slice(0, 10) < today ? period.endDate.slice(0, 10) : today;

  // ---- 1–2. State planning officer signs in and views the statewide dashboard.
  const p = planner.page;
  await p.getByRole('link', { name: 'Dashboards' }).click();
  await expect(p.getByTestId('kpi-grid')).toBeVisible();
  await shot(p, info, '01-state-dashboard');

  // ---- 3–4. Selects District A; the district dashboard lists its schemes and financial status.
  await p.getByTestId('compare-DIST-A').getByRole('link').click();
  await expect(p.getByTestId('dashboard-title')).toContainText('District A');
  const row = p.getByTestId(`dash-scheme-${CODE}`);
  await expect(row).toBeVisible();
  await shot(p, info, '02-district-dashboard');

  // ---- 5–6. Opens the rural road scheme: ₹1 crore approved, ₹70 lakh released.
  await row.getByRole('link', { name: CODE }).click();
  await expect(p.getByTestId('scheme360-title')).toContainText(CODE);
  await expect(p.getByTestId('s360-approved')).toContainText(inr(10_000_000));
  await expect(p.getByTestId('s360-released')).toContainText(inr(7_000_000));
  await shot(p, info, '03-scheme-360-before');

  // ---- 7. Implementing officer reports 40% physical completion (4 of 10 km).
  const o = officer.page;
  await o.goto('/progress');
  await o.getByLabel('Scheme').selectOption(scheme.id);
  await o.getByLabel('Progress period').selectOption({ label: period.code });
  await o.getByLabel(/^Road improvement 0–10 km — cumulative/).fill('4');
  await o.getByLabel('Remarks').fill('4 km of 10 km improved (synthetic)');
  await o.getByRole('button', { name: 'Save draft' }).click();
  const sub = o.getByTestId(`submission-${period.code}-v1`);
  await sub.getByRole('button', { name: 'Submit' }).click();
  await expect(sub).toContainText('SUBMITTED');

  // ---- 8. Implementing officer reports ₹55 lakh expenditure.
  const ref = `NJ-EXP-${RUN}`;
  await o.goto('/finance');
  await o.getByLabel('Scheme').selectOption(scheme.id);
  await o.getByLabel('Reporting period').selectOption({ label: period.code });
  await o.getByLabel('Expenditure amount (INR)').fill('5500000.00');
  await o.getByLabel('Expenditure date').fill(spendDate);
  await o.getByLabel('Bill or voucher reference').fill(ref);
  await o.getByRole('button', { name: 'Submit expenditure' }).click();
  await expect(o.getByTestId(`expenditure-${ref}`)).toContainText('SUBMITTED');

  // ---- 9. Reviewers approve: district verifies progress, finance verifies expenditure.
  const d = district.page;
  await d.goto('/verification');
  const prow = d.getByTestId(`queue-PROGRESS-${period.code}`).filter({ hasText: CODE });
  await prow.getByRole('button', { name: 'Verify' }).click();
  await expect(prow).toHaveCount(0);
  const f = finance.page;
  await f.goto('/verification');
  const erow = f.getByTestId(`queue-EXPENDITURE-${ref}`);
  await erow.getByRole('button', { name: 'Verify' }).click();
  await expect(erow).toHaveCount(0);

  // ---- 10–11. Dashboard shows verified figures: 55% financial utilisation, 40% physical.
  await p.reload();
  await expect(p.getByTestId('s360-spent')).toContainText(inr(5_500_000));
  await expect(p.getByTestId('s360-fin-util')).toContainText('55.00');
  await expect(p.getByTestId('s360-physical')).toContainText('40.00');
  await expect(p.getByTestId('s360-gap')).toContainText('15.00');
  await shot(p, info, '04-scheme-360-verified');

  // ---- 12. The configurable 15-point gap rule raises an alert (event-triggered evaluation).
  let alertId = '';
  await expect
    .poll(
      async () => {
        const list = await district.api(
          'GET',
          '/alerts?ruleCode=PHYSICAL_FINANCIAL_GAP&pageSize=100',
        );
        alertId =
          list.items.find(
            (a: { scheme: { schemeCode: string } | null }) => a.scheme?.schemeCode === CODE,
          )?.id ?? '';
        return alertId;
      },
      { timeout: 30_000, intervals: [1000] },
    )
    .not.toBe('');
  await d.goto(`/alerts/${alertId}`);
  await expect(d.getByTestId('alert-title')).toContainText(CODE);
  await expect(d.getByTestId('ctx-gapPercentagePoints')).toHaveText('15.00');
  await expect(d.getByText('Review indicator').first()).toBeVisible();

  // ---- 13. Alert assigned to the responsible officer.
  const assignee = d.getByLabel('Assignee');
  await expect(assignee.locator('option')).not.toHaveCount(1);
  const names = await assignee.locator('option').allTextContents();
  await assignee.selectOption({ label: names.find((n) => /Implementing Officer/.test(n))! });
  await d.getByRole('button', { name: 'Assign' }).click();
  await expect(d.getByTestId('alert-assignee')).toContainText('Implementing Officer');
  await shot(d, info, '05-alert-assigned');

  // ---- 14. Corrective action created for the officer, who records progress and evidence.
  const actionText = `Reconcile measurement book with verified spend ${RUN}`;
  const owner = d.getByLabel('Responsible officer');
  await owner.selectOption({ label: names.find((n) => /Implementing Officer/.test(n))! });
  await d
    .getByLabel('Due date')
    .fill(new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10));
  await d.getByLabel('Action', { exact: true }).fill(actionText);
  await d.getByRole('button', { name: 'Create corrective action' }).click();
  await d.getByRole('link', { name: actionText }).click();
  const caUrl = d.url();
  await o.getByRole('link', { name: 'Actions' }).click();
  await o.getByRole('button', { name: 'Assigned to me' }).click();
  await o.getByRole('link', { name: actionText }).click();
  await o.getByLabel('Progress note').fill('Site measured; 4 km confirmed (synthetic)');
  await o.getByRole('button', { name: 'Add progress note' }).click();
  await expect(o.getByTestId('ca-status')).toContainText('IN_PROGRESS');
  await o.getByLabel('Evidence reference').fill('Synthetic MB page 14');
  await o.getByRole('button', { name: 'Submit for verification' }).click();
  await expect(o.getByTestId('ca-status')).toContainText('PENDING_VERIFICATION');

  // ---- 15. Reviewer verifies and closes it (independent of the responsible officer).
  await d.goto(caUrl);
  await d.getByLabel('Verification reason').fill('Checked against synthetic measurement book');
  await d.getByRole('button', { name: 'Verify and close' }).click();
  await expect(d.getByTestId('ca-status')).toContainText('CLOSED');
  await shot(d, info, '06-corrective-action-closed');

  // ---- 16. State officer views the scheme on the GIS map.
  const m = monitor.page;
  await m.getByRole('link', { name: 'Map' }).click();
  await expect(m.getByTestId('gis-notice')).toContainText('synthetic');
  await expect(m.locator('.maplibregl-canvas')).toBeVisible();
  const gisRow = m.getByTestId('gis-row').filter({ hasText: CODE });
  await expect(gisRow).toContainText('40.00');
  await expect(gisRow).toContainText('55.00');
  await shot(m, info, '07-gis-map');
  await gisRow.getByRole('link', { name: CODE }).click();
  await expect(m.getByTestId('scheme360-title')).toContainText(CODE);

  // ---- 17. State officer exports a district-level MIS report.
  await m.getByRole('link', { name: 'Reports' }).click();
  await m.getByLabel('Report', { exact: true }).selectOption('district-progress');
  await m.getByLabel('Jurisdiction').selectOption({ label: 'District A' });
  await expect(m.getByTestId('report-meta')).toContainText('District A');
  await expect(m.getByTestId('report-row').filter({ hasText: 'Co-district A1' })).toBeVisible();
  await shot(m, info, '08-mis-report');
  const [download] = await Promise.all([
    m.waitForEvent('download'),
    m.getByTestId('export-csv').click(),
  ]);
  const csv = readFileSync((await download.path())!, 'utf8');
  expect(csv).toContain('Report,District-wise physical and financial progress');
  expect(csv).toContain('Jurisdiction filter,District A');
  expect(csv).toContain('Co-district A1');
  expect(csv).toContain('Notice,Synthetic demonstration data');

  // ---- 18. Auditor reviews the approval and audit history.
  const a = auditor.page;
  await a.getByRole('link', { name: 'Reports' }).click();
  await a.getByLabel('Report', { exact: true }).selectOption('scheme-history');
  await a.getByLabel('Scheme', { exact: true }).selectOption(scheme.id);
  const hist = a.getByTestId('report-table');
  for (const t of [
    'SCHEME_APPROVED',
    'FUND_RELEASE_RECORDED',
    'Approval',
    'VERIFY',
    'corrective_action.created',
  ])
    await expect(hist).toContainText(t);
  await shot(a, info, '09-audit-history');

  for (const x of [planner, checker, finance, financeChecker, officer, district, monitor, auditor])
    await x.close();
});
