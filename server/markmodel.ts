/**
 * The review-mark model from ticket 04, and the only validator for it.
 *
 * Pure — no filesystem, no network — because the web client imports it too:
 * marks travel between the two as JSON, and a shape the client can write but
 * the server rejects would be a bug found only at save time.
 *
 * Version 2 splits the two things a mark records. A tick is progress and
 * belongs to a hunk. A note is a comment and belongs to a **line**, so it can
 * be read where it was written, the way a pull request review reads. Both stay
 * content-addressed: the anchor is a hunk id, never a line number.
 */

export const MARK_VERSION = 2;

/** A note is a line of reasoning, not a document. */
export const NOTE_MAX = 4000;

/** A guard against a runaway body, well above any real pull request. */
export const MARKS_MAX = 5000;

export interface PublishedNote {
  /** ISO-8601. */
  readonly at: string;
  /** The comment's URL on GitHub, so a published note can be opened again. */
  readonly url: string;
}

/** Progress on one hunk. */
export interface HunkMark {
  readonly path: string;
  /** The hunk's content-addressed id — see hunkid.ts. */
  readonly id: string;
  /** The hunk header as it read when marked, so a finding can name its place. */
  readonly header: string;
  readonly reviewed: boolean;
  /** ISO-8601. */
  readonly updatedAt: string;
}

/** A comment, anchored inside a hunk. */
export interface LineNote {
  readonly path: string;
  readonly hunkId: string;
  /**
   * Index into the hunk's lines. Null means the note is about the hunk as a
   * whole — what a version 1 note becomes, since version 1 never recorded a
   * line.
   */
  readonly lineIndex: number | null;
  /**
   * The line's text when the note was written. The hunk id covers added and
   * removed lines only, so the context around them can drift; matching the
   * text re-finds the line when it does.
   */
  readonly lineText: string | null;
  /**
   * Last line of the range, for a comment that spans several lines. Null for a
   * single-line note — which is every note written before ranges existed, so
   * absence has to mean "one line" rather than "unknown".
   */
  readonly endLineIndex?: number | null;
  readonly endLineText?: string | null;
  readonly body: string;
  /** ISO-8601. */
  readonly updatedAt: string;
  /** Set once posted, so the same note is never posted twice. */
  readonly published: PublishedNote | null;
}

export interface MarkFile {
  readonly version: typeof MARK_VERSION;
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  /** Ticks, keyed by `markKey`. */
  readonly hunks: Readonly<Record<string, HunkMark>>;
  /** Comments, keyed by `noteKey`. */
  readonly notes: Readonly<Record<string, LineNote>>;
}

export interface PrRef {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

export class MarkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarkError";
  }
}

/**
 * An id identifies a hunk's content; the same one-line addition can appear in
 * two files and must not be one mark. The path scopes it.
 */
export const markKey = (path: string, id: string): string => `${path}@${id}`;

/**
 * One note per anchor — editing replaces, as flags always have. A range is a
 * different anchor from its first line: `#3` and `#3-7` are two notes.
 */
export const noteKey = (
  path: string,
  hunkId: string,
  lineIndex: number | null,
  endLineIndex: number | null = null,
): string => {
  if (lineIndex === null) return `${path}@${hunkId}#hunk`;
  const span = endLineIndex === null || endLineIndex === lineIndex ? "" : `-${endLineIndex}`;
  return `${path}@${hunkId}#${lineIndex}${span}`;
};

export const emptyMarkFile = (pr: PrRef): MarkFile => ({
  version: MARK_VERSION,
  owner: pr.owner,
  repo: pr.repo,
  number: pr.number,
  hunks: {},
  notes: {},
});

const ID = /^[0-9a-f]{16}$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireString = (value: unknown, what: string, max = 512): string => {
  if (typeof value !== "string") throw new MarkError(`${what} must be a string`);
  if (value.length > max) throw new MarkError(`${what} is longer than ${max} characters`);
  return value;
};

/** Marks name files; a path that escapes the repo has no business being one. */
const requireRepoPath = (value: unknown): string => {
  const path = requireString(value, "path", 1024);
  if (!path || path.startsWith("/") || path.split("/").includes("..")) {
    throw new MarkError(`Not a repo-relative path: "${path}"`);
  }
  return path;
};

const requireHunkId = (value: unknown, what: string): string => {
  const id = requireString(value, what, 64);
  if (!ID.test(id)) throw new MarkError(`Not a hunk id: "${id}"`);
  return id;
};

function parsePublished(value: unknown): PublishedNote | null {
  if (value === null || value === undefined) return null;
  if (!isObject(value)) throw new MarkError("published must be an object or null");
  return {
    at: requireString(value.at, "published.at", 40),
    url: requireString(value.url, "published.url", 512),
  };
}

