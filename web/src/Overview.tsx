import { Markdown } from "./Markdown";
import type { ConversationState } from "./useConversation";
import type { PullRequest } from "./api";

/** GitHub's own review-state labels, in plain words. */
const STATE_LABEL: Record<string, string> = {
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Requested changes",
  COMMENTED: "Reviewed",
  DISMISSED: "Dismissed",
};

const stateClass = (state: string): string => `state-${state.toLowerCase().replace(/_/g, "-")}`;

interface OverviewProps {
  readonly pr: PullRequest;
  readonly conversation: ConversationState;
  readonly onClose: () => void;
}

/** The pull request's own description and conversation — read-only, never posted from here. */
export function Overview({ pr, conversation, onClose }: OverviewProps) {
  return (
    <aside className="overview" aria-label="Pull request overview">
      <header className="commits-head">
        <span className="eyebrow">Overview</span>
        <button className="commits-close" onClick={onClose} aria-label="Close overview" title="Close — Esc">
          ×
        </button>
      </header>

      <div className="overview-body">
        <section className="overview-desc">
          <span className="eyebrow">Description</span>
          {pr.body.trim() ? (
            <Markdown text={pr.body} className="markdown-box markdown" />
          ) : (
            <p className="pane-empty">No description.</p>
          )}
        </section>

        <section className="overview-thread">
          <span className="eyebrow">
            Conversation{conversation.entries.length > 0 ? ` · ${conversation.entries.length}` : ""}
          </span>
          {conversation.loading && <p className="pane-empty">Loading…</p>}
          {conversation.error && <p className="notice">{conversation.error}</p>}
          {!conversation.loading && !conversation.error && conversation.entries.length === 0 && (
            <p className="pane-empty">No comments yet.</p>
          )}
          {conversation.entries.map((entry) => (
            <article className="overview-entry" key={`${entry.kind}-${entry.id}`}>
              <div className="overview-entry-meta">
                {entry.avatarUrl && (
                  <img className="overview-avatar" src={entry.avatarUrl} alt="" width={16} height={16} />
                )}
                <span className="overview-author">{entry.author}</span>
                {entry.state && (
                  <span className={`badge ${stateClass(entry.state)}`}>
                    {STATE_LABEL[entry.state] ?? entry.state}
                  </span>
                )}
                <span className="overview-date">{entry.createdAt.slice(0, 10)}</span>
                {entry.url && (
                  <a className="overview-link" href={entry.url} target="_blank" rel="noreferrer">
                    View on GitHub
                  </a>
                )}
              </div>
              {entry.body.trim() && <Markdown text={entry.body} className="markdown-box markdown" />}
            </article>
          ))}
        </section>
      </div>
    </aside>
  );
}
