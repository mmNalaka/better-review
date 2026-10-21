import type { DiffLine, Hunk, HunkIndex } from "./diff";
import { markKey, type MarkFile, type ReviewPass } from "./markmodel";

/**
 * Re-review after a push: which hunks are new since the last finished pass,
 * which ones you had reviewed and have since been edited, and which are gone.
 *
 * Pure — the web client imports it, as it does markmodel. Classification works
 * on hunk ids alone, so a rebase that only moved code reads as nothing new;
 * the git-side report (since.ts) adds the matches that need old hunk bodies.
 */

/** How alike two hunks must be before one is offered as the other, edited. */
export const MATCH_MIN = 0.5;

/** Past this, similarity is not worth the quadratic table: call it unmatched. */
const LINES_MAX = 400;

export type HunkStatus = "carried" | "unreviewed" | "new" | "edited";

export interface DeltaRow {
  /** `same` in both versions, `dropped` from the old, `added` in the new. */
  readonly change: "same" | "dropped" | "added";
  readonly kind: DiffLine["kind"];
  readonly text: string;
}

/** A new hunk that looks like an old one, rewritten. */
export interface HunkMatch {
  readonly path: string;
  readonly newId: string;
  readonly oldId: string;
  /** 0..1, over the hunks' added and removed lines. */
  readonly similarity: number;
  /** The old hunk against the new one, line by line. */
  readonly delta: readonly DeltaRow[];
}

const MARKER: Readonly<Record<DiffLine["kind"], string>> = { added: "+", removed: "-", context: " " };

const keyOf = (line: Pick<DiffLine, "kind" | "text">) => `${MARKER[line.kind]}${line.text}`;

/** Longest common subsequence, as the table a diff is read back from. */
function lcsTable(a: readonly string[], b: readonly string[]): number[][] {
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  return table;
}

/** Dice coefficient over the changed lines: context is not what was reviewed. */
export function similarity(a: readonly DiffLine[], b: readonly DiffLine[]): number {
  const left = a.filter((line) => line.kind !== "context").map(keyOf);
  const right = b.filter((line) => line.kind !== "context").map(keyOf);
  if (left.length === 0 && right.length === 0) return 1;
  if (left.length > LINES_MAX || right.length > LINES_MAX) return 0;
  const common = lcsTable(left, right)[0]![0]!;
  return (2 * common) / (left.length + right.length);
}

/** The old hunk's lines against the new hunk's, as one aligned list. */
export function lineDelta(before: readonly DiffLine[], after: readonly DiffLine[]): DeltaRow[] {
  const a = before.map(keyOf);
  const b = after.map(keyOf);
  const table = lcsTable(a, b);
  const rows: DeltaRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ change: "same", kind: after[j]!.kind, text: after[j]!.text });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      rows.push({ change: "dropped", kind: before[i]!.kind, text: before[i]!.text });
      i++;
    } else {
      rows.push({ change: "added", kind: after[j]!.kind, text: after[j]!.text });
      j++;
    }
  }
  for (; i < a.length; i++) rows.push({ change: "dropped", kind: before[i]!.kind, text: before[i]!.text });
  for (; j < b.length; j++) rows.push({ change: "added", kind: after[j]!.kind, text: after[j]!.text });
  return rows;
}

/**
 * Pair each hunk that is new in a file with the old hunk it most resembles,
 * among the old ones that are gone. Greedy, best pair first, each hunk used
 * once: two new hunks cannot both be "the edited version" of one old one.
 */
