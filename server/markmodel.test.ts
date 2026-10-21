import { describe, expect, test } from "bun:test";

import {
  emptyMarkFile,
  MARK_VERSION,
  MarkError,
  markKey,
  NOTE_MAX,
  noteKey,
  parseMarkFile,
  PASSES_MAX,
  lastPass,
  recordPass,
  type MarkFile,
  type ReviewPass,
} from "./markmodel";

const PR = { owner: "acme", repo: "auth", number: 146 } as const;
const ID = "e08ea6d1ada2d07c";
const AT = "2026-08-27T09:00:00.000Z";

const tick = (over: Record<string, unknown> = {}) => ({
  path: "service/scim.go",
  id: ID,
  header: "@@ -44,15 +44,20 @@ func assignScope(",
  reviewed: true,
  updatedAt: AT,
  ...over,
});

const note = (over: Record<string, unknown> = {}) => ({
  path: "service/scim.go",
  hunkId: ID,
  lineIndex: 3,
  lineText: "\tnew()",
  body: "ordering?",
  updatedAt: AT,
  published: null,
  ...over,
});

const file = (parts: Record<string, unknown>) => ({
  version: MARK_VERSION,
  ...PR,
  hunks: {},
  notes: {},
  passes: [],
  ...parts,
});

describe("keys", () => {
  test("a hunk key scopes the hunk id to its file", () => {
    expect(markKey("a.go", ID)).not.toBe(markKey("b.go", ID));
  });

  test("a note key names the line it hangs under", () => {
    expect(noteKey("a.go", ID, 3)).toBe(`a.go@${ID}#3`);
  });

  test("a note about the whole hunk has a key of its own", () => {
    expect(noteKey("a.go", ID, null)).toBe(`a.go@${ID}#hunk`);
    expect(noteKey("a.go", ID, null)).not.toBe(noteKey("a.go", ID, 0));
  });
});

describe("parseMarkFile", () => {
  test("round-trips ticks and line notes", () => {
    const key = noteKey("service/scim.go", ID, 3);
    const parsed = parseMarkFile(
      file({ hunks: { [markKey("service/scim.go", ID)]: tick() }, notes: { [key]: note() } }),
      PR,
    );
    expect(parsed.hunks[markKey("service/scim.go", ID)]?.reviewed).toBe(true);
    expect(parsed.notes[key]?.body).toBe("ordering?");
    expect(parsed.notes[key]?.lineIndex).toBe(3);
  });

  test("keeps a note that is about the whole hunk", () => {
    const key = noteKey("service/scim.go", ID, null);
    const parsed = parseMarkFile(file({ notes: { [key]: note({ lineIndex: null, lineText: null }) } }), PR);
    expect(parsed.notes[key]?.lineIndex).toBeNull();
  });

  test.each([
    ["a fractional line index", { lineIndex: 1.5 }],
    ["a negative line index", { lineIndex: -1 }],
    ["a missing body", { body: undefined }],
    ["an empty body — a note with no words is not a note", { body: "   " }],
    ["a malformed hunk id", { hunkId: "nothex" }],
    ["an absolute path", { path: "/etc/passwd" }],
  ])("rejects %s", (_name, over) => {
    const bad = note(over);
    const key = noteKey(bad.path as string, bad.hunkId as string, bad.lineIndex as number | null);
    expect(() => parseMarkFile(file({ notes: { [key]: bad } }), PR)).toThrow(MarkError);
  });

  test("rejects a note whose key does not match its own anchor", () => {
    expect(() => parseMarkFile(file({ notes: { "wrong@key#1": note() } }), PR)).toThrow(MarkError);
  });

  test("rejects a body longer than the cap", () => {
    const long = note({ body: "x".repeat(NOTE_MAX + 1) });
    expect(() =>
      parseMarkFile(file({ notes: { [noteKey("service/scim.go", ID, 3)]: long } }), PR),
    ).toThrow(MarkError);
  });

  test("accepts an empty file", () => {
    const empty: MarkFile = emptyMarkFile(PR);
    expect(parseMarkFile(empty, PR)).toEqual(empty);
  });
});

describe("ranges", () => {
  const spanning = (over: Record<string, unknown> = {}) => ({
    ...note(),
    lineIndex: 3,
    endLineIndex: 7,
    endLineText: "\t}",
    ...over,
  });

  test("a range has a key of its own, distinct from its first line", () => {
    expect(noteKey("a.go", ID, 3, 7)).toBe(`a.go@${ID}#3-7`);
    expect(noteKey("a.go", ID, 3, 7)).not.toBe(noteKey("a.go", ID, 3));
  });

  test("a range that ends where it starts is one line, not a span", () => {
    expect(noteKey("a.go", ID, 3, 3)).toBe(noteKey("a.go", ID, 3));
  });

  test("round-trips a spanning note", () => {
    const key = noteKey("service/scim.go", ID, 3, 7);
    const parsed = parseMarkFile(file({ notes: { [key]: spanning() } }), PR);
    expect(parsed.notes[key]?.endLineIndex).toBe(7);
    expect(parsed.notes[key]?.endLineText).toBe("\t}");
  });

  test("reads a note written before ranges existed as a single line", () => {
    const key = noteKey("service/scim.go", ID, 3);
    const parsed = parseMarkFile(file({ notes: { [key]: note() } }), PR);
    expect(parsed.notes[key]?.endLineIndex).toBeNull();
  });

  test("rejects a range that ends before it starts", () => {
    const backwards = spanning({ lineIndex: 7, endLineIndex: 3 });
    expect(() =>
      parseMarkFile(file({ notes: { [`service/scim.go@${ID}#7-3`]: backwards } }), PR),
    ).toThrow(MarkError);
  });

  test("rejects a range with no first line", () => {
    const rootless = spanning({ lineIndex: null });
    expect(() =>
      parseMarkFile(file({ notes: { [`service/scim.go@${ID}#hunk`]: rootless } }), PR),
    ).toThrow(MarkError);
  });
});

