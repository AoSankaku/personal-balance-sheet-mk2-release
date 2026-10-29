import type { ExpenseTag, TagExpenseAmount } from "@balance-sheet/shared";
import { calculateExpenseTagAmounts } from "../../../shared/expenseTags";
import type { MoneyScaleOptions } from "./moneyValidation";
import { findInvalidMoney, fromStorageMoneyAmount, toStorageMoneyAmount } from "./moneyValidation";

const MAX_TAGS = 20;
const MAX_TAG_NAME_LENGTH = 80;
const MAX_AMOUNT_CURRENCY_LENGTH = 20;

export type ExpenseTagMetadata = {
  expense_tags: ExpenseTag[];
  tag_expense_mode: "auto" | "manual";
  tag_expense_amounts: TagExpenseAmount[];
};

export type ExpenseTagInputResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function parseExpenseTagNames(value: unknown): ExpenseTagInputResult<string[]> {
  if (!Array.isArray(value)) return { ok: false, error: "expense_tags must be an array" };
  if (value.some((name) => typeof name !== "string")) {
    return { ok: false, error: "expense_tags must contain strings" };
  }
  const names = [...new Set((value as string[]).map((name) => name.trim()))];
  if (names.some((name) => name.length === 0)) {
    return { ok: false, error: "expense_tags must not contain empty names" };
  }
  if (names.some((name) => Array.from(name).length > MAX_TAG_NAME_LENGTH)) {
    return { ok: false, error: `expense tag names must be ${MAX_TAG_NAME_LENGTH} characters or fewer` };
  }
  if (names.length > MAX_TAGS) {
    return { ok: false, error: `expense_tags may contain at most ${MAX_TAGS} distinct tags` };
  }
  return { ok: true, value: names };
}

export function parseTagExpenseAmounts(
  value: unknown,
  currenciesOnLines: readonly string[],
  decimalPlacesByCurrency: Record<string, number>,
): ExpenseTagInputResult<TagExpenseAmount[]> {
  if (!Array.isArray(value)) return { ok: false, error: "tag_expense_amounts must be an array" };
  if (value.length === 0) return { ok: false, error: "manual tag amounts must not be empty" };
  if (value.length > MAX_TAGS) return { ok: false, error: `tag_expense_amounts may contain at most ${MAX_TAGS} currencies` };

  const representedCurrencies = new Set(currenciesOnLines.map((currency) => currency.toUpperCase()));
  const amounts: TagExpenseAmount[] = [];
  const usedCurrencies = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const row = value[index] as { currency?: unknown; amount?: unknown } | null;
    if (!row || typeof row !== "object" || typeof row.currency !== "string") {
      return { ok: false, error: `tag_expense_amounts[${index}] must include a currency and amount` };
    }
    const currency = row.currency.trim().toUpperCase();
    if (currency.length === 0 || currency.length > MAX_AMOUNT_CURRENCY_LENGTH || !/^[A-Z0-9]+$/.test(currency)) {
      return { ok: false, error: `tag_expense_amounts[${index}].currency is invalid` };
    }
    if (!representedCurrencies.has(currency)) {
      return { ok: false, error: `tag_expense_amounts[${index}].currency must be represented by a journal line` };
    }
    if (usedCurrencies.has(currency)) {
      return { ok: false, error: `tag_expense_amounts contains duplicate currency ${currency}` };
    }
    const invalid = findInvalidMoney([{
      path: `tag_expense_amounts[${index}].amount`,
      value: row.amount,
      currency,
      decimalPlaces: decimalPlacesByCurrency[currency],
    }]);
    if (invalid) return { ok: false, error: invalid.path };
    amounts.push({ currency, amount: row.amount as number });
    usedCurrencies.add(currency);
  }
  return { ok: true, value: amounts.sort((left, right) => left.currency.localeCompare(right.currency)) };
}

/** SQL statements appended to the same guarded batch as a new journal entry. */
export function buildNewExpenseTagStatements(
  DB: D1Database,
  names: string[],
  mode: "auto" | "manual",
  amounts: TagExpenseAmount[],
  scaleOptions: MoneyScaleOptions,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  const entryIdSql = "(SELECT MAX(id) FROM journal_entries)";
  for (const name of names) {
    statements.push(DB.prepare("INSERT INTO expense_tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING").bind(name));
    statements.push(DB.prepare(
      `INSERT INTO journal_entry_expense_tags (journal_entry_id, tag_id)
       SELECT ${entryIdSql}, id FROM expense_tags WHERE name = ?`,
    ).bind(name));
  }
  if (mode === "manual") {
    for (const amount of amounts) {
      statements.push(DB.prepare(
        `INSERT INTO journal_entry_tag_amounts (journal_entry_id, currency, amount)
         VALUES (${entryIdSql}, ?, ?)`,
      ).bind(amount.currency, toStorageMoneyAmount(amount.amount, amount.currency, scaleOptions)));
    }
  }
  return statements;
}

