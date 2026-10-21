import { parseUnifiedDiff, type DiffLine } from "./diff";
import { git, readBlob } from "./git";

/**
 * One file's past: every commit that touched it, and any of those versions
 * laid side by side against the pull request head.
 */

export interface FileRevision {
  readonly sha: string;
  readonly subject: string;
  readonly author: string;
  /** ISO-8601, from `git log --date=iso-strict`. */
  readonly date: string;
  /** What the file was called at this commit — it differs across a rename. */
  readonly path: string;
}

export type CompareKind = "context" | "removed" | "added";

export interface CompareSide {
  /** 1-based line number on this side. */
  readonly line: number;
  readonly text: string;
  readonly kind: CompareKind;
}

/** One visual row: the older version on the left, the newer on the right. */
export interface CompareRow {
  readonly left: CompareSide | null;
  readonly right: CompareSide | null;
}

export interface Comparison {
  readonly rows: readonly CompareRow[];
  readonly binary: boolean;
}

/** Enough to read a file's story; older than this is rarely what a reviewer wants. */
export const HISTORY_LIMIT = 200;

/**
 * More context than any source file has lines, so the diff carries the whole
 * file and the two columns can show it end to end rather than in hunks.
 */
const WHOLE_FILE_CONTEXT = 1_000_000;

const RECORD = "\x1e";
const FIELD = "\x1f";
const NUL = "\0";

/**
 * Parses `git log -z --name-only --format=<RS>%H<US>%s<US>%an<US>%ad`. Each
 * record is the header, a NUL, then a newline and the path git knew the file
 * by at that commit — which is what `--follow` changes across a rename.
 */
export function parseFileLog(out: string): readonly FileRevision[] {
  return out
    .split(RECORD)
    .filter(Boolean)
    .flatMap((record) => {
      const [header = "", rawPath = ""] = record.split(NUL);
      const path = rawPath.trim();
      if (!path) return [];
      const [sha = "", subject = "", author = "", date = ""] = header.split(FIELD);
      return [{ sha, subject, author, date, path }];
    });
}

export async function fileHistory(
  dir: string,
  head: string,
  path: string,
): Promise<readonly FileRevision[]> {
  const out = await git(
    dir,
    "log",
    "--follow",
    "-z",
    "--name-only",
    `-n${HISTORY_LIMIT}`,
    `--format=${RECORD}%H${FIELD}%s${FIELD}%an${FIELD}%ad`,
    "--date=iso-strict",
    head,
    "--",
    path,
  );
  return parseFileLog(out);
}

const sideOf = (line: DiffLine, which: "old" | "new"): CompareSide | null => {
  const number = which === "old" ? line.oldLine : line.newLine;
  return number === null ? null : { line: number, text: line.text, kind: line.kind };
};

/**
 * Lays a whole-file diff out in two columns. Within one change block the
 * removed lines pair with the added ones in order, so a rewritten line sits
 * beside what it replaced; whichever side runs out is left blank.
 */
export function sideBySide(lines: readonly DiffLine[]): readonly CompareRow[] {
  const rows: CompareRow[] = [];
  let removed: CompareSide[] = [];
  let added: CompareSide[] = [];

  const flush = () => {
    const span = Math.max(removed.length, added.length);
    for (let i = 0; i < span; i += 1) {
      rows.push({ left: removed[i] ?? null, right: added[i] ?? null });
    }
    removed = [];
    added = [];
  };

  for (const line of lines) {
    if (line.kind === "removed") {
      removed = [...removed, { line: line.oldLine ?? 0, text: line.text, kind: "removed" }];
    } else if (line.kind === "added") {
      added = [...added, { line: line.newLine ?? 0, text: line.text, kind: "added" }];
    } else {
      flush();
      rows.push({ left: sideOf(line, "old"), right: sideOf(line, "new") });
    }
  }
  flush();
  return rows;
}

const unchanged = (text: string): readonly CompareRow[] =>
  text
    .replace(/\n$/, "")
    .split("\n")
    .map((content, index) => {
      const side = { line: index + 1, text: content, kind: "context" as const };
      return { left: side, right: side };
    });

/**
 * `from:fromPath` against `to:toPath` — blob to blob, so a renamed file still
 * lines up with what it used to be called.
 */
export async function compareFile(
  dir: string,
  from: string,
  fromPath: string,
  to: string,
  toPath: string,
): Promise<Comparison> {
  const patch = await git(
    dir,
    "diff",
    "--no-color",
    `--unified=${WHOLE_FILE_CONTEXT}`,
    `${from}:${fromPath}`,
    `${to}:${toPath}`,
  );
  const { hunks, binary } = parseUnifiedDiff(patch);
  if (binary) return { rows: [], binary: true };
  // No hunks means the two versions are identical: show the file once over.
  if (hunks.length === 0) return { rows: unchanged(await readBlob(dir, to, toPath)), binary: false };
  return { rows: sideBySide(hunks.flatMap((hunk) => hunk.lines)), binary: false };
}
