import { expect, test, type Browser, type Page } from '@playwright/test';

/** F10 dashboards: every figure checked here is read back from the API it is rendered from. */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? '';

async function signIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  return page;
}

const inr = (v: string) =>
  `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

test('state planner: statewide dashboard → district → scheme 360 reconcile with the API', async ({
  browser,
}) => {
  const page = await signIn(browser, 'state.planner@example.test');
  await page.getByRole('link', { name: 'Dashboards' }).click();
  await expect(page.getByTestId('kpi-grid')).toBeVisible();
  const state = await (await page.request.get('/api/v1/dashboards/state')).json();
  await expect(page.getByTestId('kpi-verified-exp')).toContainText(
    inr(state.totals.verifiedExpenditure),
  );
  await expect(page.getByTestId('kpi-approved')).toContainText(inr(state.totals.approvedBudget));
  await expect(page.getByTestId('data-basis')).toContainText('Verified records only');
  await expect(page.getByTestId('freshness')).toBeVisible();
  await expect(page.getByTestId('chart-comparison')).toBeVisible();

  await page.getByTestId('compare-DIST-A').getByRole('link').click();
  await expect(page.getByTestId('dashboard-title')).toContainText('District');
  const distId = page.url().split('/').pop();
  const dist = await (await page.request.get(`/api/v1/dashboards/district/${distId}`)).json();
  await expect(page.getByTestId('kpi-verified-exp')).toContainText(
    inr(dist.totals.verifiedExpenditure),
  );

  const list = await (
    await page.request.get(`/api/v1/dashboards/schemes?jurisdictionId=${distId}&pageSize=100`)
  ).json();
  const demo = list.items.find((s: { schemeCode: string }) => s.schemeCode === 'DEMO-001');
  expect(demo).toBeTruthy();
  await page.goto(`/dashboards/scheme/${demo.id}`);
  await expect(page.getByTestId('scheme360-title')).toContainText('DEMO-001');
  await expect(page.getByTestId('s360-fin-util')).toContainText(
    `${demo.financialUtilisationPercent}%`,
  );
  await expect(page.getByTestId('s360-physical')).toContainText(
    `${demo.physicalCompletionPercent}%`,
  );
  await expect(page.getByTestId('s360-gap')).toContainText(
    `${demo.physicalFinancialDifferencePoints} pts`,
  );
  await expect(page.getByTestId('s360-approval').first()).toBeVisible();

  // Reporting-period filter changes the request and is shown as the cut-off.
  await page.goto('/dashboards');
  await page.getByTestId('filter-period').selectOption({ index: 1 });
  await expect(page.getByText(/Cumulative to/)).toBeVisible();
});

test('district A reviewer is denied District B and the officer has no dashboards', async ({
  browser,
}) => {
  const page = await signIn(browser, 'district.reviewer@example.test');
  const juris = await (await page.request.get('/api/v1/jurisdictions')).json();
  const distB = juris.find((j: { code: string }) => j.code === 'DIST-B');
  await page.goto('/dashboards');
  await expect(page.getByText('Figures limited to your assigned scope')).toBeVisible();
  await expect(page.getByTestId('compare-DIST-B')).toHaveCount(0);
  if (distB) {
    await page.goto(`/dashboards/jurisdiction/${distB.id}`);
    await expect(page.getByTestId('dashboard-denied')).toBeVisible();
  }
  const officer = await signIn(browser, 'field.officer@example.test');
  await expect(officer.getByRole('link', { name: 'Dashboards' })).toHaveCount(0);
});
