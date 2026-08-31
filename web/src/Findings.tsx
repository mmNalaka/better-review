import { useState } from "react";

import {
  previewReview,
  publishReview,
  type MarkFile,
  type PublishPlan,
  type PullRequest,
  type ReviewEvent,
} from "./api";
import { useCopy } from "./clipboard";
import type { Finding } from "./marks";
import { parseNoteBody } from "../../server/suggestion";

/**
 * The findings — every hunk you flagged and what you wrote — and the one place
 * this app writes to GitHub.
 *
 * Posting sits behind a preview and then a confirmation. The preview is
 * computed by the server from a diff taken now, so what it lists is exactly
 * what would be posted, on the lines it would land on. Ticket 04 kept findings
 * copyable as text; that stays, because a review comment is not always where a
 * finding belongs.
 */

const EVENT_LABEL: Readonly<Record<ReviewEvent, string>> = {
  COMMENT: "Comment",
  REQUEST_CHANGES: "Request changes",
  APPROVE: "Approve",
};

/** What each verdict means on GitHub, in the words the reviewer is thinking. */
const EVENT_MEANS: Readonly<Record<ReviewEvent, string>> = {
  COMMENT: "leave the comments, no verdict",
  REQUEST_CHANGES: "ask for changes before merge",
  APPROVE: "sign it off",
};

const EVENTS: readonly ReviewEvent[] = ["COMMENT", "REQUEST_CHANGES", "APPROVE"];

/** Where a finding sits, in words: the line it hangs under, or its hunk. */
const placeOf = (finding: Finding): string => {
  if (finding.lineIndex === null) return "the whole hunk";
  const span =
    finding.endLineIndex === null
      ? ""
      : ` … +${finding.endLineIndex - finding.lineIndex} more line${
          finding.endLineIndex - finding.lineIndex === 1 ? "" : "s"
        }`;
  return `${finding.lineText?.trim() || `line ${finding.lineIndex + 1} of the hunk`}${span}`;
};

const asText = (findings: readonly Finding[]): string =>
  findings
    .map((finding) => `${finding.path}\n  ${placeOf(finding)}\n  ${finding.note}`)
    .join("\n\n");

interface FindingsProps {
  readonly findings: readonly Finding[];
  readonly pr: PullRequest;
  readonly onClose: () => void;
  readonly onOpen: (path: string) => void;
  readonly onPublished: (marks: MarkFile) => void;
}

