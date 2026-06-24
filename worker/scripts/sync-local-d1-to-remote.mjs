import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DATABASE_NAME = "balance-sheet-db";

export const IMPORT_TABLE_ORDER = [
  "enabled_currencies",
  "accounts",
  "budget_categories",
  "budget_filters",
  "actual_balance_snapshots",
  "journal_entries",
  "credit_card_settings",
  "crypto_wallets",
  "exchange_credentials",
  "actual_balance_credit_card_state",
  "store_account_mappings",
  "account_completions",
  "budget_allocations",
  "budget_category_accounts",
  "budget_category_account_targets",
  "budget_settings",
  "budget_adjustment_logs",
  "budget_filter_steps",
  "budget_filter_step_allocations",
  "journal_lines",
  "journal_entry_budget_allocations",
  "depreciation_schedules",
  "depreciation_entries",
  "loan_settlements",
  "long_term_loan_plans",
  "long_term_loan_plan_rows",
  "actual_balance_entries",
];

const SYSTEM_TABLES = new Set([
  "_cf_metadata",
  "d1_migrations",
  "sqlite_sequence",
]);
const APPLICATION_TABLES = new Set(IMPORT_TABLE_ORDER);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workerDirectory = dirname(scriptDirectory);

export function parseOptions(args) {
  const options = {
    yes: false,
    dryRun: false,
    skipBackup: false,
    verifyOnly: false,
  };

  const flags = new Map([
    ["--yes", "yes"],
    ["--dry-run", "dryRun"],
    ["--skip-backup", "skipBackup"],
    ["--verify-only", "verifyOnly"],
  ]);

  for (const argument of args) {
    const option = flags.get(argument);
    if (!option) {
      throw new Error(`Unknown option: ${argument}`);
    }
    options[option] = true;
  }

  if (options.dryRun && options.verifyOnly) {
    throw new Error("--dry-run and --verify-only cannot be used together.");
  }

  return options;
}

export function splitSqlStatements(sql) {
  const statements = [];
  let start = 0;
  let quote = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];

    if (inLineComment) {
      if (character === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (character === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === quote) {
        if (
          (quote === "'" || quote === '"') &&
          next === quote
        ) {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (character === "-" && next === "-") {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === ";") {
      const statement = sql.slice(start, index + 1).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }

  const remainder = sql.slice(start).trim();
  if (remainder) statements.push(remainder);
  return statements;
}

function stripLeadingComments(statement) {
  return statement
    .replace(/^\s*(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/u, "")
    .trim();
}

function getInsertedTable(statement) {
  const normalized = stripLeadingComments(statement);
  const match = normalized.match(
    /^INSERT\s+INTO\s+(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_$]*))/iu,
  );
  return match ? match.slice(1).find(Boolean) ?? null : null;
}

export function buildTableImports(sql) {
  const grouped = new Map();
  const unknownTables = new Set();

  for (const statement of splitSqlStatements(sql)) {
    const table = getInsertedTable(statement);
    if (!table) continue;

    const normalizedTable = table.toLowerCase();
    if (
      SYSTEM_TABLES.has(normalizedTable) ||
      normalizedTable.startsWith("sqlite_")
    ) {
      continue;
    }
    if (!APPLICATION_TABLES.has(normalizedTable)) {
      unknownTables.add(table);
      continue;
    }

    const statements = grouped.get(normalizedTable) ?? [];
    statements.push(stripLeadingComments(statement));
    grouped.set(normalizedTable, statements);
  }

  if (unknownTables.size > 0) {
    throw new Error(
      `Local export contains unsupported tables: ${[...unknownTables].join(", ")}. Update IMPORT_TABLE_ORDER before syncing.`,
    );
  }

  return new Map(
    IMPORT_TABLE_ORDER.filter((table) => grouped.has(table)).map((table) => [
      table,
      `PRAGMA defer_foreign_keys = true;\n${grouped.get(table).join("\n")}\n`,
    ]),
  );
}

export function buildDeleteSql() {
  return [
    "PRAGMA defer_foreign_keys = true;",
    ...[...IMPORT_TABLE_ORDER]
      .reverse()
      .map((table) => `DELETE FROM "${table}";`),
    "",
  ].join("\n");
}

export function parseDatabaseList(output) {
  const parsed = parseJsonOutput(output);
  if (!Array.isArray(parsed)) {
    throw new Error("Unexpected output from `wrangler d1 list --json`.");
  }

  return new Map(
    parsed.flatMap((database) => {
      const id = database?.uuid ?? database?.id;
      return typeof database?.name === "string" && typeof id === "string"
        ? [[database.name, id]]
        : [];
    }),
  );
}

function getResultRows(output) {
  const parsed = parseJsonOutput(output);
  const resultSets = Array.isArray(parsed) ? parsed : [parsed];
  return resultSets.flatMap((result) =>
    Array.isArray(result?.results) ? result.results : [],
  );
}

export function parseCountResults(output) {
  return new Map(
    getResultRows(output).map((row) => {
      const tableName = String(row.table_name);
      const rowCount = Number(row.row_count);
      if (!Number.isSafeInteger(rowCount) || rowCount < 0) {
        throw new Error(`Invalid row count returned for ${tableName}.`);
      }
      return [tableName, rowCount];
    }),
  );
}

function parseJsonOutput(output) {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const arrayStart = trimmed.indexOf("[");
    const objectStart = trimmed.indexOf("{");
    const starts = [arrayStart, objectStart].filter((index) => index >= 0);
    if (starts.length === 0) throw new Error("Wrangler returned no JSON.");
    return JSON.parse(trimmed.slice(Math.min(...starts)));
  }
}

function buildCountQuery() {
  return `${IMPORT_TABLE_ORDER.map(
    (table) =>
      `SELECT '${table}' AS table_name, COUNT(*) AS row_count FROM "${table}"`,
  ).join("\nUNION ALL\n")};`;
}

function formatTimestamp(date = new Date()) {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/u, "")
    .replace(/[-:T]/gu, "");
}