function parseTick(value: unknown, key: string): HunkMark {
  if (!isObject(value)) throw new MarkError(`Mark "${key}" is not an object`);

  const path = requireRepoPath(value.path);
  const id = requireHunkId(value.id, "id");
  if (markKey(path, id) !== key) {
    throw new MarkError(`Mark "${key}" does not match its own path and id`);
  }
  if (typeof value.reviewed !== "boolean") throw new MarkError("reviewed must be a boolean");

  return {
    path,
    id,
    header: requireString(value.header, "header"),
    reviewed: value.reviewed,
    updatedAt: requireString(value.updatedAt, "updatedAt", 40),
  };
}

function parseLineIndex(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new MarkError(`Not a line index: ${String(value)}`);
  }
  return value;
}

function parseNote(value: unknown, key: string): LineNote {
  if (!isObject(value)) throw new MarkError(`Note "${key}" is not an object`);

  const path = requireRepoPath(value.path);
  const hunkId = requireHunkId(value.hunkId, "hunkId");
  const lineIndex = parseLineIndex(value.lineIndex);
  const endLineIndex = parseLineIndex(value.endLineIndex);

  if (endLineIndex !== null) {
    if (lineIndex === null) throw new MarkError("A range needs a first line");
    if (endLineIndex < lineIndex) throw new MarkError("A range must end after it starts");
  }
  if (noteKey(path, hunkId, lineIndex, endLineIndex) !== key) {
    throw new MarkError(`Note "${key}" does not match its own anchor`);
  }

  const body = requireString(value.body, "body", NOTE_MAX).trim();
  if (body === "") throw new MarkError("A note needs words");

  return {
    path,
    hunkId,
    lineIndex,
    lineText:
      value.lineText === null || value.lineText === undefined
        ? null
        : requireString(value.lineText, "lineText", 4096),
    endLineIndex,
    endLineText:
      value.endLineText === null || value.endLineText === undefined
        ? null
        : requireString(value.endLineText, "endLineText", 4096),
    body,
    updatedAt: requireString(value.updatedAt, "updatedAt", 40),
    published: parsePublished(value.published),
  };
}

/**
 * Version 1 kept one note inside each hunk mark. It never recorded a line, so
 * the note becomes one about the whole hunk rather than a guess at a line.
 */
function migrateFromV1(input: Record<string, unknown>, pr: PrRef): MarkFile {
  if (!isObject(input.hunks)) throw new MarkError("hunks must be an object");

  const hunks: Record<string, HunkMark> = {};
  const notes: Record<string, LineNote> = {};

  for (const [key, value] of Object.entries(input.hunks)) {
    if (!isObject(value)) throw new MarkError(`Mark "${key}" is not an object`);
    const tick = parseTick(value, key);
    hunks[key] = tick;

    if (value.note === null || value.note === undefined) continue;
    const body = requireString(value.note, "note", NOTE_MAX).trim();
    if (body === "") continue;

    notes[noteKey(tick.path, tick.id, null)] = {
      path: tick.path,
      hunkId: tick.id,
      lineIndex: null,
      lineText: null,
      endLineIndex: null,
      endLineText: null,
      body,
      updatedAt: tick.updatedAt,
      published: parsePublished(value.published),
    };
  }

  return { version: MARK_VERSION, owner: pr.owner, repo: pr.repo, number: pr.number, hunks, notes };
}

/**
 * Validates a mark file, whether it came off disk or off the wire, migrating an
 * older one on the way through. Throws rather than repairing: silently dropping
 * a mark is exactly the failure a review tool must not have.
 */
export function parseMarkFile(input: unknown, pr: PrRef): MarkFile {
  if (!isObject(input)) throw new MarkError("Marks must be an object");
  if (input.owner !== pr.owner || input.repo !== pr.repo || input.number !== pr.number) {
    throw new MarkError(
      `Marks are for ${String(input.owner)}/${String(input.repo)}#${String(input.number)}, not ${pr.owner}/${pr.repo}#${pr.number}`,
    );
  }

  if (input.version === 1) return migrateFromV1(input, pr);
  if (input.version !== MARK_VERSION) {
    throw new MarkError(`Unsupported marks version: ${String(input.version)}`);
  }
  if (!isObject(input.hunks)) throw new MarkError("hunks must be an object");
  if (!isObject(input.notes)) throw new MarkError("notes must be an object");

  const tickEntries = Object.entries(input.hunks);
  const noteEntries = Object.entries(input.notes);
  if (tickEntries.length + noteEntries.length > MARKS_MAX) {
    throw new MarkError(`More than ${MARKS_MAX} marks`);
  }

  const hunks: Record<string, HunkMark> = {};
  for (const [key, value] of tickEntries) hunks[key] = parseTick(value, key);

  const notes: Record<string, LineNote> = {};
  for (const [key, value] of noteEntries) notes[key] = parseNote(value, key);

  return { version: MARK_VERSION, owner: pr.owner, repo: pr.repo, number: pr.number, hunks, notes };
}
