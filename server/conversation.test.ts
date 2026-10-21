import { describe, expect, test } from "bun:test";

import { buildConversation, type RawIssueComment, type RawReview } from "./conversation";

describe("buildConversation", () => {
  test("maps an issue comment", () => {
    const comment: RawIssueComment = {
      id: 1,
      user: { login: "octocat", avatar_url: "https://example.com/a.png" },
      body: "looks good",
      created_at: "2026-01-01T00:00:00Z",
      html_url: "https://github.com/o/r/pull/1#issuecomment-1",
    };
    expect(buildConversation([comment], [])).toEqual([
      {
        id: 1,
        kind: "comment",
        author: "octocat",
        avatarUrl: "https://example.com/a.png",
        body: "looks good",
        createdAt: "2026-01-01T00:00:00Z",
        url: "https://github.com/o/r/pull/1#issuecomment-1",
        state: null,
      },
    ]);
  });

  test("falls back to \"unknown\" when the user is missing", () => {
    const comment: RawIssueComment = { id: 1, body: "hi" };
    expect(buildConversation([comment], [])[0]?.author).toBe("unknown");
  });

  test("keeps a review with a written summary regardless of state", () => {
    const review: RawReview = { id: 2, state: "COMMENTED", body: "consider renaming this" };
    expect(buildConversation([], [review])).toHaveLength(1);
  });

  test("keeps an approval or a change request even with no summary", () => {
    const approved: RawReview = { id: 2, state: "APPROVED", body: "" };
    const changes: RawReview = { id: 3, state: "CHANGES_REQUESTED" };
    expect(buildConversation([], [approved, changes])).toHaveLength(2);
  });

  test("drops a plain COMMENTED review with no summary — inline notes with nothing to say here", () => {
    const review: RawReview = { id: 2, state: "COMMENTED", body: "" };
    expect(buildConversation([], [review])).toEqual([]);
  });

  test("drops a pending review — not submitted yet", () => {
    const review: RawReview = { id: 2, state: "PENDING", body: "draft" };
    expect(buildConversation([], [review])).toEqual([]);
  });

  test("sorts comments and reviews together, oldest first", () => {
    const early: RawIssueComment = { id: 1, created_at: "2026-01-01T00:00:00Z", body: "first" };
    const late: RawReview = { id: 2, state: "APPROVED", submitted_at: "2026-01-02T00:00:00Z" };
    const middle: RawIssueComment = { id: 3, created_at: "2026-01-01T12:00:00Z", body: "second" };

    const result = buildConversation([early, middle], [late]);
    expect(result.map((entry) => entry.id)).toEqual([1, 3, 2]);
  });
});
