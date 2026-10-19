// Reuse an existing Vite server; all /api requests go to the disposable QA DB.
// Start the fixture with DEPRECIATION_QA_PORT=18787. Never forward to the real API.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const output = '.tmp/installment-layout';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
let page;
try {
  for (const width of [1440, 390]) {
    page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.setDefaultTimeout(10000);
    const marker = await page.request.get('http://127.0.0.1:18787/__depreciation-budget-qa');
    assert.equal((await marker.json()).isolated, true);
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (!url.pathname.startsWith('/api/')) return route.continue();
      await route.fulfill({ response: await route.fetch({ url: `http://127.0.0.1:18787${url.pathname}${url.search}` }) });
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { localStorage.setItem('locale', 'ja'); localStorage.setItem('display_currency', 'JPY'); });
    await page.goto('http://127.0.0.1:5173/input');
    await page.getByText('予算分割振替', { exact: true }).click();
    const purchase = page.getByRole('group', { name: '購入・支払い', exact: true });
    const monthly = page.getByRole('group', { name: '毎月の費用', exact: true });
    const budgets = page.getByRole('group', { name: '予算の扱い', exact: true });
    assert.equal(await purchase.count(), 1, 'Purchase/payment inputs need one named group');
    assert.equal(await monthly.count(), 1, 'Monthly expense inputs need one named group');
    assert.equal(await budgets.count(), 1, 'Budget options need one named group');
    async function select(name, option) {
      const field = page.getByRole('textbox', { name, exact: true });
      if (await field.inputValue() === option) return;
      await field.click();
      await page.getByRole('option', { name: option, exact: true }).click();
    }
    await page.getByRole('textbox', { name: '金額', exact: true }).fill('120000');
    await select('支払元', 'テスト銀行');
    await select('購入資産科目', 'テスト機器');
    await select('費用科目', '減価償却費');
    await page.getByRole('radio', { name: /割当済み予算/ }).check();
    await select('購入時の負担予算', '貯蓄');
    const purchaseBox = await purchase.boundingBox();
    const monthlyBox = await monthly.boundingBox();
    const budgetBox = await budgets.boundingBox();
    if (width > 1000) {
      assert.ok(Math.abs(purchaseBox.y - monthlyBox.y) < 3, 'Related groups should share a desktop row');
    } else {
      assert.ok(purchaseBox.y < monthlyBox.y && monthlyBox.y < budgetBox.y, 'Mobile should follow purchase → monthly expense → budget');
    }
    const sourceEditor = page.getByTestId('depreciation-monthly-source-editor');
    assert.equal(await sourceEditor.getByTestId('monthly-source-row-unallocated').isVisible(), false, 'Zero-value unallocated row should not clutter the default view');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/after-${width}.png`, fullPage: true });
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(JSON.stringify({ width, groups: 3, overflow: false, pageErrors: errors.length }));
    await page.close();
    page = undefined;
  }
} catch (error) {
  if (page) writeFileSync(`${output}/failure.aria.txt`, await page.locator('body').ariaSnapshot());
  throw error;
} finally { await browser.close(); }
