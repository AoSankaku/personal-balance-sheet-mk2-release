// Use existing Vite and the disposable in-memory QA API on port 18787.
// All actual API requests are redirected; real local D1 is never accessed.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const output = '.tmp/installment-setup';
const name = '予算分割振替（減価償却）';
const checkbox = '予算の対象外とし、予算分割振替（減価償却）元として扱う';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
let page;
try {
  for (const width of [1440, 390]) {
    page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.setDefaultTimeout(10000);
    const marker = await page.request.get('http://127.0.0.1:18787/__depreciation-budget-qa');
    assert.equal((await marker.json()).isolated, true);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const response = await route.fetch({ url: `http://127.0.0.1:18787${url.pathname}${url.search}` });
      if (url.pathname === '/api/accounts') {
        const accounts = (await response.json()).map(account => ({ ...account, is_depreciable: false }));
        return route.fulfill({ response, json: accounts });
      }
      await route.fulfill({ response });
    });
    await page.addInitScript(() => { localStorage.setItem('locale', 'ja'); localStorage.setItem('display_currency', 'JPY'); });
    await page.goto('http://127.0.0.1:5173/input');
    assert.equal(await page.getByRole('switch', { name: /予算分割振替/ }).count(), 1, 'The feature must remain discoverable without a source asset account');
    await page.getByText(name, { exact: true }).click();
    const prompt = page.getByTestId('depreciation-asset-required');
    await prompt.waitFor();
    assert.ok((await prompt.innerText()).includes(checkbox), 'Explain the exact account option to select');
    assert.equal(await page.getByRole('textbox', { name: '購入資産科目', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '追加', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${output}/empty-${width}.png`, animations: 'disabled' });
    const settings = prompt.getByRole('link', { name: /勘定科目/ });
    assert.equal(await settings.getAttribute('href'), '/settings');
    await settings.click();
    await page.getByRole('button', { name: '+ 勘定科目を追加', exact: true }).click();
    const modal = page.getByRole('dialog', { name: '勘定科目を追加', exact: true });
    assert.equal(await modal.getByRole('checkbox', { name: checkbox, exact: true }).count(), 1);
    await modal.getByRole('checkbox', { name: checkbox, exact: true }).check();
    assert.equal(await modal.getByRole('checkbox', { name: checkbox, exact: true }).isChecked(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/account-${width}.png`, animations: 'disabled' });
    await modal.getByRole('button', { name: 'キャンセル', exact: true }).click();
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(JSON.stringify({ width, noSourcePrompt: true, submitDisabled: true, settingsLink: true, checkboxCopy: true, overflow: false, pageErrors: 0 }));
    await page.close();
    page = undefined;
  }
} catch (error) {
  if (page) writeFileSync(`${output}/failure.aria.txt`, await page.locator('body').ariaSnapshot());
  throw error;
} finally { await browser.close(); }
