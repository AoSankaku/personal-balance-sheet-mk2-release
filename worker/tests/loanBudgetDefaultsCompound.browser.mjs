import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright');
const copy = require('yaml').parse(readFileSync('frontend/src/i18n/locales/ja.yaml', 'utf8'));
const ui = 'http://127.0.0.1:15173';
const api = 'http://127.0.0.1:18787';
const output = '.tmp/loan-budget-defaults';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, serviceWorkers: 'block' });
page.setDefaultTimeout(10000);
const errors = [];
const posts = [];
page.on('pageerror', error => errors.push(error.message));
try {
  assert.equal((await (await page.request.get(`${api}/__loan-defaults-qa`)).json()).isolated, true);
  await page.request.post(`${api}/__loan-defaults-reset`);
  await page.clock.install({ time: new Date('2026-11-08T03:00:00Z') });
  await page.addInitScript(() => { localStorage.setItem('locale', 'ja'); localStorage.setItem('display_currency', 'JPY'); });
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== ui) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/journal' && request.method() === 'POST') posts.push(request.postDataJSON());
    const response = await route.fetch({ url: `${api}${url.pathname}${url.search}` });
    return route.fulfill({ response });
  });
  async function begin(description) {
    await page.goto(`${ui}/input`);
    await page.getByRole('tab', { name: copy.tabMultiLine, exact: true }).click();
    await page.getByRole('textbox', { name: copy.descriptionLabel, exact: true }).fill(description);
    while (await page.getByTestId(/multiline-entry-row-/).count() < 3) {
      await page.getByRole('button', { name: copy.addRow, exact: true }).click();
    }
  }
  async function line(index, account, debit, credit) {
    const row = page.getByTestId(`multiline-entry-row-${index}`);
    await row.getByPlaceholder(copy.selectAccount, { exact: true }).click();
    await page.getByRole('option', { name: account, exact: true }).click();
    await row.getByRole('textbox').nth(1).fill(String(debit));
    await row.getByRole('textbox').nth(2).fill(String(credit));
  }
  async function waitNumber(locator, expected) {
    await locator.evaluate((element, expected) => new Promise((resolve, reject) => {
      let attempts = 0;
      const check = () => {
        if (Number(element.value.replace(/[^0-9.-]/g, '')) === expected) return resolve();
        if (++attempts > 100) return reject(new Error(`Expected ${expected}, got ${element.value}`));
        setTimeout(check, 20);
      };
      check();
    }), expected);
  }
  await begin('複数貸付の自動初期配分');
  await line(0, 'テスト銀行', 101, 0);
  await line(1, '長期貸付テスト', 0, 100);
  await line(2, '端数貸付テスト', 0, 1);
  await waitNumber(page.getByRole('textbox', { name: '生活費', exact: true }).first(), 51);
  await waitNumber(page.getByRole('textbox', { name: '積立', exact: true }), 25);
  const [saved] = await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname === '/api/journal' && r.request().method() === 'POST'),
    page.getByRole('button', { name: copy.add, exact: true }).click(),
  ]);
  assert.equal(saved.status(), 201, await saved.text());
  assert.deepEqual(posts.at(-1).loan_budget_default_snapshot.account_ids.sort(), [1010, 1015]);
  assert.deepEqual(posts.at(-1).budget_funding_components[0].allocations.map(row => [row.budget_category_id, row.amount]), [[1001, 51], [1002, 25], [null, 25]]);

  await begin('確認画面からの競合回復');
  await line(0, '長期借入テスト', 100, 0);
  await line(1, '支払利息', 20, 0);
  await line(2, 'テスト銀行', 0, 120);
  await waitNumber(page.getByRole('textbox', { name: '生活費', exact: true }).first(), 50);
  await page.getByRole('textbox', { name: '生活費', exact: true }).last().fill('10');
  await page.getByRole('button', { name: copy.add, exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: copy.underBudgetWarningTitle, exact: true });
  await confirmation.waitFor();
  const updated = await page.request.put(`${api}/api/loans/1011/budget-defaults`, { data: {
    currency: 'JPY', allocations: [{ budget_category_id: 1001, weight: 2 }, { budget_category_id: 1002, weight: 1 }, { budget_category_id: null, weight: 1 }],
  } });
  assert.equal(updated.status(), 200, await updated.text());
  const [conflict, reload] = await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname === '/api/journal' && r.request().method() === 'POST'),
    page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/1011/budget-defaults') && r.request().method() === 'GET'),
    confirmation.getByRole('button', { name: copy.save, exact: true }).click(),
  ]);
  assert.equal(conflict.status(), 409, await conflict.text());
  assert.equal(reload.status(), 200);
  assert.equal(await page.getByRole('textbox', { name: copy.descriptionLabel, exact: true }).inputValue(), '確認画面からの競合回復');
  await confirmation.waitFor({ state: 'hidden' });
  await page.screenshot({ path: `${output}/compound-stale-recovered.png`, animations: 'disabled' });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ multipleLoanDefaultAggregation: true, automaticSnapshot: true, archivedBudget: true, underBudgetConfirmationStaleRecovery: true, draftPreserved: true, pageErrors: 0 }));
} catch (error) {
  writeFileSync(`${output}/compound-failure.aria.txt`, await page.locator('body').ariaSnapshot());
  throw error;
} finally {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await browser.close();
}
