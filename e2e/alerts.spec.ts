import { expect, test, type Browser, type Page } from '@playwright/test';

/** F11 alerts, corrective actions and GIS, driven through the UI against the real API. */
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

async function csrfPost(page: Page, url: string, data: object) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'dcp_csrf')?.value ?? '';
  return page.request.post(url, { data, headers: { 'x-csrf-token': decodeURIComponent(csrf) } });
}

test('alert → corrective action → owner submits → independent reviewer verifies, with history', async ({
  browser,
}) => {
  const reviewer = await signIn(browser, 'district.reviewer@example.test');
  const list = await (
    await reviewer.request.get('/api/v1/alerts?ruleCode=PHYSICAL_FINANCIAL_GAP&pageSize=100')
  ).json();
  let alert = list.items.find(
    (a: { dedupKey: string }) => a.dedupKey === 'PHYSICAL_FINANCIAL_GAP:DEMO-001',
  );
  expect(alert).toBeTruthy();
  if (!['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS'].includes(alert.status)) {
    const r = await csrfPost(reviewer, `/api/v1/alerts/${alert.id}/reopen`, {
      version: alert.version,
      reason: 'Playwright: reopen for journey',
    });
    expect(r.status()).toBe(201);
    alert = await r.json();
  }

  await reviewer.getByRole('link', { name: 'Alerts', exact: true }).click();
  await expect(reviewer.getByTestId('alert-summary')).toBeVisible();
  await reviewer.goto(`/alerts/${alert.id}`);
  await expect(reviewer.getByTestId('alert-title')).toContainText('PHYSICAL FINANCIAL GAP');
  await expect(reviewer.getByText('Review indicator').first()).toBeVisible();
  await expect(reviewer.getByTestId('ctx-gapPercentagePoints')).toHaveText('15.00');
  if (alert.status === 'OPEN') {
    await reviewer.getByRole('button', { name: 'Acknowledge' }).click();
    await expect(reviewer.getByText('ACKNOWLEDGED').first()).toBeVisible();
  }

  const stamp = Date.now().toString().slice(-6);
  const actionText = `Reconcile synthetic MB with verified spend ${stamp}`;
  const owner = reviewer.getByLabel('Responsible officer');
  await expect(owner.locator('option')).not.toHaveCount(1);
  const labels = await owner.locator('option').allTextContents();
  await owner.selectOption({ label: labels.find((o) => /Implementing Officer/.test(o))! });
  const due = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  await reviewer.getByLabel('Due date').fill(due);
  await reviewer.getByLabel('Action', { exact: true }).fill(actionText);
  await reviewer.getByRole('button', { name: 'Create corrective action' }).click();
  await reviewer.getByRole('link', { name: actionText }).click();
  await expect(reviewer.getByTestId('ca-status')).toContainText('ASSIGNED');
  const caUrl = reviewer.url();

  const officer = await signIn(browser, 'field.officer@example.test');
  await officer.getByRole('link', { name: 'Actions' }).click();
  await officer.getByRole('button', { name: 'Assigned to me' }).click();
  await officer.getByRole('link', { name: actionText }).click();
  await officer.getByLabel('Progress note').fill('Site visit done');
  await officer.getByRole('button', { name: 'Add progress note' }).click();
  await expect(officer.getByTestId('ca-status')).toContainText('IN_PROGRESS');
  await officer.getByLabel('Evidence reference').fill('Synthetic MB page 12');
  await officer.getByRole('button', { name: 'Submit for verification' }).click();
  await expect(officer.getByTestId('ca-status')).toContainText('PENDING_VERIFICATION');
  await expect(officer.getByRole('button', { name: 'Verify and close' })).toHaveCount(0);

  await reviewer.goto(caUrl);
  await reviewer.getByLabel('Verification reason').fill('Checked against synthetic MB');
  await reviewer.getByRole('button', { name: 'Verify and close' }).click();
  await expect(reviewer.getByTestId('ca-status')).toContainText('CLOSED');
  const history = reviewer.getByTestId('history');
  for (const e of ['CREATED', 'PROGRESS NOTE', 'SUBMITTED FOR VERIFICATION', 'CLOSED'])
    await expect(history).toContainText(e);
});

test('rule configuration is visible to the state planner and read-only for officers', async ({
  browser,
}) => {
  const planner = await signIn(browser, 'state.planner@example.test');
  await planner.getByRole('link', { name: 'Alert rules' }).click();
  await expect(planner.getByTestId('rule-PHYSICAL_FINANCIAL_GAP-TENANT')).toContainText(
    '"gapPercentagePoints":15',
  );
  await expect(
    planner.getByTestId('rule-PHYSICAL_FINANCIAL_GAP-TENANT').getByRole('button', { name: 'Edit' }),
  ).toBeVisible();
  const officer = await signIn(browser, 'field.officer@example.test');
  await officer.goto('/alerts/rules');
  await expect(officer.getByRole('button', { name: 'Edit' })).toHaveCount(0);
});

test('GIS map shows only in-scope synthetic points and links to scheme detail', async ({
  browser,
}) => {
  const monitor = await signIn(browser, 'state.monitor@example.test');
  await monitor.getByRole('link', { name: 'Map' }).click();
  await expect(monitor.getByTestId('gis-notice')).toContainText('synthetic');
  const all = await (await monitor.request.get('/api/v1/gis/schemes')).json();
  await expect(monitor.getByTestId('gis-row')).toHaveCount(
    all.features.length + all.unmapped.length,
  );
  await expect(monitor.locator('.maplibregl-canvas')).toBeVisible();
  await monitor.getByRole('link', { name: 'DEMO-005' }).click();
  await expect(monitor).toHaveURL(/\/dashboards\/scheme\/|\/schemes\//);

  const district = await signIn(browser, 'district.reviewer@example.test');
  await district.getByRole('link', { name: 'Map' }).click();
  await expect(district.getByRole('link', { name: 'DEMO-001' })).toBeVisible();
  await expect(district.getByRole('link', { name: 'DEMO-005' })).toHaveCount(0);
});