async function runCommand(command, args, { env, capture = false } = {}) {
  const child = Bun.spawn([command, ...args], {
    cwd: workerDirectory,
    env: env ?? process.env,
    stdin: "inherit",
    stdout: capture ? "pipe" : "inherit",
    stderr: capture ? "pipe" : "inherit",
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    capture ? new Response(child.stdout).text() : Promise.resolve(""),
    capture ? new Response(child.stderr).text() : Promise.resolve(""),
  ]);

  if (exitCode !== 0) {
    if (capture && stderr) process.stderr.write(stderr);
    throw new Error(
      `Command failed (${exitCode}): ${[command, ...args].join(" ")}`,
    );
  }
  return stdout;
}

async function runWrangler(args, options) {
  return runCommand(process.execPath, ["x", "wrangler", ...args], options);
}

async function runRemoteWrangler(databaseId, args, options) {
  return runCommand(
    process.execPath,
    ["run", "wrangler:remote", ...args],
    {
      ...options,
      env: {
        ...process.env,
        ...options?.env,
        D1_DATABASE_ID: databaseId,
      },
    },
  );
}

async function findOrCreateRemoteDatabase({ allowCreate }) {
  const listDatabases = async () =>
    parseDatabaseList(
      await runWrangler(["d1", "list", "--json"], { capture: true }),
    );

  let databaseId = (await listDatabases()).get(DATABASE_NAME);
  if (databaseId) {
    console.log(`Remote D1 found: ${DATABASE_NAME}`);
    return databaseId;
  }
  if (!allowCreate) {
    throw new Error(`Remote D1 does not exist: ${DATABASE_NAME}`);
  }

  console.log(`Remote D1 not found. Creating ${DATABASE_NAME}...`);
  await runWrangler(["d1", "create", DATABASE_NAME]);
  databaseId = (await listDatabases()).get(DATABASE_NAME);
  if (!databaseId) {
    throw new Error(
      `Created ${DATABASE_NAME}, but could not resolve its database ID.`,
    );
  }
  return databaseId;
}

async function confirmSync(options) {
  if (options.yes || options.dryRun || options.verifyOnly) return;
  if (!process.stdin.isTTY) {
    throw new Error(
      "Remote data replacement requires confirmation. Re-run with --yes in a non-interactive environment.",
    );
  }

  const { createInterface } = await import("node:readline/promises");
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await readline.question(
      `Replace all application data in remote D1 "${DATABASE_NAME}"? Type "yes" to continue: `,
    );
    if (answer.trim().toLowerCase() !== "yes") {
      throw new Error("Sync cancelled.");
    }
  } finally {
    readline.close();
  }
}

async function fetchCounts({ databaseId, remote }) {
  const args = [
    "d1",
    "execute",
    DATABASE_NAME,
    remote ? "--remote" : "--local",
    "--command",
    buildCountQuery(),
    "--json",
  ];
  const output = remote
    ? await runRemoteWrangler(databaseId, args, { capture: true })
    : await runWrangler(args, { capture: true });
  return parseCountResults(output);
}

