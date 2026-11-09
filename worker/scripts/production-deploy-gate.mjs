import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const repositoryDirectory = join(dirname(fileURLToPath(import.meta.url)), "../..");
const execFileAsync = promisify(execFile);

async function runGit(args) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repositoryDirectory,
      encoding: "utf8",
      windowsHide: true,
    });
    return stdout.trim();
  } catch {
    throw new Error("Unable to verify Git release metadata; production deployment was not attempted.");
  }
}

async function readAppVersion() {
  const source = await readFile(join(repositoryDirectory, "frontend/src/lib/version.ts"), "utf8");
  const match = /export const VERSION = (["'])([^"']+)\1;/.exec(source);
  if (!match) throw new Error("Application release version was not found.");
  return match[2];
}

/** Only the current version-bump commit may publish production from Workers Builds. */
export async function checkProductionDeployment({
  args,
  env = process.env,
  git = runGit,
  readVersion = readAppVersion,
}) {
  if (env.WORKERS_CI !== "1" || args[0] !== "deploy" || args.includes("--dry-run")) {
    return { deploy: true };
  }
  if (env.WORKERS_CI_BRANCH !== "main" || !/^[0-9a-f]{40}$/.test(env.WORKERS_CI_COMMIT_SHA ?? "")) {
    throw new Error("Invalid production CI branch or commit metadata; deployment was not attempted.");
  }
  const checkout = (await git(["rev-parse", "HEAD"])).trim();
  if (checkout !== env.WORKERS_CI_COMMIT_SHA) {
    throw new Error("The checkout does not match the CI commit; deployment was not attempted.");
  }
  const version = await readVersion();
  const subject = (await git(["log", "-1", "--format=%s"])).trim();
  if (subject !== `chore: bump version to ${version}`) {
    return { deploy: false, reason: "awaiting-version-commit" };
  }
  const remote = await git(["ls-remote", "--exit-code", "origin", "refs/heads/main"]);
  const remoteHead = /^([0-9a-f]{40})\s+refs\/heads\/main\s*$/m.exec(remote)?.[1];
  if (!remoteHead) throw new Error("The current main revision could not be verified; deployment was not attempted.");
  if (remoteHead !== checkout) {
    return { deploy: false, reason: "outdated-release" };
  }
  return { deploy: true };
}
