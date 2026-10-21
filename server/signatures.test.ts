import { describe, expect, test } from "bun:test";

import type { DocumentSymbol } from "./lsp";
import { arrowHead, cutHeader, normalise, parseBlocks, signatureChanges, type ChangeBlock } from "./signatures";

const symbol = (
  name: string,
  start: number,
  end: number,
  nameLine = start,
  kind = 12,
): DocumentSymbol => ({
  name,
  kind,
  range: { start: { line: start, character: 0 }, end: { line: end, character: 1 } },
  selectionRange: {
    start: { line: nameLine, character: 9 },
    end: { line: nameLine, character: 9 + name.length },
  },
});

describe("parseBlocks", () => {
  test("reads replacements, additions and deletions with head positions", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -3 +3 @@ x",
      "-function f(a) {",
      "+function f(a, b) {",
      "@@ -9,0 +10,2 @@",
      "+one",
      "+two",
      "@@ -20,2 +21,0 @@",
      "-gone",
      "-also gone",
    ].join("\n");
    expect(parseBlocks(diff).get("a.ts")).toEqual([
      { at: 2, removed: ["function f(a) {"], added: ["function f(a, b) {"] },
      { at: 9, removed: [], added: ["one", "two"] },
      { at: 21, removed: ["gone", "also gone"], added: [] },
    ]);
  });

  test("skips a deleted file, which has no head side", () => {
    const diff = ["diff --git a/x.ts b/x.ts", "--- a/x.ts", "+++ /dev/null", "@@ -1 +0,0 @@", "-x"].join(
      "\n",
    );
    expect(parseBlocks(diff).size).toBe(0);
  });
});

describe("cutHeader and normalise", () => {
  test("stop at the line that opens the body", () => {
    expect(cutHeader(["func f(", "  a int,", ") error {", "  return nil"])).toEqual([
      "func f(",
      "  a int,",
      ") error {",
    ]);
    expect(cutHeader(["def f(a,", "      b):", "    pass"])).toEqual(["def f(a,", "      b):"]);
  });

  test("ignore whitespace and the brace", () => {
    expect(normalise(["function  f(a)", "{"])).toBe("function f(a)");
  });
});

describe("signatureChanges", () => {
  const head = [
    "// leads",
    "function f(a, b) {", // 1
    "  return a + b;",
    "}",
    "function g(x) {", // 4
    "  return x * 3;",
    "}",
  ];
  const symbols = [symbol("f", 1, 3), symbol("g", 4, 6)];

  test("reports a rewritten parameter list, with before and after", () => {
    const blocks: ChangeBlock[] = [{ at: 1, removed: ["function f(a) {"], added: ["function f(a, b) {"] }];
    expect(signatureChanges(head, symbols, blocks)).toEqual([
      {
        name: "f",
        line: 1,
        character: 9,
        before: "function f(a)",
        after: "function f(a, b)",
      },
    ]);
  });

  test("ignores a change confined to the body", () => {
    const blocks: ChangeBlock[] = [{ at: 5, removed: ["  return x * 2;"], added: ["  return x * 3;"] }];
    expect(signatureChanges(head, symbols, blocks)).toEqual([]);
  });

  test("ignores a whitespace-only header change", () => {
    const blocks: ChangeBlock[] = [{ at: 4, removed: ["function g(x){"], added: ["function g(x) {"] }];
    expect(signatureChanges(head, symbols, blocks)).toEqual([]);
  });

  test("does not report a brand-new function", () => {
    const blocks: ChangeBlock[] = [{ at: 4, removed: [], added: head.slice(4, 7) }];
    expect(signatureChanges(head, symbols, blocks)).toEqual([]);
  });

  test("reads the old header through a block that runs into the body", () => {
    const blocks: ChangeBlock[] = [
      { at: 4, removed: ["function g() {", "  return 2;"], added: ["function g(x) {", "  return x * 3;"] },
    ];
    expect(signatureChanges(head, symbols, blocks)[0]?.before).toBe("function g()");
  });

  test("reads the old header through a block that starts above it", () => {
    const blocks: ChangeBlock[] = [
      { at: 0, removed: ["// old lead", "function f(a) {"], added: ["// leads", "function f(a, b) {"] },
    ];
    expect(signatureChanges(head, symbols, blocks)[0]?.before).toBe("function f(a)");
  });

  test("counts an arrow function bound to a constant, but not a plain constant", () => {
    const lines = ["const h = (a: number, b: number) => a + b;", "const LIMIT = 4;"];
    const consts = [symbol("h", 0, 0, 0, 14), symbol("LIMIT", 1, 1, 1, 14)];
    const blocks: ChangeBlock[] = [
      { at: 0, removed: ["const h = (a: number) => a;", "const LIMIT = 3;"], added: lines },
    ];
    expect(signatureChanges(lines, consts, blocks).map((change) => change.name)).toEqual(["h"]);
  });

  test("ignores a variable that merely uses an arrow, and anonymous callbacks", () => {
    const lines = ["const paths = files.map((file) => file.path);"];
    const blocks: ChangeBlock[] = [{ at: 0, removed: ["const paths = files.map((f) => f.path);"], added: lines }];
    const found = signatureChanges(
      lines,
      [symbol("paths", 0, 0, 0, 13), symbol("files.map() callback", 0, 0, 0, 12)],
      blocks,
    );
    expect(found).toEqual([]);
  });

  test("ignores a one-line arrow whose body changed but parameters did not", () => {
    const lines = ["export const three = () => add(3, 4);"];
    const blocks: ChangeBlock[] = [{ at: 0, removed: ["export const three = () => add(3);"], added: lines }];
    expect(signatureChanges(lines, [symbol("three", 0, 0, 0, 14)], blocks)).toEqual([]);
  });
});

describe("arrowHead", () => {
  test("stops at the first arrow outside brackets", () => {
    expect(arrowHead(" (cb: () => void) => cb()")).toBe(" (cb: () => void) =>");
    expect(arrowHead(" async x => x.map((y) => y)")).toBe(" async x =>");
  });
});
