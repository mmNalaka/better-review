import { describe, expect, test } from "bun:test";

import { emptyMarkFile, noteKey, type MarkFile } from "../../server/markmodel";
import type { HunkIndex } from "../../server/diff";
import {
  fileState,
  findings,
  flagged,
  noteAt,
  notesIn,
  progress,
  setFileReviewed,
  setLineNote,
  toggleHunk,
} from "./marks";

const PR = { owner: "sitoo", repo: "auth", number: 146 } as const;
const NOW = "2026-08-27T09:00:00.000Z";
const LATER = "2026-08-27T10:00:00.000Z";
const EMPTY: MarkFile = emptyMarkFile(PR);

const A1 = "1111111111111111";
const A2 = "2222222222222222";
const B1 = "3333333333333333";

const ref = (id: string) => ({ id, header: `@@ ${id} @@` });
const index: HunkIndex = {
  files: { "a.go": [ref(A1), ref(A2)], "b.go": [ref(B1)], "c.go": [] },
};
const ids = (path: string) => index.files[path]!.map((hunk) => hunk.id);

const tick = (marks: MarkFile, path: string, id: string) =>
  toggleHunk(marks, path, id, `@@ ${id} @@`, NOW);

const note = (
  marks: MarkFile,
  path: string,
  hunkId: string,
  lineIndex: number | null,
  body: string,
  now = NOW,
) => setLineNote(marks, { path, hunkId, lineIndex, lineText: "\tnew()" }, body, now);

describe("toggleHunk", () => {
  test("does not mutate what it is given", () => {
    const after = tick(EMPTY, "a.go", A1);
    expect(EMPTY.hunks).toEqual({});
    expect(after.hunks[`a.go@${A1}`]?.reviewed).toBe(true);
  });

  test("unticking drops the tick but never the notes on that hunk", () => {
    const noted = note(tick(EMPTY, "a.go", A1), "a.go", A1, 2, "ordering?");
    const off = tick(noted, "a.go", A1);
    expect(off.hunks).toEqual({});
    expect(noteAt(off, "a.go", A1, 2)?.body).toBe("ordering?");
  });

  test("the same hunk id in another file is a different mark", () => {
    expect(fileState(tick(EMPTY, "a.go", A1), "b.go", [A1])).toBe("none");
  });
});

describe("setLineNote", () => {
  test("hangs a note under one line, and keeps the line's text with it", () => {
    const noted = note(EMPTY, "a.go", A1, 3, "why here?");
    expect(noteAt(noted, "a.go", A1, 3)?.body).toBe("why here?");
    expect(noteAt(noted, "a.go", A1, 3)?.lineText).toBe("\tnew()");
    expect(noteAt(noted, "a.go", A1, 4)).toBeNull();
  });

  test("two lines in one hunk carry two notes", () => {
    let marks = note(EMPTY, "a.go", A1, 1, "first");
    marks = note(marks, "a.go", A1, 5, "second");
    expect(notesIn(marks, "a.go", A1).map((entry) => entry.body).sort()).toEqual([
      "first",
      "second",
    ]);
  });

  test("a note about the whole hunk is distinct from one on its first line", () => {
    let marks = note(EMPTY, "a.go", A1, null, "about the hunk");
    marks = note(marks, "a.go", A1, 0, "about the line");
    expect(noteAt(marks, "a.go", A1, null)?.body).toBe("about the hunk");
    expect(noteAt(marks, "a.go", A1, 0)?.body).toBe("about the line");
  });

  test("an empty body deletes the note", () => {
    const noted = note(EMPTY, "a.go", A1, 3, "why?");
    expect(noteAt(note(noted, "a.go", A1, 3, "   "), "a.go", A1, 3)).toBeNull();
    expect(note(noted, "a.go", A1, 3, "").notes).toEqual({});
  });

  test("editing a published note unpublishes it, so the new words can be posted", () => {
    const key = noteKey("a.go", A1, 3);
    const published: MarkFile = {
      ...EMPTY,
      notes: {
        [key]: {
          path: "a.go",
          hunkId: A1,
          lineIndex: 3,
          lineText: "\tnew()",
          body: "first words",
          updatedAt: NOW,
          published: { at: NOW, url: "https://example/1" },
        },
      },
    };
    expect(note(published, "a.go", A1, 3, "second words").notes[key]?.published).toBeNull();
    expect(note(published, "a.go", A1, 3, "  first words  ").notes[key]?.published?.url).toBe(
      "https://example/1",
    );
  });
});

