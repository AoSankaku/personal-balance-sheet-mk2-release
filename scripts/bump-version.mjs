import { appendFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const VERSION_FILE = "frontend/src/lib/version.ts";
const VERSION_PATTERN = /export const VERSION = (["'])([^"']+)\1;/;
const SUPPORTED_VERSION_PATTERN = /^\d+(?:\.\d+)+(?:-[0-9A-Za-z.-]+)?$/;
const CALENDAR_BETA_PATTERN = /^(\d{4})\.(\d{1,2})\.0-beta(\d+)$/;
const VERSION_TIME_ZONE = "Asia/Tokyo";

function calendarYearMonth(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: VERSION_TIME_ZONE,
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);

  return { year, month };
}

export function bumpVersion(version, now = new Date()) {
  if (!SUPPORTED_VERSION_PATTERN.test(version)) {
    throw new Error(`Unsupported version format: ${version}`);
  }

  const calendarBetaMatch = version.match(CALENDAR_BETA_PATTERN);
  if (calendarBetaMatch) {
    const { year, month } = calendarYearMonth(now);
    const versionYear = Number(calendarBetaMatch[1]);
    const versionMonth = Number(calendarBetaMatch[2]);

    if (versionYear !== year || versionMonth !== month) {
      return `${year}.${month}.0-beta0`;
    }
  }

  const match = version.match(/^(.*\D|)(\d+)$/);
  if (!match) {
    throw new Error(`Version does not end with a number: ${version}`);
  }

  return `${match[1]}${Number(match[2]) + 1}`;
}

export function replaceVersionSource(source, now = new Date()) {
  const match = source.match(VERSION_PATTERN);
  if (!match) {
    throw new Error("VERSION export was not found");
  }

  const previousVersion = match[2];
  const nextVersion = bumpVersion(previousVersion, now);
  const content = source.replace(
    VERSION_PATTERN,
    `export const VERSION = ${match[1]}${nextVersion}${match[1]};`,
  );

  return { previousVersion, nextVersion, content };
}

async function main() {
  const filePath = resolve(VERSION_FILE);
  const source = await readFile(filePath, "utf8");
  const result = replaceVersionSource(source);

  await writeFile(filePath, result.content, "utf8");

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `version=${result.nextVersion}\n`, "utf8");
  }

  process.stdout.write(`${result.previousVersion} -> ${result.nextVersion}\n`);
}

const entryPoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;

if (entryPoint === import.meta.url) {
  await main();
}