/** SQL statements replacing metadata on an existing entry. Omission is handled by the caller. */
export function buildExpenseTagUpdateStatements(
  DB: D1Database,
  entryId: number,
  names: string[] | undefined,
  mode: "auto" | "manual" | undefined,
  amounts: TagExpenseAmount[] | undefined,
  scaleOptions: MoneyScaleOptions,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  const updateNames = names !== undefined;
  const clearAmounts = names?.length === 0 || mode === "auto" || amounts !== undefined;
  if (updateNames) {
    statements.push(DB.prepare("DELETE FROM journal_entry_expense_tags WHERE journal_entry_id = ?").bind(entryId));
    for (const name of names) {
      statements.push(DB.prepare("INSERT INTO expense_tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING").bind(name));
      statements.push(DB.prepare(
        `INSERT INTO journal_entry_expense_tags (journal_entry_id, tag_id)
         SELECT ?, id FROM expense_tags WHERE name = ?`,
      ).bind(entryId, name));
    }
  }
  if (clearAmounts) {
    statements.push(DB.prepare("DELETE FROM journal_entry_tag_amounts WHERE journal_entry_id = ?").bind(entryId));
  }
  if (mode === "manual" && amounts) {
    for (const amount of amounts) {
      statements.push(DB.prepare(
        `INSERT INTO journal_entry_tag_amounts (journal_entry_id, currency, amount)
         VALUES (?, ?, ?)`,
      ).bind(entryId, amount.currency, toStorageMoneyAmount(amount.amount, amount.currency, scaleOptions)));
    }
  }
  return statements;
}

type RawTag = { journal_entry_id: number; id: number; name: string };
type RawAmount = { journal_entry_id: number; currency: string; amount: number };
type RawLine = {
  journal_entry_id: number;
  account_id: number;
  account_type: "asset" | "liability" | "equity" | "income" | "expense";
  debit: number;
  credit: number;
  currency: string;
};
function chunkIds(ids: number[], size = 5000): number[][] {
  const chunks: number[][] = [];
  for (let index = 0; index < ids.length; index += size) chunks.push(ids.slice(index, index + size));
  return chunks;
}

/** Loads assigned tags and manual overrides; auto totals are always derived from current expense lines. */
export async function loadExpenseTagMetadata(
  DB: D1Database,
  entryIds: number[],
  decimalPlacesByCurrency: Record<string, number>,
): Promise<Map<number, ExpenseTagMetadata>> {
  const uniqueIds = [...new Set(entryIds)];
  const metadata = new Map<number, ExpenseTagMetadata>(uniqueIds.map((id) => [id, {
    expense_tags: [], tag_expense_mode: "auto", tag_expense_amounts: [],
  }]));
  if (uniqueIds.length === 0) return metadata;

  const tags: RawTag[] = [];
  const amounts: RawAmount[] = [];
  const lines: RawLine[] = [];
  for (const chunk of chunkIds(uniqueIds)) {
    const serializedIds = JSON.stringify(chunk);
    const [tagRows, amountRows, lineRows] = await Promise.all([
      DB.prepare(`SELECT jet.journal_entry_id, t.id, t.name
        FROM json_each(?) requested
        JOIN journal_entry_expense_tags jet ON jet.journal_entry_id=requested.value
        JOIN expense_tags t ON t.id=jet.tag_id
        ORDER BY t.name COLLATE NOCASE, t.name`)
        .bind(serializedIds).all<RawTag>(),
      DB.prepare(`SELECT amounts.journal_entry_id, amounts.currency, amounts.amount
        FROM json_each(?) requested
        JOIN journal_entry_tag_amounts amounts ON amounts.journal_entry_id=requested.value
        ORDER BY amounts.currency`)
        .bind(serializedIds).all<RawAmount>(),
      DB.prepare(`SELECT jl.journal_entry_id, jl.account_id, a.type AS account_type,
          jl.debit, jl.credit, jl.currency
          FROM json_each(?) requested
          JOIN journal_lines jl ON jl.journal_entry_id=requested.value
          JOIN accounts a ON a.id=jl.account_id`)
        .bind(serializedIds).all<RawLine>(),
    ]);
    tags.push(...(tagRows.results ?? []));
    amounts.push(...(amountRows.results ?? []));
    lines.push(...(lineRows.results ?? []));
  }

  for (const row of tags) metadata.get(row.journal_entry_id)?.expense_tags.push({ id: row.id, name: row.name });
  const manualByEntry = new Map<number, TagExpenseAmount[]>();
  for (const row of amounts) {
    const entryAmounts = manualByEntry.get(row.journal_entry_id) ?? [];
    const currency = row.currency.toUpperCase();
    entryAmounts.push({
      currency,
      amount: fromStorageMoneyAmount(row.amount, currency, { decimalPlacesByCurrency }),
    });
    manualByEntry.set(row.journal_entry_id, entryAmounts);
  }
  const linesByEntry = new Map<number, RawLine[]>();
  for (const line of lines) {
    const grouped = linesByEntry.get(line.journal_entry_id) ?? [];
    grouped.push(line);
    linesByEntry.set(line.journal_entry_id, grouped);
  }

  for (const id of uniqueIds) {
    const record = metadata.get(id)!;
    const manualAmounts = manualByEntry.get(id);
    if (manualAmounts?.length) {
      record.tag_expense_mode = "manual";
      record.tag_expense_amounts = manualAmounts;
    } else {
      const entryLines = linesByEntry.get(id) ?? [];
      const scaleOptions = { decimalPlacesByCurrency };
      record.tag_expense_amounts = calculateExpenseTagAmounts(
        entryLines.map((line) => ({
          account_id: line.account_id,
          debit: fromStorageMoneyAmount(line.debit, line.currency, scaleOptions),
          credit: fromStorageMoneyAmount(line.credit, line.currency, scaleOptions),
          currency: line.currency,
        })),
        [...new Map(entryLines.map((line) => [line.account_id, { id: line.account_id, type: line.account_type }])).values()],
      );
    }
  }
  return metadata;
}
