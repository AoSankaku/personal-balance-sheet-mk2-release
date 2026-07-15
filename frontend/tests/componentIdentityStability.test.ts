import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "bun:test";
import * as ts from "typescript";

const frontendSrc = join(import.meta.dir, "../src");

function collectTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(path);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [path] : [];
  });
}

function hasFunctionAncestor(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionLike(parent)) return true;
  }
  return false;
}

function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function findNestedComponentDefinitions(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const findings: string[] = [];

  function report(name: ts.Identifier) {
    const { line } = source.getLineAndCharacterOfPosition(name.getStart(source));
    findings.push(
      `${relative(frontendSrc, file).replaceAll("\\", "/")}:${line + 1} ${name.text}`,
    );
  }

  function visit(node: ts.Node) {
    if (
      ts.isClassDeclaration(node) &&
      node.name &&
      isComponentName(node.name.text) &&
      hasFunctionAncestor(node)
    ) {
      report(node.name);
    }

    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      isComponentName(node.name.text) &&
      hasFunctionAncestor(node)
    ) {
      report(node.name);
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      isComponentName(node.name.text) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer)) &&
      hasFunctionAncestor(node)
    ) {
      report(node.name);
    }

    ts.forEachChild(node, visit);
  }

  visit(source);
  return findings;
}

describe("React component identity stability", () => {
  test("does not define component types inside other functions", () => {
    const findings = collectTsxFiles(frontendSrc).flatMap(
      findNestedComponentDefinitions,
    );

    expect(findings).toEqual([]);
  });
});