async function verifyDatabases(databaseId) {
  console.log("Verifying table row counts...");
  const [localCounts, remoteCounts] = await Promise.all([
    fetchCounts({ databaseId, remote: false }),
    fetchCounts({ databaseId, remote: true }),
  ]);

  const mismatches = IMPORT_TABLE_ORDER.flatMap((table) => {
    const local = localCounts.get(table);
    const remote = remoteCounts.get(table);
    return local === remote ? [] : [`${table}: local=${local}, remote=${remote}`];
  });
  if (mismatches.length > 0) {
    throw new Error(`Row count verification failed:\n${mismatches.join("\n")}`);
  }

  console.log("Checking remote foreign keys...");
  const foreignKeyOutput = await runRemoteWrangler(
    databaseId,
    [
      "d1",
      "execute",
      DATABASE_NAME,
      "--remote",
      "--command",
      "PRAGMA foreign_key_check;",
      "--json",
    ],
    { capture: true },
  );
  const violations = getResultRows(foreignKeyOutput);
  if (violations.length > 0) {
    throw new Error(
      `Foreign key verification failed:\n${JSON.stringify(violations, null, 2)}`,
    );
  }

  console.log("Verification passed: counts match and no foreign key violations.");
}

export async function syncLocalD1ToRemote(options) {
  await confirmSync(options);

  if (options.dryRun) {
    const databases = parseDatabaseList(
      await runWrangler(["d1", "list", "--json"], { capture: true }),
    );
    console.log(
      databases.has(DATABASE_NAME)
        ? `Dry run: ${DATABASE_NAME} exists.`
        : `Dry run: ${DATABASE_NAME} would be created.`,
    );
    console.log(
      "Dry run: would apply migrations, back up remote data, export local data, replace tables in dependency order, and verify counts/foreign keys.",
    );
    return;
  }

  const databaseId = await findOrCreateRemoteDatabase({
    allowCreate: !options.verifyOnly,
  });

  if (options.verifyOnly) {
    await verifyDatabases(databaseId);
    return;
  }

  console.log("Applying remote D1 migrations...");
  await runRemoteWrangler(
    databaseId,
    [
      "d1",
      "migrations",
      "apply",
      DATABASE_NAME,
      "--remote",
    ],
    { env: { CI: "true" } },
  );

  const syncDirectory = join(
    workerDirectory,
    ".tmp",
    "d1-sync",
    formatTimestamp(),
  );
  const importDirectory = join(syncDirectory, "table-imports");
  await mkdir(importDirectory, { recursive: true });

  if (!options.skipBackup) {
    const backupPath = join(syncDirectory, "remote-before-sync.sql");
    console.log(`Backing up remote D1 to ${backupPath}...`);
    await runRemoteWrangler(databaseId, [
      "d1",
      "export",
      DATABASE_NAME,
      "--remote",
      "--skip-confirmation",
      "--output",
      backupPath,
    ]);
  } else {
    console.warn("Skipping remote backup because --skip-backup was supplied.");
  }

  const localExportPath = join(syncDirectory, "local-data.sql");
  console.log("Exporting local D1 data...");
  await runWrangler([
    "d1",
    "export",
    DATABASE_NAME,
    "--local",
    "--no-schema",
    "--output",
    localExportPath,
  ]);

  const localSql = await readFile(localExportPath, "utf8");
  const tableImports = buildTableImports(localSql);
  const importFiles = [];
  for (const [table, sql] of tableImports) {
    const index = String(IMPORT_TABLE_ORDER.indexOf(table)).padStart(3, "0");
    const path = join(importDirectory, `${index}-${table}.sql`);
    await writeFile(path, sql, "utf8");
    importFiles.push({ table, path });
  }

  const deletePath = join(syncDirectory, "delete-remote-data.sql");
  await writeFile(deletePath, buildDeleteSql(), "utf8");

  console.log("Deleting existing remote application data...");
  await runRemoteWrangler(databaseId, [
    "d1",
    "execute",
    DATABASE_NAME,
    "--remote",
    "--file",
    deletePath,
    "--yes",
  ]);

  for (const { table, path } of importFiles) {
    console.log(`Importing ${table}...`);
    try {
      await runRemoteWrangler(databaseId, [
        "d1",
        "execute",
        DATABASE_NAME,
        "--remote",
        "--file",
        path,
        "--yes",
      ]);
    } catch (error) {
      throw new Error(`Import failed for table "${table}".`, {
        cause: error,
      });
    }
  }

  await verifyDatabases(databaseId);
  console.log(`D1 sync completed successfully. Artifacts: ${syncDirectory}`);
}

if (import.meta.main) {
  try {
    await syncLocalD1ToRemote(parseOptions(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    if (error instanceof Error && error.cause) {
      console.error(error.cause);
    }
    process.exitCode = 1;
  }
}
