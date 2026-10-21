// Headless UI + isolated in-memory API. Never reaches the user's D1 database.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const ui = process.env.INVESTMENT_SALE_UI_URL || 'http://127.0.0.1:5173';
const api = process.env.INVESTMENT_SALE_API_URL || 'http://127.0.0.1:18788';
const output = '.tmp/compound-income/browser';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const records = [];
const runId = Date.now().toString(36);
let stage = 'startup';
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1050 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const marker = await (await page.request.get(`${api}/__investment-sale-qa`)).json();
    assert.equal(marker.isolated, true);
    await page.clock.install({ time: new Date('2026-10-21T03:00:00Z') });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== ui) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const response = await route.fetch({ url: `${api}${url.pathname}${url.search}` });
      return route.fulfill({ response });
    });
    await page.addInitScript(() => {
      localStorage.setItem('locale', 'ja');
      localStorage.setItem('display_currency', 'JPY');
    });
    const summary = async categoryId => {
      const response = await page.request.get(`${api}/api/budget/summary?year_month=2026-10&as_of=2026-10-21&currency=JPY`);
      assert.equal(response.status(), 200);
      const data = await response.json();
      return data.categories.find(row => row.category.id === categoryId).available;
    };
    async function choose(scope, label, option) {
      const input = scope.getByRole('textbox', { name: label, exact: true });
      if (await input.inputValue() === option) return;
      await input.click();
      await page.getByRole('option', { name: option, exact: true }).click();
    }
    async function editEntry(description) {
      await page.goto(`${ui}/ledger`);
      const row = page.getByRole('row').filter({ hasText: description }).first();
      await row.locator('button').first().click();
      return page.getByRole('dialog');
    }
    async function saveEdit(dialog, id) {
      const [response] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === `/api/journal/${id}` && response.request().method() === 'PUT'),
        dialog.getByRole('button', { name: '保存', exact: true }).click(),
      ]);
      assert.equal(response.status(), 200, await response.text());
      await dialog.waitFor({ state: 'hidden' });
      return response.request().postDataJSON();
    }
    // Existing positive expense reductions convert only when explicitly saved.
    stage = `legacy conversion ${width}`;
    const beforeLegacy = await summary(1002);
    const beforeLegacyExpense = await summary(1001);
    const legacyDialog = await editEntry('既存の複合売却テスト');
    await legacyDialog.getByTestId('multiline-income-budget').waitFor();
    const legacyBody = await saveEdit(legacyDialog, marker.legacyEntryId);
    assert.equal((legacyBody.budget_allocations || []).length, 1);
    assert.equal(legacyBody.budget_allocations[0].budget_category_id, 1001);
    assert.equal(legacyBody.budget_allocations[0].amount, -10000, 'An existing negative allocation must survive conversion');
    assert.equal(legacyBody.income_budget_allocations.reduce((sum, row) => sum + row.amount, 0), 120000);
    assert.equal(legacyBody.income_budget_allocations.filter(row => row.adjustment_type !== 'transfer').reduce((sum, row) => sum + row.amount, 0), 20000);
    assert.equal(await summary(1002), beforeLegacy, 'Conversion must not increase the budget twice');
    assert.equal(await summary(1001), beforeLegacyExpense, 'Conversion must preserve existing budget consumption');

    stage = `assisted entry ${width}`;
    await page.goto(`${ui}/input`);
    await page.getByRole('tab', { name: '複合仕訳', exact: true }).click();
    await page.getByRole('button', { name: '投資売却の簡単入力', exact: true }).click();
    const assist = page.getByTestId('investment-sale-assist');
    await choose(assist, '売却した投資口座', 'テスト投資資産');
    await choose(assist, '入金先', 'テスト銀行');
    await assist.getByRole('textbox', { name: '売却代金（入金額）', exact: true }).fill('120000');
    await assist.getByRole('textbox', { name: '売却分の帳簿価額（元本）', exact: true }).fill('100000');
    await choose(assist, '売却益の収入科目', 'テスト売却益');
    await assist.getByRole('button', { name: '仕訳を作成', exact: true }).click();
    const description = `投資売却の簡単入力テスト ${width} ${runId}`;
    await page.getByRole('textbox', { name: '摘要', exact: true }).fill(description);
    const allocation = page.getByTestId('multiline-income-budget');
    // Implementation labels each amount with its budget name for accessibility.
    await allocation.getByRole('textbox', { name: '生活費', exact: true }).fill('120000');
    const beforeNew = await summary(1001);
    await page.screenshot({ path: `${output}/sale-${width}.png`, animations: 'disabled' });
    const [response] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/journal' && response.request().method() === 'POST'),
      page.getByRole('button', { name: '追加', exact: true }).click(),
    ]);
    assert.equal(response.status(), 201, await response.text());
    const { id } = await response.json();
    const body = response.request().postDataJSON();
    assert.equal(body.lines.reduce((sum, row) => sum + row.debit - row.credit, 0), 0);
    assert.equal(body.income_budget_allocations.filter(row => row.adjustment_type === 'transfer').reduce((sum, row) => sum + row.amount, 0), 100000);
    assert.equal(body.income_budget_allocations.filter(row => row.adjustment_type !== 'transfer').reduce((sum, row) => sum + row.amount, 0), 20000);
    assert.equal((body.budget_allocations || []).length, 0);
    assert.equal(body.income_transfer_destinations.reduce((sum, row) => sum + row.amount, 0), 120000);
    assert.equal(await summary(1001), beforeNew + 120000);

    stage = `round-trip ${width}`;
    const dialog = await editEntry(description);
    await dialog.getByTestId('multiline-income-budget').waitFor();
    const roundTrip = await saveEdit(dialog, id);
    const normalizedAllocations = allocations => allocations.map(row => ({
      budget_category_id: row.budget_category_id, amount: row.amount,
      currency: row.currency || 'JPY', adjustment_type: row.adjustment_type || 'allocation', note: row.note ?? null,
    }));
    const normalizedTasks = tasks => tasks.map(row => ({ ...row, is_deferred: row.is_deferred ?? null }));
    assert.deepEqual(normalizedAllocations(roundTrip.income_budget_allocations), normalizedAllocations(body.income_budget_allocations));
    assert.deepEqual(normalizedTasks(roundTrip.income_transfer_destinations), normalizedTasks(body.income_transfer_destinations));
    assert.equal(await summary(1001), beforeNew + 120000, 'Saving again must not erase or duplicate allocations');

    // Changing only the scheduling flag must be persisted even when allocations stay unchanged.
    stage = `deferral edit ${width}`;
    const deferDialog = await editEntry(description);
    await deferDialog.getByRole('checkbox', { name: '振替を後回しにする', exact: true }).check();
    const deferBody = await saveEdit(deferDialog, id);
    assert.equal(deferBody.income_transfer_destinations[0].is_deferred, true);

    // Correct the sold book value and recognized gain without changing total proceeds.
    stage = `book-value correction ${width}`;
    const correctionDialog = await editEntry(description);
    await correctionDialog.getByTestId('multiline-entry-row-1').locator('input.mantine-NumberInput-input').nth(1).fill('90000');
    await correctionDialog.getByTestId('multiline-entry-row-2').locator('input.mantine-NumberInput-input').nth(1).fill('30000');
    const corrected = await saveEdit(correctionDialog, id);
    assert.equal(corrected.income_budget_allocations.filter(row => row.adjustment_type === 'transfer').reduce((sum, row) => sum + row.amount, 0), 90000);
    assert.equal(corrected.income_budget_allocations.filter(row => row.adjustment_type !== 'transfer').reduce((sum, row) => sum + row.amount, 0), 30000);
    assert.equal(await summary(1001), beforeNew + 120000);

    async function changeFirstAccount(dialog, accountName) {
      await dialog.getByTestId('multiline-entry-row-0').locator('input.mantine-Select-input').click();
      await page.getByRole('option', { name: accountName, exact: true }).click();
    }
    stage = `deposit correction ${width}`;
    const bankDialog = await editEntry(description);
    await changeFirstAccount(bankDialog, '別の銀行');
    const changedBank = await saveEdit(bankDialog, id);
    assert.equal(changedBank.lines[0].account_id, 1007);
    assert.equal(changedBank.income_transfer_destinations.length, 0, 'An obsolete source task must clear when cash now arrives at its target');

    stage = `excluded deposit ${width}`;
    const excludedDialog = await editEntry(description);
    await changeFirstAccount(excludedDialog, '非追跡テスト');
    await excludedDialog.getByTestId('multiline-income-budget').getByRole('textbox', { name: '生活費', exact: true }).fill('0');
    const excluded = await saveEdit(excludedDialog, id);
    assert.equal((excluded.income_budget_allocations || []).length, 0);
    assert.equal(excluded.income_transfer_destinations.length, 0);
    assert.equal(await summary(1001), beforeNew);

    // A budget-deducted card receives an income allocation without physical cash transfer tasks.
    stage = `compound card income ${width}`;
    await page.goto(`${ui}/input`);
    await page.getByRole('tab', { name: '複合仕訳', exact: true }).click();
    const cardRow = page.getByTestId('multiline-entry-row-0');
    await cardRow.locator('input.mantine-Select-input').click();
    await page.getByRole('option', { name: '対象カード', exact: true }).click();
    await cardRow.locator('input.mantine-NumberInput-input').nth(0).fill('1950');
    const creditRow = page.getByTestId('multiline-entry-row-1');
    await creditRow.locator('input.mantine-Select-input').click();
    await page.getByRole('option', { name: '値引き収入', exact: true }).click();
    await creditRow.locator('input.mantine-NumberInput-input').nth(1).fill('1950');
    await page.getByRole('textbox', { name: '摘要', exact: true }).fill(`複合カード収入テスト ${width}`);
    await page.getByTestId('multiline-income-budget').getByRole('textbox', { name: '生活費', exact: true }).fill('1950');
    const [cardResponse] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/journal' && response.request().method() === 'POST'),
      page.getByRole('button', { name: '追加', exact: true }).click(),
    ]);
    assert.equal(cardResponse.status(), 201, await cardResponse.text());
    const cardBody = cardResponse.request().postDataJSON();
    assert.equal((cardBody.income_transfer_destinations || []).length, 0);
    assert.equal(cardBody.income_budget_allocations.reduce((sum, row) => sum + row.amount, 0), 1950);

    if (width === 1440) {
      async function seed(description, lines, allocations = [], tasks = []) {
        const response = await page.request.post(`${api}/api/journal`, { data: {
          date: '2026-10-21', description, lines, budget_source: 'multiline',
          budget_allocations: [], income_budget_allocations: allocations, income_transfer_destinations: tasks,
        } });
        assert.equal(response.status(), 201, await response.text());
        return (await response.json()).id;
      }
      const saleLines = [
        { account_id: 1001, debit: 120000, credit: 0, currency: 'JPY' },
        { account_id: 1009, debit: 0, credit: 100000, currency: 'JPY' },
        { account_id: 1010, debit: 0, credit: 20000, currency: 'JPY' },
      ];
      stage = 'mixed deferral preservation';
      const mixedDescription = `混在保留テスト ${runId}`;
      const mixedId = await seed(mixedDescription, saleLines, [
        { budget_category_id: 1001, amount: 10000 },
        { budget_category_id: 1001, amount: 50000, adjustment_type: 'transfer' },
        { budget_category_id: 1003, amount: 10000 },
        { budget_category_id: 1003, amount: 50000, adjustment_type: 'transfer' },
      ], [
        { budget_category_id: 1001, from_account_id: 1001, to_account_id: 1007, amount: 60000, currency: 'JPY', is_deferred: true },
        { budget_category_id: 1003, from_account_id: 1001, to_account_id: 1012, amount: 60000, currency: 'JPY', is_deferred: false },
      ]);
      const mixedDialog = await editEntry(mixedDescription);
      await mixedDialog.getByTestId('multiline-income-budget').getByRole('textbox', { name: '生活費', exact: true }).fill('70000');
      await mixedDialog.getByTestId('multiline-income-budget').getByRole('textbox', { name: '第三テスト予算', exact: true }).fill('50000');
      await saveEdit(mixedDialog, mixedId);
      const mixedEntry = await (await page.request.get(`${api}/api/journal/${mixedId}`)).json();
      assert.equal(mixedEntry.income_transfer_requirements.find(row => row.budget_category_id === 1001).is_deferred, true);
      assert.equal(mixedEntry.income_transfer_requirements.find(row => row.budget_category_id === 1003).is_deferred, false);

      stage = 'multiple deposit accounts';
      const multiDescription = `複数入金元テスト ${runId}`;
      const multiId = await seed(multiDescription, [
        { account_id: 1001, debit: 60000, credit: 0, currency: 'JPY' },
        { account_id: 1007, debit: 60000, credit: 0, currency: 'JPY' },
        ...saleLines.slice(1),
      ]);
      const multiDialog = await editEntry(multiDescription);
      await multiDialog.getByTestId('multiline-income-budget').getByRole('textbox', { name: '第三テスト予算', exact: true }).fill('120000');
      const multiBody = await saveEdit(multiDialog, multiId);
      assert.deepEqual(multiBody.income_transfer_destinations.map(row => row.amount).sort((a, b) => a - b), [60000, 60000]);

      stage = 'multiple deposit account rounding';
      const roundingDialog = await editEntry(multiDescription);
      await roundingDialog.getByTestId('multiline-income-budget').getByRole('textbox', { name: '生活費', exact: true }).fill('59999');
      await roundingDialog.getByTestId('multiline-income-budget').getByRole('textbox', { name: '第三テスト予算', exact: true }).fill('60001');
      const roundingBody = await saveEdit(roundingDialog, multiId);
      for (const accountId of [1001, 1007]) assert.ok(roundingBody.income_transfer_destinations.filter(row => row.from_account_id === accountId).reduce((sum, row) => sum + row.amount, 0) <= 60000);
    }
    assert.deepEqual(errors, []);
    records.push({ width, legacyConversion: 'passed', negativeAllocationPreserved: 'passed', fullProceedsAllocation: 'passed', fullProceedsTransferTask: 'passed', roundTrip: 'passed', deferralEdit: 'passed', bookValueCorrection: 'passed', changedDeposit: 'passed', excludedDeposit: 'passed', cardIncome: 'passed', ...(width === 1440 ? { mixedDeferrals: 'passed', multipleDeposits: 'passed', multipleDepositRounding: 'passed' } : {}) });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
  }
  writeFileSync(`${output}/results.json`, JSON.stringify(records, null, 2));
  console.log(JSON.stringify(records));
} catch (error) {
  console.error(`Failure during ${stage}:`, error);
  writeFileSync(`${output}/failure.json`, JSON.stringify({ stage, message: error.stack || String(error) }, null, 2));
  for (const context of browser.contexts()) for (const page of context.pages()) {
    if (!page.isClosed()) await page.screenshot({ path: `${output}/failure.png`, animations: 'disabled' }).catch(() => {});
  }
  throw error;
} finally {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
  }
  await browser.close();
}