describe("migration from version 1", () => {
  /** Version 1 kept one note per hunk, inside the hunk mark itself. */
  const v1 = {
    version: 1,
    ...PR,
    hunks: {
      [markKey("service/scim.go", ID)]: {
        path: "service/scim.go",
        id: ID,
        header: "@@ -44,15 +44,20 @@",
        reviewed: true,
        note: "scope check runs after the write",
        updatedAt: AT,
        published: { at: AT, url: "https://example/1" },
      },
    },
  };

  test("keeps the tick", () => {
    const parsed = parseMarkFile(v1, PR);
    expect(parsed.version).toBe(MARK_VERSION);
    expect(parsed.hunks[markKey("service/scim.go", ID)]?.reviewed).toBe(true);
  });

  test("moves the note to the hunk, since version 1 never knew which line", () => {
    const parsed = parseMarkFile(v1, PR);
    const moved = parsed.notes[noteKey("service/scim.go", ID, null)];
    expect(moved?.body).toBe("scope check runs after the write");
    expect(moved?.lineIndex).toBeNull();
  });

  test("carries the posted stamp across, so nothing is posted twice", () => {
    const parsed = parseMarkFile(v1, PR);
    expect(parsed.notes[noteKey("service/scim.go", ID, null)]?.published?.url).toBe(
      "https://example/1",
    );
  });

  test("leaves a tick with no note alone", () => {
    const ticked = { ...v1, hunks: { [markKey("service/scim.go", ID)]: { ...v1.hunks[markKey("service/scim.go", ID)], note: null, published: null } } };
    expect(Object.keys(parseMarkFile(ticked, PR).notes)).toEqual([]);
  });

  test("still refuses a version it does not know", () => {
    expect(() => parseMarkFile({ ...file({}), version: 99 }, PR)).toThrow(MarkError);
  });
});

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);

const pass = (over: Partial<ReviewPass> = {}): ReviewPass => ({
  headSha: HEAD,
  mergeBase: BASE,
  at: AT,
  hunks: { "service/scim.go": [ID] },
  ...over,
});

describe("passes", () => {
  test("reads a version 2 file as having none", () => {
    const parsed = parseMarkFile({ ...file({}), version: 2, passes: undefined }, PR);
    expect(parsed.version).toBe(MARK_VERSION);
    expect(parsed.passes).toEqual([]);
  });

  test("round-trips a pass", () => {
    const parsed = parseMarkFile(file({ passes: [pass()] }), PR);
    expect(parsed.passes).toEqual([pass()]);
  });

  test("rejects a short sha, since a pass must name one exact commit", () => {
    expect(() => parseMarkFile(file({ passes: [pass({ headSha: "abc1234" })] }), PR)).toThrow(
      MarkError,
    );
  });

  test("rejects a pass hunk id that is not one", () => {
    expect(() =>
      parseMarkFile(file({ passes: [pass({ hunks: { "a.go": ["nope"] } })] }), PR),
    ).toThrow(MarkError);
  });

  test("rejects a pass path that escapes the repo", () => {
    expect(() =>
      parseMarkFile(file({ passes: [pass({ hunks: { "../x.go": [ID] } })] }), PR),
    ).toThrow(MarkError);
  });

  test("rejects more passes than are kept", () => {
    const many = Array.from({ length: PASSES_MAX + 1 }, (_, i) =>
      pass({ headSha: i.toString(16).padStart(40, "0") }),
    );
    expect(() => parseMarkFile(file({ passes: many }), PR)).toThrow(MarkError);
  });
});

describe("recordPass", () => {
  const empty = emptyMarkFile(PR);

  test("appends, and the newest is the last pass", () => {
    const second = pass({ headSha: "c".repeat(40) });
    const marks = recordPass(recordPass(empty, pass()), second);
    expect(marks.passes).toHaveLength(2);
    expect(lastPass(marks)).toEqual(second);
  });

  test("a second pass at the same head replaces the first", () => {
    const later = pass({ at: "2026-09-01T00:00:00.000Z" });
    const marks = recordPass(recordPass(empty, pass()), later);
    expect(marks.passes).toEqual([later]);
  });

  test("keeps only the newest passes", () => {
    let marks = empty;
    for (let i = 0; i < PASSES_MAX + 5; i++) {
      marks = recordPass(marks, pass({ headSha: i.toString(16).padStart(40, "0") }));
    }
    expect(marks.passes).toHaveLength(PASSES_MAX);
    expect(lastPass(marks)?.headSha).toBe((PASSES_MAX + 4).toString(16).padStart(40, "0"));
  });

  test("does not change the file it was given", () => {
    recordPass(empty, pass());
    expect(empty.passes).toEqual([]);
  });

  test("has no last pass before the first one", () => {
    expect(lastPass(empty)).toBeNull();
  });
});
