import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Run against an existing Vite instance. Every API response is synthetic.
const { chromium } = createRequire(import.meta.url)(process.argv[2] || "playwright");
const base = process.argv[3] || "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true, serviceWorkers: "block" });
const page = await context.newPage();
page.setDefaultTimeout(10_000);
const errors = [], writes = [];
page.on("pageerror", error => errors.push(error.message));
const category = (id, name, available) => ({
  category: { id, name, account_ids: [], target_accounts: [], sort_order: id, budget_group: "", created_at: "2026-01-01" },
  available, total_budget: available, budget_base: available, spent: 0, carryover: 0,
});
const categories = [category(1, "Example positive", 100_000), category(2, "Example overrun", -15_000)];
const summary = { year_month: "2026-11", currency: "JPY", categories, monthly_income: 0, total_budget: 85_000, total_spent: 0, total_available: 85_000 };
await page.route("**/*", async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.origin !== base) return route.abort();
  if (!url.pathname.startsWith("/api/")) return route.continue();
  if (!["GET", "HEAD"].includes(request.method())) {
    writes.push(`${request.method()} ${url.pathname}`);
    return route.abort();
  }
  let json = [];
  if (url.pathname === "/api/currencies") json = [{ id: 1, code: "JPY", sort_order: 0, decimal_places: 0 }];
  if (url.pathname === "/api/accounts") json = [
    { id: 1, name: "Example bank", type: "asset", category: "cash", currency: "JPY", balance: 100_000, balances: { JPY: 100_000 } },
    { id: 2, name: "Example card", type: "liability", category: "credit_card", currency: "JPY", balance: 10_000, balances: { JPY: 10_000 } },
  ];
  if (url.pathname === "/api/budget/summary") json = summary;
  if (url.pathname === "/api/budget/categories") json = categories.map(row => row.category);
  if (url.pathname === "/api/budget/settings") json = {};
  if (url.pathname === "/api/task-settings") json = { configured: true, updated_at: "2026-01-01", loan_overdue_days: 30 };
  if (url.pathname === "/api/reports/pl") json = { income: [], expenses: [], total_income: 0, total_expenses: 0, net_income: 0 };
  if (url.pathname === "/api/trial-balance/latest-snapshot") json = { snapshot_date: null };
  if (url.pathname === "/api/income-transfer-requirements") json = { groups: [], requirements: [] };
  if (url.pathname.endsWith("/placement-preview")) return route.fulfill({ status: 503, json: { error: "synthetic_unavailable" } });
  return route.fulfill({ json });
});
await context.addInitScript(() => {
  localStorage.setItem("locale", localStorage.getItem("locale") || "ja");
  localStorage.setItem("display_currency", "JPY");
  localStorage.setItem("app:initialSeeded", "true");
});

async function expectTarget(id) {
  const heading = page.locator(`#${id}`);
  await heading.waitFor({ state: "visible" });
  await page.waitForFunction(id => {
    const top = document.getElementById(id)?.getBoundingClientRect().top;
    return top != null && top >= 60 && top < 160;
  }, id);
  assert.equal(await page.locator("main").innerText().then(text => text.includes("{#budget-")), false);
}

async function openDetails() {
  const button = page.getByRole("button", { name: "整合性の詳しい計算を見る" });
  await button.click();
  const panelId = await button.getAttribute("aria-controls");
  await page.waitForFunction(id => {
    const panel = document.getElementById(id);
    return panel?.getAttribute("aria-hidden") === "false" && panel.style.height === "";
  }, panelId);
  return button;
}

try {
  await page.goto(`${base}/fs/budget`);
  const detailsButton = await openDetails();
  const help = page.getByRole("link", { name: "純整合差額の説明をガイドで読む", exact: true });
  assert.equal(await help.getAttribute("href"), "/settings/guides?section=budget#budget-net-gap");
  await help.hover();
  await page.getByRole("tooltip").getByText(/予算原資 − 全予算残高/).waitFor();
  await page.mouse.move(1200, 20);
  await detailsButton.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  assert.equal(await help.evaluate(element => document.activeElement === element && element.matches(":focus-visible")), true);
  await page.getByRole("tooltip").filter({ hasText: "予算原資 − 全予算残高" }).getByText(/クリックしてガイド/).waitFor();
  await page.waitForFunction(() => {
    const tooltip = [...document.querySelectorAll('[role="tooltip"]')].find(element => element.textContent.includes("予算原資 − 全予算残高"));
    return tooltip && Number(getComputedStyle(tooltip).opacity) === 1;
  });
  if (process.env.BUDGET_HELP_SCREENSHOTS) await page.screenshot({ path: ".tmp/budget-help-desktop.png" });
  await help.press("Enter");
  await expectTarget("budget-net-gap");
  await page.reload();
  await expectTarget("budget-net-gap");
  await page.getByText("予算システム（仮想バケット）", { exact: true }).first().waitFor();
  await page.getByText("複式簿記とシンプル入力", { exact: true }).first().click();
  assert.equal(new URL(page.url()).hash, "");
  await page.goBack();
  await expectTarget("budget-net-gap");

  for (const locale of ["en", "fr", "es", "zh-CN", "zh-TW", "ja"]) {
    await page.evaluate(locale => localStorage.setItem("locale", locale), locale);
    await page.goto(`${base}/settings/guides?section=budget#budget-adjusted-gap`);
    await expectTarget("budget-adjusted-gap");
    assert.ok((await page.locator("#budget-adjusted-gap").textContent()).trim());
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/fs/budget`);
  await openDetails();
  await page.getByRole("link", { name: "予約控除後の整合差額の説明をガイドで読む", exact: true }).tap();
  await expectTarget("budget-adjusted-gap");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.env.BUDGET_HELP_SCREENSHOTS) await page.screenshot({ path: ".tmp/budget-help-mobile.png" });
  await page.locator("main input").first().click();
  await page.getByRole("option").first().click();
  await page.waitForFunction(() => window.scrollY < 2);
  assert.equal(new URL(page.url()).hash, "");
  await page.goto(`${base}/settings/guides?section=missing#%broken`);
  await page.getByRole("heading", { level: 1 }).waitFor();
  assert.deepEqual(writes, []);
  assert.deepEqual(errors, []);
  console.log("PASS: hover/focus hints; keyboard/touch guide links; deep links/reload/back; six languages; mobile chapter top; invalid URL; no API writes or browser errors");
} catch (error) {
  console.error(JSON.stringify({ errors, writes, body: (await page.locator("body").innerText()).slice(0, 1800) }));
  throw error;
} finally {
  await context.close();
  await browser.close();
}
