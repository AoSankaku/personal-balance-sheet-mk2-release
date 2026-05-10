export type CsvFormat =
  | "smbc-draft"
  | "smbc-confirmed"
  | "smbc-bank"
  | "rakuten-draft"
  | "rakuten-confirmed"
  | "sbi-bank"
  | "unknown";

export interface ParsedTransaction {
  date: string; // YYYY-MM-DD
  store: string;
  amount: number; // JPY integer (absolute value)
  paymentMonth: string; // YYYY-MM (when charged to card)
  direction?: "withdrawal" | "deposit";
  foreignAmount?: number;
  foreignCurrency?: string;
  rawRow: string;
}

export function isBankFormat(fmt: CsvFormat): boolean {
  return fmt === "sbi-bank" || fmt === "smbc-bank";
}

export interface ParseResult {
  format: CsvFormat;
  transactions: ParsedTransaction[];
  cardName?: string; // SMBC confirmed: card name from section header
}

function parseCSVRow(row: string): string[] {
  const fields: string[] = [];
  let inQuote = false;
  let current = "";
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (inQuote) {
      if (ch === '"') {
        if (row[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ",") {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseSignedInteger(raw: string): number | null {
  const normalized = raw
    .replace(/,/g, "")
    .replace(/"/g, "")
    .replace(/[¥￥\s]/g, "")
    .trim();
  if (normalized === "") return null;

  const isNegative =
    normalized.startsWith("-") ||
    normalized.startsWith("△") ||
    normalized.startsWith("▲") ||
    normalized.endsWith("-") ||
    (normalized.startsWith("(") && normalized.endsWith(")"));

  const digits = normalized.replace(/[^\d]/g, "");
  if (digits === "") return null;

  const amount = parseInt(digits, 10);
  if (isNaN(amount)) return null;
  return isNegative ? -amount : amount;
}

/** Convert YYYY/M/D or YYYY/MM/DD to YYYY-MM-DD */
function normalizeDateSlash(s: string): string {
  const parts = s.trim().split("/");
  if (parts.length !== 3) return s;
  const y = parts[0]!.padStart(4, "20");
  const m = parts[1]!.padStart(2, "0");
  const d = parts[2]!.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Convert SMBC paymentMonth col[5] like '26/03 or 26/03 to 2026-03 */
function smbcPaymentMonth(raw: string): string {
  const s = raw.replace(/^'/, "").trim();
  const parts = s.split("/");
  if (parts.length === 2) {
    const y = parts[0]!.length === 2 ? `20${parts[0]}` : parts[0]!;
    const m = parts[1]!.padStart(2, "0");
    return `${y}-${m}`;
  }
  return s;
}

/** Convert Rakuten paymentMonth col[7] like '3月' to YYYY-MM using current year */
function rakutenPaymentMonth(raw: string): string {
  const m = raw.replace(/月$/, "").trim();
  const num = parseInt(m, 10);
  if (isNaN(num)) return "";
  const now = new Date();
  // Heuristic: if month > current month by more than 3, assume previous year
  const currentMonth = now.getMonth() + 1;
  let year = now.getFullYear();
  if (num > currentMonth + 3) year -= 1;
  return `${year}-${String(num).padStart(2, "0")}`;
}

function parseSmbcDraft(lines: string[]): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = parseCSVRow(line);
    if (cols.length < 7) continue;
    // col[0] = date, col[1] = store, col[5] = paymentMonth, col[6] = billedAmt, col[7] = usageAmt
    const rawDate = cols[0] ?? "";
    if (!/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(rawDate)) continue;
    const date = normalizeDateSlash(rawDate);
    const store = cols[1] ?? "";
    const amount = parseSignedInteger(cols[6] ?? cols[7] ?? "");
    if (amount == null || amount === 0) continue;
    const paymentMonth = smbcPaymentMonth(cols[5] ?? "");
    const foreignAmountStr = (cols[9] ?? "").replace(/,/g, "");
    const foreignAmount = parseFloat(foreignAmountStr) || undefined;
    const foreignCurrency = cols[10] && cols[10] !== "" ? cols[10] : undefined;
    transactions.push({
      date,
      store,
      amount: Math.abs(amount),
      direction: amount < 0 ? "deposit" : "withdrawal",
      paymentMonth: paymentMonth || date.slice(0, 7),
      foreignAmount:
        foreignAmount && foreignAmount > 0 ? foreignAmount : undefined,
      foreignCurrency,
      rawRow: line,
    });
  }
  return transactions;
}

function parseSmbcConfirmed(lines: string[]): {
  transactions: ParsedTransaction[];
  cardName?: string;
} {
  const transactions: ParsedTransaction[] = [];
  let cardName: string | undefined;

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = parseCSVRow(line);
    if (cols.length === 0) continue;

    // Section header: col[0] ends with 様
    if (cols[0] && /様$/.test(cols[0])) {
      cardName = cols[0].replace(/様$/, "").trim();
      continue;
    }

    // Transaction row: col[0] is date YYYY/MM/DD
    const rawDate = cols[0] ?? "";
    if (!/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(rawDate)) continue;

    const date = normalizeDateSlash(rawDate);
    const store = cols[1] ?? "";
    const amount = parseSignedInteger(cols[2] ?? "");
    if (amount == null || amount === 0) continue;

    // col[3] = payment method, col[4] = payment number in series
    const payMethod = cols[3] ?? "";
    let description = store;
    if (payMethod && payMethod !== "１" && payMethod !== "1") {
      description = `${store} [${payMethod}]`;
    }

    // Payment month = same as date month (confirmed statement = this month's charge)
    const paymentMonth = date.slice(0, 7);

    transactions.push({
      date,
      store: description,
      amount: Math.abs(amount),
      direction: amount < 0 ? "deposit" : "withdrawal",
      paymentMonth,
      rawRow: line,
    });
  }

  return { transactions, cardName };
}

function parseRakuten(
  lines: string[],
  isConfirmed: boolean,
): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];
  let headerSkipped = false;

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = parseCSVRow(line);
    if (cols.length === 0) continue;

    // Skip header row
    if (!headerSkipped) {
      if (
        cols[0] &&
        (cols[0].includes("利用日") || cols[0].includes("カード番号"))
      ) {
        headerSkipped = true;
        continue;
      }
    }

    // Skip sub-rows with empty date (currency info rows)
    const rawDate = cols[0] ?? "";
    if (!rawDate || !/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(rawDate)) continue;

    const date = normalizeDateSlash(rawDate);
    const store = cols[1] ?? "";

    // col[4] = amount for both draft and confirmed
    const amount = parseSignedInteger(cols[4] ?? "");
    if (amount == null || amount === 0) continue;

    // col[7] = paymentMonth like "3月" (draft) or "2026年3月" (confirmed)
    const rawPayMonth = cols[7] ?? "";
    let paymentMonth: string;
    if (rawPayMonth.includes("年")) {
      // Format: 2026年3月 → 2026-03
      const match = rawPayMonth.match(/(\d{4})年(\d{1,2})月/);
      if (match) {
        paymentMonth = `${match[1]}-${match[2]!.padStart(2, "0")}`;
      } else {
        paymentMonth = date.slice(0, 7);
      }
    } else {
      paymentMonth = rakutenPaymentMonth(rawPayMonth) || date.slice(0, 7);
    }

    transactions.push({
      date,
      store,
      amount: Math.abs(amount),
      direction: amount < 0 ? "deposit" : "withdrawal",
      paymentMonth,
      rawRow: line,
    });

    void isConfirmed; // suppress unused var warning
  }

  return transactions;
}

function parseSbiBank(lines: string[]): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];
  let headerSkipped = false;

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = parseCSVRow(line);
    if (cols.length === 0) continue;

    // Skip header row (日付,内容,出金金額(円),...)
    if (!headerSkipped) {
      if (cols[0] === "日付") {
        headerSkipped = true;
        continue;
      }
    }

    // Transaction row: col[0] is date YYYY/MM/DD
    const rawDate = cols[0] ?? "";
    if (!/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(rawDate)) continue;

    const date = normalizeDateSlash(rawDate);
    const store = cols[1] ?? "";
    const withdrawalStr = (cols[2] ?? "").replace(/,/g, "").trim();
    const depositStr = (cols[3] ?? "").replace(/,/g, "").trim();

    const withdrawal = parseSignedInteger(withdrawalStr);
    const deposit = parseSignedInteger(depositStr);

    if (withdrawal != null && withdrawal !== 0) {
      transactions.push({
        date,
        store,
        amount: Math.abs(withdrawal),
        paymentMonth: date.slice(0, 7),
        direction: withdrawal > 0 ? "withdrawal" : "deposit",
        rawRow: line,
      });
    } else if (deposit != null && deposit !== 0) {
      transactions.push({
        date,
        store,
        amount: Math.abs(deposit),
        paymentMonth: date.slice(0, 7),
        direction: deposit > 0 ? "deposit" : "withdrawal",
        rawRow: line,
      });
    }
  }

  return transactions;
}

