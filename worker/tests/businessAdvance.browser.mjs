import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const base = process.env.BUSINESS_ADVANCE_QA_UI || "http://127.0.0.1:18822";
const api = process.env.BUSINESS_ADVANCE_QA_API || "http://127.0.0.1:18821";
const out = ".tmp/business-advance-qa";
mkdirSync(out, { recursive: true });
assert.equal((await (await fetch(`${api}/__business-advance-qa`)).json()).isolated, true);
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const report = [];
let page;
try {
  for (const { currency, width, amount, repayment, loss, purchase } of [
    { currency: "JPY", width: 1440, amount: 3000, repayment: 1000, loss: 1000, purchase: 1500 },
    { currency: "USD", width: 390, amount: 12.34, repayment: 2.34, loss: 5, purchase: 25.55 },
  ]) {
    assert.equal((await fetch(`${api}/__business-advance-reset`, { method: "POST" })).status, 200);
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
    page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await page.addInitScript(value => {
      localStorage.setItem("locale", "ja");
      localStorage.setItem("display_currency", value);
    }, currency);
    await page.goto(`${base}/input`);
    const main = page.getByRole("main");
    await main.getByRole("tab", { name: "事業立替金処理", exact: true }).click();
    async function choose(label, option) {
      await main.getByRole("textbox", { name: label, exact: true }).click();
      await page.getByRole("option", { name: option, exact: true }).click();
    }
    async function save(label) {
      const [response] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === "/api/journal" && response.request().method() === "POST"),
        main.getByRole("button", { name: label, exact: true }).click(),
      ]);
      assert.equal(response.status(), 201, await response.text());
      const body = response.request().postDataJSON();
      assert.ok(body.lines.every(line => line.currency === currency), "All lines keep the selected currency");
      await main.getByRole("textbox", { name: "金額", exact: true }).waitFor();
      return body;
    }
    async function checkBalances(expectedCash, expectedAdvance, expectedBudget) {
      const accounts = await (await fetch(`${api}/api/accounts?as_of=2026-11-30`)).json();
      assert.ok(Math.abs(accounts.find(account => account.id === 1001).balances[currency] - expectedCash) < 1e-7,
        `${currency} cash expected ${expectedCash}, got ${accounts.find(account => account.id === 1001).balances[currency]}`);
      assert.ok(Math.abs(accounts.find(account => account.id === 1003).balances[currency] - expectedAdvance) < 1e-7);
      const summary = await (await fetch(`${api}/api/budget/summary?year_month=2026-11&currency=${currency}`)).json();
      assert.ok(Math.abs(summary.categories.find(row => row.category.id === 1001).available - expectedBudget) < 1e-7);
      assert.equal(summary.categories.find(row => row.category.id === 1002).available, 10000);
    }
    await main.getByRole("textbox", { name: "金額", exact: true }).fill(String(amount));
    const sent = await save("保存");
    assert.equal(sent.budget_allocations[0].amount, -amount);
    await checkBalances(50000 - amount, amount, 10000 - amount);

    await main.locator("label").filter({ hasText: /^振替（入金）$/ }).click();
    await choose("振替先科目", "メイン口座");
    await main.getByRole("textbox", { name: "金額", exact: true }).fill(String(repayment));
    const recovered = await save("保存");
    assert.equal(recovered.budget_allocations, undefined);
    await checkBalances(50000 - amount + repayment, amount - repayment, 10000 - amount);

    await main.locator("label").filter({ hasText: /^損失として破棄$/ }).click();
    await main.getByRole("textbox", { name: "金額", exact: true }).fill(String(loss));
    const disposed = await save("保存");
    assert.equal(disposed.budget_allocations, undefined);
    await checkBalances(50000 - amount + repayment, amount - repayment - loss, 10000 - amount);

    await main.getByRole("tab", { name: "シンプル", exact: true }).click();
    await main.locator("label").filter({ hasText: /^事業立替$/ }).click();
    await main.getByRole("textbox", { name: "摘要", exact: true }).fill("事業用100%の支払");
    await main.getByRole("textbox", { name: "金額", exact: true }).fill(String(purchase));
    assert.equal(await main.getByRole("textbox", { name: "カテゴリー", exact: true }).count(), 0);
    const bought = await save("追加");
    assert.equal(bought.lines.length, 2);
    assert.equal(bought.lines.find(line => line.account_id === 1003).debit, purchase);
    assert.equal(bought.budget_allocations[0].amount, -purchase);
    await checkBalances(50000 - amount + repayment - purchase, amount - repayment - loss + purchase, 10000 - amount - purchase);
    if (currency === "USD") {
      await fetch(`${api}/__business-advance-reset`, { method: "POST" });
      await page.reload();
      await main.getByRole("tab", { name: "事業立替金処理", exact: true }).click();
      await main.getByRole("textbox", { name: "金額", exact: true }).fill("0.30");
      await save("保存");
      await main.locator("label").filter({ hasText: /^振替（入金）$/ }).click();
      await choose("振替先科目", "メイン口座");
      await main.getByRole("textbox", { name: "金額", exact: true }).fill("0.20");
      await save("保存");
      // A binary float remainder of .3 - .2 must not block the final cent units.
      await main.locator("label").filter({ hasText: /^振替（入金）$/ }).click();
      await choose("振替先科目", "メイン口座");
      await main.getByRole("textbox", { name: "金額", exact: true }).fill("0.10");
      await save("保存");
      await checkBalances(50000, 0, 9999.70);
    }
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${out}/${currency}-${width}.png`, fullPage: true, animations: "disabled" });
    report.push({ currency, width, send: amount, recovered: repayment, disposed: loss,
      fullBusinessPurchase: purchase, finalCentSettlement: currency === "USD", errors });
    await context.close();
    page = undefined;
  }
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  if (page) writeFileSync(`${out}/failure.txt`, await page.getByRole("main").ariaSnapshot());
  throw error;
} finally {
  await browser.close();
}
