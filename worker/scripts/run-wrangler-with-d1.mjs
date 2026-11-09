import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { prepareWranglerConfig } from "./prepare-wrangler-config.mjs";
import { checkProductionDeployment } from "./production-deploy-gate.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workerDirectory = dirname(scriptDirectory);
const templatePath = join(workerDirectory, "wrangler.deploy.toml.template");
const outputPath = join(workerDirectory, ".wrangler.deploy.toml");
const wranglerArguments = process.argv.slice(2);

if (wranglerArguments.length === 0) {
  throw new Error("A Wrangler command is required.");
}

const deploymentDecision = await checkProductionDeployment({ args: wranglerArguments });
if (!deploymentDecision.deploy) {
  process.stdout.write(`Skipping production deployment: ${deploymentDecision.reason}.\n`);
  process.exit(0);
}

try {
  await prepareWranglerConfig({
    databaseId: process.env.D1_DATABASE_ID,
    templatePath,
    outputPath,
  });

  const child = Bun.spawn(
    [
      process.execPath,
      "x",
      "wrangler",
      ...wranglerArguments,
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

  const exitCode = await child.exited;
  process.exitCode = exitCode;
} finally {
  await rm(outputPath, { force: true });
}