export function matchHunks(
  path: string,
  before: readonly Hunk[],
  after: readonly Hunk[],
): HunkMatch[] {
  const oldIds = new Set(before.map((hunk) => hunk.id));
  const newIds = new Set(after.map((hunk) => hunk.id));
  const gone = before.filter((hunk) => !newIds.has(hunk.id));
  const fresh = after.filter((hunk) => !oldIds.has(hunk.id));

  const pairs = fresh
    .flatMap((next) =>
      gone.map((prev) => ({ prev, next, score: similarity(prev.lines, next.lines) })),
    )
    .filter((pair) => pair.score >= MATCH_MIN)
    .sort((x, y) => y.score - x.score);

  const usedOld = new Set<string>();
  const usedNew = new Set<string>();
  const matches: HunkMatch[] = [];
  for (const { prev, next, score } of pairs) {
    if (usedOld.has(prev.id) || usedNew.has(next.id)) continue;
    usedOld.add(prev.id);
    usedNew.add(next.id);
    matches.push({
      path,
      newId: next.id,
      oldId: prev.id,
      similarity: score,
      delta: lineDelta(prev.lines, next.lines),
    });
  }
  return matches;
}

export interface GoneHunk {
  readonly path: string;
  readonly id: string;
}

export interface SinceSummary {
  /** Status of every current hunk, keyed by `markKey`. */
  readonly byHunk: Readonly<Record<string, HunkStatus>>;
  /** Files with anything new, edited or gone — what "What's new" narrows to. */
  readonly paths: readonly string[];
  /** Hunks you had ticked or noted that are no longer in the diff, unmatched. */
  readonly gone: readonly GoneHunk[];
  readonly counts: Readonly<Record<HunkStatus | "gone", number>>;
}

const touched = (marks: MarkFile, path: string, id: string): boolean =>
  marks.hunks[markKey(path, id)]?.reviewed === true ||
  Object.values(marks.notes).some((note) => note.path === path && note.hunkId === id);

/**
 * Every current hunk against the last pass. A hunk the pass had is `carried`
 * when ticked and `unreviewed` when not; a hunk it lacked is `edited` when it
 * matches one you had ticked or noted, and `new` otherwise.
 */
export function classify(
  index: HunkIndex,
  marks: MarkFile,
  pass: ReviewPass,
  matches: readonly HunkMatch[],
): SinceSummary {
  const matchOf = new Map(matches.map((match) => [markKey(match.path, match.newId), match]));
  const matchedOld = new Set(matches.map((match) => markKey(match.path, match.oldId)));
  const byHunk: Record<string, HunkStatus> = {};
  const counts = { carried: 0, unreviewed: 0, new: 0, edited: 0, gone: 0 };
  const paths = new Set<string>();

  for (const [path, hunks] of Object.entries(index.files)) {
    const before = new Set(pass.hunks[path] ?? []);
    for (const hunk of hunks) {
      const key = markKey(path, hunk.id);
      const match = matchOf.get(key);
      const status: HunkStatus = before.has(hunk.id)
        ? marks.hunks[key]?.reviewed
          ? "carried"
          : "unreviewed"
        : match && touched(marks, path, match.oldId)
          ? "edited"
          : "new";
      byHunk[key] = status;
      counts[status] += 1;
      if (status === "new" || status === "edited") paths.add(path);
    }
  }

  const gone: GoneHunk[] = [];
  for (const [path, ids] of Object.entries(pass.hunks)) {
    const now = new Set((index.files[path] ?? []).map((hunk) => hunk.id));
    for (const id of ids) {
      if (now.has(id) || matchedOld.has(markKey(path, id)) || !touched(marks, path, id)) continue;
      gone.push({ path, id });
      // A file the PR no longer changes has no row to narrow to.
      if (index.files[path]) paths.add(path);
    }
  }
  counts.gone = gone.length;

  return { byHunk, paths: [...paths].sort(), gone, counts };
}

/** The pass to record now: every hunk the pull request has at this head. */
export const passAt = (
  headSha: string,
  mergeBase: string,
  index: HunkIndex,
  at: string,
): ReviewPass => ({
  headSha,
  mergeBase,
  at,
  hunks: Object.fromEntries(
    Object.entries(index.files).map(([path, hunks]) => [path, hunks.map((hunk) => hunk.id)]),
  ),
});
