import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { prepareWranglerConfig } from "../scripts/prepare-wrangler-config.mjs";

const VALID_DATABASE_ID = "12345678-1234-4abc-8def-1234567890ab";
const TEMPLATE = `name = "test-worker"

[[d1_databases]]
binding = "DB"
database_name = "test-db"
database_id = "__D1_DATABASE_ID__"
`;

async function withTempDir(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "wrangler-config-test-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("prepareWranglerConfig", () => {
  test("requires D1_DATABASE_ID", async () => {
    await withTempDir(async (directory) => {
      const templatePath = join(directory, "wrangler.deploy.toml.template");
      const outputPath = join(directory, ".wrangler", "wrangler.deploy.toml");
      await writeFile(templatePath, TEMPLATE, "utf8");

      await expect(
        prepareWranglerConfig({
          databaseId: undefined,
          templatePath,
          outputPath,
        }),
      ).rejects.toThrow("D1_DATABASE_ID");
    });
  });

  test("rejects malformed D1 database IDs", async () => {
    await withTempDir(async (directory) => {
      const templatePath = join(directory, "wrangler.deploy.toml.template");
      const outputPath = join(directory, ".wrangler", "wrangler.deploy.toml");
      await writeFile(templatePath, TEMPLATE, "utf8");

      await expect(
        prepareWranglerConfig({
          databaseId: "not-a-d1-id",
          templatePath,
          outputPath,
        }),
      ).rejects.toThrow("valid D1 database UUID");
    });
  });

  test("writes an ignored deployment config without modifying the template", async () => {
    await withTempDir(async (directory) => {
      const templatePath = join(directory, "wrangler.deploy.toml.template");
      const outputPath = join(directory, ".wrangler", "wrangler.deploy.toml");
      await writeFile(templatePath, TEMPLATE, "utf8");

      await prepareWranglerConfig({
        databaseId: VALID_DATABASE_ID,
        templatePath,
        outputPath,
      });

      expect(await readFile(outputPath, "utf8")).toContain(
        `database_id = "${VALID_DATABASE_ID}"`,
      );
      expect(await readFile(templatePath, "utf8")).toBe(TEMPLATE);
    });
  });
});
