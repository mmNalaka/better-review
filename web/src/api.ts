import type { ReviewPayload } from "../../server/types";

export type { ChangedFile, Commit, PullRequest, ReviewPayload } from "../../server/types";
import type { ChangedFile } from "../../server/types";
export type { DiffLine, FileDiff, Hunk } from "../../server/diff";

export interface Definition {
  readonly path: string;
  readonly line: number;
  readonly character: number;
}

interface ErrorBody {
  readonly error?: string;
}

async function getJson<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const query = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  );
  const response = await fetch(`${path}?${query}`);
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((body as ErrorBody).error ?? `Request failed (${response.status})`);
  }
  return body as T;
}

export const loadReview = (pr: string): Promise<ReviewPayload> => getJson("/api/review", { pr });

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
