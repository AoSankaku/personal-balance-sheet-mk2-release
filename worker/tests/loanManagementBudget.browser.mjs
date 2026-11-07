// Real Vite UI and Worker routes backed exclusively by disposable in-memory D1.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const ui = process.env.LOAN_BUDGET_UI_URL || 'http://127.0.0.1:15173';
const api = process.env.LOAN_BUDGET_API_URL || 'http://127.0.0.1:18787';
const output = '.tmp/loan-management-budget';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
let page;
try {
  for (const [width, currency] of [[1440, 'JPY'], [390, 'JPY'], [1440, 'USD']]) {
    page = await browser.newPage({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
    page.setDefaultTimeout(10000);
    assert.equal((await (await page.request.get(`${api}/__loan-budget-qa`)).json()).isolated, true);
    await page.request.post(`${api}/__loan-budget-reset`);
    await page.clock.install({ time: new Date('2026-11-08T03:00:00Z') });
    const errors = [];
    const requests = [];
    let failNextSave = false;
    let saveGate;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== ui) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (request.method() === 'POST' && url.pathname === '/api/journal') {
        requests.push(request.postDataJSON());
        if (failNextSave) {
          failNextSave = false;
          return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'synthetic_save_failure' }) });
        }
        if (saveGate) await saveGate;
      }
      const response = await route.fetch({ url: `${api}${url.pathname}${url.search}` });
      return route.fulfill({ response });
    });
    await page.addInitScript(currency => {
      localStorage.setItem('locale', 'ja');
      localStorage.setItem('display_currency', currency);
    }, currency);
    async function summary() {
      return (await page.request.get(`${api}/api/budget/summary?year_month=2026-11&as_of=2026-11-30&currency=${currency}`)).json();
    }
    const available = result => result.categories.find(row => row.category.id === 1001).available;
    async function choose(dialog, label, option) {
      const select = dialog.getByRole('textbox', { name: label, exact: true });
      if (await select.inputValue() === option) return;
      await select.click();
      await page.getByRole('option', { name: option, exact: true }).click();
    }
    async function save(dialog, verifyBusy = false) {
      let release;
      if (verifyBusy) saveGate = new Promise(resolve => { release = resolve; });
      const countBefore = requests.length;
      const [response] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === '/api/journal' && response.request().method() === 'POST'),
        (async () => {
          await dialog.getByRole('button', { name: '追加', exact: true }).click();
          if (verifyBusy) {
            try {
              await dialog.locator('fieldset[aria-busy="true"]').waitFor();
              assert.equal(await dialog.getByRole('button', { name: '追加', exact: true }).isDisabled(), true);
              await page.keyboard.press('Escape');
              assert.equal(await dialog.isVisible(), true, 'Pending financial save cannot be dismissed');
              assert.equal(await dialog.locator('header button, [class*="Modal-header"] button').count(), 0);
            } finally {
              release();
              saveGate = undefined;
            }
          }
        })(),
      ]);
      assert.equal(response.status(), 201, await response.text());
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(requests.length, countBefore + 1, 'Only one save was submitted');
      return { saved: await response.json(), sent: requests.at(-1) };
    }
    const principalAmount = currency === 'JPY' ? 10000 : 10.25;
    const interestAmount = currency === 'JPY' ? 500 : 5.25;
    for (const [kind, accountId, delta] of [['lend', 1010, principalAmount], ['loan', 1011, -principalAmount]]) {
      await page.goto(`${ui}/fs/db/long-term-${kind}/${accountId}`);
      await page.getByRole('button', { name: 'ここから入力', exact: true }).click();
      let dialog = page.getByRole('dialog');
      await dialog.getByText('予算資金の内訳', { exact: true }).waitFor();
      const before = available(await summary());
      // The breakdown must be discoverable before selecting cash or entering an amount.
      await dialog.getByRole('textbox', { name: '金額', exact: true }).fill(String(principalAmount));
      await choose(dialog, kind === 'lend' ? '受け取り口座' : '支払い元', 'テスト銀行');
      await dialog.getByRole('textbox', { name: '生活費', exact: true }).fill(String(principalAmount));
      if (kind === 'lend' && width === 1440 && currency === 'JPY') {
        failNextSave = true;
        const [failure] = await Promise.all([
          page.waitForResponse(response => new URL(response.url()).pathname === '/api/journal' && response.request().method() === 'POST'),
          dialog.getByRole('button', { name: '追加', exact: true }).click(),
        ]);
        assert.equal(failure.status(), 500);
        await dialog.getByRole('button', { name: '追加', exact: true }).waitFor();
        await dialog.locator('fieldset:not([disabled])').waitFor();
        assert.equal(Number((await dialog.getByRole('textbox', { name: '生活費', exact: true }).inputValue()).replace(/[^0-9.]/g, '')), principalAmount);
        assert.equal(available(await summary()), before, 'Failed save leaves budget unchanged');
      }
      await page.screenshot({ path: `${output}/${kind}-principal-${width}-${currency}.png`, animations: 'disabled' });
      const principal = await save(dialog, kind === 'lend' && width === 1440 && currency === 'JPY');
      assert.equal(principal.sent.budget_funding_components[0].kind, kind === 'lend' ? 'collect' : 'repay');
      assert.deepEqual(principal.sent.budget_funding_components[0].allocations, [
        { budget_category_id: 1001, amount: principalAmount, currency, effect: 'apply', source_journal_entry_id: null },
      ]);
      assert.equal(available(await summary()), before + delta);
      const saved = await (await page.request.get(`${api}/api/journal/${principal.saved.id}`)).json();
      assert.equal(saved.budget_funding_components[0].allocations[0].budget_category_id, 1001);
      assert.equal(saved.lines.every(line => line.currency === currency), true);

      // Interest must use the same budget-aware income/expense flow as normal entry.
      await page.getByRole('button', { name: '利子仕訳を追加', exact: true }).first().click();
      dialog = page.getByRole('dialog');
      const interestBefore = available(await summary());
      await dialog.getByRole('textbox', { name: '金額', exact: true }).fill(String(interestAmount));
      if (kind === 'lend') {
        await choose(dialog, '収入の種類', '受取利息');
        await choose(dialog, '入金先', 'テスト銀行');
        const row = dialog.locator('p').filter({ hasText: /^生活費$/ }).locator('..');
        await row.getByRole('textbox').fill(String(interestAmount));
      } else {
        await choose(dialog, 'カテゴリー', '支払利息');
        await choose(dialog, '支払元', 'テスト銀行');
        await dialog.getByText('予算配分', { exact: true }).waitFor();
      }
      await page.screenshot({ path: `${output}/${kind}-interest-${width}-${currency}.png`, animations: 'disabled' });
      const interest = await save(dialog);
      const allocations = kind === 'lend' ? interest.sent.income_budget_allocations : interest.sent.budget_allocations;
      assert.equal(allocations.length, 1);
      assert.equal(allocations[0].budget_category_id, 1001);
      assert.equal(allocations[0].amount, kind === 'lend' ? interestAmount : -interestAmount);
      assert.equal(interest.sent.lines.every(line => line.currency === currency), true);
      assert.ok(Math.abs(available(await summary()) - interestBefore - (kind === 'lend' ? interestAmount : -interestAmount)) < 0.000001);
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ width, currency, longTermCollection: true, longTermRepayment: true, interestIncomeBudget: true, interestExpenseBudget: true, savedBudgetTotals: true,
      ...(width === 1440 && currency === 'JPY' ? { failedSaveRetained: true, pendingSaveProtected: true } : {}), pageErrors: 0 }));
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