describe("fileState", () => {
  test("none, partial, then reviewed", () => {
    expect(fileState(EMPTY, "a.go", ids("a.go"))).toBe("none");
    const one = tick(EMPTY, "a.go", A1);
    expect(fileState(one, "a.go", ids("a.go"))).toBe("partial");
    expect(fileState(tick(one, "a.go", A2), "a.go", ids("a.go"))).toBe("reviewed");
  });

  test("a tick whose hunk is gone reads as changed since reviewed", () => {
    expect(fileState(tick(EMPTY, "a.go", "9999999999999999"), "a.go", ids("a.go"))).toBe("changed");
  });

  test("a note whose hunk is gone says the ground moved too", () => {
    const orphan = note(EMPTY, "a.go", "9999999999999999", 1, "was here");
    expect(fileState(orphan, "a.go", ids("a.go"))).toBe("changed");
  });

  test("changed outranks reviewed", () => {
    let marks = tick(tick(EMPTY, "a.go", A1), "a.go", A2);
    marks = tick(marks, "a.go", "9999999999999999");
    expect(fileState(marks, "a.go", ids("a.go"))).toBe("changed");
  });

  test("a file with no hunks is none, not reviewed", () => {
    expect(fileState(EMPTY, "c.go", ids("c.go"))).toBe("none");
  });

  test("a note alone is not reviewed, but it does flag the file", () => {
    const noted = note(EMPTY, "b.go", B1, 0, "why?");
    expect(fileState(noted, "b.go", ids("b.go"))).toBe("none");
    expect(flagged(noted, "b.go")).toBe(true);
    expect(flagged(noted, "a.go")).toBe(false);
  });
});

describe("setFileReviewed", () => {
  test("ticks every hunk in the file in one action, and back again", () => {
    const all = setFileReviewed(EMPTY, "a.go", index.files["a.go"]!, true, NOW);
    expect(fileState(all, "a.go", ids("a.go"))).toBe("reviewed");
    const none = setFileReviewed(all, "a.go", index.files["a.go"]!, false, NOW);
    expect(fileState(none, "a.go", ids("a.go"))).toBe("none");
  });

  test("clearing a file's ticks keeps its notes", () => {
    let marks = setFileReviewed(EMPTY, "a.go", index.files["a.go"]!, true, NOW);
    marks = note(marks, "a.go", A1, 2, "look again");
    marks = setFileReviewed(marks, "a.go", index.files["a.go"]!, false, NOW);
    expect(noteAt(marks, "a.go", A1, 2)?.body).toBe("look again");
  });
});

describe("progress", () => {
  test("counts files, not hunks — the explorer is a list of files", () => {
    let marks = setFileReviewed(EMPTY, "a.go", index.files["a.go"]!, true, NOW);
    marks = tick(marks, "b.go", B1);
    expect(progress(marks, index, ["a.go", "b.go", "c.go"])).toEqual({ reviewed: 2, total: 3 });
  });
});

describe("findings", () => {
  test("collects notes with their anchor, oldest first", () => {
    let marks = note(EMPTY, "a.go", A1, 1, "first", NOW);
    marks = note(marks, "b.go", B1, null, "second", LATER);
    const list = findings(marks, index);
    expect(list.map((finding) => finding.note)).toEqual(["first", "second"]);
    expect(list[0]).toMatchObject({ path: "a.go", hunkId: A1, lineIndex: 1, stale: false });
    expect(list[1]?.lineIndex).toBeNull();
  });

  test("marks a finding stale when its hunk is gone", () => {
    const marks = note(EMPTY, "a.go", "9999999999999999", 1, "why?");
    expect(findings(marks, index)[0]?.stale).toBe(true);
  });

  test("ignores ticks: progress is not a finding", () => {
    expect(findings(tick(EMPTY, "a.go", A1), index)).toEqual([]);
  });
});
