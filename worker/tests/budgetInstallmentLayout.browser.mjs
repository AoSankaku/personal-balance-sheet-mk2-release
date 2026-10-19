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
      const response = await route.fetch({ url: `http://127.0.0.1:18787${url.pathname}${url.search}` });
      // Response-only fixtures exercise the optional payment and business fields.
      if (url.pathname === '/api/budget/settings') {
        return route.fulfill({ response, json: { ...await response.json(), is_business_owner: true } });
      }
      if (url.pathname === '/api/accounts') {
        const accounts = await response.json();
        accounts.push({ ...accounts.find(account => account.id === 1001), id: 1006, name: 'テストカード', type: 'liability', category: 'credit_card', balance: 0, balances: {} });
        return route.fulfill({ response, json: accounts });
      }
      await route.fulfill({ response });
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
    const zeros = sourceEditor.getByTestId('monthly-source-zero-categories-toggle');
    const zeroPanelId = await zeros.getAttribute('aria-controls');
    const zeroPanel = page.locator(`[id="${zeroPanelId}"]`);
    // Mantine Collapse retains children with opacity 0 / height 0 / inert.
    // Locator.isVisible ignores ancestor clipping and opacity, so inspect the panel.
    assert.equal(await zeroPanel.getAttribute('aria-hidden'), 'true');
    assert.equal(await zeroPanel.evaluate(node => node.getBoundingClientRect().height), 0);
    assert.equal(await zeroPanel.getByTestId('monthly-source-row-unallocated').count(), 1, 'Zero-value unallocated row belongs to the collapsed panel');
    const methodNames = await budgets.getByRole('radio').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label') || node.labels?.[0]?.textContent || ''));
    assert.equal(methodNames.length, 3);
    assert.match(methodNames[0], /割当済み予算/);
    assert.match(methodNames[1], /マイナスの特別予算/);
    assert.match(methodNames[2], /未割当から/);
    assert.equal(await page.getByTestId('depreciation-purchase-negative-warning').isVisible(), true, 'Relevant purchase warning stays visible');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/after-${width}.png`, fullPage: true, animations: 'disabled' });

    assert.equal(await zeros.getAttribute('aria-expanded'), 'false');
    await zeros.click();
    assert.equal(await zeros.getAttribute('aria-expanded'), 'true');
    assert.equal(await zeroPanel.getAttribute('aria-hidden'), 'false');
    await page.waitForFunction(id => document.getElementById(id).getBoundingClientRect().height > 0, zeroPanelId);
    await zeros.click();
    const help = sourceEditor.getByTestId('monthly-source-help-toggle');
    assert.equal(await help.getAttribute('aria-expanded'), 'false');
    await help.click();
    assert.equal(await help.getAttribute('aria-expanded'), 'true');
    await sourceEditor.getByText(/金額を入力すると/).waitFor({ state: 'visible' });
    assert.equal(await sourceEditor.getByText(/金額を入力すると/).isVisible(), true);
    await help.click();

    async function numericInput(id) {
      const control = sourceEditor.getByTestId(id);
      return await control.locator('input').count() ? control.locator('input') : control;
    }
    async function fillNumber(id, value) {
      await (await numericInput(id)).fill(String(value));
      await page.keyboard.press('Tab');
    }
    async function number(id) {
      return Number((await (await numericInput(id)).inputValue()).replace(/[^\d.\-]/g, ''));
    }
    await page.getByRole('textbox', { name: '振替月数', exact: true }).fill('1');
    await page.getByRole('textbox', { name: '金額', exact: true }).fill('5');
    await fillNumber('monthly-source-ratio-1002', 50);
    await fillNumber('monthly-source-ratio-1003', 50);
    assert.equal(await number('monthly-source-amount-1002'), 3);
    assert.equal(await number('monthly-source-amount-1003'), 2);
    await fillNumber('monthly-source-amount-1002', 2);
    await fillNumber('monthly-source-amount-1003', 3);
    assert.equal(await number('monthly-source-ratio-1002'), 40);
    assert.equal(await number('monthly-source-ratio-1003'), 60);
    await sourceEditor.getByTestId('monthly-source-restore-defaults').click();
    assert.equal(await number('monthly-source-ratio-1002'), 60);
    assert.equal(await number('monthly-source-ratio-1003'), 40);

    // Changing a share reveals the unallocated remainder and required consent.
    await fillNumber('monthly-source-ratio-1002', 50);
    assert.equal(await sourceEditor.getByTestId('monthly-source-row-unallocated').isVisible(), true);
    const consent = sourceEditor.getByTestId('monthly-source-unallocated-consent');
    assert.equal(await consent.isChecked(), false);
    await consent.check();
    assert.equal(await consent.isChecked(), true);
    await page.getByRole('radio', { name: /割当済み予算/ }).click();
    assert.equal(await consent.isChecked(), true, 'Clicking the selected method preserves confirmed monthly unallocated use');

    await page.getByRole('radio', { name: /未割当から/ }).check();
    assert.equal(await sourceEditor.count(), 0);
    await page.getByRole('radio', { name: /マイナスの特別予算/ }).check();
    assert.equal(await sourceEditor.isVisible(), true);

    await select('支払元', 'テストカード');
    const offset = purchase.getByRole('textbox', { name: '取引ごとの請求オフセット', exact: true });
    await offset.fill('2');
    await select('支払元', 'テスト銀行');
    assert.equal(await offset.count(), 0);
    await select('支払元', 'テストカード');
    assert.equal(await offset.inputValue(), '0', 'Changing payment account resets its billing offset');
    await select('支払元', 'テスト銀行');

    await page.getByText('事業立替', { exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: '事業用割合', exact: true }).count(), 1, 'Business split remains editable with installments enabled');
    assert.equal(await page.getByRole('textbox', { name: '事業立替金科目', exact: true }).count(), 1);
    await page.getByText('事業立替', { exact: true }).click();

    // The regular expense form still has exactly one amount and payment input.
    await page.getByText('予算分割振替', { exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: '金額', exact: true }).count(), 1);
    assert.equal(await page.getByRole('textbox', { name: '支払元', exact: true }).count(), 1);
    assert.equal(await purchase.count(), 0);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(JSON.stringify({ width, groups: 3, overflow: false, manualAmounts: true, zeroDisclosure: true, methodOrder: true, regularExpense: true, pageErrors: errors.length }));
    await page.close();
    page = undefined;
  }
} catch (error) {
  if (page) writeFileSync(`${output}/failure.aria.txt`, await page.locator('body').ariaSnapshot());
  throw error;
} finally { await browser.close(); }
