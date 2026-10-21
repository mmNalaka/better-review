import { describe, expect, test } from "bun:test";

import { sitesFromCalls, sitesFromReferences } from "./callers";
import type { IncomingCall } from "./lsp";

const ROOT = "/work/repo";
const range = (line: number, character = 2) => ({
  start: { line, character },
  end: { line, character: character + 3 },
});
const readLine = (path: string, line: number) => `${path}:${line}`;

const call = (uri: string, name: string, ...lines: number[]): IncomingCall => ({
  from: { name, uri, kind: 12, range: range(0), selectionRange: range(1, 5) },
  fromRanges: lines.map((line) => range(line)),
});

describe("sitesFromCalls", () => {
  test("lists each call site with its caller and line, in file order", () => {
    const { sites, external } = sitesFromCalls(
      [call(`file://${ROOT}/b.go`, "Serve", 40), call(`file://${ROOT}/a.go`, "Main", 9, 3)],
      ROOT,
      readLine,
    );
    expect(external).toBe(0);
    expect(sites.map((site) => [site.path, site.line, site.caller, site.preview])).toEqual([
      ["a.go", 3, "Main", "a.go:3"],
      ["a.go", 9, "Main", "a.go:9"],
      ["b.go", 40, "Serve", "b.go:40"],
    ]);
  });

  test("counts callers outside the repo instead of listing them", () => {
    const { sites, external } = sitesFromCalls(
      [call("file:///usr/lib/go/x.go", "Lib", 1)],
      ROOT,
      readLine,
    );
    expect(sites).toEqual([]);
    expect(external).toBe(1);
  });

  test("falls back to the caller's name when the server gives no call ranges", () => {
    const { sites } = sitesFromCalls([call(`file://${ROOT}/a.go`, "Main")], ROOT, readLine);
    expect(sites).toMatchObject([{ path: "a.go", line: 1, character: 5 }]);
  });

  test("names a module-level caller as top level, not by its file path", () => {
    const { sites } = sitesFromCalls(
      [call(`file://${ROOT}/a.test.ts`, `${ROOT}/a.test.ts`, 2)],
      ROOT,
      readLine,
    );
    expect(sites[0]?.caller).toBe("top level");
  });

  test("decodes an escaped path", () => {
    const { sites } = sitesFromCalls(
      [call(`file://${ROOT}/my%20dir/a.go`, "Main", 2)],
      ROOT,
      readLine,
    );
    expect(sites[0]?.path).toBe("my dir/a.go");
  });
});

describe("sitesFromReferences", () => {
  test("drops duplicates and has no caller name", () => {
    const location = { uri: `file://${ROOT}/a.go`, range: range(4) };
    const { sites } = sitesFromReferences([location, location], ROOT, readLine);
    expect(sites).toEqual([
      { path: "a.go", line: 4, character: 2, caller: null, preview: "a.go:4" },
    ]);
  });
});
