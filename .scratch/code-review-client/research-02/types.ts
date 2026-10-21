// Shape of what the local server hands the frontend.
// Derived empirically — see ../issues/02-pr-to-local-checkout.md for the evidence.

/** Everything the review surface needs, resolved in one server call. */
export type PrSession = {
  readonly source: PrSource;
  readonly anchors: Anchors;
  readonly meta: PrMeta;
  readonly commits: readonly PrCommit[];
  readonly files: readonly ChangedFile[];
  readonly tree: TreeEntry[]; // the WHOLE repo at head, not just touched files
  readonly workspace: Workspace;
  readonly warnings: readonly Warning[]; // never throw for a degraded-but-usable session
};

export type PrSource = {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly url: string;
};

/**
 * The three shas that matter. `baseSha` is a trap: it is the tip of the base
 * branch at API-read time and drifts ahead of the fork point. Every diff and
 * every blast-radius calculation must anchor on `mergeBaseSha`.
 */
export type Anchors = {
  readonly headSha: string;
  readonly baseSha: string; // from API .base.sha — display only, DO NOT diff against
  readonly mergeBaseSha: string; // computed locally: git merge-base base head
  readonly baseRef: string; // e.g. "main"
  readonly baseDrift: number; // commits base.sha is ahead of mergeBase; >0 means two-dot would lie
};

export type PrMeta = {
  readonly title: string;
  readonly body: string | null;
  readonly author: string;
  readonly state: "open" | "closed" | "merged"; // API gives state+merged; collapse them
  readonly isDraft: boolean;
  readonly headRepo: string | null; // null when the fork was deleted
  readonly isFork: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number; // API's count — cross-check against files.length
};

export type PrCommit = {
  readonly sha: string;
  readonly shortSha: string;
  readonly subject: string; // first line
  readonly body: string; // remainder, may be ""
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authoredAt: string;
  readonly parents: readonly string[];
  readonly isMerge: boolean; // parents.length > 1
};

export type FileStatus =
  | "added"
  | "modified"
  | "removed"
  | "renamed"
  | "copied"
  | "typechange";

export type ChangedFile = {
  readonly path: string;
  readonly previousPath: string | null; // set for renamed/copied
  readonly status: FileStatus;
  readonly additions: number;
  readonly deletions: number;
  readonly isBinary: boolean;
  /** Unified diff hunks. Computed locally, so never truncated. */
  readonly patch: string | null; // null only when isBinary
  readonly changedLineRanges: readonly LineRange[]; // head-side lines, for blast-radius seeding
};

export type LineRange = { readonly start: number; readonly end: number };

/** One entry per path in the repo at head — powers the whole-tree explorer. */
export type TreeEntry = {
  readonly path: string;
  readonly type: "blob" | "tree" | "commit"; // "commit" = submodule
  readonly size: number; // bytes; 0 for trees
  readonly oid: string;
  readonly touched: boolean; // is this path in `files`? drives the explorer marking
};

/** Where the code actually is on disk, and whether code intelligence will work. */
export type Workspace = {
  readonly clonePath: string; // the user's clone — we only ever read + fetch here
  readonly worktreePath: string; // detached worktree, safe LSP root
  readonly lspReady: boolean;
  readonly lspBlockers: readonly string[]; // e.g. ["node_modules missing and lockfile differs"]
};

export type Warning = {
  readonly code:
    | "BASE_DRIFT" // base.sha != mergeBase; we corrected, but say so
    | "STALE_CLONE" // fetch was needed and performed
    | "DIRTY_CLONE" // user has uncommitted work; harmless, informational
    | "LOCKFILE_MISMATCH" // symlinked node_modules may not match the PR
    | "DEPS_MISSING" // no node_modules anywhere; code intelligence will be poor
    | "FILE_CAP" // PR has >3000 files
    | "COMMIT_CAP" // PR has >250 commits (API list truncated; git is not)
    | "SUBMODULES" // worktree + submodules is documented as incomplete
    | "PARTIAL_CLONE"; // blobless clone: first checkout is slow
  readonly message: string;
};
