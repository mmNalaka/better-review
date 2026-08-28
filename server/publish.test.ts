import { describe, expect, test } from "bun:test";

import { parseUnifiedDiff, type FileHunks } from "./diff";
import { emptyMarkFile, noteKey, type MarkFile } from "./markmodel";
import { planReview } from "./publish";

const PR = { owner: "sitoo", repo: "auth", number: 146 } as const;

/** An added-lines hunk at 44, and a deletion-only hunk at 90. */
const ADDED = parseUnifiedDiff(
  "@@ -44,3 +44,4 @@ func assignScope(\n ctx := c\n-\told()\n+\tnew()\n+\tmore()\n",
).hunks[0]!;
const DELETED = parseUnifiedDiff("@@ -90,3 +91,1 @@\n gone := 1\n-\tone()\n-\ttwo()\n").hunks[0]!;

const byFile = new Map<string, FileHunks>([
  ["service/scim.go", { hunks: [ADDED, DELETED], binary: false }],
]);

/** A note about the whole hunk — what a version 1 note migrates to. */
const noted = (
  id: string,
  body: string,
  published: { at: string; url: string } | null = null,
): MarkFile => ({
  ...emptyMarkFile(PR),
  notes: {
    [noteKey("service/scim.go", id, null)]: {
      path: "service/scim.go",
      hunkId: id,
      lineIndex: null,
      lineText: null,
      body,
      updatedAt: "2026-08-27T09:00:00.000Z",
      published,
    },
  },
});

/** A note spanning several lines of a hunk. */
const notedRange = (
  id: string,
  lineIndex: number,
  lineText: string,
  endLineIndex: number,
  endLineText: string,
  body: string,
): MarkFile => ({
  ...emptyMarkFile(PR),
  notes: {
    [noteKey("service/scim.go", id, lineIndex, endLineIndex)]: {
      path: "service/scim.go",
      hunkId: id,
      lineIndex,
      lineText,
      endLineIndex,
      endLineText,
      body,
      updatedAt: "2026-08-27T09:00:00.000Z",
      published: null,
    },
  },
});

/** A note on one line inside a hunk — the inline case. */
const notedAt = (
  id: string,
  lineIndex: number,
  lineText: string | null,
  body: string,
): MarkFile => ({
  ...emptyMarkFile(PR),
  notes: {
    [noteKey("service/scim.go", id, lineIndex)]: {
      path: "service/scim.go",
      hunkId: id,
      lineIndex,
      lineText,
      body,
      updatedAt: "2026-08-27T09:00:00.000Z",
      published: null,
    },
  },
});

