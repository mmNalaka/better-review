import { describe, expect, test } from "bun:test";

import type { DiffLine, Hunk, HunkIndex } from "./diff";
import { hunkId } from "./hunkid";
import { emptyMarkFile, markKey, noteKey, type MarkFile } from "./markmodel";
import { classify, lineDelta, matchHunks, MATCH_MIN, passAt, similarity } from "./rereview";

const PR = { owner: "acme", repo: "auth", number: 146 } as const;
const AT = "2026-10-01T09:00:00.000Z";
const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);

const line = (raw: string): DiffLine => {
  const kind = raw[0] === "+" ? "added" : raw[0] === "-" ? "removed" : "context";
  return { kind, text: raw.slice(1), oldLine: null, newLine: null };
};

const hunk = (...raw: string[]): Hunk => {
  const lines = raw.map(line);
  return { id: hunkId(lines), header: `@@ ${raw[0]} @@`, oldStart: 1, newStart: 1, lines };
};

const indexOf = (files: Record<string, readonly Hunk[]>): HunkIndex => ({
  files: Object.fromEntries(
    Object.entries(files).map(([path, hunks]) => [
      path,
      hunks.map((entry) => ({ id: entry.id, header: entry.header })),
    ]),
  ),
});

const tick = (marks: MarkFile, path: string, id: string): MarkFile => ({
  ...marks,
  hunks: {
    ...marks.hunks,
    [markKey(path, id)]: { path, id, header: "@@", reviewed: true, updatedAt: AT },
  },
});

const noteOn = (marks: MarkFile, path: string, id: string): MarkFile => ({
  ...marks,
  notes: {
    ...marks.notes,
    [noteKey(path, id, null)]: {
      path,
      hunkId: id,
      lineIndex: null,
      lineText: null,
      body: "why?",
      updatedAt: AT,
      published: null,
    },
  },
});

describe("similarity", () => {
  test("is 1 for the same changed lines, whatever the context", () => {
    expect(similarity(hunk(" a", "+b").lines, hunk(" z", "+b").lines)).toBe(1);
  });

  test("is 0 when nothing changed is shared", () => {
    expect(similarity(hunk("+a").lines, hunk("+b").lines)).toBe(0);
  });

  test("counts an addition and a removal of the same text as different", () => {
    expect(similarity(hunk("+a").lines, hunk("-a").lines)).toBe(0);
  });

  test("scores a one-line edit of a four-line hunk above the threshold", () => {
    const before = hunk("+one", "+two", "+three", "+four");
    const after = hunk("+one", "+two", "+THREE", "+four");
    expect(similarity(before.lines, after.lines)).toBeGreaterThanOrEqual(MATCH_MIN);
  });
});

describe("lineDelta", () => {
  test("keeps what both have, and marks what each side alone has", () => {
    const rows = lineDelta(hunk(" ctx", "+old").lines, hunk(" ctx", "+new").lines);
    expect(rows.map((row) => [row.change, row.text])).toEqual([
      ["same", "ctx"],
      ["dropped", "old"],
      ["added", "new"],
    ]);
  });

  test("is all same for identical hunks", () => {
    const rows = lineDelta(hunk("+a", "+b").lines, hunk("+a", "+b").lines);
    expect(rows.every((row) => row.change === "same")).toBe(true);
  });
});

describe("matchHunks", () => {
  const kept = hunk("+kept");
  const before = hunk("+one", "+two", "+three", "+four");
  const after = hunk("+one", "+two", "+THREE", "+four");

  test("pairs an edited hunk with the one it replaced", () => {
    const [match, ...rest] = matchHunks("a.go", [kept, before], [kept, after]);
    expect(rest).toEqual([]);
    expect(match).toMatchObject({ path: "a.go", oldId: before.id, newId: after.id });
  });

  test("never pairs a hunk that is still there", () => {
    expect(matchHunks("a.go", [kept], [kept])).toEqual([]);
  });

  test("leaves an unrelated new hunk unmatched", () => {
    expect(matchHunks("a.go", [before], [hunk("+something", "+else")])).toEqual([]);
  });

  test("uses each old hunk once, for its closest new one", () => {
    const close = hunk("+one", "+two", "+three", "+FOUR");
    const far = hunk("+one", "+TWO", "+THREE", "+FOUR", "+five");
    const matches = matchHunks("a.go", [before], [far, close]);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.newId).toBe(close.id);
  });
});

describe("classify", () => {
  const same = hunk("+same");
  const pending = hunk("+pending");
  const before = hunk("+one", "+two", "+three", "+four");
  const after = hunk("+one", "+two", "+THREE", "+four");
  const fresh = hunk("+brand new");
  const removed = hunk("+removed later");

  const pass = passAt(HEAD, BASE, indexOf({ "a.go": [same, pending, before, removed] }), AT);

  let marks = emptyMarkFile(PR);
  marks = tick(marks, "a.go", same.id);
  marks = tick(marks, "a.go", before.id);
  marks = noteOn(marks, "a.go", removed.id);

  const now = indexOf({ "a.go": [same, pending, after, fresh], "b.go": [hunk("+b")] });
  const matches = matchHunks("a.go", [same, pending, before, removed], [same, pending, after, fresh]);
  const summary = classify(now, marks, pass, matches);

  test("a ticked hunk the pass had is carried", () => {
    expect(summary.byHunk[markKey("a.go", same.id)]).toBe("carried");
  });

  test("an unticked hunk the pass had is still just unreviewed", () => {
    expect(summary.byHunk[markKey("a.go", pending.id)]).toBe("unreviewed");
  });

  test("a rewrite of a hunk you ticked is edited", () => {
    expect(summary.byHunk[markKey("a.go", after.id)]).toBe("edited");
  });

  test("a hunk the pass never had is new, as is every hunk of a new file", () => {
    expect(summary.byHunk[markKey("a.go", fresh.id)]).toBe("new");
    expect(summary.byHunk[markKey("b.go", hunk("+b").id)]).toBe("new");
  });

  test("a noted hunk that vanished without a match is gone", () => {
    expect(summary.gone).toEqual([{ path: "a.go", id: removed.id }]);
  });

  test("counts and lists the files that need a look", () => {
    expect(summary.counts).toEqual({ carried: 1, unreviewed: 1, new: 2, edited: 1, gone: 1 });
    expect(summary.paths).toEqual(["a.go", "b.go"]);
  });

  test("a rewrite of a hunk you never touched is just new", () => {
    const untouched = classify(now, emptyMarkFile(PR), pass, matches);
    expect(untouched.byHunk[markKey("a.go", after.id)]).toBe("new");
    expect(untouched.gone).toEqual([]);
  });

  test("nothing is new against a pass at the same head", () => {
    const again = passAt(HEAD, BASE, now, AT);
    const quiet = classify(now, marks, again, []);
    expect(quiet.counts.new + quiet.counts.edited + quiet.counts.gone).toBe(0);
    expect(quiet.paths).toEqual([]);
  });
});