export function Findings({ findings, pr, onClose, onOpen, onPublished }: FindingsProps) {
  const [event, setEvent] = useState<ReviewEvent>("COMMENT");
  const [summary, setSummary] = useState("");
  const [plan, setPlan] = useState<PublishPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<{
    url: string;
    count: number;
    failures: readonly { path: string; reason: string }[];
  } | null>(null);
  const copy = useCopy();

  const where = `${pr.owner}/${pr.repo}#${pr.number}`;

  /** Any edit invalidates the preview: it described a different review. */
  const reset = () => {
    setPlan(null);
    setConfirming(false);
  };

  /** How many notes would actually go: published and stale ones do not. */
  const ready = findings.filter((finding) => !finding.published && !finding.stale).length;

  const preview = async () => {
    setBusy(true);
    setError(null);
    setConfirming(false);
    try {
      const result = await previewReview(pr.owner, pr.repo, pr.number, pr.headSha, event, summary);
      setPlan(result.plan);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  /** One click to "about to post": the preview is part of the confirmation. */
  const submit = async () => {
    await preview();
    setConfirming(true);
  };

  const post = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await publishReview(pr.owner, pr.repo, pr.number, pr.headSha, event, summary);
      setPosted({ url: result.url, count: result.count, failures: result.failures ?? [] });
      setPlan(result.plan);
      setConfirming(false);
      onPublished(result.marks);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const comments = plan?.comments.length ?? 0;

  return (
    <aside className="findings" aria-label="Findings">
      <header className="commits-head">
        <span className="eyebrow">Findings</span>
        <span className="n">{findings.length}</span>
        <button className="commits-close" onClick={onClose} title="Close">
          ×
        </button>
      </header>

      {findings.length === 0 ? (
        <p className="pane-empty">
          Nothing yet. Press the <b>+</b> on any line in the diff to write a comment — they gather
          here, and go to GitHub as one review when you submit.
        </p>
      ) : (
        <>
          <div className="findings-actions">
            <button onClick={() => void copy.copy(asText(findings), "findings")}>
              Copy all as text
            </button>
            {copy.state !== "idle" && (
              <span className={`copied-flash${copy.state === "failed" ? " failed" : ""}`}>
                {copy.state === "copied" ? "copied" : "could not copy"}
              </span>
            )}
          </div>

          {findings.map((finding) => (
            <div className="finding" key={`${finding.path}@${finding.hunkId}#${finding.lineIndex ?? "hunk"}`}>
              <button className="finding-place" onClick={() => onOpen(finding.path)}>
                {finding.path}
              </button>
              <div className="finding-header">{placeOf(finding)}</div>
              <p className="finding-note">{parseNoteBody(finding.note).prose || "(suggestion)"}</p>
              <div className="finding-tags">
                {parseNoteBody(finding.note).suggestion !== null && (
                  <span className="badge suggests" title="Carries a suggested change">
                    suggestion
                  </span>
                )}
                {finding.stale && (
                  <span
                    className="badge stale"
                    title="The hunk this was written against has changed"
                  >
                    changed since noted
                  </span>
                )}
                {finding.published && (
                  <a
                    className="badge posted"
                    href={finding.published.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    posted
                  </a>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      <section className="publish">
        <div className="publish-head">
          <span className="eyebrow">Submit as one review</span>
          <span className="publish-count">
            {ready} comment{ready === 1 ? "" : "s"} ready
          </span>
        </div>

        {/* The button comes first: the verdict is a detail of submitting, not
            a thing to decide before knowing submitting is possible. */}
        <div className="publish-row">
          <button
            className="publish-go big"
            disabled={busy || ready + summary.trim().length === 0}
            onClick={() => void submit()}
          >
            {busy && !confirming ? "Checking…" : `Submit review to ${where}`}
          </button>
          <button className="publish-back" disabled={busy} onClick={() => void preview()}>
            Preview
          </button>
        </div>

        <fieldset className="publish-kinds" disabled={busy}>
          <legend className="publish-legend">Submit as</legend>
          {EVENTS.map((option) => (
            <label key={option} className={`publish-kind${event === option ? " on" : ""}`}>
              <input
                type="radio"
                name="review-event"
                checked={event === option}
                onChange={() => {
                  setEvent(option);
                  reset();
                }}
              />
              <span className="publish-kind-name">{EVENT_LABEL[option]}</span>
              <span className="publish-kind-means">{EVENT_MEANS[option]}</span>
            </label>
          ))}
        </fieldset>

        <textarea
          className="publish-summary"
          rows={2}
          value={summary}
          placeholder="Review summary — optional when there are comments to post"
          onChange={(changed) => {
            setSummary(changed.target.value);
            reset();
          }}
        />

        {confirming && (
          <div className="publish-confirm">
            <p className="publish-ask">
              This posts {comments} comment{comments === 1 ? "" : "s"} to {where} as{" "}
              <b>{EVENT_LABEL[event]}</b>. Everything below is exactly what GitHub will receive.
            </p>
            <div className="publish-row">
              <button className="publish-go" disabled={busy} onClick={() => void post()}>
                {busy ? "Posting…" : "Post it"}
              </button>
              <button className="publish-back" onClick={() => setConfirming(false)}>
                Not yet
              </button>
            </div>
          </div>
        )}

        {plan && !posted && (
          <div className="publish-plan">
            {comments === 0 ? (
              <p className="publish-none">No comments would be posted.</p>
            ) : (
              plan.comments.map((comment, index) => (
                <div className="publish-line" key={index}>
                  <span className="publish-where">
                    {comment.path}:
                    {comment.start_line ? `${comment.start_line}–${comment.line}` : comment.line}
                    <span className="publish-side">
                      {comment.side === "LEFT" ? "base" : "head"}
                    </span>
                  </span>
                  <span className="publish-body">{comment.body}</span>
                </div>
              ))
            )}
            {plan.skipped.map((skip, index) => (
              <div className="publish-skip" key={index}>
                skipped · {skip.path} — {skip.reason}
              </div>
            ))}
          </div>
        )}

        {posted && (
          <>
            <p className="publish-done">
              Posted {posted.count} comment{posted.count === 1 ? "" : "s"}.{" "}
              <a href={posted.url} target="_blank" rel="noreferrer">
                Open the review on GitHub
              </a>
            </p>
            {posted.failures.map((failure, index) => (
              <p className="publish-error" key={index}>
                {failure.path} — GitHub would not anchor this one: {failure.reason}
              </p>
            ))}
          </>
        )}

        {error && <p className="publish-error">{error}</p>}
      </section>
    </aside>
  );
}
