import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';

/**
 * F04–F06 user journeys against a running stack with the synthetic seed.
 * SEED_DEMO_PASSWORD must match the password used when seeding.
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? '';
const PLANNER = 'state.planner@example.test';
const CHECKER = 'budget.checker@example.test';
const DISTRICT_A = 'district.reviewer@example.test';
const RUN = Date.now().toString(36).toUpperCase();

interface Actor {
  ctx: BrowserContext;
  page: Page;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped JSON fixtures
  api: (method: 'GET' | 'POST', path: string, body?: object) => Promise<any>;
}

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
}

async function actor(browser: Browser, email: string): Promise<Actor> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, email);
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
  return { ctx, page, api };
}

test.beforeAll(() => {
  if (!PASSWORD) throw new Error('Set SEED_DEMO_PASSWORD to the password used for the demo seed.');
});

test('1. login → authenticated area → logout → protected route denied', async ({ page }) => {
  await page.goto('/schemes');
  await expect(page).toHaveURL(/\/login\?next=%2Fschemes/);
  await page.getByLabel('Email').fill(PLANNER);
  await page.getByLabel('Password').fill('wrong-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid email or password');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/schemes$/);
  await expect(page.getByRole('heading', { name: 'Scheme register' })).toBeVisible();
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === 'dcp_session')?.httpOnly).toBe(true);
  expect(
    await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage)),
  ).not.toMatch(/dcp_session|token/i);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/schemes');
  await expect(page).toHaveURL(/\/login/);
  expect((await page.request.get('/api/v1/schemes')).status()).toBe(401);
});

test.describe.serial('scheme registry and budget planning', () => {
  let planner: Actor;
  let checker: Actor;
  let fyId = '';
  let fyCode = '';
  const j: Record<string, string> = {};
  let schemeUrl = '';
  const schemeCode = `E2E-${RUN}`;

  test.beforeAll(async ({ browser }) => {
    planner = await actor(browser, PLANNER);
    checker = await actor(browser, CHECKER);
    for (const x of await planner.api('GET', '/jurisdictions')) j[x.code] = x.id;
    // A fresh financial year per run keeps ceiling registration repeatable.
    fyCode = `E2E-${RUN}`.slice(0, 20);
    // Financial years cannot overlap, so start after the latest configured year.
    const years: { endDate: string }[] = await planner.api('GET', '/budget/financial-years');
    const y = Math.max(2030, ...years.map((f) => new Date(f.endDate).getUTCFullYear()));
    fyId = (
      await planner.api('POST', '/budget/financial-years', {
        code: fyCode,
        startDate: `${y}-04-01`,
        endDate: `${y + 1}-03-31`,
      })
    ).id;
  });
  test.afterAll(async () => {
    await planner?.ctx.close();
    await checker?.ctx.close();
  });

  test('2. officer creates scheme → submits → maker cannot approve → reviewer approves → appears in register', async () => {
    const p = planner.page;
    await p.goto('/schemes/new');
    await p.getByLabel('Scheme reference').fill(schemeCode);
    await p.getByLabel('Title').fill('E2E synthetic culvert');
    await p.getByLabel('Category').fill('Infrastructure');
    await p.getByLabel('Financial year').selectOption({ label: fyCode });
    await p.getByLabel('District / co-district').selectOption(j['CD-A1']);
    await p.getByLabel('Implementing agency').selectOption({ index: 1 });
    await p.getByLabel('Proposed budget (INR)').fill('150000.00');
    await p.getByRole('button', { name: 'Save draft' }).click();
    await expect(
      p.getByRole('heading', { name: `${schemeCode} — E2E synthetic culvert` }),
    ).toBeVisible();
    await expect(p.getByText('DRAFT', { exact: true })).toBeVisible();
    schemeUrl = new URL(p.url()).pathname;
    await p.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(p.getByText('SUBMITTED', { exact: true })).toBeVisible();
    await p.getByRole('button', { name: 'Approve' }).click();
    await expect(p.getByRole('alert')).toContainText('SELF_APPROVAL_FORBIDDEN');
    await expect(p.getByText('SUBMITTED', { exact: true })).toBeVisible();

    const c = checker.page;
    await c.goto(schemeUrl);
    await c.getByRole('button', { name: 'Approve' }).click();
    await expect(c.getByText('APPROVED', { exact: true })).toBeVisible();
    await c.goto(`/schemes?q=${schemeCode}`);
    const row = c.getByRole('row').filter({ hasText: schemeCode });
    await expect(row).toContainText('APPROVED');
    await expect(row).toContainText('₹1,50,000.00');
  });

  const ceilingRow = (p: Page) => p.getByTestId(/^ceiling-/).first();
  const allocRow = (p: Page, text: string) =>
    p.getByTestId(/^allocation-/).filter({ hasText: text });

  test('3 & 6. ceiling → district → co-district → scheme; maker cannot approve own allocation; remaining recalculates', async () => {
    const p = planner.page;
    const c = checker.page;
    await p.goto('/budget');
    await p.getByLabel('Financial year').selectOption(fyId);
    await p.getByLabel('Ceiling amount (INR)').fill('1000000.00');
    await p.getByRole('button', { name: 'Register ceiling' }).click();
    await expect(ceilingRow(p)).toContainText('DRAFT');
    await ceilingRow(p).getByRole('button', { name: 'Approve' }).click();
    await expect(p.getByRole('alert').first()).toContainText('SELF_APPROVAL_FORBIDDEN');

    await c.goto('/budget');
    await c.getByLabel('Financial year').selectOption(fyId);
    await ceilingRow(c).getByRole('button', { name: 'Approve' }).click();
    await expect(ceilingRow(c)).toContainText('APPROVED');

    await p.reload();
    await p.getByLabel('Financial year').selectOption(fyId);
    await expect(ceilingRow(p).getByTestId('ceiling-remaining')).toHaveText('₹10,00,000.00');
    await p.getByLabel('Recipient jurisdiction').selectOption(j['DIST-A']);
    await p.getByLabel('Amount', { exact: true }).fill('600000.00');
    await p.getByRole('button', { name: 'Create draft allocation' }).click();
    await expect(allocRow(p, 'District A')).toContainText('DRAFT');
    await allocRow(p, 'District A').getByRole('button', { name: 'Approve' }).click();
    await expect(allocRow(p, 'District A').getByRole('alert')).toContainText(
      'SELF_APPROVAL_FORBIDDEN',
    );
    await expect(allocRow(p, 'District A')).toContainText('DRAFT');

    const approveAs = async (text: string) => {
      await c.reload();
      await c.getByLabel('Financial year').selectOption(fyId);
      await allocRow(c, text).getByRole('button', { name: 'Approve' }).click();
      await expect(allocRow(c, text)).toContainText('APPROVED');
    };
    await approveAs('District A');
    await p.reload();
    await p.getByLabel('Financial year').selectOption(fyId);
    await expect(ceilingRow(p).getByTestId('ceiling-remaining')).toHaveText('₹4,00,000.00');

    const distA = await allocRow(p, 'District A').getAttribute('data-testid');
    await p.getByLabel('Allocate from').selectOption(distA!.replace('allocation-', ''));
    await p.getByLabel('Recipient jurisdiction').selectOption(j['CD-A1']);
    await p.getByLabel('Amount', { exact: true }).fill('250000.00');
    await p.getByRole('button', { name: 'Create draft allocation' }).click();
    await expect(allocRow(p, 'Co-district A1')).toContainText('DRAFT');
    await approveAs('Co-district A1');

    await p.reload();
    await p.getByLabel('Financial year').selectOption(fyId);
    const cdA1 = await allocRow(p, 'Co-district A1').getAttribute('data-testid');
    await p.getByLabel('Allocate from').selectOption(cdA1!.replace('allocation-', ''));
    await p.getByLabel('Scheme').selectOption({ label: `${schemeCode} — E2E synthetic culvert` });
    await p.getByLabel('Amount', { exact: true }).fill('100000.00');
    await p.getByRole('button', { name: 'Create draft allocation' }).click();
    await expect(allocRow(p, schemeCode)).toContainText('DRAFT');
    await approveAs(schemeCode);

    await p.reload();
    await p.getByLabel('Financial year').selectOption(fyId);
    await expect(allocRow(p, 'District A').first()).toContainText('₹3,50,000.00');
    await expect(allocRow(p, 'Co-district A1').first()).toContainText('₹1,50,000.00');
    // The ceiling counts only its immediate district allocation: no double counting.
    await expect(ceilingRow(p).getByTestId('ceiling-remaining')).toHaveText('₹4,00,000.00');
    await p.goto(schemeUrl);
    await expect(p.getByText('₹1,00,000.00')).toBeVisible();
  });

  test('4. over-allocation is rejected without changing balances', async () => {
    const p = planner.page;
    await p.goto('/budget');
    await p.getByLabel('Financial year').selectOption(fyId);
    await expect(ceilingRow(p).getByTestId('ceiling-remaining')).toHaveText('₹4,00,000.00');
    const before = (await ceilingRow(p).textContent()) ?? '';
    await p.getByLabel('Recipient jurisdiction').selectOption(j['DIST-B']);
    await p.getByLabel('Amount', { exact: true }).fill('400000.01');
    await p.getByRole('button', { name: 'Create draft allocation' }).click();
    await expect(p.getByRole('alert')).toContainText('exceeds the available balance 400000.00');
    await expect(p.getByRole('alert')).toContainText('ALLOCATION_EXCEEDS_AVAILABLE');
    await p.reload();
    await p.getByLabel('Financial year').selectOption(fyId);
    await expect(ceilingRow(p)).toHaveText(before);
    await expect(allocRow(p, 'District B')).toHaveCount(0);
  });

  test('5. District A cannot access District B', async ({ browser }) => {
    const all = await planner.api('GET', '/schemes?pageSize=100');
    const inB = all.items.find((s: { jurisdiction: { code: string } }) =>
      s.jurisdiction.code.startsWith('CD-B'),
    );
    const d = await actor(browser, DISTRICT_A);
    await d.page.goto('/schemes');
    await expect(d.page.getByRole('heading', { name: 'Scheme register' })).toBeVisible();
    const rows = d.page.getByRole('row');
    await expect(rows.nth(1)).toBeVisible();
    await expect(d.page.getByRole('table')).not.toContainText('District B');
    await expect(d.page.getByRole('table')).not.toContainText('Co-district B');
    await d.page.goto(`/schemes/${inB.id}`);
    await expect(d.page.getByRole('alert')).toContainText('NOT_FOUND');
    await d.page.goto('/admin/users');
    await expect(d.page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
    await d.ctx.close();
  });
});

test('administration: no self-modification, template roles read-only, admin screens permission-gated', async ({
  browser,
}) => {
  const admin = await actor(browser, 'admin@example.test');
  const p = admin.page;
  await p.goto('/admin/users');
  const own = p.getByTestId('user-admin@example.test');
  await expect(own).toContainText('You cannot change your own access.');
  await expect(own.getByRole('button')).toHaveCount(0);
  await expect(p.getByTestId('user-auditor@example.test')).toContainText('AUDITOR');

  await p.goto('/admin/roles');
  const template = p.getByRole('row').filter({ hasText: 'STATE_PLANNER' });
  await expect(template).toContainText('Template (read-only)');
  await expect(template.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  const code = `E2E_ROLE_${RUN}`.replace(/[^A-Z0-9_]/g, '_');
  await p.getByLabel('Code (UPPER_SNAKE)').fill(code);
  await p.getByLabel('Name', { exact: true }).fill('E2E viewer');
  await p.getByLabel('scheme.view', { exact: true }).check();
  await p.getByRole('button', { name: 'Create role' }).click();
  const custom = p.getByRole('row').filter({ hasText: code });
  await expect(custom).toContainText('Custom');
  await expect(custom).toContainText('scheme.view');
  await admin.ctx.close();

  const d = await actor(browser, DISTRICT_A);
  await expect(d.page.getByRole('link', { name: 'Users' })).toHaveCount(0);
  await d.page.goto('/admin/roles');
  await expect(d.page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
  await d.ctx.close();
});
