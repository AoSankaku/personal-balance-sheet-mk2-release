// Run only against the disposable in-memory depreciationBudgetQaServer.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const fixture = await page.request.get('http://127.0.0.1:8787/__depreciation-budget-qa');
  assert.deepEqual(await fixture.json(), { isolated: true, monthlySources: true });
  await page.addInitScript(() => {
    localStorage.setItem('locale', 'ja');
    localStorage.setItem('display_currency', 'JPY');
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = 'http://127.0.0.1:5173';
  async function input(testId, scope = page) {
    const control = scope.getByTestId(testId);
    return await control.locator('input').count() ? control.locator('input') : control;
  }
  async function fill(testId, value, scope = page) {
    const control = await input(testId, scope);
    await control.fill(String(value));
    await page.keyboard.press('Tab');
  }
  async function number(testId, scope = page) {
    return Number((await (await input(testId, scope)).inputValue()).replace(/[^\d.\-]/g, ''));
  }
  async function select(label, option, scope = page) {
    const field = scope.getByRole('textbox', { name: label, exact: typeof label === 'string' });
    if (await field.inputValue() === option) return;
    await field.click();
    await page.getByRole('option', { name: option, exact: true }).click();
  }
  await page.goto(origin + '/fs/budget');
  await page.getByRole('button', { name: /予算分割振替（減価償却）の設定・修正$/ }).first().click();
  const modal = page.getByRole('dialog', { name: '予算分割振替（減価償却）の設定・修正', exact: true });
  await modal.getByRole('radio', { name: /割当済み予算から支出/ }).check();
  await select(/購入時の負担予算|購入時に負担するカテゴリ/, '貯蓄', modal);
  const sources = modal.getByTestId('depreciation-monthly-source-editor').first();
  await sources.getByTestId('monthly-source-restore-defaults').click();
  assert.equal(await number('monthly-source-ratio-1002', sources), 60);
  assert.equal(await number('monthly-source-ratio-1003', sources), 40);
  assert.equal(await number('monthly-source-amount-1002', sources), 6000);
  await fill('monthly-source-ratio-1002', 50, sources);
  assert.equal(await number('monthly-source-ratio-1002', sources), 50);
  assert.equal(await number('monthly-source-amount-unallocated', sources), 1000);
  assert.ok((await sources.innerText()).includes('未割当'));
  await sources.getByTestId('monthly-source-unallocated-consent').check();
  await sources.getByTestId('monthly-source-restore-defaults').click();
  assert.equal(await number('monthly-source-ratio-1002', sources), 60);
  await fill('monthly-source-amount-1002', 3333, sources);
  await fill('monthly-source-amount-1003', 6667, sources);
  assert.equal(await number('monthly-source-amount-1002', sources), 3333);
  assert.equal(await number('monthly-source-amount-1003', sources), 6667);
  // The same editor is available for a dated replacement.
  await modal.getByRole('button', { name: '日付指定の振替先を追加', exact: true }).click();
  const routeSources = modal.getByTestId('depreciation-monthly-source-editor').nth(1);
  await fill('monthly-source-ratio-1002', 50, routeSources);
  await fill('monthly-source-ratio-1003', 50, routeSources);
  const routeDate = modal.getByLabel('振替の開始日', { exact: true });
  await routeDate.fill('2026-11-01');
  await routeDate.blur();
  const waitPreview = () => page.waitForResponse(response => response.url().endsWith('/100/budget/preview'));
  let response = waitPreview();
  await modal.getByRole('button', { name: '変更をプレビュー', exact: true }).click();
  const initial = await (await response).json();
  assert.equal(initial.boundaries.length, 2);
  const decisions = modal.getByLabel(/このリセットへの対応/);
  for (let index = 0; index < 2; index++) {
    await decisions.nth(index).click();
    await page.getByRole('option', { name: /継続/ }).click();
  }
  response = waitPreview();
  await modal.getByRole('button', { name: '変更をプレビュー', exact: true }).click();
  const preview = await (await response).json();
  assert.equal(preview.can_apply, true);
  assert.deepEqual(preview.settings.monthly_source_allocations, [
    { budget_category_id: 1002, ratio: 33.33 },
    { budget_category_id: 1003, ratio: 66.67 },
  ]);
  const firstMonth = preview.changes.filter(change => change.operation !== 'cancel' && change.event.key.startsWith('monthly:1:'));
  assert.deepEqual(firstMonth.map(change => [change.event.source_category_id, change.event.amount]), [[1002, 3333], [1003, 6667]]);
  assert.deepEqual(preview.settings.routing_changes[0].monthly_source_allocations.map(row => row.ratio), [50, 50]);
  for (const point of preview.timeline) assert.equal(point.before.T, point.after.T);
  await modal.getByRole('button', { name: 'キャンセル', exact: true }).click();

  // Exercise the actual new-purchase form on a mobile viewport with a tiny amount.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '/input');
  await page.getByText('予算分割振替（減価償却）', { exact: true }).click();
  assert.equal(await page.getByLabel('予算分割振替（減価償却）', { exact: true }).isChecked(), true);
  await select('購入資産科目', 'テスト機器');
  await select(/^費用科目/, '減価償却費');
  await page.getByLabel('振替月数', { exact: true }).fill('1');
  await page.getByRole('textbox', { name: '金額', exact: true }).fill('5');
  await select(/^支払元/, 'テスト銀行');
  await page.getByRole('radio', { name: /マイナスの特別予算で負担/ }).check();
  const creationSources = page.getByTestId('depreciation-monthly-source-editor').first();
  assert.equal(await number('monthly-source-amount-1002', creationSources), 3);
  assert.equal(await number('monthly-source-amount-1003', creationSources), 2);
  await select(/^費用科目/, '別の償却費');
  assert.equal(await number('monthly-source-ratio-1002', creationSources), 25);
  assert.equal(await number('monthly-source-amount-1003', creationSources), 4);
  await select(/^費用科目/, '減価償却費');
  await fill('monthly-source-ratio-1002', 50, creationSources);
  await fill('monthly-source-ratio-1003', 50, creationSources);
  assert.equal(await number('monthly-source-amount-1002', creationSources), 3);
  assert.equal(await number('monthly-source-amount-1003', creationSources), 2);
  await fill('monthly-source-amount-1002', 2, creationSources);
  await fill('monthly-source-amount-1003', 3, creationSources);
  assert.equal(await number('monthly-source-ratio-1002', creationSources), 40);
  assert.equal(await number('monthly-source-ratio-1003', creationSources), 60);
  assert.equal(await number('monthly-source-ratio-unallocated', creationSources), 0);
  await page.getByRole('textbox', { name: '摘要', exact: true }).fill('予算割合ブラウザ確認');
  const createResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/depreciation' && response.request().method() === 'POST');
  await page.getByRole('button', { name: '追加', exact: true }).click();
  const created = await createResponse;
  assert.equal(created.status(), 201, await created.text());
  const schedules = await (await page.request.get(origin + '/api/depreciation')).json();
  const saved = schedules.find(schedule => schedule.description === '予算割合ブラウザ確認');
  assert.ok(saved);
  assert.deepEqual(saved.budget.settings.monthly_source_allocations, [
    { budget_category_id: 1002, ratio: 40 }, { budget_category_id: 1003, ratio: 60 },
  ]);
  assert.equal(saved.budget.reimbursed_amount + saved.budget.future_amount, 5);
  await page.goto(origin + '/fs/bs');
  const savedCard = page.getByText('予算割合ブラウザ確認', { exact: true }).locator('..').locator('..');
  await savedCard.getByRole('button', { name: /予算分割振替（減価償却）の設定・修正$/ }).click();
  const savedSources = modal.getByTestId('depreciation-monthly-source-editor').first();
  assert.equal(await number('monthly-source-ratio-1002', savedSources), 40);
  assert.equal(await number('monthly-source-ratio-1003', savedSources), 60);
  assert.equal(await number('monthly-source-amount-1002', savedSources), 2);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(JSON.stringify({ result: 'PASS', checks: ['account defaults', 'manual ratios and amounts', 'U remainder confirmation', 'dated split editor', 'preview totals', 'mobile creation', 'odd-yen ties', 'expense account changes', 'saved split restoration'], pageErrors: errors.length }));
} catch (error) {
  mkdirSync('.tmp/monthly-sources-qa', { recursive: true });
  if (page) writeFileSync('.tmp/monthly-sources-qa/sources-failure.aria.txt', await page.locator('body').ariaSnapshot());
  throw error;
} finally {
  await browser.close();
}
