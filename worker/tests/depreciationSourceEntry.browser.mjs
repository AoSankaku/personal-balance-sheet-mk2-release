// Existing Vite + disposable in-memory QA API; never use real local D1.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const output = '.tmp/depreciation-source-entry';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
let page;
try {
  for (const width of [1440, 390]) {
    page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.setDefaultTimeout(7000);
    await page.clock.install({ time: new Date('2026-10-19T03:00:00Z') });
    assert.equal((await (await page.request.get('http://127.0.0.1:18787/__depreciation-budget-qa')).json()).isolated, true);
    const errors = [];
    const mutations = [];
    let failSource = true;
    let pendingSource = null;
    let sourceStarted = null;
    let sourceFinished = null;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.origin !== 'http://127.0.0.1:5173') return route.fulfill({ json: {} });
      const request = route.request();
      if (request.method() !== 'GET') mutations.push([request.method(), url.pathname]);
      if (url.pathname === '/api/journal/7001') {
        if (failSource) return route.fulfill({ status: 503, json: { error: 'Temporary QA failure' } });
        if (pendingSource) {
          sourceStarted?.();
          await pendingSource;
          pendingSource = null;
        }
      }
      const response = await route.fetch({ url: `http://127.0.0.1:18787${url.pathname}${url.search}` });
      await route.fulfill({ response });
      if (url.pathname === '/api/journal/7001') sourceFinished?.();
    });
    await page.addInitScript(() => { localStorage.setItem('locale', 'ja'); localStorage.setItem('display_currency', 'JPY'); });
    await page.goto('http://127.0.0.1:5173/ledger');
    const row = page.locator('tr:visible').filter({ has: page.getByText('テスト償却 4', { exact: true }) });
    await row.waitFor();
    assert.equal(await page.locator('tr:visible').filter({ has: page.getByText('修正テスト用の機器', { exact: true }) }).count(), 0, 'Source purchase is outside the current ledger date range');
    async function openMonthly() {
      await row.getByRole('button').first().click();
      const modal = page.getByRole('dialog', { name: '仕訳を編集', exact: true });
      await modal.getByText(/個別の月次仕訳を編集すると/).waitFor();
      return modal;
    }
    const modal = await openMonthly();
    const sourceButton = modal.getByRole('button', { name: '元の購入仕訳', exact: true });
    await sourceButton.waitFor();
    await modal.getByRole('textbox', { name: '摘要', exact: true }).fill('月次の未保存メモ');
    await sourceButton.click();
    await modal.getByTestId('depreciation-source-entry-error').waitFor();
    assert.equal(await modal.getByRole('textbox', { name: '摘要', exact: true }).inputValue(), '月次の未保存メモ');
    assert.equal(await sourceButton.isEnabled(), true, 'Failure allows retry without changing the editing target');
    failSource = false;
    await sourceButton.focus();
    await page.keyboard.press('Enter');
    await modal.getByRole('textbox', { name: '購入資産科目', exact: true }).waitFor();
    assert.equal(await modal.getByRole('textbox', { name: '摘要', exact: true }).inputValue(), '修正テスト用の機器');
    assert.equal(await modal.getByRole('textbox', { name: '金額', exact: true }).inputValue(), '¥300,000');
    assert.equal(await modal.getByRole('textbox', { name: '振替月数', exact: true }).inputValue(), '30');
    assert.equal(await page.getByRole('dialog', { name: '仕訳を編集', exact: true }).count(), 1);
    assert.equal(await sourceButton.count(), 0);
    await page.screenshot({ path: `${output}/source-${width}.png`, animations: 'disabled' });
    await modal.getByRole('button', { name: 'キャンセル', exact: true }).click();
    await modal.waitFor({ state: 'hidden' });

    // A delayed response from a closed modal must not hijack a reopened editor.
    await openMonthly();
    let release;
    pendingSource = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { sourceStarted = resolve; });
    const finished = new Promise(resolve => { sourceFinished = resolve; });
    await sourceButton.click();
    await started;
    assert.equal(await sourceButton.isDisabled(), true);
    await modal.getByRole('button', { name: 'キャンセル', exact: true }).click();
    await modal.waitFor({ state: 'hidden' });
    await openMonthly();
    release();
    await finished;
    await page.waitForLoadState('networkidle');
    assert.equal(await modal.getByRole('textbox', { name: '摘要', exact: true }).inputValue(), 'テスト償却 4');
    assert.equal(await modal.getByRole('textbox', { name: '購入資産科目', exact: true }).count(), 0, 'Late source response must not switch the newly opened monthly entry');
    sourceStarted = sourceFinished = null;

    if (width === 390) {
      await sourceButton.click();
      await modal.getByRole('textbox', { name: '購入資産科目', exact: true }).waitFor();
      await modal.getByRole('textbox', { name: '摘要', exact: true }).fill('購入元からの編集確認');
      const [saved] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === '/api/depreciation/100' && response.request().method() === 'PATCH'),
        modal.getByRole('button', { name: '保存', exact: true }).click(),
      ]);
      assert.equal(saved.status(), 200, await saved.text());
      await modal.waitFor({ state: 'hidden' });
      assert.deepEqual(mutations, [['PATCH', '/api/depreciation/100']], 'Save must target the source plan, never the monthly journal entry');
      const source = await (await page.request.get('http://127.0.0.1:18787/api/journal/7001')).json();
      assert.equal(source.description, '購入元からの編集確認');
      assert.equal(source.lines.find(line => line.account_id === 1002).debit, 300000);
    } else {
      await modal.getByRole('button', { name: 'キャンセル', exact: true }).click();
      assert.deepEqual(mutations, []);
    }
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(JSON.stringify({ width, originalPurchaseSwitch: true, retry: true, lateResponseIgnored: true, correctSaveTarget: width === 390, pageErrors: 0 }));
    await page.close();
    page = undefined;
  }
} catch (error) {
  if (page) writeFileSync(`${output}/failure.aria.txt`, await page.locator('body').ariaSnapshot());
  throw error;
} finally { await browser.close(); }
