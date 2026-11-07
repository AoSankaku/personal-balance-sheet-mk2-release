import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright');
const { parse } = require('yaml');
const copy = parse(readFileSync('frontend/src/i18n/locales/ja.yaml', 'utf8'));
const ui = process.env.LOAN_DEFAULTS_UI_URL || 'http://127.0.0.1:15173';
const api = process.env.LOAN_DEFAULTS_API_URL || 'http://127.0.0.1:18787';
const output = '.tmp/loan-budget-defaults';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
let page;
try {
  for (const [width, currency] of [[1440, 'JPY'], [390, 'JPY'], [1440, 'USD']]) {
    page = await browser.newPage({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
    page.setDefaultTimeout(10000);
    await page.clock.install({ time: new Date('2026-11-08T03:00:00Z') });
    assert.equal((await (await page.request.get(`${api}/__loan-defaults-qa`)).json()).isolated, true);
    await page.request.post(`${api}/__loan-defaults-reset`);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const posts = [];
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== ui) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname === '/api/journal' && request.method() === 'POST') posts.push(request.postDataJSON());
      const response = await route.fetch({ url: `${api}${url.pathname}${url.search}` });
      return route.fulfill({ response });
    });
    await page.addInitScript(currency => {
      localStorage.setItem('locale', 'ja');
      localStorage.setItem('display_currency', currency);
    }, currency);
    const number = async locator => Number((await locator.inputValue()).replace(/[^0-9.-]/g, ''));
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
    async function choose(scope, label, option) {
      const input = scope.getByRole('textbox', { name: label, exact: true });
      if (await input.inputValue() === option) return;
      await input.click();
      await page.getByRole('option', { name: option, exact: true }).click();
    }
    async function openPrincipal(kind, id) {
      await page.goto(`${ui}/fs/db/long-term-${kind}/${id}`);
      await page.getByRole('button', { name: copy.loanInputBtn, exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByText(copy.loanFundingBreakdownTitle, { exact: true }).waitFor();
      await choose(dialog, kind === 'lend' ? copy.loanCounterCollect : copy.loanCounterDecrease, 'テスト銀行');
      return dialog;
    }
    for (const [kind, id] of [['lend', 1010], ['loan', 1011]]) {
      const dialog = await openPrincipal(kind, id);
      const amount = dialog.getByRole('textbox', { name: copy.amountLabel, exact: true });
      const a = dialog.getByRole('textbox', { name: '生活費', exact: true });
      const b = dialog.getByRole('textbox', { name: '積立', exact: true });
      await amount.fill(currency === 'JPY' ? '101' : '0.30');
      await waitNumber(a, currency === 'JPY' ? 51 : 0.1); await waitNumber(b, currency === 'JPY' ? 25 : 0.2);
      await amount.fill(currency === 'JPY' ? '99' : '0.60');
      await waitNumber(a, currency === 'JPY' ? 49 : 0.2); await waitNumber(b, currency === 'JPY' ? 25 : 0.4);
      await a.fill(currency === 'JPY' ? '10' : '0.01');
      await amount.fill(currency === 'JPY' ? '100' : '0.90');
      assert.equal(await number(a), currency === 'JPY' ? 10 : 0.01, 'An explicit per-entry override survives amount changes');
      await dialog.getByRole('button', { name: copy.loanFundingApplyDefaults, exact: true }).click();
      await amount.fill(currency === 'JPY' ? '100' : '0.30');
      await waitNumber(a, currency === 'JPY' ? 50 : 0.1); await waitNumber(b, currency === 'JPY' ? 25 : 0.2);
      await page.screenshot({ path: `${output}/${kind}-inherited-${width}-${currency}.png`, animations: 'disabled' });
      const [response] = await Promise.all([
        page.waitForResponse(r => new URL(r.url()).pathname === '/api/journal' && r.request().method() === 'POST'),
        dialog.getByRole('button', { name: copy.add, exact: true }).click(),
      ]);
      assert.equal(response.status(), 201, await response.text());
      const allocations = posts.at(-1).budget_funding_components[0].allocations;
      assert.deepEqual(allocations.map(row => [row.budget_category_id, row.amount]), currency === 'JPY' ? [[1001, 50], [1002, 25], [null, 25]] : [[1001, 0.1], [1002, 0.2]]);
      assert.equal(posts.at(-1).lines.every(line => line.currency === currency), true);
      await dialog.waitFor({ state: 'hidden' });
    }

    // Editing a persistent default changes later entries without changing the ledger.
    await page.goto(`${ui}/fs/db/long-term-lend/1010`);
    const editor = page.getByText(copy.loanBudgetDefaultsTitle, { exact: true }).locator('..').locator('..');
    const beforeJournal = await (await page.request.get(`${api}/api/journal`)).json();
    await editor.getByRole('textbox', { name: '生活費', exact: true }).fill('1');
    await editor.getByRole('textbox', { name: '積立', exact: true }).fill('1');
    await editor.getByRole('textbox', { name: copy.loanFundingUnallocated, exact: true }).fill('1');
    const [saved] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/1010/budget-defaults') && r.request().method() === 'PUT'),
      editor.getByRole('button', { name: copy.loanBudgetDefaultsSave, exact: true }).click(),
    ]);
    assert.equal(saved.status(), 200, await saved.text());
    const afterJournal = await (await page.request.get(`${api}/api/journal`)).json();
    assert.deepEqual(afterJournal, beforeJournal);
    const custom = await (await page.request.get(`${api}/api/loans/1010/budget-defaults?currency=${currency}`)).json();
    assert.equal(custom.source, 'custom');
    const dialog = await openPrincipal('lend', 1010);
    await dialog.getByRole('textbox', { name: copy.amountLabel, exact: true }).fill(currency === 'JPY' ? '100' : '0.31');
    await waitNumber(dialog.getByRole('textbox', { name: '生活費', exact: true }), currency === 'JPY' ? 34 : 0.11);
    await waitNumber(dialog.getByRole('textbox', { name: '積立', exact: true }), currency === 'JPY' ? 33 : 0.1);
    await dialog.getByRole('button', { name: copy.cancel, exact: true }).click();
    const resetEditor = page.getByText(copy.loanBudgetDefaultsTitle, { exact: true }).locator('..').locator('..');
    const [reset] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/1010/budget-defaults') && r.request().method() === 'DELETE'),
      resetEditor.getByRole('button', { name: copy.loanBudgetDefaultsReset, exact: true }).click(),
    ]);
    assert.equal(reset.status(), 200);
    assert.deepEqual((await reset.json()).allocations.map(row => row.weight), currency === 'JPY' ? [2, 1, 1] : [33333, 66667]);

    // Remainders across installments must release both original budgets at completion.
    for (let installment = 0; installment < (currency === 'JPY' ? 1 : 0); installment++) {
      const tiny = await openPrincipal('lend', 1015);
      await tiny.getByRole('textbox', { name: copy.amountLabel, exact: true }).fill('1');
      await waitNumber(tiny.getByRole('textbox', { name: '生活費', exact: true }), 1);
      await waitNumber(tiny.getByRole('textbox', { name: '積立', exact: true }), 0);
      const external = await page.request.post(`${api}/api/journal`, { data: {
        date: '2026-11-08', description: 'Concurrent collection', budget_source: 'simple',
        lines: [{ account_id: 1001, debit: 1, credit: 0, currency: 'JPY' }, { account_id: 1015, debit: 0, credit: 1, currency: 'JPY' }],
        budget_funding_components: [{ kind: 'collect', principal_amount: 1, applied_amount: 1, component_only_amount: 0,
          allocations: [{ budget_category_id: 1001, amount: 1, currency: 'JPY', effect: 'apply' }] }],
      } });
      assert.equal(external.status(), 201, await external.text());
      const [stale] = await Promise.all([
        page.waitForResponse(r => new URL(r.url()).pathname === '/api/journal' && r.request().method() === 'POST'),
        tiny.getByRole('button', { name: copy.add, exact: true }).click(),
      ]);
      assert.equal(stale.status(), 409, await stale.text());
      assert.equal(await tiny.isVisible(), true);
      assert.equal(await number(tiny.getByRole('textbox', { name: copy.amountLabel, exact: true })), 1);
      await waitNumber(tiny.getByRole('textbox', { name: '生活費', exact: true }), 0);
      await waitNumber(tiny.getByRole('textbox', { name: '積立', exact: true }), 1);
      const [result] = await Promise.all([
        page.waitForResponse(r => new URL(r.url()).pathname === '/api/journal' && r.request().method() === 'POST'),
        tiny.getByRole('button', { name: copy.add, exact: true }).click(),
      ]);
      assert.equal(result.status(), 201, await result.text());
      await tiny.waitFor({ state: 'hidden' });
    }
    if (currency === 'JPY') {
      const finalProgress = await (await page.request.get(`${api}/api/loans/1015/budget-defaults?currency=JPY`)).json();
      assert.equal(finalProgress.settled_minor_units, 2);
      assert.deepEqual(finalProgress.settled_allocations.map(row => [row.budget_category_id, row.minor_units]), [[1001, 1], [1002, 1]]);
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ width, currency, inheritedLendAndBorrow: true, originalRatios: true, exactRemainders: true, ...(currency === 'JPY' ? { installmentClosure: true, staleSaveRecovered: true } : { decimalSave: true }), archivedBudgetsVisible: true, amountRecalculation: true, manualOverride: true, customSaveReloadReset: true, ledgerUntouched: true, pageErrors: 0 }));
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.close(); page = undefined;
  }
} catch (error) {
  if (page) writeFileSync(`${output}/failure.aria.txt`, await page.locator('body').ariaSnapshot());
  throw error;
} finally {
  if (page) await page.unrouteAll({ behavior: 'ignoreErrors' });
  await browser.close();
}
