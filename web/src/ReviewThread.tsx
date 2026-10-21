import { memo, useState } from "react";

import type { ReviewThread as Thread } from "./api";
import { Markdown } from "./Markdown";
import { threadWhere } from "../../server/threads";

export type ThreadReply = (threadId: string, body: string) => Promise<void>;
export type ThreadResolve = (threadId: string, resolved: boolean) => Promise<void>;

interface ReviewThreadProps {
  readonly thread: Thread;
  readonly onReply: ThreadReply;
  readonly onResolve: ThreadResolve;
}

const message = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/**
 * A thread GitHub already holds, drawn under the line it was written on.
 *
 * Kept visually apart from your own notes: those are drafts you will publish,
 * these are already public. A resolved thread starts folded, as on GitHub.
 */
export const ReviewThread = memo(function ReviewThread({
  thread,
  onReply,
  onResolve,
}: ReviewThreadProps) {
  const [open, setOpen] = useState(!thread.resolved);
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const first = thread.comments[0];
  const replies = thread.comments.length - 1;

  const run = async (action: () => Promise<void>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      after?.();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const send = () =>
    draft.trim() &&
    void run(
      () => onReply(thread.id, draft),
      () => {
        setDraft("");
        setReplying(false);
      },
    );

  const toggleResolved = () =>
    void run(
      () => onResolve(thread.id, !thread.resolved),
      () => setOpen(thread.resolved),
    );

  const classes = ["gh-thread", thread.resolved ? "resolved" : "", thread.outdated ? "outdated" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} data-thread={thread.id}>
      <button className="gh-thread-head" onClick={() => setOpen((now) => !now)} aria-expanded={open}>
        <span className="gh-thread-caret" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className="dl-comment-where">{threadWhere(thread)}</span>
        {thread.resolved && <span className="badge">resolved</span>}
        {thread.outdated && <span className="badge">outdated</span>}
        {!open && first && (
          <span className="gh-thread-peek">
            {first.author}: {first.body.split("\n")[0]}
            {replies > 0 && ` · ${replies} ${replies === 1 ? "reply" : "replies"}`}
          </span>
        )}
      </button>

      {open && (
        <>
          {thread.comments.map((comment) => (
            <article className="gh-comment" key={comment.id || comment.url}>
              <div className="overview-entry-meta">
                {comment.avatarUrl && (
                  <img className="overview-avatar" src={comment.avatarUrl} alt="" width={16} height={16} />
                )}
                <span className="overview-author">{comment.author}</span>
                <span className="overview-date">{comment.createdAt.slice(0, 10)}</span>
                {comment.url && (
                  <a className="overview-link" href={comment.url} target="_blank" rel="noreferrer">
                    View on GitHub
                  </a>
                )}
              </div>
              <Markdown text={comment.body} className="markdown" />
            </article>
          ))}

          {replying ? (
            <div className="gh-reply">
              <textarea
                value={draft}
                autoFocus
                rows={2}
                disabled={busy}
                placeholder="Reply — posts to GitHub straight away"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    send();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setReplying(false);
                  }
                }}
              />
              <div className="noterow">
                <button className="notesave" disabled={busy || !draft.trim()} onClick={send}>
                  {busy ? "Posting…" : "Post reply"}
                </button>
                <button className="notecancel" disabled={busy} onClick={() => setReplying(false)}>
                  Cancel
                </button>
                <span className="notehint">⌘↵ to post · Esc to cancel</span>
              </div>
            </div>
          ) : (
            <div className="dl-comment-row">
              <button onClick={() => setReplying(true)}>Reply</button>
              <button disabled={busy} onClick={toggleResolved}>
                {thread.resolved ? "Unresolve" : "Resolve"}
              </button>
            </div>
          )}
        </>
      )}

      {error && <p className="notice">{error}</p>}
    </div>
  );
});