function isSmbcBankHeader(cols: string[]): boolean {
  return (
    (cols[0] ?? "") === "\u5e74\u6708\u65e5" &&
    (cols[1] ?? "") === "\u304a\u5f15\u51fa\u3057" &&
    (cols[2] ?? "") === "\u304a\u9810\u5165\u308c" &&
    (cols[3] ?? "") === "\u304a\u53d6\u308a\u6271\u3044\u5185\u5bb9"
  );
}

function parseSmbcBank(lines: string[]): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];
  let headerSkipped = false;

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = parseCSVRow(line);
    if (cols.length === 0) continue;

    if (!headerSkipped && isSmbcBankHeader(cols)) {
      headerSkipped = true;
      continue;
    }

    const rawDate = cols[0] ?? "";
    if (!/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(rawDate)) continue;

    const date = normalizeDateSlash(rawDate);
    const withdrawalStr = (cols[1] ?? "").replace(/,/g, "").trim();
    const depositStr = (cols[2] ?? "").replace(/,/g, "").trim();
    const store = cols[3] ?? "";

    const withdrawal = parseSignedInteger(withdrawalStr);
    const deposit = parseSignedInteger(depositStr);

    if (withdrawal != null && withdrawal !== 0) {
      transactions.push({
        date,
        store,
        amount: Math.abs(withdrawal),
        paymentMonth: date.slice(0, 7),
        direction: withdrawal > 0 ? "withdrawal" : "deposit",
        rawRow: line,
      });
    } else if (deposit != null && deposit !== 0) {
      transactions.push({
        date,
        store,
        amount: Math.abs(deposit),
        paymentMonth: date.slice(0, 7),
        direction: deposit > 0 ? "deposit" : "withdrawal",
        rawRow: line,
      });
    }
  }

  return transactions;
}

