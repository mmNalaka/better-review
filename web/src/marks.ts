import type { HunkIndex, HunkRef } from "../../server/diff";
import {
  markKey,
  noteKey,
  type HunkMark,
  type LineNote,
  type MarkFile,
} from "../../server/markmodel";

/**
 * Review marks, per ticket 04: hunks carry the state, files derive theirs.
 *
 * Every function here returns a new mark file — the server validates and
 * persists whatever it is handed, so a mutation in place would be a save the
 * UI never saw.
 */

export type { LineNote, MarkFile } from "../../server/markmodel";

/**
 * `changed` is *changed since reviewed*: a mark naming a hunk the diff no
 * longer has. It is not a reset to unreviewed — you did the work and the
 * ground moved — so it outranks every other state on the row.
 */
export type FileState = "none" | "partial" | "reviewed" | "changed";

const at = (marks: MarkFile, path: string, id: string): HunkMark | undefined =>
  marks.hunks[markKey(path, id)];

export const isReviewed = (marks: MarkFile, path: string, id: string): boolean =>
  at(marks, path, id)?.reviewed ?? false;

/** The note on exactly this anchor, if there is one. */
export const noteAt = (
  marks: MarkFile,
  path: string,
  hunkId: string,
  lineIndex: number | null,
  endLineIndex: number | null = null,
): LineNote | null => marks.notes[noteKey(path, hunkId, lineIndex, endLineIndex)] ?? null;

/** Every note inside one hunk — line notes and any about the hunk as a whole. */
export const notesIn = (marks: MarkFile, path: string, hunkId: string): readonly LineNote[] =>
  Object.values(marks.notes).filter((note) => note.path === path && note.hunkId === hunkId);

/** First and last line a note covers. Equal for a single-line note. */
export const rangeOf = (
  note: LineNote,
): { readonly start: number; readonly end: number } | null =>
  note.lineIndex === null
    ? null
    : { start: note.lineIndex, end: note.endLineIndex ?? note.lineIndex };

/**
 * Notes by the line they end on — where the box goes, as on GitHub: the
 * commented lines read as a block, and the comment follows them.
 */
export function notesByLastLine(
  marks: MarkFile,
  path: string,
  hunkId: string,
): ReadonlyMap<number, LineNote> {
  const byEnd = new Map<number, LineNote>();
  for (const note of notesIn(marks, path, hunkId)) {
    const range = rangeOf(note);
    if (range) byEnd.set(range.end, note);
  }
  return byEnd;
}

/** Every line index a note covers, for marking the block it refers to. */
export function coveredLines(marks: MarkFile, path: string, hunkId: string): ReadonlySet<number> {
  const covered = new Set<number>();
  for (const note of notesIn(marks, path, hunkId)) {
    const range = rangeOf(note);
    if (!range) continue;
    for (let line = range.start; line <= range.end; line++) covered.add(line);
  }
  return covered;
}

/** An unticked hunk with no note left on it is not worth storing. */
const withTick = (marks: MarkFile, key: string, mark: HunkMark): MarkFile => {
  const hunks = { ...marks.hunks };
  if (!mark.reviewed) delete hunks[key];
  else hunks[key] = mark;
  return { ...marks, hunks };
};

export function toggleHunk(
  marks: MarkFile,
  path: string,
  id: string,
  header: string,
  now: string,
): MarkFile {
  const before = at(marks, path, id);
  return withTick(marks, markKey(path, id), {
    path,
    id,
    header,
    reviewed: !(before?.reviewed ?? false),
    updatedAt: now,
  });
}

/**
 * Write, edit or clear the note on a line. An empty body removes it — the same
 * gesture that wrote it takes it back.
 */
