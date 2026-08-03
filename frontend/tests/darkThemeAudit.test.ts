import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { extname, join, relative } from "path";

const sourceRoot = join(import.meta.dir, "..", "src");

function sourceFiles(directory = sourceRoot): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (![".ts", ".tsx", ".css", ".scss"].includes(extname(entry.name))) {
      return [];
    }
    if (entry.name.includes(".test.")) return [];
    return [path];
  });
}

function displayPath(path: string): string {
  return relative(sourceRoot, path).replaceAll("\\", "/");
}

function matchesInSource(pattern: RegExp) {
  return sourceFiles()
    .filter((path) => extname(path) === ".ts" || extname(path) === ".tsx")
    .flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return [...source.matchAll(pattern)].map((match) => ({
        file: displayPath(path),
        value: match[0],
      }));
    });
}

describe("dark theme source audit", () => {
  test("does not use fixed light surfaces in runtime style objects", () => {
    const intentionalBrandSurfaces = new Set([
      "components/CryptoCurrencyIcon.tsx",
      "components/CustomCurrencyIcon.tsx",
    ]);
    const findings = matchesInSource(
      /\b(?:background|backgroundColor):\s*["'](?:#[0-9a-f]{3,8}|white|rgba?\([^"']+\))["']/gi,
    ).filter((finding) => !intentionalBrandSurfaces.has(finding.file));

    expect(findings).toEqual([]);
  });

  test("does not use fixed dark text colors on theme-controlled surfaces", () => {
    const findings = matchesInSource(
      /\bcolor:\s*["']#[0-9a-f]{3,8}["']/gi,
    ).filter((finding) => {
      if (
        finding.file === "components/CryptoCurrencyIcon.tsx" ||
        finding.file === "components/CustomCurrencyIcon.tsx"
      ) {
        return false;
      }
      // White text on the filled red unresolved-task counter is intentional.
      if (finding.file === "pages/AssetsPage.tsx" && finding.value.includes("#fff")) {
        return false;
      }
      return true;
    });

    expect(findings).toEqual([]);
  });

  test("uses semantic theme tokens for component surfaces and text", () => {
    expect(matchesInSource(/\bbg=["'][a-z]+\.[0-2]["']/gi)).toEqual([]);
    expect(matchesInSource(/\bc=["'][a-z]+\.[7-9]["']/gi)).toEqual([]);
    expect(matchesInSource(/theme\.colors\.gray\[[0-4]\]/g)).toEqual([]);
  });

  test("requires hard-coded CSS surfaces to define both color schemes", () => {
    const findings = sourceFiles()
      .filter((path) => [".css", ".scss"].includes(extname(path)))
      .flatMap((path) => {
        const source = readFileSync(path, "utf8");
        return [...source.matchAll(/background(?:-color)?\s*:\s*([^;]+);/gi)]
          .filter(([, value]) => /#[0-9a-f]{3,8}|rgba?\(/i.test(value!))
          .filter(([, value]) => !value!.includes("light-dark("))
          .map((match) => ({
            file: displayPath(path),
            value: match[0],
          }));
      });

    expect(findings).toEqual([]);
  });

  test("keeps audited status, report, calendar, and ledger surfaces adaptive", () => {
    const feedback = readFileSync(
      join(sourceRoot, "components", "FeedbackHost.tsx"),
      "utf8",
    );
    for (const color of ["red", "yellow", "teal", "blue"]) {
      expect(feedback).toContain(`--mantine-color-${color}-light`);
      expect(feedback).toContain(`--mantine-color-${color}-light-color`);
    }

    const exportPage = readFileSync(
      join(sourceRoot, "pages", "ExportPage.tsx"),
      "utf8",
    );
    expect(exportPage).toContain("--report-info-background");
    expect(exportPage).toContain("--report-info-color");

    const plannedExpenses = readFileSync(
      join(sourceRoot, "pages", "PlannedExpensePage.tsx"),
      "utf8",
    );
    expect(plannedExpenses).toContain("--mantine-color-green-light-color");
    expect(plannedExpenses).toContain("--mantine-color-yellow-light-color");

    const journal = readFileSync(
      join(sourceRoot, "components", "JournalTable.tsx"),
      "utf8",
    );
    expect(journal).toContain("--mantine-color-blue-light-color");
    expect(journal).toContain("--mantine-color-orange-light-color");
  });
});
