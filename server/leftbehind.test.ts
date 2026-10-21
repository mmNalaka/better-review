import { describe, expect, test } from "bun:test";

import type { CallSite } from "./callers";
import { addedLines, partitionSites } from "./leftbehind";

const site = (path: string, line: number): CallSite => ({
  path,
  line,
  character: 2,
  caller: "main",
  preview: "f(1)",
});

describe("addedLines", () => {
  test("collects each block's added head lines, and none for a deletion", () => {
    const added = addedLines(
      new Map([
        [
          "a.ts",
          [
            { at: 2, removed: ["x"], added: ["y", "z"] },
            { at: 9, removed: ["gone"], added: [] },
          ],
        ],
      ]),
    );
    expect([...(added.get("a.ts") ?? [])]).toEqual([2, 3]);
  });
});

describe("partitionSites", () => {
  test("a call on a line the PR changed counts as updated; the rest are stale", () => {
    const added = new Map([["a.ts", new Set([4])]]);
    const result = partitionSites([site("a.ts", 4), site("a.ts", 7), site("b.ts", 4)], added);
    expect(result.updated).toBe(1);
    expect(result.stale.map((s) => `${s.path}:${s.line}`)).toEqual(["a.ts:7", "b.ts:4"]);
  });
});
