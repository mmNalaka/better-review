import { describe, expect, test } from "bun:test";

import { hunkId, type HashableLine } from "./hunkid";
import { parseUnifiedDiff } from "./diff";

const line = (kind: HashableLine["kind"], text: string): HashableLine => ({ kind, text });

describe("hunkId", () => {
  test("ignores line numbers, so a pure shift keeps the id", () => {
    const lines = [line("removed", "old()"), line("added", "new()")];
    // Same texts, different DiffLine numbering: the hasher never sees numbers.
    expect(hunkId(lines)).toBe(hunkId([...lines]));

    const shifted = parseUnifiedDiff(
      "@@ -1,2 +1,2 @@\n-old()\n+new()\n",
    ).hunks[0];
    const later = parseUnifiedDiff(
      "@@ -400,2 +412,2 @@\n-old()\n+new()\n",
    ).hunks[0];
    expect(hunkId(shifted!.lines)).toBe(hunkId(later!.lines));
  });

  test("ignores context, so a change to surrounding code keeps the id", () => {
    const before = parseUnifiedDiff("@@ -1,3 +1,3 @@\n if a {\n-old()\n+new()\n").hunks[0];
    const after = parseUnifiedDiff("@@ -1,3 +1,3 @@\n if b {\n-old()\n+new()\n").hunks[0];
    expect(hunkId(before!.lines)).toBe(hunkId(after!.lines));
  });

  test("changes when an added line changes", () => {
    expect(hunkId([line("added", "new()")])).not.toBe(hunkId([line("added", "newer()")]));
  });

  test("distinguishes an added line from a removed one with the same text", () => {
    expect(hunkId([line("added", "x")])).not.toBe(hunkId([line("removed", "x")]));
  });

  test("distinguishes order", () => {
    expect(hunkId([line("added", "a"), line("added", "b")])).not.toBe(
      hunkId([line("added", "b"), line("added", "a")]),
    );
  });

  test("is not fooled by a text that contains the separator", () => {
    expect(hunkId([line("added", "a\nb")])).not.toBe(
      hunkId([line("added", "a"), line("added", "b")]),
    );
  });

  /**
   * Golden value. Ids are written to disk and are how a mark finds its hunk
   * again, so changing the algorithm silently would void everyone's review
   * progress. If this fails, the change needs a migration, not a new literal.
   */
  test("is stable across versions", () => {
    expect(hunkId([line("removed", "old()"), line("added", "new()")])).toBe("e08ea6d1ada2d07c");
  });

  test("gives a mode-only hunk an id rather than throwing", () => {
    expect(hunkId([])).toMatch(/^[0-9a-f]{16}$/);
  });
});
