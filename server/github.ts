import { toThreadInput, type ReviewSubmission } from "./publish";
import type { PullRequest } from "./types";

export class GitHubError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubError";
  }
}

interface PrApiResponse {
  readonly title?: string;
  readonly draft?: boolean;
  readonly state?: string;
  readonly head?: {
    readonly sha?: string;
    readonly ref?: string;
    readonly repo?: { readonly full_name?: string };
  };
  readonly base?: { readonly ref?: string; readonly repo?: { readonly full_name?: string } };
}

/**
 * The one API call this app makes. Everything else comes from git.
 * Auth comes from the user's own `gh` keyring — no token is stored here.
 */
export async function fetchPullRequest(
  owner: string,
  repo: string,
  number: number,
): Promise<Omit<PullRequest, "mergeBase">> {
  const proc = Bun.spawn(["gh", "api", `repos/${owner}/${repo}/pulls/${number}`], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (code !== 0) {
    const detail = stderr.trim();
    if (detail.includes("404")) {
      // Keep gh's own words: the friendly message alone hid a keychain failure
      // that had nothing to do with the PR existing.
      throw new GitHubError(
        `${owner}/${repo}#${number} not found — it may not exist, or your gh token may not have access. gh said: ${detail}`,
      );
    }
    throw new GitHubError(`gh api failed: ${detail || "no stderr"}`);
  }

  let parsed: PrApiResponse;
  try {
    parsed = JSON.parse(stdout) as PrApiResponse;
  } catch {
    throw new GitHubError("gh api returned output that was not JSON");
  }

  const headSha = parsed.head?.sha;
  const baseRef = parsed.base?.ref;
  if (!headSha || !baseRef) {
    throw new GitHubError("PR response is missing head.sha or base.ref");
  }

  const headRepo = parsed.head?.repo?.full_name ?? null;
  const baseRepo = parsed.base?.repo?.full_name ?? `${owner}/${repo}`;

  return {
    owner,
    repo,
    number,
    title: parsed.title ?? "",
    headSha,
    baseRef,
    headRef: parsed.head?.ref ?? "",
    forkOf: headRepo && headRepo !== baseRepo ? headRepo : null,
    draft: parsed.draft ?? false,
    state: parsed.state ?? "open",
  };
}

const PR_URL = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;
const PR_SHORT = /^([^/\s]+)\/([^/#\s]+)#(\d+)$/;

/** Accepts a full PR URL or `owner/repo#123`. Returns null on anything else. */
export function parsePrRef(
  input: string,
): { owner: string; repo: string; number: number } | null {
  const match = PR_URL.exec(input) ?? PR_SHORT.exec(input.trim());
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const number = Number(match[3]);
  return Number.isSafeInteger(number) && number > 0
    ? { owner: match[1], repo: match[2], number }
    : null;
}

/**
 * Posting a review, the way GitHub's own UI does it.
 *
 * Not `POST /pulls/{n}/reviews` with a `comments[]` array: that endpoint
 * ignores the line fields and stores each comment against a diff *position*,
 * which leaves `line` and `side` null. Such a comment shows up in the
 * conversation and can never be drawn in the files-changed view — the bug this
 * replaces. `addPullRequestReviewThread` is the API that anchors to a line, so
 * the flow is: open a pending review, add a thread per comment, submit it.
 */

interface GraphQlReply<T> {
  readonly data?: T;
  readonly errors?: readonly { readonly message?: string }[];
}

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const proc = Bun.spawn(["gh", "api", "graphql", "--input", "-"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(JSON.stringify({ query, variables }));
  await proc.stdin.end();

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  let parsed: GraphQlReply<T>;
  try {
    parsed = JSON.parse(stdout) as GraphQlReply<T>;
  } catch {
    // A non-zero exit with unparseable output is usually auth or network.
    throw new GitHubError(`gh api graphql failed: ${stderr.trim() || `exit ${code}`}`);
  }

  const failed = parsed.errors?.map((error) => error.message ?? "unknown").join("; ");
  if (failed) throw new GitHubError(failed);
  if (!parsed.data) throw new GitHubError("gh api graphql returned no data");
  return parsed.data;
}

const PR_ID = `query ($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) { pullRequest(number: $number) { id } }
}`;

const OPEN_REVIEW = `mutation ($pullRequestId: ID!, $commitOID: GitObjectID) {
  addPullRequestReview(input: { pullRequestId: $pullRequestId, commitOID: $commitOID }) {
    pullRequestReview { id }
  }
}`;

const ADD_THREAD = `mutation (
  $pullRequestReviewId: ID!, $path: String!, $body: String!,
  $line: Int!, $side: DiffSide, $startLine: Int, $startSide: DiffSide,
  $subjectType: PullRequestReviewThreadSubjectType
) {
  addPullRequestReviewThread(input: {
    pullRequestReviewId: $pullRequestReviewId, path: $path, body: $body,
    line: $line, side: $side, startLine: $startLine, startSide: $startSide,
    subjectType: $subjectType
  }) { thread { id } }
}`;

const SUBMIT = `mutation ($pullRequestReviewId: ID!, $event: PullRequestReviewEvent!, $body: String) {
  submitPullRequestReview(input: {
    pullRequestReviewId: $pullRequestReviewId, event: $event, body: $body
  }) { pullRequestReview { url state } }
}`;

const DISCARD = `mutation ($pullRequestReviewId: ID!) {
  deletePullRequestReview(input: { pullRequestReviewId: $pullRequestReviewId }) {
    pullRequestReview { id }
  }
}`;

/** A comment that could not be anchored, and why. */
export interface ThreadFailure {
  /** Index into the comments that were handed in. */
  readonly index: number;
  readonly path: string;
  readonly reason: string;
}

export interface PostedReview {
  readonly url: string;
  /** Indexes of the comments that landed, so only those get stamped. */
  readonly posted: readonly number[];
  readonly failures: readonly ThreadFailure[];
}

export async function postReview(
  owner: string,
  repo: string,
  number: number,
  submission: ReviewSubmission,
): Promise<PostedReview> {
  const { repository } = await graphql<{
    repository: { pullRequest: { id: string } | null } | null;
  }>(PR_ID, { owner, repo, number });

  const pullRequestId = repository?.pullRequest?.id;
  if (!pullRequestId) throw new GitHubError(`${owner}/${repo}#${number} not found`);

  const opened = await graphql<{
    addPullRequestReview: { pullRequestReview: { id: string } };
  }>(OPEN_REVIEW, { pullRequestId, commitOID: submission.commit_id });
  const reviewId = opened.addPullRequestReview.pullRequestReview.id;

  const posted: number[] = [];
  const failures: ThreadFailure[] = [];

  // One at a time, and on purpose: a line GitHub will not take should cost that
  // comment, not the whole review.
  for (const [index, comment] of submission.comments.entries()) {
    try {
      await graphql(ADD_THREAD, { pullRequestReviewId: reviewId, ...toThreadInput(comment) });
      posted.push(index);
    } catch (cause) {
      failures.push({
        index,
        path: comment.path,
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  if (submission.comments.length > 0 && posted.length === 0) {
    // Nothing anchored: discard the draft rather than leave an empty review.
    await graphql(DISCARD, { pullRequestReviewId: reviewId }).catch(() => {});
    throw new GitHubError(
      `None of the ${failures.length} comments could be anchored. First reason: ${failures[0]?.reason ?? "unknown"}`,
    );
  }

  const submitted = await graphql<{
    submitPullRequestReview: { pullRequestReview: { url: string } };
  }>(SUBMIT, {
    pullRequestReviewId: reviewId,
    event: submission.event,
    body: submission.body || null,
  });

  return { url: submitted.submitPullRequestReview.pullRequestReview.url, posted, failures };
}
