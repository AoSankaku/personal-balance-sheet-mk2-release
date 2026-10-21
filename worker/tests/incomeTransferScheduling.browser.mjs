// Synthetic API only: helpers/incomeTransferSchedulingQaServer.ts + an existing Vite.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const ui = process.env.TRANSFER_QA_UI_URL || 'http://localhost:5173';
const api = process.env.TRANSFER_QA_API_URL || 'http://127.0.0.1:18787';
const output = '.tmp/income-transfer-scheduling';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
let page;
try {
  for (const width of [1440, 390]) {
    page = await browser.newPage({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
    page.setDefaultTimeout(10000);
    assert.equal((await (await page.request.get(`${api}/__income-transfer-scheduling-qa`)).json()).isolated, true);
    const existing = await (await page.request.get(`${api}/api/journal`)).json();
    for (const entry of existing.filter(entry => entry.description.startsWith('deferred qa '))) {
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
    await page.addInitScript(() => { localStorage.setItem('locale', 'ja'); localStorage.setItem('display_currency', 'JPY'); });
    await page.goto(`${ui}/settings`);
    await page.getByRole('heading', { name: '口座移動の保留', exact: true }).waitFor();
    assert.equal(await page.getByText('利息収入の予算配賦', { exact: true }).count(), 0);
    await page.getByRole('textbox', { name: '通常タスクに表示する振替合計額 (JPY)', exact: true }).fill('1000');
    const [settingsResponse] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === '/api/budget/settings' && r.request().method() === 'PATCH'),
      page.getByRole('button', { name: '設定を保存', exact: true }).click(),
    ]);
    assert.equal(settingsResponse.status(), 200, await settingsResponse.text());
    async function choose(label, option) {
      const control = page.getByRole('textbox', { name: label, exact: true });
      if (await control.inputValue() === option) return;
      await control.click();
      await page.getByRole('option', { name: option, exact: true }).click();
    }
    const ids = [];
    async function income(amount, incomeAccount, budget, manual) {
      await page.goto(`${ui}/input`);
      await page.locator('label').filter({ hasText: /^収入$/ }).click();
      await choose('収入の種類', incomeAccount);
      await choose('入金先', 'テスト銀行');
      await page.getByRole('textbox', { name: '摘要', exact: true }).fill(`deferred qa ${width} ${amount}`);
      await page.getByRole('textbox', { name: '金額', exact: true }).fill(String(amount));
      const allocation = page.locator('p:visible').filter({ hasText: new RegExp(`^${budget}$`) }).locator('..').getByRole('textbox');
      assert.equal(Number((await allocation.inputValue()).replace(/[^0-9.]/g, '')), 0, 'No interest-specific allocation preset');
      await allocation.fill(String(amount));
      await page.getByLabel('振替を後回しにする', { exact: true }).waitFor({ state: 'attached' });
      if (manual) await page.locator('label').filter({ hasText: /^振替を後回しにする$/ }).click();
      const [response] = await Promise.all([
        page.waitForResponse(r => new URL(r.url()).pathname === '/api/journal' && r.request().method() === 'POST'),
        page.getByRole('button', { name: '追加', exact: true }).click(),
      ]);
      assert.equal(response.status(), 201, await response.text());
      const body = response.request().postDataJSON();
      assert.equal(body.income_budget_allocations[0].amount, amount);
      assert.equal(body.income_transfer_destinations[0].is_deferred, manual ? true : undefined);
      ids.push((await response.json()).id);
    }
    await income(112, '臨時収入', '必要出費', false);
    await page.goto(`${ui}/tasks/income-transfer`);
    await page.getByRole('button', { name: '配置調整待ち（1件）', exact: true }).click();
    const [resumed] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/defer') && r.request().method() === 'PATCH'),
      page.getByRole('button', { name: '通常タスクに戻す', exact: true }).click(),
    ]);
    assert.equal(resumed.status(), 200);
    await page.getByRole('button', { name: '後でまとめる', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /配置調整待ち/ }).count(), 0, 'Explicit resume overrides small-amount threshold');
    const [deferred] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/defer') && r.request().method() === 'PATCH'),
      page.getByRole('button', { name: '後でまとめる', exact: true }).click(),
    ]);
    assert.equal(deferred.status(), 200);
    await income(20000, 'その他の収入', '自由出費', true);
    if (width === 1440) {
      await page.goto(`${ui}/ledger`);
      const row = page.locator('tr').filter({ hasText: `deferred qa ${width} 20000` });
      await row.getByRole('button').first().click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      assert.equal(await dialog.getByLabel('振替を後回しにする', { exact: true }).isChecked(), true);
      const [updated] = await Promise.all([
        page.waitForResponse(r => new URL(r.url()).pathname === `/api/journal/${ids[1]}` && r.request().method() === 'PUT'),
        dialog.getByRole('button', { name: '保存', exact: true }).click(),
      ]);
      assert.equal(updated.status(), 200, await updated.text());
      assert.equal(updated.request().postDataJSON().income_transfer_destinations[0].is_deferred, true);
    }
    await page.goto(`${ui}/settings`);
    await page.getByRole('button', { name: '自動保留ルールを解除', exact: true }).click();
    await page.getByRole('button', { name: '自動保留ルールを解除', exact: true }).waitFor({ state: 'detached' });
    await page.goto(`${ui}/tasks/income-transfer`);
    await page.getByRole('button', { name: '配置調整待ち（2件）', exact: true }).click();
    await page.getByText('手動・自動で保留した振替をまとめて処理します。実際に口座振替を行ってから完了してください。', { exact: true }).waitFor();
    await page.screenshot({ path: `${output}/deferred-${width}.png`, animations: 'disabled' });
    const pending = await (await page.request.get(`${api}/api/income-transfer-requirements?status=pending`)).json();
    assert.equal(pending.requirements.length, 2);
    assert.ok(pending.requirements.every(requirement => requirement.is_deferred === true));
    assert.equal(pending.requirements.reduce((sum, requirement) => sum + requirement.amount, 0), 20112);
    const journal = await (await page.request.get(`${api}/api/journal`)).json();
    assert.equal(journal.filter(entry => entry.lines.some(line => line.account_id === 1007)).length, 0);
    assert.deepEqual(errors, []);
    for (const id of ids) assert.equal((await page.request.delete(`${api}/api/journal/${id}`)).status(), 200);
    console.log(`PASS generic income/manual deferral/automatic resume/edit preservation width=${width}`);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.close();
    page = undefined;
  }
} finally {
  if (page) await page.unrouteAll({ behavior: 'ignoreErrors' });
  await browser.close();
}
