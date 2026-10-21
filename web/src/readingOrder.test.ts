import { describe, expect, test } from "bun:test";

import { orderFiles } from "./readingOrder";

const files = (...paths: string[]) => paths.map((path) => ({ path }));
const paths = (list: readonly { path: string }[]) => list.map((file) => file.path);

// handler -> service -> repo, and docs.md stands apart.
const edges = [
  { from: "handler.go", to: "service.go" },
  { from: "service.go", to: "repo.go" },
];
const changed = files("docs.md", "handler.go", "repo.go", "service.go");

describe("orderFiles", () => {
  test("by path leaves the order alone", () => {
    expect(orderFiles(changed, edges, "path")).toBe(changed);
  });

  test("callees first reads what is called before what calls it", () => {
    expect(paths(orderFiles(changed, edges, "callees"))).toEqual([
      "repo.go",
      "service.go",
      "handler.go",
      "docs.md",
    ]);
  });

  test("entry points first starts at the top of the call chain", () => {
    expect(paths(orderFiles(changed, edges, "entries"))).toEqual([
      "handler.go",
      "service.go",
      "repo.go",
      "docs.md",
    ]);
  });

  test("a cycle still yields every file once, deterministically", () => {
    const cycle = [
      { from: "a.go", to: "b.go" },
      { from: "b.go", to: "a.go" },
      { from: "c.go", to: "a.go" },
    ];
    const ordered = paths(orderFiles(files("a.go", "b.go", "c.go"), cycle, "callees"));
    expect(ordered).toEqual(["a.go", "b.go", "c.go"]);
  });

  test("ignores edges to files outside the list, and self-calls", () => {
    const odd = [
      { from: "a.go", to: "gone.go" },
      { from: "a.go", to: "a.go" },
      { from: "b.go", to: "a.go" },
    ];
    expect(paths(orderFiles(files("b.go", "a.go"), odd, "callees"))).toEqual(["a.go", "b.go"]);
  });

  test("with no call graph yet, keeps the order it was given", () => {
    expect(orderFiles(changed, [], "callees")).toBe(changed);
  });
});
