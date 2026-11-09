import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const runtime = process.argv[2] || "playwright";
const { chromium } = require(runtime), { expect } = require(`${runtime}/test`);
const base = process.argv[3] || "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, serviceWorkers: "block" });
const errors = [], writes = [];
page.on("pageerror", error => errors.push(error.message));
const row = (id, name, total, spent, extra = {}) => ({
  category: { id, name, budget_group: "日常", sort_order: id, account_ids: [], target_accounts: [] },
  total_budget: total, budget_base: total, carryover: 3000, spent, available: total - spent,
  months_with_contributions: 4, ...extra,
});
const categories = [
  row(1001, "自由出費", 12000, 6500, { depreciation_funding_out: 2000, reference_spent: 500 }),
  row(1002, "必要出費", 7000, 9000, { carryover: -1000, depreciation_funding_out: 1000, depreciation_funding_in: 500, reference_spent: 100,
    borrowed_funding: 500, lent_funding: 100, restored_funding: 50, discarded_funding: 20, converted_to_own_funding: 30, reset_cutoff_funding: 10, funding_adjustment: 350 }),
  row(1003, "旅行準備金", 18000, 2000, { category: { id: 1003, name: "旅行準備金", budget_group: "日常", sort_order: 3, account_ids: [], target_accounts: [], goal_balance: 20000 }, depreciation_spent: 1000, depreciation_reserve: 5000 }),
  row(1004, "貯蓄", 100000, 10000, { category: { id: 1004, name: "貯蓄", budget_group: "貯蓄", sort_order: 4, account_ids: [], target_accounts: [] }, depreciation_funding_in: 3500, depreciation_funding_out: 500, reference_spent: 100 }),
];
const journal = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, date: `2026-11-0${9 - i}`, description: `サンプル支出 ${i + 1}`,
  lines: [{ account_id: 2, account_name: "食費", debit: 1000, credit: 0, currency: "JPY" }, { account_id: 1, account_name: "銀行", debit: 0, credit: 1000, currency: "JPY" }],
  budget_allocations: [{ budget_category_id: 1001, amount: -1000, currency: "JPY" }],
}));
await page.route("**/*", async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.origin !== base) return route.abort();
  if (!url.pathname.startsWith("/api/")) return route.continue();
  if (request.method() !== "GET") { writes.push(request.method() + " " + url.pathname); return route.abort(); }
  let json = [];
  if (url.pathname === "/api/accounts") json = [{ id: 1, name: "銀行", type: "asset", category: "cash", balances: { JPY: 200000 }, include_in_allocatable: true }, { id: 2, name: "食費", type: "expense", category: "food", balances: { JPY: 5000 } }];
  if (url.pathname === "/api/journal") json = journal;
  if (url.pathname === "/api/currencies") json = [{ id: 1, code: "JPY", decimal_places: 0, sort_order: 0 }];
  if (url.pathname === "/api/budget/settings") json = {};
  if (url.pathname === "/api/task-settings") json = { configured: true, loan_overdue_days: 30 };
  if (url.pathname === "/api/reports/pl") json = { income: [], expenses: [], total_income: 0, total_expenses: 5000, net_income: -5000 };
  if (url.pathname === "/api/budget/categories") json = categories.map(row => row.category);
  if (url.pathname === "/api/budget/summary") json = { year_month: url.searchParams.get("year_month") || "2026-11", categories, currency: "JPY", monthly_income: 0, total_budget: 137000, total_spent: 27500, total_available: 109500 };
  if (url.pathname === "/api/trial-balance/latest-snapshot") json = { snapshot_date: null };
  if (url.pathname === "/api/income-transfer-requirements") json = { groups: [], requirements: [] };
  if (url.pathname.endsWith("/placement-preview")) return route.fulfill({ status: 503, json: { error: "synthetic_unavailable" } });
  return route.fulfill({ json });
});
await page.addInitScript(() => { localStorage.setItem("locale", localStorage.getItem("locale") || "ja"); localStorage.setItem("display_currency", "JPY"); localStorage.setItem("app:initialSeeded", "true"); });
const countText = async () => Array.from((await page.locator("main").innerText()).replace(/\s/g, "")).length;
try {
  await page.clock.setFixedTime(new Date("2026-11-09T12:00:00+09:00"));
  await page.goto(base);
  const hero = page.getByTestId("budget-usage-hero");
  await expect(hero).toContainText("19,500");
  await expect(page.getByTestId("budget-category-1002")).toContainText("2,000");
  const counts = { desktop: await countText() };
  await page.screenshot({ path: `.tmp/overview-compact-${process.env.OVERVIEW_CAPTURE_BASELINE ? "before" : "after"}-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  counts.mobile = await countText();
  await page.screenshot({ path: `.tmp/overview-compact-${process.env.OVERVIEW_CAPTURE_BASELINE ? "before" : "after"}-mobile.png`, fullPage: true });
  if (process.env.OVERVIEW_CAPTURE_BASELINE) writeFileSync(".tmp/overview-compact-before.json", JSON.stringify(counts));
  await expect(hero.getByTestId("budget-monthly-funding-out")).not.toBeVisible();
  // Captured from this same synthetic fixture before the simplification.
  const baseline = { desktop: 1023, mobile: 1023 };
  assert.ok(counts.desktop <= baseline.desktop * 0.75, `desktop text: ${counts.desktop}/${baseline.desktop}`);
  assert.ok(counts.mobile <= baseline.mobile * 0.75, `mobile text: ${counts.mobile}/${baseline.mobile}`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await hero.locator("summary").focus(); await page.keyboard.press("Enter");
  await expect(hero.getByTestId("budget-monthly-funding-out")).toBeVisible();
  await expect(hero.getByTestId("budget-monthly-funding-out")).toContainText("3,000");
  await expect(hero.getByTestId("budget-used-amount")).toContainText("20,500");
  const necessary = page.getByTestId("budget-category-1002");
  await necessary.locator("summary").click();
  await expect(necessary.getByTestId("budget-monthly-funding-in")).toBeVisible();
  await expect(necessary).toContainText("参考記録");
  await expect(necessary).toContainText("500");
  const savings = page.getByTestId("budget-usage-including-savings");
  await savings.locator("summary").click();
  await expect(savings.getByTestId("budget-used-amount")).toContainText("31,000");
  await expect(savings.getByTestId("budget-monthly-funding-in")).toContainText("4,000");
  const installments = page.locator("details").filter({ has: page.locator("summary", { hasText: "分割振替" }) }).last();
  await installments.locator("summary").click();
  await expect(installments).toContainText("5,000");
  const transaction = page.locator("details").filter({ has: page.locator("summary", { hasText: /^配分$/ }) }).first();
  await transaction.locator("summary").click();
  await expect(transaction).toContainText("自由出費");
  await expect(page.getByRole("link", { name: /買い物リスト/ })).toHaveAttribute("href", "/shopping-list");
  await expect(page.locator('a[href="/wishlist"]')).toBeVisible();
  await expect(page.locator('a[href="/scheduled-payments"]')).toBeVisible();
  for (const locale of ["en", "fr", "es", "zh-CN", "zh-TW", "ja"]) {
    await page.evaluate(locale => localStorage.setItem("locale", locale), locale);
    await page.reload();
    await expect(page.getByTestId("budget-usage-hero")).toBeVisible();
    assert.equal((await page.locator("main").innerText()).includes("overviewCategoryDetails"), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(page.getByTestId("budget-usage-hero")).toBeVisible();
  await page.setViewportSize({ width: 320, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: ".tmp/overview-compact-after-dark-mobile.png", fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  writeFileSync(".tmp/overview-compact-result.json", JSON.stringify({ baseline, counts, reduction: 1 - counts.desktop / baseline.desktop }));
  console.log(JSON.stringify({ baseline, counts, checks: "exact balances; compact defaults; keyboard disclosures; full financial details; 6 locales; 320px/dark; links; no writes/errors" }));
} finally { await browser.close(); }
