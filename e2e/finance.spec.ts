import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * F07–F09 journeys: releases, expenditure, physical progress and the verification queue.
 * Runs against a stack seeded with the synthetic data; SEED_DEMO_PASSWORD must match the seed.
 * Progress uses DEMO-009 (CD-A1) and consumes the next unused 2026-27 period on each run.
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? '';
const OFFICER = 'field.officer@example.test';
const FINANCE = 'finance.reviewer@example.test';
const FINANCE_CHECKER = 'finance.checker@example.test';
const DISTRICT_A = 'district.reviewer@example.test';
const RUN = Date.now().toString(36).toUpperCase();

interface Actor {
  page: Page;
  close: () => Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped JSON fixtures
  api: (method: 'GET' | 'POST', path: string, body?: object) => Promise<any>;
}

async function actor(browser: Browser, email: string): Promise<Actor> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  const req: APIRequestContext = ctx.request;
  const api = async (method: 'GET' | 'POST', path: string, body?: object) => {
    const csrf = (await ctx.cookies()).find((c) => c.name === 'dcp_csrf')?.value ?? '';
    const res = await req.fetch(`/api/v1${path}`, {
      method,
      data: body,
      headers: { 'x-csrf-token': csrf, 'Idempotency-Key': `e2e-${crypto.randomUUID()}` },
    });
    const json = await res.json().catch(() => null);
    if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${JSON.stringify(json)}`);
    return json;
  };
  return { page, api, close: () => ctx.close() };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const metric = (p: Page, name: string) => p.getByTestId(`metric-${name}`);

test.describe.serial('F07–F09 releases, expenditure, progress and maker-checker', () => {
  let officer: Actor;
  let finance: Actor;
  let financeChecker: Actor;
  let district: Actor;
  let schemeId = '';
  const scheme = /^DEMO-009 /;

  const openScheme = async (p: Page, path: '/finance' | '/progress') => {
    await p.goto(path);
    const picker = p.getByLabel('Scheme');
    await expect(picker.locator('option', { hasText: scheme })).toHaveCount(1);
    await picker.selectOption(schemeId);
  };

  test.beforeAll(async ({ browser }) => {
    if (!PASSWORD)
      throw new Error('Set SEED_DEMO_PASSWORD to the password used for the demo seed.');
    officer = await actor(browser, OFFICER);
    finance = await actor(browser, FINANCE);
    financeChecker = await actor(browser, FINANCE_CHECKER);
    district = await actor(browser, DISTRICT_A);
    schemeId = (await officer.api('GET', '/schemes?q=DEMO-009')).items[0].id;
  });
  test.afterAll(async () => {
    for (const a of [officer, finance, financeChecker, district]) await a?.close();
  });

  test('7. finance records a release → maker cannot verify it → second finance reviewer verifies → verified releases update', async () => {
    const ref = `E2E-REL-${RUN}`;
    const p = finance.page;
    await openScheme(p, '/finance');
    const before = await metric(p, 'Verified releases').innerText();
    await p.getByLabel('Release amount (INR)').fill('12345.67');
    await p.getByLabel('Release date').fill('2026-11-10');
    await p.getByLabel('Release reference').fill(ref);
    await p.getByRole('button', { name: 'Record release' }).click();
    await expect(p.getByTestId(`release-${ref}`)).toContainText('PENDING');
    await expect(metric(p, 'Pending releases')).not.toHaveText('₹0.00');

    // The maker's queue never lists their own record, and the API refuses a self-decision.
    await p.goto('/verification');
    await expect(p.getByRole('heading', { name: 'Verification queue' })).toBeVisible();
    await expect(p.getByTestId(`queue-FUND_RELEASE-${ref}`)).toHaveCount(0);
    const rel = (
      await finance.api('GET', `/fund-releases?schemeId=${schemeId}&pageSize=100`)
    ).items.find((r: { reference: string }) => r.reference === ref);
    await expect(
      finance.api('POST', `/fund-releases/${rel.id}/decision`, {
        version: rel.version,
        decision: 'VERIFY',
      }),
    ).rejects.toThrow(/403.*SELF_APPROVAL_FORBIDDEN/);

    const c = financeChecker.page;
    await c.goto('/verification');
    const row = c.getByTestId(`queue-FUND_RELEASE-${ref}`);
    await row.getByRole('button', { name: 'Verify' }).click();
    await expect(row).toHaveCount(0);

    await openScheme(p, '/finance');
    await expect(p.getByTestId(`release-${ref}`)).toContainText('VERIFIED');
    await expect(metric(p, 'Verified releases')).not.toHaveText(before);
  });

  test('8. officer submits expenditure → return needs a reason → resubmit → finance verifies → correction keeps the original (T09)', async () => {
    const ref = `E2E-EXP-${RUN}`;
    const o = officer.page;
    await openScheme(o, '/finance');
    const verifiedBefore = await metric(o, 'Verified expenditure').innerText();
    await o.getByLabel('Reporting period').selectOption({ label: '2026-11' });
    await o.getByLabel('Expenditure amount (INR)').fill('2500.00');
    await o.getByLabel('Expenditure date').fill('2026-11-10');
    await o.getByLabel('Bill or voucher reference').fill(ref);
    await o.getByRole('button', { name: 'Submit expenditure' }).click();
    const own = o.getByTestId(`expenditure-${ref}`);
    await expect(own).toContainText('SUBMITTED');
    await expect(metric(o, 'Verified expenditure')).toHaveText(verifiedBefore);

    const f = finance.page;
    await f.goto('/verification');
    const row = f.getByTestId(`queue-EXPENDITURE-${ref}`);
    await row.getByRole('button', { name: 'Return' }).click();
    await expect(f.getByRole('alert')).toContainText(/reason/i);
    await row.getByLabel('Decision reason').fill('Voucher copy is illegible');
    await row.getByRole('button', { name: 'Return' }).click();
    await expect(row).toHaveCount(0);

    await openScheme(o, '/finance');
    await expect(own).toContainText('RETURNED');
    await expect(own).toContainText('Voucher copy is illegible');
    await own.getByRole('button', { name: 'Resubmit' }).click();
    await expect(own).toContainText('SUBMITTED');

    await f.goto('/verification');
    await row.getByRole('button', { name: 'Verify' }).click();
    await expect(row).toHaveCount(0);

    await openScheme(o, '/finance');
    await expect(own).toContainText('VERIFIED');
    await expect(metric(o, 'Verified expenditure')).not.toHaveText(verifiedBefore);
    await own.getByRole('button', { name: 'Correct' }).click();
    await o.getByLabel('Corrected amount (INR)').fill('2400.00');
    await o.getByLabel('Correction reason').fill('Voucher arithmetic corrected');
    await o.getByRole('button', { name: 'Submit correction' }).click();
    const correction = o.getByTestId(`expenditure-${ref}-CORR`);
    await expect(correction).toContainText('(correction)');
    await expect(correction).toContainText('SUBMITTED');
    await expect(correction).toContainText('₹2,400.00');
    await expect(own).toContainText('VERIFIED');
    await expect(own).toContainText('₹2,500.00');
  });

  test('9. progress draft → submit (KPI unchanged) → district returns → officer edits and resubmits → district verifies → completion updates', async () => {
    const summary = await officer.api('GET', `/schemes/${schemeId}/progress`);
    const used = new Set(
      (
        await officer.api('GET', `/progress-submissions?schemeId=${schemeId}&pageSize=100`)
      ).items.map((s: { period: { code: string } }) => s.period.code),
    );
    const periods: { code: string; financialYearId: string }[] = await officer.api(
      'GET',
      '/budget/periods',
    );
    const fy = (await officer.api('GET', `/schemes/${schemeId}`)).financialYear.id;
    const period = periods
      .filter((x) => x.financialYearId === fy && !used.has(x.code))
      .map((x) => x.code)
      .sort()[0];
    test.skip(
      !period,
      'All 2026-27 periods of DEMO-009 already used on this database; reseed to rerun.',
    );

    // Half of the first milestone, nothing else: completion = w1 × 0.5 / Σw.
    const ms: { name: string; weight: string; targetQuantity: string }[] = summary.milestones;
    const total = ms.reduce((a, m) => a + Number(m.weight), 0);
    const expected = `${((Number(ms[0].weight) * 0.5 * 100) / total).toFixed(2)}%`;
    const half = (Number(ms[0].targetQuantity) / 2).toString();

    const o = officer.page;
    await openScheme(o, '/progress');
    const before = await o.getByTestId('physical-completion').innerText();
    await o.getByLabel('Progress period').selectOption({ label: period });
    await o.getByLabel(new RegExp(`^${esc(ms[0].name)} — cumulative`)).fill('1');
    for (const m of ms.slice(1))
      await o.getByLabel(new RegExp(`^${esc(m.name)} — cumulative`)).fill('0');
    await o.getByLabel('Remarks').fill(`E2E progress ${RUN}`);
    await o.getByRole('button', { name: 'Save draft' }).click();
    const sub = o.getByTestId(`submission-${period}-v1`);
    await expect(sub).toContainText('DRAFT');
    await sub.getByRole('button', { name: 'Submit' }).click();
    await expect(sub).toContainText('SUBMITTED');
    await expect(o.getByTestId('physical-completion')).toHaveText(before);

    const d = district.page;
    await d.goto('/verification');
    const row = d.getByTestId(`queue-PROGRESS-${period}`).filter({ hasText: 'DEMO-009' });
    await row.getByLabel('Decision reason').fill('Quantity does not match the site photo');
    await row.getByRole('button', { name: 'Return' }).click();
    await expect(row).toHaveCount(0);

    await openScheme(o, '/progress');
    await expect(sub).toContainText('RETURNED');
    await expect(sub).toContainText('Quantity does not match the site photo');
    await sub.getByRole('button', { name: 'Edit' }).click();
    await o.getByLabel(new RegExp(`^${esc(ms[0].name)} — cumulative`)).fill(half);
    await o.getByRole('button', { name: 'Save changes' }).click();
    await sub.getByRole('button', { name: 'Resubmit' }).click();
    await expect(sub).toContainText('RESUBMITTED');

    await d.goto('/verification');
    await row.getByRole('button', { name: 'Verify' }).click();
    await expect(row).toHaveCount(0);

    await openScheme(o, '/progress');
    await expect(sub).toContainText('VERIFIED');
    await expect(o.getByTestId('physical-completion')).toHaveText(expected);
  });
});
