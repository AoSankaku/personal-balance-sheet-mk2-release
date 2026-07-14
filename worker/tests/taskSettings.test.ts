import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { taskSettingsRouter } from "../src/routes/taskSettings";

const workerDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const readWorkerFile = (path: string) =>
  readFileSync(join(workerDir, path), "utf8");

describe("task settings persistence", () => {
  test("adds an append-only task_settings migration with safe defaults", () => {
    const migration = readWorkerFile("drizzle/0008_task_settings.sql");

    expect(migration).toContain("CREATE TABLE `task_settings`");
    expect(migration).toContain("`trial_balance_enabled` INTEGER NOT NULL DEFAULT 0");
    expect(migration).toContain("`trial_balance_day` INTEGER NOT NULL DEFAULT 1");
    expect(migration).toContain("`loan_overdue_days` INTEGER NOT NULL DEFAULT 30");
  });

  test("registers a dedicated validated task settings API", () => {
    const route = readWorkerFile("src/routes/taskSettings.ts");
    const index = readWorkerFile("src/index.ts");

    expect(route).toContain('router.get("/"');
    expect(route).toContain('router.patch("/"');
    expect(route).toContain("trial_balance_day must be an integer from 1 to 31");
    expect(route).toContain("loan_overdue_days must be an integer from 1 to 3650");
    expect(index).toContain('app.route("/api/task-settings", taskSettingsRouter)');
  });

  test("includes task settings in local-to-remote database synchronization", () => {
    const syncScript = readWorkerFile("scripts/sync-local-d1-to-remote.mjs");

    expect(syncScript).toContain('"task_settings"');
  });

  test("rejects invalid task settings before accessing the database", async () => {
    const env = { DB: {} as D1Database };
    for (const body of [
      { payday_enabled: "yes" },
      { trial_balance_day: 0 },
      { trial_balance_day: 32 },
      { loan_overdue_days: 0 },
      { loan_overdue_days: 3651 },
      null,
    ]) {
      const response = await taskSettingsRouter.request(
        "/",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
        env,
      );
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
  });
});