describe("planReview", () => {
  test("anchors a note to the added lines it was written against", () => {
    const plan = planReview(noted(ADDED.id, "ordering?"), byFile);
    expect(plan.comments).toEqual([
      {
        path: "service/scim.go",
        body: "ordering?",
        side: "RIGHT",
        start_line: 45,
        start_side: "RIGHT",
        line: 46,
      },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  test("anchors a deletion-only hunk to the base side, where its lines still exist", () => {
    const plan = planReview(noted(DELETED.id, "why remove this?"), byFile);
    expect(plan.comments[0]).toMatchObject({
      side: "LEFT",
      start_line: 91,
      start_side: "LEFT",
      line: 92,
    });
  });

  test("omits start_line for a single-line change, which GitHub rejects when equal", () => {
    const one = parseUnifiedDiff("@@ -5,1 +5,1 @@\n-\ta()\n+\tb()\n").hunks[0]!;
    const plan = planReview(noted(one.id, "here"), new Map([
      ["service/scim.go", { hunks: [one], binary: false }],
    ]));
    expect(plan.comments[0]).toEqual({
      path: "service/scim.go",
      body: "here",
      side: "RIGHT",
      line: 5,
    });
  });

  test("skips a note whose hunk is no longer in the diff rather than guessing a line", () => {
    const plan = planReview(noted("9999999999999999", "stale"), byFile);
    expect(plan.comments).toEqual([]);
    expect(plan.skipped[0]?.reason).toContain("no longer");
  });

  test("skips a note that was already posted, so publishing twice is not double-posting", () => {
    const plan = planReview(
      noted(ADDED.id, "ordering?", { at: "2026-08-27T09:30:00.000Z", url: "https://example/1" }),
      byFile,
    );
    expect(plan.comments).toEqual([]);
    expect(plan.skipped[0]?.reason).toContain("already");
  });

  test("skips a file the diff does not have at all", () => {
    const plan = planReview(noted(ADDED.id, "x"), new Map());
    expect(plan.skipped).toHaveLength(1);
    expect(plan.comments).toEqual([]);
  });

  test("ignores ticks: progress is not a comment", () => {
    const ticks: MarkFile = {
      ...emptyMarkFile(PR),
      hunks: {
        [`service/scim.go@${ADDED.id}`]: {
          path: "service/scim.go",
          id: ADDED.id,
          header: "@@ header @@",
          reviewed: true,
          updatedAt: "2026-08-27T09:00:00.000Z",
        },
      },
    };
    expect(planReview(ticks, byFile).comments).toEqual([]);
  });

  test("anchors an inline note to its own line, not to the whole hunk", () => {
    // ADDED: [context "ctx := c", removed "\told()", added "\tnew()", added "\tmore()"]
    const plan = planReview(notedAt(ADDED.id, 3, "\tmore()", "this one"), byFile);
    expect(plan.comments).toEqual([
      { path: "service/scim.go", body: "this one", side: "RIGHT", line: 46 },
    ]);
  });

  test("puts a note on a removed line on the base side, where that line exists", () => {
    const plan = planReview(notedAt(ADDED.id, 1, "\told()", "why drop this?"), byFile);
    expect(plan.comments[0]).toEqual({
      path: "service/scim.go",
      body: "why drop this?",
      side: "LEFT",
      line: 45,
    });
  });

  test("comments on a context line, as the diff view allows", () => {
    const plan = planReview(notedAt(ADDED.id, 0, "ctx := c", "unchanged, but relevant"), byFile);
    expect(plan.comments[0]).toMatchObject({ side: "RIGHT", line: 44 });
  });

  test("follows the text when context drift moved the line", () => {
    // Written at index 3; the live hunk has that text at a different offset.
    const plan = planReview(notedAt(ADDED.id, 99, "\tnew()", "moved"), byFile);
    expect(plan.comments[0]).toMatchObject({ side: "RIGHT", line: 45 });
  });

  test("skips a note whose line is gone, rather than landing it on another line", () => {
    const plan = planReview(notedAt(ADDED.id, 2, "\tvanished()", "gone"), byFile);
    expect(plan.comments).toEqual([]);
    expect(plan.skipped[0]?.reason).toContain("line it was written against");
  });

  test("spans a range of added lines", () => {
    // ADDED lines: [0] context 44, [1] removed 45, [2] added 45, [3] added 46
    const plan = planReview(
      notedRange(ADDED.id, 2, "\tnew()", 3, "\tmore()", "both of these"),
      byFile,
    );
    expect(plan.comments).toEqual([
      {
        path: "service/scim.go",
        body: "both of these",
        side: "RIGHT",
        start_line: 45,
        start_side: "RIGHT",
        line: 46,
      },
    ]);
  });

  test("spans removed lines on the base side", () => {
    const plan = planReview(
      notedRange(DELETED.id, 1, "\tone()", 2, "\ttwo()", "both gone"),
      byFile,
    );
    expect(plan.comments[0]).toMatchObject({
      side: "LEFT",
      start_side: "LEFT",
      start_line: 91,
      line: 92,
    });
  });

  test("a range that crosses the split keeps each end on its own side", () => {
    const plan = planReview(
      notedRange(ADDED.id, 1, "\told()", 3, "\tmore()", "this became that"),
      byFile,
    );
    expect(plan.comments[0]).toMatchObject({
      start_side: "LEFT",
      start_line: 45,
      side: "RIGHT",
      line: 46,
    });
  });

  test("skips a range whose last line is gone rather than quietly shrinking it", () => {
    const plan = planReview(
      notedRange(ADDED.id, 2, "\tnew()", 3, "\tvanished()", "both"),
      byFile,
    );
    expect(plan.comments).toEqual([]);
    expect(plan.skipped[0]?.reason).toContain("line it was written against");
  });

  test("carries a suggestion through untouched — GitHub renders the fence", () => {
    const body = "use the helper\n\n```suggestion\n\tnewer()\n```";
    const plan = planReview(notedAt(ADDED.id, 3, "\tmore()", body), byFile);
    expect(plan.comments[0]?.body).toBe(body);
  });

  test("refuses a suggestion on a removed line: GitHub can only apply one to the head", () => {
    const plan = planReview(
      notedAt(ADDED.id, 1, "\told()", "```suggestion\n\tkept()\n```"),
      byFile,
    );
    expect(plan.comments).toEqual([]);
    expect(plan.skipped[0]?.reason).toContain("head side");
  });

  test("refuses a suggestion on a range that starts on the base side", () => {
    const plan = planReview(
      notedRange(ADDED.id, 1, "\told()", 3, "\tmore()", "```suggestion\n\tone()\n```"),
      byFile,
    );
    expect(plan.comments).toEqual([]);
    expect(plan.skipped[0]?.reason).toContain("head side");
  });

  test("orders comments by file then position, so the review reads top to bottom", () => {
    const marks: MarkFile = {
      ...emptyMarkFile(PR),
      notes: {
        ...noted(DELETED.id, "second").notes,
        ...noted(ADDED.id, "first").notes,
      },
    };
    expect(planReview(marks, byFile).comments.map((c) => c.body)).toEqual(["first", "second"]);
  });
});
