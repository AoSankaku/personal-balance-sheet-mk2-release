// Vite UI + a disposable in-memory API. Never connects to local or remote D1.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const ui = process.env.INCOME_SCOPE_UI_URL || 'http://127.0.0.1:15173';
const api = process.env.INCOME_SCOPE_API_URL || 'http://127.0.0.1:18787';
const output = '.tmp/income-budget-scope';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
let page;
try {
  for (const width of [1440, 390]) {
    page = await browser.newPage({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
    page.setDefaultTimeout(8000);
    assert.equal((await (await page.request.get(`${api}/__income-scope-qa`)).json()).isolated, true);
    await page.clock.install({ time: new Date('2026-10-20T03:00:00Z') });
    const errors = [];
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== ui) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (request.method() !== 'GET') requests.push({ path: url.pathname, method: request.method(), body: request.postDataJSON() });
      const response = await route.fetch({ url: `${api}${url.pathname}${url.search}` });
      return route.fulfill({ response });
    });
    await page.addInitScript(() => {
      localStorage.setItem('locale', 'ja');
      localStorage.setItem('display_currency', 'JPY');
    });
    await page.goto(`${ui}/input`);
    await page.locator('label').filter({ hasText: /^収入$/ }).click();
    async function choose(label, option) {
      await page.getByRole('textbox', { name: label, exact: true }).click();
      await page.getByRole('option', { name: option, exact: true }).click();
    }
    await choose('収入の種類', '値引き収入');
    await choose('入金先', 'テスト銀行');
    await page.getByRole('textbox', { name: '金額', exact: true }).fill('1950');
    const distribution = () => page.locator('p:visible').filter({ hasText: /^生活費$/ }).locator('..').getByRole('textbox');
    await distribution().fill('1950');
    await page.getByText(/収入配分に伴う口座移動/).waitFor();
    await choose('入金先', '対象カード');
    assert.equal(await page.getByText(/収入配分に伴う口座移動/).count(), 0, 'A liability reduction requires no physical transfer');
    assert.match(await distribution().inputValue(), /1,?950/);

    // An excluded destination clears prior allocations; returning to a card allows fresh allocation.
    await choose('入金先', '対象外カード');
    await page.getByText('この口座は予算対象外のため、この収入を予算科目に配賦できません。', { exact: true }).waitFor();
    assert.equal(await page.getByText('配分プレビュー', { exact: true }).count(), 0);
    await choose('入金先', '対象カード');
    assert.equal(Number((await distribution().inputValue()).replace(/[^0-9.]/g, '')), 0);
    await distribution().fill('1950');
    await page.getByRole('textbox', { name: '摘要', exact: true }).fill(`カード収入テスト ${width}`);
    await page.screenshot({ path: `${output}/normal-${width}.png`, animations: 'disabled' });
    const [normalResponse] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/journal' && response.request().method() === 'POST'),
      page.getByRole('button', { name: '追加', exact: true }).click(),
    ]);
    assert.equal(normalResponse.status(), 201, await normalResponse.text());
    const normal = requests.find(request => request.path === '/api/journal').body;
    assert.equal(normal.lines[0].account_id, 1004);
    assert.equal(normal.lines[1].account_id, 1005);
    assert.deepEqual(normal.income_budget_allocations, [{ budget_category_id: 1001, amount: 1950 }]);
    assert.deepEqual(normal.income_transfer_destinations, []);

    await page.getByRole('tab', { name: '支出一括入力', exact: true }).click();
    await choose('支払い口座（貸方）', '対象カード');
    await page.getByRole('button', { name: '+ 割引・GC行を追加', exact: true }).click();
    const discount = page.locator('tr').filter({ has: page.getByText('割引・GC', { exact: true }) });
    await discount.getByPlaceholder('種別（GC・ポイント等）', { exact: true }).fill(`ポイント ${width}`);
    await discount.locator('.mantine-NumberInput-input').fill('1475');
    await discount.getByPlaceholder('収益科目', { exact: true }).click();
    await page.getByRole('option', { name: '値引き収入', exact: true }).click();
    await discount.getByPlaceholder('任意', { exact: true }).click();
    await page.getByRole('option', { name: '生活費', exact: true }).click();
    await choose('支払い口座（貸方）', '非追跡テスト');
    await page.getByText('この口座は予算対象外のため、この収入を予算科目に配賦できません。', { exact: true }).waitFor();
    assert.equal(await discount.getByPlaceholder('任意', { exact: true }).count(), 0);
    await choose('支払い口座（貸方）', '対象カード');
    assert.equal(await discount.getByPlaceholder('任意', { exact: true }).inputValue(), '', 'The old category was cleared');
    await discount.getByPlaceholder('任意', { exact: true }).click();
    await page.getByRole('option', { name: '生活費', exact: true }).click();
    await page.screenshot({ path: `${output}/bulk-${width}.png`, animations: 'disabled' });
    const [bulkResponse] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/journal/batch' && response.request().method() === 'POST'),
      page.getByRole('button', { name: 'まとめて記入', exact: true }).click(),
    ]);
    assert.equal(bulkResponse.status(), 201, await bulkResponse.text());
    const bulk = requests.find(request => request.path === '/api/journal/batch').body;
    assert.equal(bulk.entries.length, 1);
    assert.equal(bulk.entries[0].lines[0].account_id, 1004);
    assert.equal(bulk.entries[0].lines[1].account_id, 1005);
    assert.deepEqual(bulk.entries[0].income_budget_allocations, [{ budget_category_id: 1001, amount: 1475 }]);
    assert.deepEqual(bulk.entries[0].income_transfer_destinations, []);
    const tasks = await (await page.request.get(`${api}/api/income-transfer-requirements?status=pending`)).json();
    assert.equal(tasks.requirements.length, 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ width, normalCardSave: true, bulkCardSave: true, independentIncomeAndBudget: true, staleAllocationCleared: true, cashTransferGuidancePreserved: true, liabilityTransfers: 0, pageErrors: 0 }));
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.close();
    page = undefined;
  }
} catch (error) {
  if (page) writeFileSync(`${output}/failure.aria.txt`, await page.locator('body').ariaSnapshot());
  throw error;
} finally {
  if (page) await page.unrouteAll({ behavior: 'ignoreErrors' });
  await browser.close();
}
