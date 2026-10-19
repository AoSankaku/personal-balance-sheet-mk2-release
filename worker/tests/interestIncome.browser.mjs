// Run against helpers/interestIncomeQaServer.ts and an existing Vite instance.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const ui = process.env.INTEREST_QA_UI_URL || 'http://localhost:5173';
const api = process.env.INTEREST_QA_API_URL || 'http://127.0.0.1:18787';
const output = '.tmp/interest-income';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
let page;
try {
  for (const width of [1440, 390]) {
    page = await browser.newPage({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
    page.setDefaultTimeout(10000);
    assert.equal((await (await page.request.get(`${api}/__interest-qa`)).json()).isolated, true);
    const oldEntries = await (await page.request.get(`${api}/api/journal`)).json();
    for (const entry of oldEntries.filter(entry => entry.description.startsWith('interest '))) {
      assert.equal((await page.request.delete(`${api}/api/journal/${entry.id}`)).status(), 200);
    }
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: new Date('2026-10-20T03:00:00Z') });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== ui) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const response = await route.fetch({ url: `${api}${url.pathname}${url.search}` });
      return route.fulfill({ response });
    });
    await page.addInitScript(() => {
      localStorage.setItem('locale', 'ja');
      localStorage.setItem('display_currency', 'JPY');
    });
    async function choose(label, option) {
      const control = page.getByRole('textbox', { name: label, exact: true });
      if (await control.inputValue() === option) return;
      await control.click();
      await page.getByRole('option', { name: option, exact: true }).click();
    }
    async function saveSettings(threshold) {
      await page.goto(`${ui}/settings`);
      await page.getByRole('heading', { name: '利息収入の予算配賦', exact: true }).waitFor();
      await choose('利息収入に使う収入科目', '預金利息');
      await choose('初期配賦先の予算科目', '自由出費');
      await page.getByRole('textbox', { name: '通常タスクに表示する振替合計額 (JPY)', exact: true }).fill(String(threshold));
      const [response] = await Promise.all([
        page.waitForResponse(r => new URL(r.url()).pathname === '/api/budget/settings' && r.request().method() === 'PATCH'),
        page.getByRole('button', { name: '利息の設定を保存', exact: true }).click(),
      ]);
      assert.equal(response.status(), 200, await response.text());
    }
    await saveSettings(1000);
    const ids = [];
    const distribution = () => page.locator('p:visible').filter({ hasText: /^自由出費$/ }).locator('..').getByRole('textbox');
    async function income(amount, name, testOverride = false) {
      await page.goto(`${ui}/input`);
      await page.locator('label').filter({ hasText: /^収入$/ }).click();
      await choose('収入の種類', '預金利息');
      await choose('入金先', 'テスト銀行');
      await page.getByRole('textbox', { name: '摘要', exact: true }).fill(name);
      await page.getByRole('textbox', { name: '金額', exact: true }).fill(String(amount));
      await page.waitForFunction(() => document.querySelector('input[role="switch"]') !== null || document.body.textContent.includes('利息の既定配賦を使う'));
      assert.equal(Number((await distribution().inputValue()).replace(/[^0-9.]/g, '')), amount);
      if (testOverride) {
        await distribution().fill('100');
        await page.getByRole('textbox', { name: '金額', exact: true }).fill('200');
        assert.equal(Number((await distribution().inputValue()).replace(/[^0-9.]/g, '')), 100);
        await page.getByRole('textbox', { name: '金額', exact: true }).fill(String(amount));
        await page.locator('label').filter({ hasText: /^利息の既定配賦を使う$/ }).click();
        await page.waitForTimeout(100);
        assert.equal(Number((await distribution().inputValue()).replace(/[^0-9.]/g, '')), amount);
      }
      const [response] = await Promise.all([
        page.waitForResponse(r => new URL(r.url()).pathname === '/api/journal' && r.request().method() === 'POST'),
        page.getByRole('button', { name: '追加', exact: true }).click(),
      ]);
      assert.equal(response.status(), 201, await response.text());
      const body = response.request().postDataJSON();
      assert.equal(body.income_budget_allocations[0].amount, amount);
      assert.equal(body.income_transfer_destinations[0].amount, amount);
      ids.push((await response.json()).id);
    }
    await income(112, `interest ${width} first`);
    await income(122, `interest ${width} second`, true);
    await page.goto(`${ui}/tasks/income-transfer`);
    await page.getByRole('button', { name: '利息の配置調整待ち（2件）', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '振替仕訳を作成して完了', exact: true }).count(), 0);
    await page.getByText('保留中の利息も含めて合算します。実際の口座振替を行ってから完了してください。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '利息の配置調整待ち（2件）', exact: true }).click();
    await page.screenshot({ path: `${output}/deferred-${width}.png`, animations: 'disabled' });
    await income(766, `interest ${width} threshold`);
    await page.goto(`${ui}/tasks/income-transfer`);
    await page.getByRole('button', { name: '振替仕訳を作成して完了', exact: true }).first().waitFor();
    assert.equal(await page.getByRole('button', { name: '振替仕訳を作成して完了', exact: true }).count(), 3);
    assert.equal(await page.getByRole('button', { name: /利息の配置調整待ち/ }).count(), 0);
    const pending = await (await page.request.get(`${api}/api/income-transfer-requirements?status=pending`)).json();
    assert.equal(pending.requirements.length, 3);
    assert.equal(pending.requirements.reduce((sum, r) => sum + r.amount, 0), 1000);
    const journal = await (await page.request.get(`${api}/api/journal`)).json();
    assert.equal(journal.filter(e => e.lines.some(line => line.account_id === 1007)).length, 0, 'Deferral never fabricates a cash transfer');
    assert.deepEqual(errors, []);
    for (const id of ids) assert.equal((await page.request.delete(`${api}/api/journal/${id}`)).status(), 200);
    console.log(`PASS interest input/settings/manual override/cumulative threshold/deferred tasks width=${width}`);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.close();
    page = undefined;
  }
} finally {
  if (page) await page.unrouteAll({ behavior: 'ignoreErrors' });
  await browser.close();
}
