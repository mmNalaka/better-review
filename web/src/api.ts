import type { ReviewPayload } from "../../server/types";

export type { ChangedFile, Commit, PullRequest, ReviewPayload } from "../../server/types";
import type { ChangedFile } from "../../server/types";
export type { DiffLine, FileDiff, Hunk, HunkIndex, HunkRef } from "../../server/diff";
export type { HunkMark, MarkFile } from "../../server/markmodel";
export type { PublishPlan, ReviewEvent, ReviewSubmission } from "../../server/publish";
import type { PublishPlan, ReviewEvent, ReviewSubmission } from "../../server/publish";
import type { HunkIndex } from "../../server/diff";
import type { MarkFile } from "../../server/markmodel";

export interface Definition {
  readonly path: string;
  readonly line: number;
  readonly character: number;
}

interface ErrorBody {
  readonly error?: string;
}

/**
 * The server says what went wrong in `error`. A reply without one did not come
 * from the server at all — it is the dev proxy failing to reach it, and "500"
 * on its own sends you looking in the wrong place.
 */
function failure(response: Response, body: unknown): Error {
  const said = (body as ErrorBody).error;
  if (said) return new Error(said);
  if (response.status >= 500) {
    return new Error(
      `No answer from the better-review server (${response.status}). Start it with \`bun run dev:server\`.`,
    );
  }
  return new Error(`Request failed (${response.status})`);
}

async function getJson<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const query = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  );
  const response = await fetch(`${path}?${query}`);
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) throw failure(response, body);
  return body as T;
}

async function sendJson<T>(
  path: string,
  params: Record<string, string | number>,
  method: "PUT" | "POST",
  payload: unknown,
): Promise<T> {
  const query = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  );
  const response = await fetch(`${path}?${query}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) throw failure(response, body);
  return body as T;
}

export const loadReview = (pr: string): Promise<ReviewPayload> => getJson("/api/review", { pr });

/** Every hunk in the PR, ids only — what the explorer derives its state from. */
export const loadHunks = (
  owner: string,
  repo: string,
  pr: number,
  rev: string,
): Promise<HunkIndex> => getJson("/api/hunks", { owner, repo, pr, rev });

export const loadMarks = (owner: string, repo: string, pr: number): Promise<MarkFile> =>
  getJson("/api/marks", { owner, repo, pr });

export const saveMarks = (
  owner: string,
  repo: string,
  pr: number,
  marks: MarkFile,
): Promise<MarkFile> => sendJson("/api/marks", { owner, repo, pr }, "PUT", marks);

export const loadBlob = (
  owner: string,
  repo: string,
  rev: string,
  path: string,
): Promise<{ text: string }> => getJson("/api/blob", { owner, repo, rev, path });

export const loadDiff = (
  owner: string,
  repo: string,
  pr: number,
  rev: string,
  path: string,
  commit?: string | null,
): Promise<import("../../server/diff").FileDiff> =>
  getJson("/api/diff", { owner, repo, pr, rev, path, ...(commit ? { commit } : {}) });

/** Files changed by one commit, for reviewing commit by commit. */
export const loadCommitFiles = (
  owner: string,
  repo: string,
  pr: number,
  rev: string,
  commit: string,
): Promise<{ changed: readonly ChangedFile[] }> =>
  getJson("/api/commit-files", { owner, repo, pr, rev, commit });

export const resolveDefinition = (
  owner: string,
  repo: string,
  pr: number,
  rev: string,
  path: string,
  line: number,
  character: number,
): Promise<{
  definitions: readonly Definition[];
  external?: boolean;
  unsupported?: boolean;
  reason?: string;
  unknown?: string;
}> =>
  getJson("/api/definition", { owner, repo, pr, rev, path, line, character });

export interface PublishPreview {
  readonly posted: false;
  readonly plan: PublishPlan;
  readonly submission: ReviewSubmission;
}

export interface PublishResult {
  readonly posted: true;
  readonly url: string;
  /** How many comments actually landed on lines. */
  readonly count: number;
  /** Comments GitHub would not anchor, with its reason. */
  readonly failures: readonly { readonly path: string; readonly reason: string }[];
  readonly plan: PublishPlan;
  readonly marks: MarkFile;
}

/**
 * `dryRun` is the difference between showing the review and posting it. The
 * server defaults to a preview, and only `false` reaches GitHub.
 */
const publishCall = <T,>(
  owner: string,
  repo: string,
  pr: number,
  rev: string,
  event: ReviewEvent,
  body: string,
  dryRun: boolean,
): Promise<T> =>
  sendJson<T>("/api/publish", { owner, repo, pr, rev }, "POST", { event, body, dryRun });

export const previewReview = (
  owner: string,
  repo: string,
  pr: number,
  rev: string,
  event: ReviewEvent,
  body: string,
): Promise<PublishPreview> => publishCall(owner, repo, pr, rev, event, body, true);

export const publishReview = (
  owner: string,
  repo: string,
  pr: number,
  rev: string,
  event: ReviewEvent,
  body: string,
): Promise<PublishResult> => publishCall(owner, repo, pr, rev, event, body, false);