export function setLineNote(
  marks: MarkFile,
  where: {
    readonly path: string;
    readonly hunkId: string;
    readonly lineIndex: number | null;
    readonly lineText: string | null;
    readonly endLineIndex?: number | null;
    readonly endLineText?: string | null;
  },
  body: string,
  now: string,
): MarkFile {
  // A range ending where it starts is one line; keep one key per anchor.
  const endLineIndex =
    where.endLineIndex === undefined || where.endLineIndex === where.lineIndex
      ? null
      : where.endLineIndex;
  const key = noteKey(where.path, where.hunkId, where.lineIndex, endLineIndex);
  const trimmed = body.trim();
  const notes = { ...marks.notes };

  if (trimmed === "") {
    delete notes[key];
    return { ...marks, notes };
  }

  const before = notes[key];
  notes[key] = {
    path: where.path,
    hunkId: where.hunkId,
    lineIndex: where.lineIndex,
    lineText: where.lineText,
    endLineIndex,
    endLineText: endLineIndex === null ? null : (where.endLineText ?? null),
    body: trimmed,
    updatedAt: now,
    // Edited words are unpublished words: posting the new ones is the point.
    published: before && before.body === trimmed ? before.published : null,
  };
  return { ...marks, notes };
}

/** One action for the whole file — the common case is "I read all of this". */
export function setFileReviewed(
  marks: MarkFile,
  path: string,
  hunks: readonly HunkRef[],
  reviewed: boolean,
  now: string,
): MarkFile {
  let next = marks;
  for (const hunk of hunks) {
    next = withTick(next, markKey(path, hunk.id), {
      path,
      id: hunk.id,
      header: hunk.header,
      reviewed,
      updatedAt: now,
    });
  }
  return next;
}

const ticksFor = (marks: MarkFile, path: string): readonly HunkMark[] =>
  Object.values(marks.hunks).filter((mark) => mark.path === path);

const notesFor = (marks: MarkFile, path: string): readonly LineNote[] =>
  Object.values(marks.notes).filter((note) => note.path === path);

export function fileState(marks: MarkFile, path: string, ids: readonly string[]): FileState {
  const live = new Set(ids);
  const mine = ticksFor(marks, path);
  const noted = notesFor(marks, path);
  // A note whose hunk is gone says the ground moved just as loudly as a tick's.
  if (mine.some((mark) => !live.has(mark.id))) return "changed";
  if (noted.some((note) => !live.has(note.hunkId))) return "changed";
  if (ids.length === 0) return "none";

  const ticked = ids.filter((id) => isReviewed(marks, path, id)).length;
  if (ticked === 0) return "none";
  return ticked === ids.length ? "reviewed" : "partial";
}

export const flagged = (marks: MarkFile, path: string): boolean =>
  notesFor(marks, path).length > 0;

export function progress(
  marks: MarkFile,
  index: HunkIndex,
  paths: readonly string[],
): { readonly reviewed: number; readonly total: number } {
  const reviewed = paths.filter(
    (path) =>
      fileState(
        marks,
        path,
        (index.files[path] ?? []).map((hunk) => hunk.id),
      ) === "reviewed",
  ).length;
  return { reviewed, total: paths.length };
}

export interface Finding {
  readonly path: string;
  /** The hunk the note is anchored in. */
  readonly hunkId: string;
  /** Null when the note is about the whole hunk rather than one line. */
  readonly lineIndex: number | null;
  readonly lineText: string | null;
  /** Set only when the note spans more than one line. */
  readonly endLineIndex: number | null;
  readonly note: string;
  readonly updatedAt: string;
  /** The hunk this note was written against is no longer in the diff. */
  readonly stale: boolean;
  readonly published: LineNote["published"];
}

/**
 * The notes, oldest first — the list you read back before publishing, and the
 * reason flags exist at all.
 */
export function findings(marks: MarkFile, index: HunkIndex): readonly Finding[] {
  return Object.values(marks.notes)
    .map((note) => ({
      path: note.path,
      hunkId: note.hunkId,
      lineIndex: note.lineIndex,
      lineText: note.lineText,
      endLineIndex: note.endLineIndex ?? null,
      note: note.body,
      updatedAt: note.updatedAt,
      stale: !(index.files[note.path] ?? []).some((hunk) => hunk.id === note.hunkId),
      published: note.published,
    }))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.path.localeCompare(b.path));
}
