import type { DiffLine, FileHunks, Hunk } from "./diff";
import type { LineNote, MarkFile } from "./markmodel";
import { hasSuggestion } from "./suggestion";

/**
 * Turning notes into a GitHub pull request review.
 *
 * Line numbers are never taken from the stored mark — they were true when the
 * note was written and a later push moves them. The hunk is found again by its
 * content-addressed id in a diff computed at publish time, and the anchor is
 * derived from that. A note whose hunk no longer exists is skipped and
 * reported: guessing a line is how a comment lands on unrelated code.
 */

export type Side = "LEFT" | "RIGHT";

/** The subset of GitHub's review-comment shape this app uses. */
export interface ReviewComment {
  readonly path: string;
  readonly body: string;
  readonly side: Side;
  /** Omitted for a single-line comment — GitHub rejects start_line === line. */
  readonly start_line?: number;
  /** Required by GitHub whenever start_line is present, and always our `side`. */
  readonly start_side?: Side;
  readonly line: number;
}

export interface SkippedNote {
  readonly path: string;
  readonly note: string;
  readonly reason: string;
}

export interface PublishPlan {
  readonly comments: readonly ReviewComment[];
  /** Mark keys, in the same order as `comments`, so posted notes can be stamped. */
  readonly keys: readonly string[];
  readonly skipped: readonly SkippedNote[];
}

interface Anchor {
  /** Side of the last line — GitHub's `side`. */
  readonly side: Side;
  readonly first: number;
  readonly last: number;
  /**
   * Side of the first line, when it differs. A range may cross the split — a
   * removed line through to its replacement — and GitHub takes each end on its
   * own side.
   */
  readonly startSide?: Side;
}

/**
 * Where a comment on this hunk goes. The head side when the hunk adds
 * anything, because that is the code as it will be merged; the base side for a
 * pure deletion, whose lines only exist there.
 */
function anchorOf(hunk: Hunk): Anchor | null {
  const added = hunk.lines.flatMap((line) =>
    line.kind === "added" && line.newLine !== null ? [line.newLine] : [],
  );
  if (added.length > 0) {
    return { side: "RIGHT", first: added[0]!, last: added[added.length - 1]! };
  }

  const removed = hunk.lines.flatMap((line) =>
    line.kind === "removed" && line.oldLine !== null ? [line.oldLine] : [],
  );
  if (removed.length > 0) {
    return { side: "LEFT", first: removed[0]!, last: removed[removed.length - 1]! };
  }

  return null; // a hunk that changes no lines: nothing to point at
}

/**
 * A line, found again in a freshly computed hunk.
 *
 * The stored index first, but only if the text still matches: the hunk id
 * covers added and removed lines, so context can drift by a line without
 * changing the hunk's identity. Falling back to the text keeps the note on the
 * code it was written about rather than on whatever now sits at that offset.
 */
function relocate(hunk: Hunk, index: number | null, text: string | null): DiffLine | null {
  if (index === null) return null;

  const atIndex = hunk.lines[index];
  if (atIndex && (text === null || atIndex.text === text)) return atIndex;
  if (text === null) return null;

  return hunk.lines.find((line) => line.text === text) ?? null;
}

/** Which side a line lives on, and its number there. */
const placeOf = (line: DiffLine): { side: Side; line: number } | null => {
  if (line.kind === "removed") {
    return line.oldLine === null ? null : { side: "LEFT", line: line.oldLine };
  }
  return line.newLine === null ? null : { side: "RIGHT", line: line.newLine };
};

/** One line, or a span from the first to the last. */
function spanAnchor(start: DiffLine, end: DiffLine | null): Anchor | null {
  const from = placeOf(start);
  if (!from) return null;
  if (!end) return { side: from.side, first: from.line, last: from.line };

  const to = placeOf(end);
  if (!to) return null;
  // A backwards span would be rejected by GitHub, and means the two ends were
  // relocated out of order — safer to treat as unanchorable.
  if (to.side === from.side && to.line < from.line) return null;

  return { side: to.side, startSide: from.side, first: from.line, last: to.line };
}

/**
 * What would be posted, and what would not. Pure: the caller decides whether
 * to show it as a preview or send it.
 */
