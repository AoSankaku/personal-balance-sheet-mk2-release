import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { prepareWranglerConfig } from "./prepare-wrangler-config.mjs";

const LOCAL_DATABASE_ID = "00000000-0000-0000-0000-000000000000";
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workerDirectory = dirname(scriptDirectory);
const templatePath = join(workerDirectory, "wrangler.deploy.toml.template");
const outputPath = join(workerDirectory, ".wrangler.fullstack.toml");

try {
  await prepareWranglerConfig({
    databaseId: LOCAL_DATABASE_ID,
    templatePath,
    outputPath,
  });

  const child = Bun.spawn(
    [
      process.execPath,
      "x",
      "wrangler",
      "dev",
      "--ip",
      "0.0.0.0",
      "--config",
      outputPath,
    ],
    {
      cwd: workerDirectory,
      env: process.env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  process.exitCode = await child.exited;
} finally {
  await rm(outputPath, { force: true });
}
