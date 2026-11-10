import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const worker = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), "balance-sheet-db-reads-"));
if (!resolve(temporary).startsWith(resolve(tmpdir(), "balance-sheet-db-reads-"))) {
  throw new Error("Unexpected temporary directory for DB read tests");
}
try {
  const configPath = join(temporary, "wrangler.toml");
  writeFileSync(configPath, `name = "balance-sheet-db-read-tests"
compatibility_date = "2026-06-25"
[[d1_databases]]
binding = "DB"
database_name = "synthetic-read-tests"
database_id = "00000000-0000-0000-0000-000000000000"
`);
  const modulePath = join(temporary, "routes.mjs");
  const build = spawnSync("bun", ["build", "tests/helpers/dbReadRoutes.ts", "--target=node", `--outfile=${modulePath}`], {
    cwd: worker, encoding: "utf8", windowsHide: true,
  });
  if (build.status !== 0) throw new Error(build.error?.message ?? build.stderr ?? "DB read fixture build failed");
  const result = spawnSync(process.execPath, ["--test", "tests/dbReads.integration.mjs"], {
    cwd: worker, stdio: "inherit", windowsHide: true,
    env: { ...process.env, DB_READ_ROUTES_MODULE: modulePath, DB_READ_CONFIG: configPath,
      WRANGLER_LOG_PATH: join(temporary, "logs"), WRANGLER_SEND_METRICS: "false" },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  // Only this newly created disposable directory is removed.
  rmSync(temporary, { recursive: true, force: true });
}
