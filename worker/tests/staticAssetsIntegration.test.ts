import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import app from "../src/index";

const repositoryRoot = join(import.meta.dir, "..", "..");

describe("Static Assets integration", () => {
  test("serves health information from /api/health", async () => {
    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "balance-sheet-worker",
    });
  });

  test("does not reserve / for the Worker health endpoint", async () => {
    const response = await app.request("/");

    expect(response.status).toBe(404);
  });

  test("configures deployment assets without changing API-only local development", async () => {
    const deploymentTemplate = await readFile(
      join(repositoryRoot, "worker", "wrangler.deploy.toml.template"),
      "utf8",
    );
    const developmentConfig = await readFile(
      join(repositoryRoot, "worker", "wrangler.toml"),
      "utf8",
    );

    expect(deploymentTemplate).toContain(
      '[assets]\ndirectory = "../frontend/dist"',
    );
    expect(deploymentTemplate).toContain(
      'not_found_handling = "single-page-application"',
    );
    expect(deploymentTemplate).toContain('run_worker_first = ["/api/*"]');
    expect(developmentConfig).not.toContain("[assets]");
  });

  test("provides a root full-stack development command", async () => {
    const rootPackage = JSON.parse(
      await readFile(join(repositoryRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(rootPackage.scripts["dev:fullstack"]).toBe(
      "bun run build:frontend && bun run --cwd worker dev:fullstack",
    );
  });
});