export function planReview(marks: MarkFile, byFile: Map<string, FileHunks>): PublishPlan {
  const comments: (ReviewComment & { readonly sort: number; readonly key: string })[] = [];
  const skipped: SkippedNote[] = [];

  for (const [key, note] of Object.entries(marks.notes)) {
    if (note.published) {
      skipped.push({
        path: note.path,
        note: note.body,
        reason: `already posted at ${note.published.at}`,
      });
      continue;
    }

    const file = byFile.get(note.path);
    const hunk = file?.hunks.find((candidate) => candidate.id === note.hunkId);
    if (!hunk) {
      skipped.push({
        path: note.path,
        note: note.body,
        reason: "the hunk it was written against is no longer in the diff",
      });
      continue;
    }

    // A line note comments on its line or range; a note about the whole hunk
    // spans the hunk's own changed lines.
    const start = relocate(hunk, note.lineIndex ?? null, note.lineText ?? null);
    const end =
      note.endLineIndex === null || note.endLineIndex === undefined
        ? null
        : relocate(hunk, note.endLineIndex, note.endLineText ?? null);
    const lost =
      (note.lineIndex !== null && start === null) ||
      (note.endLineIndex !== null && note.endLineIndex !== undefined && end === null);

    if (lost) {
      // Never widen to the hunk, and never shrink a range: a comment that lands
      // on lines the reviewer did not mean is worse than one that does not land.
      skipped.push({
        path: note.path,
        note: note.body,
        reason: "the line it was written against is no longer in the hunk",
      });
      continue;
    }

    const anchor = start ? spanAnchor(start, end) : anchorOf(hunk);
    if (!anchor) {
      skipped.push({
        path: note.path,
        note: note.body,
        reason: note.lineIndex === null ? "the hunk changes no lines" : "its lines moved apart",
      });
      continue;
    }

    // GitHub applies a suggestion to the head of the pull request, so it cannot
    // hang off a line that only exists on the base side.
    if (hasSuggestion(note.body) && (anchor.side === "LEFT" || anchor.startSide === "LEFT")) {
      skipped.push({
        path: note.path,
        note: note.body,
        reason: "a suggestion has to sit on the head side, and this one is anchored to removed code",
      });
      continue;
    }

    const startSide = anchor.startSide ?? anchor.side;
    // One line needs no start; a span, or two ends on different sides, does.
    const spans = anchor.first !== anchor.last || startSide !== anchor.side;

    comments.push({
      path: note.path,
      body: note.body,
      side: anchor.side,
      ...(spans ? { start_line: anchor.first, start_side: startSide } : {}),
      line: anchor.last,
      sort: anchor.first,
      key,
    });
  }

  // Top to bottom, file by file: a review reads in the order the code does.
  comments.sort((a, b) => a.path.localeCompare(b.path) || a.sort - b.sort);

  return {
    comments: comments.map(({ sort: _sort, key: _key, ...comment }) => comment),
    keys: comments.map((comment) => comment.key),
    skipped,
  };
}

export type ReviewEvent = "COMMENT" | "REQUEST_CHANGES" | "APPROVE";

export const REVIEW_EVENTS: readonly ReviewEvent[] = ["COMMENT", "REQUEST_CHANGES", "APPROVE"];

export interface ReviewSubmission {
  readonly commit_id: string;
  readonly body: string;
  readonly event: ReviewEvent;
  readonly comments: readonly ReviewComment[];
}

/** The exact JSON that would be sent — shown in the preview, then posted. */
export const reviewSubmission = (
  headSha: string,
  event: ReviewEvent,
  body: string,
  plan: PublishPlan,
): ReviewSubmission => ({
  commit_id: headSha,
  body,
  event,
  comments: plan.comments,
});

/**
 * A comment as GitHub's thread API wants it.
 *
 * The batch `comments[]` array on `POST /pulls/{n}/reviews` does not apply the
 * line fields — it stored our comments positionally, with `line` and `side`
 * null, which is why they appeared in the conversation but never in the diff.
 * `addPullRequestReviewThread` is the API that anchors to lines, and this is
 * its shape: camelCase, and a subject type.
 */
export interface ThreadInput {
  readonly path: string;
  readonly body: string;
  readonly side: Side;
  readonly startSide?: Side;
  readonly startLine?: number;
  readonly line: number;
  readonly subjectType: "LINE";
}

export const toThreadInput = (comment: ReviewComment): ThreadInput => ({
  path: comment.path,
  body: comment.body,
  side: comment.side,
  ...(comment.start_line === undefined
    ? {}
    : { startLine: comment.start_line, startSide: comment.start_side ?? comment.side }),
  line: comment.line,
  subjectType: "LINE",
});