export async function parseCSVFile(file: File): Promise<ParseResult> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Check UTF-8 BOM (EF BB BF)
  const hasBOM = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;

  if (hasBOM) {
    // Rakuten format (UTF-8 with BOM)
    const text = new TextDecoder("utf-8").decode(buffer);
    const lines = text.replace(/^\ufeff/, "").split(/\r?\n/);
    // Detect confirmed vs draft by presence of "新規サイン" anywhere in file
    const isConfirmed = text.includes("新規サイン") || text.includes("確定");
    const format: CsvFormat = isConfirmed
      ? "rakuten-confirmed"
      : "rakuten-draft";
    const transactions = parseRakuten(lines, isConfirmed);
    return { format, transactions };
  }

  // Try UTF-8 first (without BOM)
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    const lines = text.split(/\r?\n/);
    const firstNonEmpty = lines.find((l) => l.trim().length > 0) ?? "";
    if (firstNonEmpty.includes("利用店名・商品名")) {
      const isConfirmed = text.includes("新規サイン") || text.includes("確定");
      const format: CsvFormat = isConfirmed
        ? "rakuten-confirmed"
        : "rakuten-draft";
      const transactions = parseRakuten(lines, isConfirmed);
      return { format, transactions };
    }
  } catch {
    // Not valid UTF-8
  }

  // Try Shift-JIS (SMBC)
  try {
    const text = new TextDecoder("shift-jis").decode(buffer);
    const lines = text.split(/\r?\n/);
    const firstNonEmpty = lines.find((l) => l.trim().length > 0) ?? "";
    const firstCols = parseCSVRow(firstNonEmpty);
    const firstCol = firstCols[0] ?? "";

    if (isSmbcBankHeader(firstCols)) {
      const transactions = parseSmbcBank(lines);
      return { format: "smbc-bank", transactions };
    }

    if (firstCol === "日付") {
      // SBI bank: header row starts with "日付" column
      const transactions = parseSbiBank(lines);
      return { format: "sbi-bank", transactions };
    }

    if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(firstCol)) {
      // SMBC Draft: first row is a date row
      const transactions = parseSmbcDraft(lines);
      return { format: "smbc-draft", transactions };
    }

    if (/様$/.test(firstCol) || firstCol.includes("様")) {
      // SMBC Confirmed: first row is section header
      const { transactions, cardName } = parseSmbcConfirmed(lines);
      return { format: "smbc-confirmed", transactions, cardName };
    }

    // Check if any row looks like SMBC data
    for (const line of lines) {
      if (!line.trim()) continue;
      const cols = parseCSVRow(line);
      const col0 = cols[0] ?? "";
      if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(col0)) {
        const transactions = parseSmbcDraft(lines);
        return { format: "smbc-draft", transactions };
      }
      if (/様$/.test(col0)) {
        const { transactions, cardName } = parseSmbcConfirmed(lines);
        return { format: "smbc-confirmed", transactions, cardName };
      }
    }
  } catch {
    // Not valid Shift-JIS
  }

  return { format: "unknown", transactions: [] };
}
