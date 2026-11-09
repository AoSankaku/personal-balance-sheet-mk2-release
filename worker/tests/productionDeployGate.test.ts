import { describe, expect, test } from "bun:test";
import { checkProductionDeployment } from "../scripts/production-deploy-gate.mjs";
import { VERSION } from "../../frontend/src/lib/version";
import { join } from "node:path";

const release = "a".repeat(40);
const newer = "b".repeat(40);
const ci = { WORKERS_CI: "1", WORKERS_CI_BRANCH: "main", WORKERS_CI_COMMIT_SHA: release };

function fixture(subject = "chore: bump version to 2026.11.0-beta4", remoteHead = release) {
  const calls: string[][] = [];
  return {
    calls,
    readVersion: async () => "2026.11.0-beta4",
    git: async (args: string[]) => {
      calls.push(args);
      if (args[0] === "rev-parse") return release;
      if (args[0] === "log") return subject;
      if (args[0] === "ls-remote") return `${remoteHead}\trefs/heads/main\n`;
      throw new Error("unexpected Git operation");
    },
  };
}

describe("production CI deployment gate", () => {
  test.each([
    { args: ["deploy"], env: {} },
    { args: ["deploy", "--dry-run"], env: ci },
    { args: ["versions", "upload"], env: ci },
    { args: ["d1", "migrations", "apply", "db", "--remote"], env: ci },
    { args: ["deployments", "status"], env: ci },
  ])("leaves manual, dry-run, preview, and D1 commands unchanged: %j", async ({ args, env }) => {
    const f = fixture();
    expect(await checkProductionDeployment({ args, env, ...f })).toEqual({ deploy: true });
    expect(f.calls).toEqual([]);
  });

  test("skips the intermediate merge build even when it finishes last", async () => {
    const f = fixture("Merge branch 'dev'", newer);
    expect(await checkProductionDeployment({ args: ["deploy"], env: ci, ...f })).toMatchObject({ deploy: false, reason: "awaiting-version-commit" });
    expect(f.calls.some((args) => args[0] === "ls-remote")).toBe(false);
  });

  test("allows the current version-update release commit", async () => {
    const f = fixture();
    expect(await checkProductionDeployment({ args: ["deploy", "--keep-vars"], env: ci, ...f })).toEqual({ deploy: true });
    expect(f.calls.at(-1)).toEqual(["ls-remote", "--exit-code", "origin", "refs/heads/main"]);
  });

  test("reads the actual application version when checking the release marker", async () => {
    const f = fixture(`chore: bump version to ${VERSION}`);
    expect(await checkProductionDeployment({ args: ["deploy"], env: ci, git: f.git })).toEqual({ deploy: true });
  });

  test("skips an old release retry once main has advanced", async () => {
    const f = fixture(undefined, newer);
    expect(await checkProductionDeployment({ args: ["deploy"], env: ci, ...f })).toMatchObject({ deploy: false, reason: "outdated-release" });
  });

  test.each([
    { ...ci, WORKERS_CI_COMMIT_SHA: "" },
    { ...ci, WORKERS_CI_COMMIT_SHA: "not-a-sha" },
    { ...ci, WORKERS_CI_BRANCH: "" },
    { ...ci, WORKERS_CI_BRANCH: "dev" },
  ])("refuses invalid production CI metadata: %j", async (env) => {
    await expect(checkProductionDeployment({ args: ["deploy"], env, ...fixture() })).rejects.toThrow();
  });

  test("refuses a checkout that differs from the CI commit", async () => {
    await expect(checkProductionDeployment({ args: ["deploy"], env: { ...ci, WORKERS_CI_COMMIT_SHA: newer }, ...fixture() })).rejects.toThrow("checkout");
  });

  test("uses the real Git checkout to reject an unrelated CI revision", async () => {
    await expect(checkProductionDeployment({ args: ["deploy"], env: { ...ci, WORKERS_CI_COMMIT_SHA: "0".repeat(40) } })).rejects.toThrow("checkout");
  });

  test("fails closed when the current remote revision cannot be verified", async () => {
    const f = fixture();
    const git = f.git;
    f.git = async (args) => {
      if (args[0] === "ls-remote") throw new Error("network unavailable");
      return git(args);
    };
    await expect(checkProductionDeployment({ args: ["deploy"], env: ci, ...f })).rejects.toThrow();
  });

  test("refuses an invalid remote head response", async () => {
    const f = fixture();
    const git = f.git;
    f.git = async (args) => args[0] === "ls-remote" ? "" : git(args);
    await expect(checkProductionDeployment({ args: ["deploy"], env: ci, ...f })).rejects.toThrow();
  });

  test("the real wrapper checks the CI checkout before reading D1 credentials", async () => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../scripts/run-wrangler-with-d1.mjs"), "deploy"], {
      env: { ...process.env, ...ci, WORKERS_CI_COMMIT_SHA: "0".repeat(40), D1_DATABASE_ID: "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("checkout does not match");
    expect(stderr).not.toContain("D1_DATABASE_ID is required");
  });

  test("the real wrapper fails closed when Git cannot run", async () => {
    const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"));
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../scripts/run-wrangler-with-d1.mjs"), "deploy"], {
      env: { ...environment, ...ci, PATH: "", D1_DATABASE_ID: "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("Unable to verify Git release metadata");
    expect(stderr).not.toContain("D1_DATABASE_ID is required");
  });
});
