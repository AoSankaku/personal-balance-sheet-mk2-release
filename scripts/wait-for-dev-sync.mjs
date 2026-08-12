import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 15 * 60_000;

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function git(args) {
  const { stdout } = await execFileAsync("git", args, {
    encoding: "utf8",
    windowsHide: true,
  });
  return stdout.trim();
}

async function isAncestor(ancestor, descendant) {
  try {
    await git(["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch (error) {
    if (error?.code === 1) {
      return false;
    }
    throw error;
  }
}

export async function waitForDevSync({
  expectedCommit,
  getRemoteHeads,
  containsExpectedCommit,
  sleep = delay,
  now = Date.now,
  intervalMs = DEFAULT_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onWait = () => {},
}) {
  const deadline = now() + timeoutMs;

  while (true) {
    const { main, dev } = await getRemoteHeads();
    if (
      main &&
      main === dev &&
      (await containsExpectedCommit(expectedCommit, dev))
    ) {
      return dev;
    }

    if (now() >= deadline) {
      throw new Error(
        `Timed out waiting for origin/dev to synchronize with origin/main (${timeoutMs} ms)`,
      );
    }

    onWait({ main, dev });
    await sleep(intervalMs);
  }
}

async function main() {
  const expectedCommit = await git(["rev-parse", "HEAD"]);
  let lastStatus = "";

  process.stdout.write("Waiting for GitHub Actions to synchronize dev...\n");

  const synchronizedCommit = await waitForDevSync({
    expectedCommit,
    getRemoteHeads: async () => {
      await git(["fetch", "--quiet", "origin"]);
      return {
        main: await git(["rev-parse", "origin/main"]),
        dev: await git(["rev-parse", "origin/dev"]),
      };
    },
    containsExpectedCommit: isAncestor,
    onWait: ({ main: mainHead, dev: devHead }) => {
      const status = `${mainHead.slice(0, 7)} / ${devHead.slice(0, 7)}`;
      if (status !== lastStatus) {
        process.stdout.write(`  origin/main / origin/dev: ${status}\n`);
        lastStatus = status;
      }
    },
  });

  process.stdout.write(
    `dev synchronized at ${synchronizedCommit.slice(0, 7)}; updating local dev...\n`,
  );
  await git(["switch", "dev"]);
  await git(["pull", "--ff-only", "origin", "dev"]);
  process.stdout.write("Local dev is up to date.\n");
}

const entryPoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;

if (entryPoint === import.meta.url) {
  await main();
}
