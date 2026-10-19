// Existing Vite + disposable in-memory QA API; never use real local D1.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const app = 'http://127.0.0.1:5173';
const api = 'http://127.0.0.1:18787';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });

async function request(path, method = 'GET', body) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function applicablePreview(scheduleId, settings) {
  let current = settings;
  for (let attempt = 0; attempt < 3; attempt++) {
    const preview = await request(`/api/depreciation/${scheduleId}/budget/preview`, 'POST', { settings: current });
    if (preview.can_apply) return preview;
    const decisions = preview.boundaries.map(boundary => ({
      reset_log_id: boundary.reset_log_id,
      action: boundary.action_kind === 'carry_or_settle' ? 'carry' : 'continue',
      ...(boundary.scope_confirmation_required ? { scope: 'category' } : {}),
      ...(boundary.required_action === 'order' ? { same_day_order: 'before' } : {}),
    }));
    current = { ...preview.settings, reset_decisions: decisions };
  }
  assert.fail('QA preview remained blocked after resolving its reset decisions');
}

let page;
try {
  const marker = await request('/__depreciation-budget-qa');
  assert.equal(marker.isolated, true, 'All financial writes must stay in the disposable in-memory QA API');
  const schedules = await request('/api/depreciation');
  const schedule = schedules.find(item => item.id === 100);
  assert.ok(schedule, 'Expected the dedicated QA installment fixture');

  await request(`/api/depreciation/${schedule.id}`, 'PATCH', {
    purchase_date: '2026-07-30',
    total_amount: 310000,
    months: 60,
    idempotency_key: 'qa-repair-continuity-partial-first-month',
  });
  const proratedSchedule = (await request('/api/depreciation')).find(item => item.id === schedule.id);
  assert.equal(proratedSchedule.monthly_amounts[0], 368);
  assert.equal(proratedSchedule.monthly_amounts[1], 5248);
  assert.equal(proratedSchedule.entry_dates[0], '2026-07-30');

  const blankOptionalSettings = {
    method: 'assigned',
    purchase_category_id: 1001,
    monthly_source_category_id: 1002,
    monthly_source_allocations: [
      { budget_category_id: 1002, ratio: 60 },
      { budget_category_id: 1003, ratio: 40 },
    ],
  };
  const blankPreview = await applicablePreview(schedule.id, blankOptionalSettings);
  assert.equal(blankPreview.can_apply, true, 'Empty optional routing, settlement, and end date must preview successfully');

  page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.setDefaultTimeout(7000);
  await page.clock.setFixedTime(new Date('2026-10-19T03:00:00Z'));
  const mutations = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.origin !== app) return route.fulfill({ json: {} });
    if (route.request().method() !== 'GET') mutations.push([route.request().method(), url.pathname]);
    const response = await route.fetch({ url: `${api}${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
  await page.addInitScript(() => {
    localStorage.setItem('locale', 'ja');
    localStorage.setItem('display_currency', 'JPY');
  });

  await page.goto(`${app}/fs/budget`);
  const repairButtonName = '予算分割振替（減価償却）の設定・修正';
  await page.getByRole('button', { name: repairButtonName, exact: true }).waitFor();
  await page.getByRole('button', { name: repairButtonName, exact: true }).click();
  let modal = page.getByRole('dialog', { name: repairButtonName, exact: true });
  await modal.getByRole('radio').first().click();
  await modal.getByText('購入仕訳と既存の月次仕訳の日付・金額はそのまま使用します。予算の扱いは未設定です。ここで変更しても既存の仕訳は作り直しません。', { exact: true }).waitFor();
  await modal.getByRole('heading', { name: '今後の月次振替（任意）', exact: true }).waitFor();
  await modal.getByRole('heading', { name: '精算（任意）', exact: true }).waitFor();
  await modal.getByRole('textbox', { name: '予算負担の終了日（任意）' }).waitFor();
  const initialMonth = modal.getByRole('textbox', { name: '配分金額の確認月' });
  assert.match(await initialMonth.inputValue(), /^2026-11-01/);
  assert.match(await modal.getByTestId('depreciation-budget-fields').getByTestId('monthly-source-representative-amount').textContent(), /5,248/);
  await initialMonth.click();
  await page.getByRole('option', { name: /2026-07-30/ }).click();
  assert.equal(await modal.getByTestId('depreciation-budget-selected-month').textContent(), '2026-07-30');
  assert.match(await modal.getByTestId('depreciation-budget-fields').getByTestId('monthly-source-representative-amount').textContent(), /368/);
  assert.match(await modal.getByRole('textbox', { name: '生活費 月次金額' }).inputValue(), /221/);
  assert.match(await modal.getByRole('textbox', { name: '仕事費 月次金額' }).inputValue(), /147/);
  await initialMonth.click();
  await page.getByRole('option', { name: /2026-11-01/ }).click();
  assert.match(await modal.getByTestId('depreciation-budget-fields').getByTestId('monthly-source-representative-amount').textContent(), /5,248/);
  assert.match(await modal.getByRole('textbox', { name: '生活費 月次金額' }).inputValue(), /3,149/);
  assert.match(await modal.getByRole('textbox', { name: '仕事費 月次金額' }).inputValue(), /2,099/);
  await modal.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });

  const savedSettings = {
    ...blankOptionalSettings,
    routing_changes: [{
      date: '2027-01-01',
      monthly_source_category_id: 1002,
      monthly_source_allocations: blankOptionalSettings.monthly_source_allocations,
      destination_category_id: 1001,
    }],
    settlements: [{ key: 'qa-continuity-settlement', date: '2027-02-01', amount: 1000, source_category_id: 1002 }],
    end_date: '2028-01-01',
  };
  const preview = await applicablePreview(schedule.id, savedSettings);
  await request(`/api/depreciation/${schedule.id}/budget/apply`, 'POST', {
    token: preview.token,
    settings: preview.settings,
    confirmed: true,
  });
  const persisted = await request('/api/depreciation');
  const saved = persisted.find(item => item.id === schedule.id).budget.settings;
  assert.equal(saved.routing_changes[0].destination_category_id, 1001);
  assert.equal(saved.settlements[0].date, '2027-02-01');
  assert.equal(saved.end_date, '2028-01-01');

  await page.reload();
  await page.getByRole('button', { name: repairButtonName, exact: true }).waitFor();
  await page.getByRole('button', { name: repairButtonName, exact: true }).click();
  modal = page.getByRole('dialog', { name: repairButtonName, exact: true });
  await modal.getByRole('heading', { name: '今後の月次振替（任意）', exact: true }).waitFor();
  assert.equal(await modal.getByRole('textbox', { name: '振替の開始日' }).inputValue(), '2027-01-01');
  assert.equal(await modal.getByRole('textbox', { name: '精算日' }).inputValue(), '2027-02-01');
  assert.equal(await modal.getByRole('textbox', { name: '予算負担の終了日（任意）' }).inputValue(), '2028-01-01');

  const month = modal.getByRole('textbox', { name: '配分金額の確認月' });
  assert.match(await month.inputValue(), /^2026-11-01/);
  const previewButton = modal.getByRole('button', { name: '変更をプレビュー', exact: true });
  await previewButton.click();
  const applyButton = modal.getByRole('button', { name: 'プレビューした変更を適用', exact: true });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')]
      .find(element => element.textContent?.includes('プレビューした変更を適用'));
    return button != null && !button.disabled;
  });
  const previewRequestCount = mutations.filter(([, path]) => path === '/api/depreciation/100/budget/preview').length;
  await month.click();
  await page.getByRole('option', { name: /2026-07-30/ }).click();
  assert.equal(await modal.getByTestId('depreciation-budget-selected-month').textContent(), '2026-07-30');
  assert.match(await modal.getByTestId('depreciation-budget-fields').getByTestId('monthly-source-representative-amount').textContent(), /368/);
  assert.equal(await applyButton.isEnabled(), true, 'Display-only month selection must preserve the valid preview');
  assert.equal(mutations.filter(([, path]) => path === '/api/depreciation/100/budget/preview').length, previewRequestCount);
  assert.equal(mutations.some(([, path]) => path === '/api/depreciation/100/budget/apply'), false);

  await modal.getByRole('radio').nth(1).click();
  await modal.getByRole('radio').first().click();
  assert.equal(await modal.getByRole('textbox', { name: '振替の開始日' }).inputValue(), '2027-01-01');
  assert.equal(await modal.getByRole('textbox', { name: '精算日' }).inputValue(), '2027-02-01');
  assert.equal(await modal.getByRole('textbox', { name: '予算負担の終了日（任意）' }).inputValue(), '2028-01-01');
  assert.deepEqual(mutations.filter(([, path]) => path.includes('/api/depreciation/100/budget/')), [
    ...mutations.filter(([, path]) => path === '/api/depreciation/100/budget/preview'),
  ], 'Changing the displayed month must not write settings or invalidate the budget preview');
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileWidth = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  assert.ok(
    mobileWidth.content <= mobileWidth.viewport,
    `Mobile viewport must not overflow horizontally: ${JSON.stringify(mobileWidth)}`,
  );
  const fs = await import('node:fs/promises');
  await fs.mkdir('.tmp/depreciation-repair-continuity', { recursive: true });
  await page.screenshot({ path: '.tmp/depreciation-repair-continuity/mobile.png' });
  console.log(JSON.stringify({ blankOptionalPreview: true, continuityAfterReopen: true, selectedMonthDisplayOnly: true }));
} catch (error) {
  console.log(`browser-test-error: ${error?.stack ?? error}`);
  if (page) {
    const fs = await import('node:fs/promises');
    await fs.mkdir('.tmp/depreciation-repair-continuity', { recursive: true });
    await fs.writeFile('.tmp/depreciation-repair-continuity/failure.aria.txt', await page.locator('body').ariaSnapshot());
  }
  throw error;
} finally {
  await page?.unrouteAll({ behavior: 'ignoreErrors' });
  await page?.close();
  await browser.close();
}
