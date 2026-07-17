import {
  ActionIcon,
  Anchor,
  Box,
  Button,
  Divider,
  Group,
  Paper,
  Progress,
  ScrollArea,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import {
  IconBraces,
  IconDatabase,
  IconFileCode,
  IconFileTypePdf,
  IconInfoCircle,
  IconMoon,
  IconPrinter,
  IconSun,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { Account, DepreciationSchedule } from "@balance-sheet/shared";
import { api } from "../api/client";
import { toIntlLocale, useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { formatJPY } from "../lib/numberFormat";
import {
  categoryIndex,
  systemAccountTranslationKey,
} from "../lib/accountUtils";
import type { AccountCategory, AccountType } from "@balance-sheet/shared";

const REPORT_ID = "export-report-content";

function AccountRows({
  accounts,
}: {
  accounts: { id: number; name: string; balance: number }[];
}) {
  const { locale } = useLang();
  return (
    <>
      {accounts.map((a) => (
        <Table.Tr key={a.id}>
          <Table.Td>{a.name}</Table.Td>
          <Table.Td className="currency-cell">
            {formatJPY(a.balance, locale)}
          </Table.Td>
        </Table.Tr>
      ))}
    </>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <Table.Tr>
      <Table.Td
        colSpan={2}
        style={{
          background: "var(--mantine-color-default-hover)",
          fontWeight: 700,
          fontSize: 12,
        }}
      >
        {label}
      </Table.Td>
    </Table.Tr>
  );
}

function TotalRow({ label, amount }: { label: string; amount: number }) {
  const { locale } = useLang();
  return (
    <Table.Tr style={{ fontWeight: 700 }}>
      <Table.Td>{label}</Table.Td>
      <Table.Td className="currency-cell">
        {formatJPY(amount, locale)}
      </Table.Td>
    </Table.Tr>
  );
}

export default function ExportPage() {
  const { pathname } = useLocation();
  const { t, locale } = useLang();
  const { accounts: allAccounts, journal } = useAppData();
  const printStyleRef = useRef<HTMLStyleElement | null>(null);

  const accountDisplayName = (name: string) => {
    const key = systemAccountTranslationKey(name);
    return key ? t(key) : name;
  };

  const now = new Date();
  const firstOfYear = new Date(now.getFullYear(), 0, 1);

  const [fromDate, setFromDate] = useState<Date | null>(firstOfYear);
  const [toDate, setToDate] = useState<Date | null>(now);
  const [bsAccounts, setBsAccounts] = useState<Account[] | null>(null);
  const [bsLoading, setBsLoading] = useState(false);
  const [sqliteDownloading, setSqliteDownloading] = useState(false);
  const [reportScheme, setReportScheme] = useState<"light" | "dark">("light");
  const [deprSchedules, setDeprSchedules] = useState<
    DepreciationSchedule[] | null
  >(null);

  useEffect(() => {
    const styleId = "report-scheme-override";
    document.getElementById(styleId)?.remove();

    const light = reportScheme === "light";
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      #${REPORT_ID} {
        --mantine-color-scheme: ${light ? "light" : "dark"};
        --mantine-color-body: var(${light ? "--mantine-color-white" : "--mantine-color-dark-7"});
        --mantine-color-text: var(${light ? "--mantine-color-black" : "--mantine-color-dark-0"});
        --mantine-color-default: var(${light ? "--mantine-color-white" : "--mantine-color-dark-6"});
        --mantine-color-default-hover: var(${light ? "--mantine-color-gray-0" : "--mantine-color-dark-5"});
        --mantine-color-default-color: var(${light ? "--mantine-color-black" : "--mantine-color-white"});
        --mantine-color-default-border: var(${light ? "--mantine-color-gray-4" : "--mantine-color-dark-4"});
        --mantine-color-dimmed: var(${light ? "--mantine-color-gray-6" : "--mantine-color-dark-2"});
        background-color: var(${light ? "--mantine-color-white" : "--mantine-color-dark-7"});
        color: var(${light ? "--mantine-color-black" : "--mantine-color-dark-0"});
        color-scheme: ${light ? "light" : "dark"};
      }
      #${REPORT_ID} table {
        --table-striped-color: var(${light ? "--mantine-color-gray-0" : "--mantine-color-dark-6"});
        --table-border-color: var(${light ? "--mantine-color-gray-3" : "--mantine-color-dark-4"});
      }
    `;
    document.head.appendChild(style);
    return () => document.getElementById(styleId)?.remove();
  }, [reportScheme]);

  const localDateStr = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const fromStr = fromDate ? localDateStr(fromDate) : "";
  const toStr = toDate ? localDateStr(toDate) : "";

  useEffect(() => {
    if (!toStr) {
      setBsAccounts(null);
      return;
    }
    setBsLoading(true);
    api.accounts
      .list(toStr)
      .then(setBsAccounts)
      .catch(() => setBsAccounts(null))
      .finally(() => setBsLoading(false));
  }, [toStr]);

  useEffect(() => {
    api.depreciation
      .list()
      .then(setDeprSchedules)
      .catch(() => setDeprSchedules([]));
  }, []);

  const deprRows = useMemo(() => {
    if (!deprSchedules) return [];
    return deprSchedules.map((s) => {
      const accumulated = s.monthly_amounts.reduce((sum, amt, i) => {
        const entryDate = s.entry_dates[i];
        return entryDate && toStr && entryDate <= toStr ? sum + amt : sum;
      }, 0);
      const remaining = s.total_amount - accumulated;
      const progressPct =
        s.total_amount > 0
          ? Math.round((accumulated / s.total_amount) * 100)
          : 0;
      return { ...s, accumulated, remaining, progressPct };
    });
  }, [deprSchedules, toStr]);

  function sortByCategory<
    T extends { type: string; category: string; is_system?: boolean },
  >(list: T[]): T[] {
    return [...list].sort(
      (a, b) =>
        categoryIndex(
          a.type as AccountType,
          a.category as AccountCategory,
          a.is_system ?? false,
        ) -
        categoryIndex(
          b.type as AccountType,
          b.category as AccountCategory,
          b.is_system ?? false,
        ),
    );
  }

  // BS
  const bsSource = bsAccounts ?? allAccounts;
  const bsAssets = useMemo(
    () =>
      sortByCategory(
        bsSource.filter(
          (a) => a.type === "asset" && a.name !== "__system:unknown_funds__",
        ),
      ),
    [bsSource],
  );
  const bsLiabilities = useMemo(
    () => sortByCategory(bsSource.filter((a) => a.type === "liability")),
    [bsSource],
  );
  const bsEquity = useMemo(
    () => sortByCategory(bsSource.filter((a) => a.type === "equity")),
    [bsSource],
  );
  const totalAssets = bsAssets.reduce((s, a) => s + (a.balance ?? 0), 0);
  const totalLiabilities = bsLiabilities.reduce(
    (s, a) => s + (a.balance ?? 0),
    0,
  );
  const netWorth = totalAssets - totalLiabilities;

  // PL
  const filteredJournal = useMemo(
    () =>
      fromStr && toStr
        ? journal.filter((e) => e.date >= fromStr && e.date <= toStr)
        : journal,
    [journal, fromStr, toStr],
  );
  const typeMap = useMemo(
    () => new Map(allAccounts.map((a) => [a.id, a])),
    [allAccounts],
  );
  const plBalances = useMemo(() => {
    const map = new Map<number, number>();
    for (const entry of filteredJournal) {
      for (const line of entry.lines) {
        const acc = typeMap.get(line.account_id);
        if (!acc) continue;
        if (acc.type === "income") {
          map.set(
            line.account_id,
            (map.get(line.account_id) ?? 0) + line.credit - line.debit,
          );
        } else if (acc.type === "expense") {
          map.set(
            line.account_id,
            (map.get(line.account_id) ?? 0) + line.debit - line.credit,
          );
        }
      }
    }
    return map;
  }, [filteredJournal, typeMap]);

  const incomeRows = useMemo(
    () =>
      sortByCategory(allAccounts.filter((a) => a.type === "income")).map(
        (a) => ({
          id: a.id,
          name: accountDisplayName(a.name),
          balance: plBalances.get(a.id) ?? 0,
        }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allAccounts, plBalances],
  );
  const expenseRows = useMemo(
    () =>
      sortByCategory(allAccounts.filter((a) => a.type === "expense")).map(
        (a) => ({
          id: a.id,
          name: accountDisplayName(a.name),
          balance: plBalances.get(a.id) ?? 0,
        }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allAccounts, plBalances],
  );
  const totalIncome = incomeRows.reduce((s, r) => s + r.balance, 0);
  const totalExpense = expenseRows.reduce((s, r) => s + r.balance, 0);
  const netIncome = totalIncome - totalExpense;

  const generatedAt = useMemo(
    () => new Date().toLocaleString(toIntlLocale(locale)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fromStr, toStr, locale],
  );

  function handleExportJSON() {
    const data = {
      exported_at: new Date().toISOString(),
      period: { from: fromStr, to: toStr, bs_as_of: toStr },
      balance_sheet: {
        as_of: toStr,
        assets: bsAssets.map((a) => ({
          id: a.id,
          name: accountDisplayName(a.name),
          category: a.category,
          balance: a.balance ?? 0,
        })),
        liabilities: bsLiabilities.map((a) => ({
          id: a.id,
          name: accountDisplayName(a.name),
          category: a.category,
          balance: a.balance ?? 0,
        })),
        equity: bsEquity.map((a) => ({
          id: a.id,
          name: accountDisplayName(a.name),
          category: a.category,
          balance: a.balance ?? 0,
        })),
        totals: {
          total_assets: totalAssets,
          total_liabilities: totalLiabilities,
          net_worth: netWorth,
        },
      },
      income_statement: {
        from: fromStr,
        to: toStr,
        income: incomeRows.map((r) => ({
          id: r.id,
          name: r.name,
          amount: r.balance,
        })),
        expenses: expenseRows.map((r) => ({
          id: r.id,
          name: r.name,
          amount: r.balance,
        })),
        totals: {
          total_income: totalIncome,
          total_expenses: totalExpense,
          net_income: netIncome,
        },
      },
      depreciation: {
        as_of: toStr,
        schedules: deprRows.map((row) => ({
          id: row.id,
          description: row.description,
          asset_account_name: accountDisplayName(row.asset_account_name),
          expense_account_name: accountDisplayName(row.expense_account_name),
          start_date: row.start_date,
          total_amount: row.total_amount,
          months: row.months,
          accumulated: row.accumulated,
          book_value: row.remaining,
          progress_pct: row.progressPct,
        })),
      },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `financial_report_${fromStr || "all"}_${toStr || "now"}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleExportJSONC() {
    // Serialize value as indented JSON; subsequent lines are re-indented by `indent` spaces.
    const jv = (v: unknown, indent: number): string =>
      JSON.stringify(v, null, 2)
        .split("\n")
        .map((l, i) => (i === 0 ? l : " ".repeat(indent) + l))
        .join("\n");

    const exportedAt = new Date().toISOString();
    const now = new Date().toLocaleString(toIntlLocale(locale));

    const assetsList = bsAssets.map((a) => ({
      id: a.id,
      name: accountDisplayName(a.name),
      category: a.category,
      balance: a.balance ?? 0,
    }));
    const liabList = bsLiabilities.map((a) => ({
      id: a.id,
      name: accountDisplayName(a.name),
      category: a.category,
      balance: a.balance ?? 0,
    }));
    const eqList = bsEquity.map((a) => ({
      id: a.id,
      name: accountDisplayName(a.name),
      category: a.category,
      balance: a.balance ?? 0,
    }));
    const incList = incomeRows.map((r) => ({
      id: r.id,
      name: r.name,
      amount: r.balance,
    }));
    const expList = expenseRows.map((r) => ({
      id: r.id,
      name: r.name,
      amount: r.balance,
    }));
    const deprList = deprRows.map((row) => ({
      id: row.id,
      description: row.description,
      asset_account_name: accountDisplayName(row.asset_account_name),
      expense_account_name: accountDisplayName(row.expense_account_name),
      start_date: row.start_date,
      total_amount: row.total_amount,
      months: row.months,
      accumulated: row.accumulated,
      book_value: row.remaining,
      progress_pct: row.progressPct,
    }));

    const text = `// ${t("jsoncFileTitle")}
// ${t("jsoncGeneratedLabel")}: ${now}  ${t("jsoncPeriodRangeLabel")}: ${fromStr || "—"} 〜 ${toStr || "—"}
// ${t("jsoncFileFormatNote")}
{
  "exported_at": "${exportedAt}", // ${t("jsoncExportedAtComment")}

  // ${t("jsoncPeriodSection")}
  "period": {
    "from": "${fromStr}",    // ${t("jsoncFromComment")}
    "to": "${toStr}",        // ${t("jsoncToComment")}
    "bs_as_of": "${toStr}"   // ${t("jsoncBsAsOfComment")}
  },

  // ── ${t("jsoncBsSectionTitle")}（${toStr || "—"}）──────────────────────────────
  // ${t("jsoncBsNote1")}
  // ${t("jsoncBsNote2")}
  // ${t("jsoncBsNote3")}
  "balance_sheet": {
    "as_of": "${toStr}",
    "assets": ${jv(assetsList, 4)},       // type: asset
    "liabilities": ${jv(liabList, 4)},    // type: liability
    "equity": ${jv(eqList, 4)},           // type: equity
    "totals": {
      "total_assets": ${totalAssets},
      "total_liabilities": ${totalLiabilities},
      "net_worth": ${netWorth}             // ${t("jsoncNetWorthComment")}
    }
  },

  // ── ${t("jsoncPlSectionTitle")}（${fromStr || "—"} 〜 ${toStr || "—"}）──────────
  // ${t("jsoncPlNote1")}
  // ${t("jsoncPlNote2")}
  // ${t("jsoncPlNote3")}
  "income_statement": {
    "from": "${fromStr}",
    "to": "${toStr}",
    "income": ${jv(incList, 4)},          // type: income
    "expenses": ${jv(expList, 4)},        // type: expense
    "totals": {
      "total_income": ${totalIncome},
      "total_expenses": ${totalExpense},
      "net_income": ${netIncome}           // ${t("jsoncNetIncomeComment")}
    }
  },

  // ── ${t("jsoncDeprSectionTitle")}（${toStr || "—"}）────────────────────────────
  // ${t("jsoncDeprNote1")}
  // ${t("jsoncDeprNote2")}
  // ${t("jsoncDeprNote3")}
  "depreciation": {
    "as_of": "${toStr}",
    "schedules": ${jv(deprList, 4)}
  }
}`;

    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `financial_report_${fromStr || "all"}_${toStr || "now"}.jsonc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function buildPrintHTML(): string {
    const f = (n: number) =>
      new Intl.NumberFormat(toIntlLocale(locale), {
        style: "currency",
        currency: "JPY",
        maximumFractionDigits: 0,
      }).format(n);

    function rows(list: { name: string; balance: number }[]) {
      return list
        .map(
          (r) =>
            `<tr><td>${r.name}</td><td class="num">${f(r.balance)}</td></tr>`,
        )
        .join("");
    }

    const assetsRows = bsAssets.map((a) => ({
      name: accountDisplayName(a.name),
      balance: a.balance ?? 0,
    }));
    const liabRows = bsLiabilities.map((a) => ({
      name: accountDisplayName(a.name),
      balance: a.balance ?? 0,
    }));
    const eqRows = bsEquity.map((a) => ({
      name: accountDisplayName(a.name),
      balance: a.balance ?? 0,
    }));
    const incNonZero = incomeRows.filter((r) => r.balance !== 0);
    const expNonZero = expenseRows.filter((r) => r.balance !== 0);

    const deprSection =
      deprRows.length === 0
        ? `<p class="empty">減価償却資産の登録がありません。</p>`
        : `<table>
  <thead><tr><th>資産名</th><th class="num">取得価額</th><th>償却期間</th><th class="num">累計償却額</th><th class="num">残存簿価</th><th>進捗</th></tr></thead>
  <tbody>
    ${deprRows
      .map(
        (row) => `<tr>
      <td><strong>${row.description}</strong><br><span style="font-size:10px;color:#888;">${accountDisplayName(row.asset_account_name)}</span></td>
      <td class="num">${f(row.total_amount)}</td>
      <td style="text-align:center;">${row.start_date}<br><span style="font-size:10px;color:#888;">${row.months}ヶ月</span></td>
      <td class="num">${f(row.accumulated)}</td>
      <td class="num" style="${row.remaining <= 0 ? "color:#888;" : "font-weight:700;"}">${f(row.remaining)}</td>
      <td><div style="background:#eee;border-radius:3px;height:6px;width:100%;margin-bottom:2px;"><div style="background:${row.progressPct >= 100 ? "#aaa" : row.progressPct >= 75 ? "#0d9488" : "#2563eb"};height:6px;border-radius:3px;width:${Math.min(row.progressPct, 100)}%;"></div></div><span style="font-size:10px;">${row.progressPct}%</span></td>
    </tr>`,
      )
      .join("")}
  </tbody>
</table>`;

    return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>Financial Report ${fromStr}–${toStr}</title>
<style>
  @page { size: A4 portrait; margin: 15mm; }
  body { font-family: "Noto Sans JP","Yu Gothic","Hiragino Sans",sans-serif; font-size: 12px; color: #111; margin: 15mm; background: white; }
  @media print { body { margin: 0; } }
  h1 { font-size: 16px; margin-bottom: 2px; }
  h2 { font-size: 13px; margin-top: 18px; margin-bottom: 4px; border-bottom: 1px solid #bbb; padding-bottom: 3px; }
  .meta { font-size: 11px; color: #666; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 11px; }
  th, td { padding: 3px 8px; border: 1px solid #ddd; }
  th { background: #f5f5f5; font-weight: 600; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .sec td { background: #e8f4fb; font-weight: 700; }
  .tot td { font-weight: 700; background: #fafafa; }
  .summary { display: flex; gap: 8px; margin-bottom: 10px; }
  .card { flex: 1; border: 1px solid #ddd; border-radius: 4px; padding: 6px 10px; }
  .lbl { font-size: 9px; color: #888; text-transform: uppercase; letter-spacing: 0.4px; }
  .val { font-size: 13px; font-weight: 700; margin-top: 1px; }
  .teal { color: #0d9488; } .red { color: #dc2626; } .blue { color: #2563eb; }
  .note { font-size: 10px; color: #555; background: #eef4fb; border-left: 3px solid #93c5fd; padding: 5px 8px; margin-bottom: 8px; }
  .empty { font-size: 11px; color: #888; }
</style>
</head>
<body>
<h1>財務諸表 / Financial Report</h1>
<div class="meta">生成: ${new Date().toLocaleString(toIntlLocale(locale))} ／ 期間: ${fromStr || "—"} 〜 ${toStr || "—"}</div>

<h2>貸借対照表（${toStr || "—"} 時点）</h2>
<div class="summary">
  <div class="card"><div class="lbl">資産</div><div class="val teal">${f(totalAssets)}</div></div>
  <div class="card"><div class="lbl">負債</div><div class="val red">${f(totalLiabilities)}</div></div>
  <div class="card"><div class="lbl">純資産</div><div class="val ${netWorth >= 0 ? "blue" : "red"}">${f(netWorth)}</div></div>
</div>
<table>
  <thead><tr><th>勘定科目</th><th class="num">残高</th></tr></thead>
  <tbody>
    ${assetsRows.length > 0 ? `<tr class="sec"><td colspan="2">資産</td></tr>${rows(assetsRows)}<tr class="tot"><td>資産合計</td><td class="num">${f(totalAssets)}</td></tr>` : ""}
    ${liabRows.length > 0 ? `<tr class="sec"><td colspan="2">負債</td></tr>${rows(liabRows)}<tr class="tot"><td>負債合計</td><td class="num">${f(totalLiabilities)}</td></tr>` : ""}
    ${eqRows.length > 0 ? `<tr class="sec"><td colspan="2">資本</td></tr>${rows(eqRows)}` : ""}
    <tr class="tot"><td>純資産</td><td class="num">${f(netWorth)}</td></tr>
  </tbody>
</table>

<h2>損益計算書（${fromStr || "—"} 〜 ${toStr || "—"}）</h2>
<div class="summary">
  <div class="card"><div class="lbl">収益</div><div class="val teal">${f(totalIncome)}</div></div>
  <div class="card"><div class="lbl">費用</div><div class="val red">${f(totalExpense)}</div></div>
  <div class="card"><div class="lbl">純利益</div><div class="val ${netIncome >= 0 ? "blue" : "red"}">${f(netIncome)}</div></div>
</div>
<table>
  <thead><tr><th>勘定科目</th><th class="num">金額</th></tr></thead>
  <tbody>
    ${incNonZero.length > 0 ? `<tr class="sec"><td colspan="2">収益</td></tr>${rows(incNonZero)}<tr class="tot"><td>収益合計</td><td class="num">${f(totalIncome)}</td></tr>` : ""}
    ${expNonZero.length > 0 ? `<tr class="sec"><td colspan="2">費用</td></tr>${rows(expNonZero)}<tr class="tot"><td>費用合計</td><td class="num">${f(totalExpense)}</td></tr>` : ""}
    <tr class="tot"><td>純利益</td><td class="num">${f(netIncome)}</td></tr>
  </tbody>
</table>

<h2>減価償却の進捗（${toStr || "—"} 時点）</h2>
<p class="note">家計簿用簡易減価償却：月次の減価償却費は費用科目を通じて直接資産の帳簿価額を減少させます。</p>
${deprSection}
</body>
</html>`;
  }

  function handleSavePDF() {
    const html = buildPrintHTML();

    const iframe = document.createElement("iframe");
    Object.assign(iframe.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "1px",
      height: "1px",
      opacity: "0",
      border: "none",
      pointerEvents: "none",
    });
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
    if (!doc) {
      iframe.remove();
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    iframe.addEventListener("load", () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      // Remove iframe once the parent window regains focus after print dialog
      const onFocus = () => setTimeout(() => iframe.remove(), 300);
      window.addEventListener("focus", onFocus, { once: true });
      // Fallback: remove after 30s if focus event never fires
      setTimeout(() => iframe.remove(), 30_000);
    });
  }

  async function handleExportSQLite() {
    setSqliteDownloading(true);
    try {
      const blob = await api.admin.exportDb();
      const date = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `balance-sheet-${date}.sqlite`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setSqliteDownloading(false);
    }
  }

  function handlePrint() {
    // Inject a print-only stylesheet that hides everything except our report
    const style = document.createElement("style");
    style.setAttribute("data-export-print", "");
    style.textContent = `
      @media print {
        body * { visibility: hidden !important; }
        #${REPORT_ID}, #${REPORT_ID} * { visibility: visible !important; }
        #${REPORT_ID} {
          position: absolute !important;
          inset: 0 !important;
          padding: 12mm !important;
          background: white !important;
        }
      }
    `;
    // Remove any previous injection
    document
      .querySelectorAll("[data-export-print]")
      .forEach((el) => el.remove());
    document.head.appendChild(style);
    printStyleRef.current = style;

    const cleanup = () => {
      style.remove();
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    // Fallback: remove after 5s in case afterprint doesn't fire
    setTimeout(cleanup, 5000);

    window.print();
  }

  return (
    <Stack gap="lg">
      <Anchor
        component={Link}
        to={pathname.startsWith("/fs/") ? "/fs" : "/settings"}
        size="sm"
        c="dimmed"
      >
        {pathname.startsWith("/fs/")
          ? `← ${t("navFS")}`
          : t("settingsSubpageBack")}
      </Anchor>
      <Title order={3}>{t("settingsNavExportTitle")}</Title>

      {/* Date range */}
      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Text fw={600} size="sm">
            {t("exportPeriodLabel")}
          </Text>
          <Group wrap="wrap">
            <DatePickerInput
              label={t("exportFromLabel")}
              value={fromDate}
              onChange={setFromDate}
              clearable
              size="sm"
              w={180}
              valueFormat="YYYY-MM-DD"
            />
            <DatePickerInput
              label={t("exportToLabel")}
              value={toDate}
              onChange={setToDate}
              clearable
              size="sm"
              w={180}
              valueFormat="YYYY-MM-DD"
            />
          </Group>
        </Stack>
      </Paper>

      {/* Export buttons */}
      <Group>
        <Button
          leftSection={<IconFileCode size={16} />}
          onClick={handleExportJSON}
          variant="default"
        >
          {t("exportJSON")}
        </Button>
        <Button
          leftSection={<IconBraces size={16} />}
          onClick={handleExportJSONC}
          variant="default"
        >
          {t("exportJSONC")}
        </Button>
        <Button
          leftSection={<IconFileTypePdf size={16} />}
          onClick={handleSavePDF}
          variant="default"
        >
          {t("exportSavePDF")}
        </Button>
        <Button
          leftSection={<IconPrinter size={16} />}
          onClick={handlePrint}
          variant="default"
        >
          {t("exportPrint")}
        </Button>
        <Button
          leftSection={<IconDatabase size={16} />}
          onClick={handleExportSQLite}
          loading={sqliteDownloading}
          variant="default"
        >
          {t("exportSQLite")}
        </Button>
      </Group>

      {/* ── Inline report ─────────────────────────────────────────── */}
      {bsLoading ? (
        <Stack gap="sm">
          <Skeleton height={100} radius="md" />
          <Skeleton height={200} radius="md" />
          <Skeleton height={200} radius="md" />
        </Stack>
      ) : (
        <Box
          id={REPORT_ID}
          data-mantine-color-scheme={reportScheme}
          style={{ colorScheme: reportScheme }}
        >
          <Paper withBorder p="xl" radius="md">
            <Stack gap="xl">
              {/* Header */}
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <Stack gap={2}>
                  <Title order={4}>財務諸表 / Financial Report</Title>
                  <Text size="xs" c="dimmed">
                    生成日時: {generatedAt}　　対象期間: {fromStr || "—"} 〜{" "}
                    {toStr || "—"}
                  </Text>
                </Stack>
                <Tooltip
                  label={
                    reportScheme === "light"
                      ? t("exportSchemeDark")
                      : t("exportSchemeLight")
                  }
                  withArrow
                >
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    onClick={() =>
                      setReportScheme((s) => (s === "light" ? "dark" : "light"))
                    }
                  >
                    {reportScheme === "light" ? (
                      <IconMoon size={14} />
                    ) : (
                      <IconSun size={14} />
                    )}
                  </ActionIcon>
                </Tooltip>
              </Group>

              <Divider />

              {/* Balance Sheet */}
              <Stack gap="sm">
                <Title order={5}>
                  貸借対照表 / Balance Sheet
                  <Text span size="sm" fw={400} c="dimmed" ml={8}>
                    （{toStr || "—"} 時点）
                  </Text>
                </Title>

                <SimpleGrid cols={{ base: 1, sm: 3 }}>
                  <Paper withBorder p="sm" radius="sm">
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                      {t("assets")}
                    </Text>
                    <Text fw={700} c="teal">
                      {formatJPY(totalAssets, locale)}
                    </Text>
                  </Paper>
                  <Paper withBorder p="sm" radius="sm">
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                      {t("liabilities")}
                    </Text>
                    <Text fw={700} c="red">
                      {formatJPY(totalLiabilities, locale)}
                    </Text>
                  </Paper>
                  <Paper withBorder p="sm" radius="sm">
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                      {t("netWorth")}
                    </Text>
                    <Text fw={700} c={netWorth >= 0 ? "blue" : "red"}>
                      {formatJPY(netWorth, locale)}
                    </Text>
                  </Paper>
                </SimpleGrid>

                <ScrollArea>
                  <Table
                    withTableBorder
                    withColumnBorders
                    striped
                    style={{ minWidth: 320 }}
                  >
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>{t("thAccount")}</Table.Th>
                        <Table.Th className="currency-cell">
                          {t("thBalance")}
                        </Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {bsAssets.length > 0 && (
                        <>
                          <SectionHeader label={t("sectionAssets")} />
                          <AccountRows
                            accounts={bsAssets.map((a) => ({
                              id: a.id,
                              name: accountDisplayName(a.name),
                              balance: a.balance ?? 0,
                            }))}
                          />
                          <TotalRow
                            label={`${t("sectionAssets")}${t("total")}`}
                            amount={totalAssets}
                          />
                        </>
                      )}
                      {bsLiabilities.length > 0 && (
                        <>
                          <SectionHeader label={t("sectionLiabilities")} />
                          <AccountRows
                            accounts={bsLiabilities.map((a) => ({
                              id: a.id,
                              name: accountDisplayName(a.name),
                              balance: a.balance ?? 0,
                            }))}
                          />
                          <TotalRow
                            label={`${t("sectionLiabilities")}${t("total")}`}
                            amount={totalLiabilities}
                          />
                        </>
                      )}
                      {bsEquity.length > 0 && (
                        <>
                          <SectionHeader label={t("sectionEquity")} />
                          <AccountRows
                            accounts={bsEquity.map((a) => ({
                              id: a.id,
                              name: accountDisplayName(a.name),
                              balance: a.balance ?? 0,
                            }))}
                          />
                        </>
                      )}
                      <TotalRow label={t("netWorth")} amount={netWorth} />
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              </Stack>

              <Divider />

              {/* Income Statement */}
              <Stack gap="sm">
                <Title order={5}>
                  損益計算書 / Income Statement
                  <Text span size="sm" fw={400} c="dimmed" ml={8}>
                    （{fromStr || "—"} 〜 {toStr || "—"}）
                  </Text>
                </Title>

                <SimpleGrid cols={{ base: 1, sm: 3 }}>
                  <Paper withBorder p="sm" radius="sm">
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                      {t("income")}
                    </Text>
                    <Text fw={700} c="teal">
                      {formatJPY(totalIncome, locale)}
                    </Text>
                  </Paper>
                  <Paper withBorder p="sm" radius="sm">
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                      {t("expenses")}
                    </Text>
                    <Text fw={700} c="red">
                      {formatJPY(totalExpense, locale)}
                    </Text>
                  </Paper>
                  <Paper withBorder p="sm" radius="sm">
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                      {t("netIncome")}
                    </Text>
                    <Text fw={700} c={netIncome >= 0 ? "blue" : "red"}>
                      {formatJPY(netIncome, locale)}
                    </Text>
                  </Paper>
                </SimpleGrid>

                <ScrollArea>
                  <Table
                    withTableBorder
                    withColumnBorders
                    striped
                    style={{ minWidth: 320 }}
                  >
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>{t("thAccount")}</Table.Th>
                        <Table.Th className="currency-cell">
                          {t("thBalance")}
                        </Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {incomeRows.length > 0 && (
                        <>
                          <SectionHeader label={t("sectionIncome")} />
                          <AccountRows accounts={incomeRows} />
                          <TotalRow
                            label={`${t("sectionIncome")}${t("total")}`}
                            amount={totalIncome}
                          />
                        </>
                      )}
                      {expenseRows.length > 0 && (
                        <>
                          <SectionHeader label={t("sectionExpenses")} />
                          <AccountRows accounts={expenseRows} />
                          <TotalRow
                            label={`${t("sectionExpenses")}${t("total")}`}
                            amount={totalExpense}
                          />
                        </>
                      )}
                      <TotalRow label={t("netIncome")} amount={netIncome} />
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              </Stack>

              <Divider />

              {/* Depreciation Progress */}
              <Stack gap="sm">
                <Title order={5}>
                  {t("exportDepreciationTitle")}
                  <Text span size="sm" fw={400} c="dimmed" ml={8}>
                    （{toStr || "—"} 時点）
                  </Text>
                </Title>

                <Box
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 6,
                    background: "#e8f4fb",
                    borderLeft: "3px solid #93c5fd",
                    borderRadius: 4,
                    padding: "6px 10px",
                  }}
                >
                  <IconInfoCircle
                    size={14}
                    style={{ color: "#2563eb", flexShrink: 0, marginTop: 1 }}
                  />
                  <Text size="xs" style={{ color: "#1e3a5f" }}>
                    {t("exportDepreciationNote")}
                  </Text>
                </Box>

                {deprRows.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    {t("exportDepreciationNone")}
                  </Text>
                ) : (
                  <ScrollArea>
                    <Table
                      withTableBorder
                      withColumnBorders
                      striped
                      style={{ minWidth: 600 }}
                    >
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>{t("thAccount")}</Table.Th>
                          <Table.Th className="currency-cell">
                            {t("exportDepreciationAcquisitionCost")}
                          </Table.Th>
                          <Table.Th style={{ textAlign: "center" }}>
                            {t("exportDepreciationPeriod")}
                          </Table.Th>
                          <Table.Th className="currency-cell">
                            {t("exportDepreciationAccumulated")}
                          </Table.Th>
                          <Table.Th className="currency-cell">
                            {t("exportDepreciationBookValue")}
                          </Table.Th>
                          <Table.Th style={{ minWidth: 120 }}>
                            {t("exportDepreciationProgress")}
                          </Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {deprRows.map((row) => (
                          <Table.Tr key={row.id}>
                            <Table.Td>
                              <Text size="sm" fw={500}>
                                {row.description}
                              </Text>
                              <Text size="xs" c="dimmed">
                                {accountDisplayName(row.asset_account_name)}
                              </Text>
                            </Table.Td>
                            <Table.Td className="currency-cell">
                              {formatJPY(row.total_amount, locale)}
                            </Table.Td>
                            <Table.Td style={{ textAlign: "center" }}>
                              {row.start_date}
                              <Text size="xs" c="dimmed">
                                {row.months}
                                {t("depreciationMonthUnit")}
                              </Text>
                            </Table.Td>
                            <Table.Td className="currency-cell">
                              {formatJPY(row.accumulated, locale)}
                            </Table.Td>
                            <Table.Td
                              className="currency-cell"
                              style={{
                                fontWeight: 700,
                                color:
                                  row.remaining <= 0
                                    ? "var(--mantine-color-dimmed)"
                                    : undefined,
                              }}
                            >
                              {formatJPY(row.remaining, locale)}
                            </Table.Td>
                            <Table.Td>
                              <Group gap={6} wrap="nowrap">
                                <Progress
                                  value={row.progressPct}
                                  size="sm"
                                  color={
                                    row.progressPct >= 100
                                      ? "gray"
                                      : row.progressPct >= 75
                                        ? "teal"
                                        : "blue"
                                  }
                                  style={{ flex: 1 }}
                                />
                                <Text size="xs" w={36} ta="right">
                                  {row.progressPct}%
                                </Text>
                              </Group>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </ScrollArea>
                )}
              </Stack>
            </Stack>
          </Paper>
        </Box>
      )}
    </Stack>
  );
}
