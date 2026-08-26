/** Shapes shared between the server and the web client. */

export type ChangeKind = "A" | "M" | "D" | "R";

export interface PullRequest {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly title: string;
  readonly headSha: string;
  /** Branch the PR merges into. */
  readonly baseRef: string;
  /** Branch the PR is from. */
  readonly headRef: string;
  /** Set only when the PR comes from a fork, i.e. head repo != base repo. */
  readonly forkOf: string | null;
  readonly draft: boolean;
  readonly state: string;
  /** Fork point, from `git merge-base` — never the API's `base.sha`. See ticket 02. */
  readonly mergeBase: string;
}

export interface ChangedFile {
  readonly path: string;
  readonly kind: ChangeKind;
  readonly additions: number;
  readonly deletions: number;
}

export interface Commit {
  readonly sha: string;
  readonly subject: string;
  readonly body: string;
  readonly author: string;
  /** ISO-8601, from `git log --date=iso-strict`. */
  readonly date: string;
}

export interface ReviewPayload {
  readonly pr: PullRequest;
  readonly changed: readonly ChangedFile[];
  readonly commits: readonly Commit[];
}
