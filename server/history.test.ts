import { describe, expect, test } from "bun:test";

import type { DiffLine } from "./diff";
import { parseFileLog, sideBySide } from "./history";

const RS = "\x1e";
const US = "\x1f";

const record = (sha: string, subject: string, path: string) =>
  `${RS}${sha}${US}${subject}${US}Ada${US}2026-08-28T15:22:10+02:00\0\n${path}\0`;

describe("parseFileLog", () => {
  test("reads one revision per record, newest first as git gives them", () => {
    const out = record("a".repeat(40), "feat: two", "src/b.ts") + record("b".repeat(40), "feat: one", "src/a.ts");
    expect(parseFileLog(out)).toEqual([
      { sha: "a".repeat(40), subject: "feat: two", author: "Ada", date: "2026-08-28T15:22:10+02:00", path: "src/b.ts" },
      { sha: "b".repeat(40), subject: "feat: one", author: "Ada", date: "2026-08-28T15:22:10+02:00", path: "src/a.ts" },
    ]);
  });

  test("keeps the path each commit knew the file by, across a rename", () => {
    const out = record("c".repeat(40), "move", "new/name.ts") + record("d".repeat(40), "add", "old/name.ts");
    expect(parseFileLog(out).map((entry) => entry.path)).toEqual(["new/name.ts", "old/name.ts"]);
  });

  test("an empty log is no revisions", () => {
    expect(parseFileLog("")).toEqual([]);
  });

  test("skips a record that names no path", () => {
    const out = `${RS}${"e".repeat(40)}${US}merge${US}Ada${US}2026-08-28T15:22:10+02:00\0`;
    expect(parseFileLog(out)).toEqual([]);
  });
});

const ctx = (oldLine: number, newLine: number, text: string): DiffLine =>
  ({ kind: "context", text, oldLine, newLine });
const del = (oldLine: number, text: string): DiffLine =>
  ({ kind: "removed", text, oldLine, newLine: null });
const add = (newLine: number, text: string): DiffLine =>
  ({ kind: "added", text, oldLine: null, newLine });

describe("sideBySide", () => {
  test("context sits on both sides of one row", () => {
    expect(sideBySide([ctx(1, 1, "a")])).toEqual([
      { left: { line: 1, text: "a", kind: "context" }, right: { line: 1, text: "a", kind: "context" } },
    ]);
  });

  test("a replaced line pairs the old with the new", () => {
    expect(sideBySide([del(1, "old"), add(1, "new")])).toEqual([
      { left: { line: 1, text: "old", kind: "removed" }, right: { line: 1, text: "new", kind: "added" } },
    ]);
  });

  test("an uneven change leaves blanks on the shorter side", () => {
    const rows = sideBySide([del(1, "x"), add(1, "p"), add(2, "q"), ctx(2, 3, "z")]);
    expect(rows).toEqual([
      { left: { line: 1, text: "x", kind: "removed" }, right: { line: 1, text: "p", kind: "added" } },
      { left: null, right: { line: 2, text: "q", kind: "added" } },
      { left: { line: 2, text: "z", kind: "context" }, right: { line: 3, text: "z", kind: "context" } },
    ]);
  });

  test("a pure deletion leaves the right side blank", () => {
    expect(sideBySide([ctx(1, 1, "a"), del(2, "gone"), ctx(3, 2, "b")])).toEqual([
      { left: { line: 1, text: "a", kind: "context" }, right: { line: 1, text: "a", kind: "context" } },
      { left: { line: 2, text: "gone", kind: "removed" }, right: null },
      { left: { line: 3, text: "b", kind: "context" }, right: { line: 2, text: "b", kind: "context" } },
    ]);
  });

  test("separate change blocks are not paired with each other", () => {
    const rows = sideBySide([del(1, "x"), ctx(2, 1, "m"), add(2, "y")]);
    expect(rows).toEqual([
      { left: { line: 1, text: "x", kind: "removed" }, right: null },
      { left: { line: 2, text: "m", kind: "context" }, right: { line: 1, text: "m", kind: "context" } },
      { left: null, right: { line: 2, text: "y", kind: "added" } },
    ]);
  });
});
