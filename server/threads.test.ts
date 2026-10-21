import { describe, expect, test } from "bun:test";

import type { Hunk } from "./diff";
import {
  buildThreads,
  mirrorsThread,
  nextOpenThread,
  placeThreads,
  threadWhere,
  toThread,
  type RawThread,
  type ReviewThread,
} from "./threads";

const raw = (overrides: Partial<RawThread> = {}): RawThread => ({
  id: "T_1",
  path: "src/a.ts",
  line: 11,
  startLine: null,
  originalLine: 11,
  diffSide: "RIGHT",
  isResolved: false,
  isOutdated: false,
  comments: {
    nodes: [
      {
        databaseId: 7,
        author: { login: "octocat", avatarUrl: "https://example.com/a.png" },
        body: "why this?",
        createdAt: "2026-01-01T00:00:00Z",
        url: "https://github.com/o/r/pull/1#discussion_r7",
      },
    ],
  },
  ...overrides,
});

const thread = (overrides: Partial<RawThread> = {}): ReviewThread => toThread(raw(overrides));

const hunk: Hunk = {
  id: "h1",
  header: "@@ -10,3 +10,3 @@",
  oldStart: 10,
  newStart: 10,
  lines: [
    { kind: "context", text: "a", oldLine: 10, newLine: 10 },
    { kind: "removed", text: "b", oldLine: 11, newLine: null },
    { kind: "added", text: "B", oldLine: null, newLine: 11 },
    { kind: "context", text: "c", oldLine: 12, newLine: 12 },
  ],
};

describe("toThread", () => {
  test("maps a thread and its comments", () => {
    expect(thread()).toEqual({
      id: "T_1",
      path: "src/a.ts",
      line: 11,
      startLine: null,
      originalLine: 11,
      side: "RIGHT",
      resolved: false,
      outdated: false,
      comments: [
        {
          id: 7,
          author: "octocat",
          avatarUrl: "https://example.com/a.png",
          body: "why this?",
          createdAt: "2026-01-01T00:00:00Z",
          url: "https://github.com/o/r/pull/1#discussion_r7",
        },
      ],
    });
  });

  test("survives a deleted author and null comment nodes", () => {
    const shaped = thread({ comments: { nodes: [null, { body: "hi", author: null }] } });
    expect(shaped.comments).toHaveLength(1);
    expect(shaped.comments[0]?.author).toBe("unknown");
  });

  test("treats anything but LEFT as the head side", () => {
    expect(thread({ diffSide: null }).side).toBe("RIGHT");
    expect(thread({ diffSide: "LEFT" }).side).toBe("LEFT");
  });
});

describe("buildThreads", () => {
  test("drops threads with no comments or no path", () => {
    const built = buildThreads([raw(), raw({ id: "T_2", comments: { nodes: [] } }), raw({ id: "T_3", path: null })]);
    expect(built.map((t) => t.id)).toEqual(["T_1"]);
  });
});

describe("placeThreads", () => {
  test("hangs a RIGHT thread under the added line", () => {
    const placed = placeThreads([hunk], [thread()]);
    expect(placed.byHunk.get("h1")?.get(2)?.map((t) => t.id)).toEqual(["T_1"]);
    expect(placed.unplaced).toEqual([]);
  });

  test("hangs a LEFT thread under the removed line", () => {
    const placed = placeThreads([hunk], [thread({ diffSide: "LEFT" })]);
    expect(placed.byHunk.get("h1")?.get(1)).toHaveLength(1);
  });

  test("puts two threads on one line together", () => {
    const placed = placeThreads([hunk], [thread(), thread({ id: "T_2" })]);
    expect(placed.byHunk.get("h1")?.get(2)?.map((t) => t.id)).toEqual(["T_1", "T_2"]);
  });

  test("leaves outdated, file-level and off-diff threads unplaced", () => {
    const outdated = thread({ id: "T_o", isOutdated: true });
    const fileLevel = thread({ id: "T_f", line: null });
    const elsewhere = thread({ id: "T_e", line: 400 });
    const placed = placeThreads([hunk], [outdated, fileLevel, elsewhere]);
    expect(placed.byHunk.size).toBe(0);
    expect(placed.unplaced.map((t) => t.id)).toEqual(["T_o", "T_f", "T_e"]);
  });
});

describe("mirrorsThread", () => {
  test("matches a published note to the thread it opened, ignoring edge whitespace", () => {
    expect(mirrorsThread("why this?\n", [thread()])).toBe(true);
    expect(mirrorsThread("something else", [thread()])).toBe(false);
  });
});

describe("threadWhere", () => {
  test("names a line, a range, or the file", () => {
    expect(threadWhere(thread())).toBe("line 11");
    expect(threadWhere(thread({ startLine: 9 }))).toBe("lines 9–11");
    expect(threadWhere(thread({ line: null, originalLine: 5 }))).toBe("line 5");
    expect(threadWhere(thread({ line: null, originalLine: null }))).toBe("the file");
  });
});

describe("nextOpenThread", () => {
  const threads = [
    thread({ id: "b2", path: "b.ts", line: 20 }),
    thread({ id: "a9", path: "a.ts", line: 9 }),
    thread({ id: "b1", path: "b.ts", line: 3 }),
    thread({ id: "done", path: "a.ts", line: 1, isResolved: true }),
    thread({ id: "z", path: "z.ts", line: 1 }),
  ];
  const order = ["b.ts", "a.ts"];

  test("starts at the first open thread in explorer order, then by line", () => {
    expect(nextOpenThread(threads, order, null)?.id).toBe("b1");
  });

  test("walks on, puts unlisted files last, and wraps", () => {
    const walk = ["b1", "b2", "a9", "z"].map((id) => nextOpenThread(threads, order, id)?.id);
    expect(walk).toEqual(["b2", "a9", "z", "b1"]);
  });

  test("starts over when the last one is gone, and is null with none open", () => {
    expect(nextOpenThread(threads, order, "vanished")?.id).toBe("b1");
    expect(nextOpenThread([threads[3]!], order, null)).toBeNull();
  });
});
