/**
 * The pull request's own description and conversation — not this app's
 * findings, but what GitHub already holds: the body, general comments, and
 * review summaries.
 *
 * Kept apart from `github.ts` so the shaping is a pure function: given the two
 * raw API lists, produce one chronological timeline. The I/O — the `gh api`
 * calls that produce those lists — lives in `github.ts`, next to the rest of
 * it.
 */

export interface RawUser {
  readonly login?: string;
  readonly avatar_url?: string;
}

export interface RawIssueComment {
  readonly id: number;
  readonly user?: RawUser;
  readonly body?: string;
  readonly created_at?: string;
  readonly html_url?: string;
}

export interface RawReview {
  readonly id: number;
  readonly user?: RawUser;
  readonly body?: string;
  readonly state?: string;
  readonly submitted_at?: string;
  readonly html_url?: string;
}

export type ConversationKind = "comment" | "review";

export interface ConversationEntry {
  readonly id: number;
  readonly kind: ConversationKind;
  readonly author: string;
  readonly avatarUrl: string | null;
  readonly body: string;
  readonly createdAt: string;
  readonly url: string;
  /** Only set for a review: APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED. */
  readonly state: string | null;
}

/**
 * A review left with no summary and no state worth reporting — plain
 * "COMMENTED" with an empty body — is inline notes with nothing to say here.
 * GitHub's own conversation tab hides those too; a verdict (approved, changes
 * requested) is worth showing even without a written summary.
 */
function reviewIsWorthShowing(review: RawReview): boolean {
  if (review.state === "PENDING") return false;
  if ((review.body ?? "").trim() !== "") return true;
  return review.state === "APPROVED" || review.state === "CHANGES_REQUESTED";
}

export function buildConversation(
  comments: readonly RawIssueComment[],
  reviews: readonly RawReview[],
): readonly ConversationEntry[] {
  const fromComments = comments.map(
    (comment): ConversationEntry => ({
      id: comment.id,
      kind: "comment",
      author: comment.user?.login ?? "unknown",
      avatarUrl: comment.user?.avatar_url ?? null,
      body: comment.body ?? "",
      createdAt: comment.created_at ?? "",
      url: comment.html_url ?? "",
      state: null,
    }),
  );

  const fromReviews = reviews.filter(reviewIsWorthShowing).map(
    (review): ConversationEntry => ({
      id: review.id,
      kind: "review",
      author: review.user?.login ?? "unknown",
      avatarUrl: review.user?.avatar_url ?? null,
      body: review.body ?? "",
      createdAt: review.submitted_at ?? "",
      url: review.html_url ?? "",
      state: review.state ?? null,
    }),
  );

  return [...fromComments, ...fromReviews].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
