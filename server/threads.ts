/**
 * Review threads other people — or you, earlier — already left on the diff.
 *
 * Pure, like `conversation.ts`: the GraphQL I/O lives in `github.ts`. This
 * file shapes the raw nodes into threads, and says which diff line each one
 * hangs from, so the client draws them where GitHub would.
 */

import type { DiffLine, Hunk } from "./diff";

export interface RawThreadComment {
  readonly databaseId?: number | null;
  readonly author?: { readonly login?: string; readonly avatarUrl?: string } | null;
  readonly body?: string | null;
  readonly createdAt?: string | null;
  readonly url?: string | null;
}

export interface RawThread {
  readonly id: string;
  readonly path?: string | null;
  readonly line?: number | null;
  readonly startLine?: number | null;
  readonly originalLine?: number | null;
  readonly diffSide?: string | null;
  readonly isResolved?: boolean | null;
  readonly isOutdated?: boolean | null;
  readonly comments?: { readonly nodes?: readonly (RawThreadComment | null)[] | null } | null;
}

export interface ThreadComment {
  readonly id: number;
  readonly author: string;
  readonly avatarUrl: string | null;
  readonly body: string;
  readonly createdAt: string;
  readonly url: string;
}

export type ThreadSide = "LEFT" | "RIGHT";

export interface ReviewThread {
  /** GraphQL node id — what replying and resolving take. */
  readonly id: string;
  readonly path: string;
  /** Line on the current head (RIGHT) or base (LEFT); null once outdated. */
  readonly line: number | null;
  readonly startLine: number | null;
  /** The line it was written on, kept for an outdated thread's label. */
  readonly originalLine: number | null;
  readonly side: ThreadSide;
  readonly resolved: boolean;
  readonly outdated: boolean;
  readonly comments: readonly ThreadComment[];
}

export function toComment(raw: RawThreadComment): ThreadComment {
  return {
    id: raw.databaseId ?? 0,
    author: raw.author?.login ?? "unknown",
    avatarUrl: raw.author?.avatarUrl ?? null,
    body: raw.body ?? "",
    createdAt: raw.createdAt ?? "",
    url: raw.url ?? "",
  };
}

export function toThread(raw: RawThread): ReviewThread {
  const comments = (raw.comments?.nodes ?? [])
    .filter((node): node is RawThreadComment => node !== null)
    .map(toComment);
  return {
    id: raw.id,
    path: raw.path ?? "",
    line: raw.line ?? null,
    startLine: raw.startLine ?? null,
    originalLine: raw.originalLine ?? null,
    side: raw.diffSide === "LEFT" ? "LEFT" : "RIGHT",
    resolved: raw.isResolved ?? false,
    outdated: raw.isOutdated ?? false,
    comments,
  };
}

/** Threads with no comments are drafts GitHub has not filled; nothing to show. */
export const buildThreads = (raw: readonly RawThread[]): readonly ReviewThread[] =>
  raw.map(toThread).filter((thread) => thread.path !== "" && thread.comments.length > 0);

/**
 * Whether a diff line is the one a thread is anchored to. LEFT is the base
 * side — removed and context lines; RIGHT is the head — added and context.
 */
function lineMatches(line: DiffLine, thread: ReviewThread): boolean {
  if (thread.line === null) return false;
  return thread.side === "LEFT"
    ? line.kind !== "added" && line.oldLine === thread.line
    : line.kind !== "removed" && line.newLine === thread.line;
}

export interface PlacedThreads {
  /** Hunk id → line index → the threads hanging under that line. */
  readonly byHunk: ReadonlyMap<string, ReadonlyMap<number, readonly ReviewThread[]>>;
  /** Outdated, file-level, or on a line no hunk shows. */
  readonly unplaced: readonly ReviewThread[];
}

/** Hang each thread under the diff line it was written on, as GitHub does. */
export function placeThreads(
  hunks: readonly Hunk[],
  threads: readonly ReviewThread[],
): PlacedThreads {
  const byHunk = new Map<string, Map<number, ReviewThread[]>>();
  const unplaced: ReviewThread[] = [];

  for (const thread of threads) {
    const spot = findSpot(hunks, thread);
    if (!spot) {
      unplaced.push(thread);
      continue;
    }
    const lines = byHunk.get(spot.hunkId) ?? new Map<number, ReviewThread[]>();
    lines.set(spot.index, [...(lines.get(spot.index) ?? []), thread]);
    byHunk.set(spot.hunkId, lines);
  }
  return { byHunk, unplaced };
}

function findSpot(
  hunks: readonly Hunk[],
  thread: ReviewThread,
): { hunkId: string; index: number } | null {
  if (thread.outdated) return null;
  for (const hunk of hunks) {
    const index = hunk.lines.findIndex((line) => lineMatches(line, thread));
    if (index !== -1) return { hunkId: hunk.id, index };
  }
  return null;
}

/**
 * Whether a note you published is the opening comment of one of these
 * threads. Then the thread — which carries the replies — stands in for it.
 */
export const mirrorsThread = (body: string, threads: readonly ReviewThread[]): boolean =>
  threads.some((thread) => thread.comments[0]?.body.trim() === body.trim());

/** Where a thread sits, in words, for the header above it. */
export function threadWhere(thread: ReviewThread): string {
  const end = thread.line ?? thread.originalLine;
  if (end === null) return "the file";
  const start = thread.startLine;
  return start !== null && start !== end ? `lines ${start}–${end}` : `line ${end}`;
}

/**
 * The open thread after `afterId`, in reading order: files as the explorer
 * lists them, then by line. Wraps, so repeated asks walk every open thread.
 * Files the explorer does not list go last, by path.
 */
export function nextOpenThread(
  threads: readonly ReviewThread[],
  paths: readonly string[],
  afterId: string | null,
): ReviewThread | null {
  const rank = new Map(paths.map((path, index) => [path, index]));
  const line = (thread: ReviewThread) => thread.line ?? thread.originalLine ?? 0;
  const open = threads
    .filter((thread) => !thread.resolved)
    .sort(
      (a, b) =>
        (rank.get(a.path) ?? paths.length) - (rank.get(b.path) ?? paths.length) ||
        a.path.localeCompare(b.path) ||
        line(a) - line(b),
    );
  if (open.length === 0) return null;
  const at = afterId === null ? -1 : open.findIndex((thread) => thread.id === afterId);
  return open[(at + 1) % open.length] ?? null;
}
