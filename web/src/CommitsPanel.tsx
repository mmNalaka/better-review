import type { Commit } from "./api";

/** Ticket 05: the full list, opened when you want the story rather than a hunk. */

interface CommitsPanelProps {
  readonly commits: readonly Commit[];
  readonly onClose: () => void;
}

export function CommitsPanel({ commits, onClose }: CommitsPanelProps) {
  return (
    <aside className="commits" aria-label="Commits">
      <header className="commits-head">
        <span className="eyebrow">Commits</span>
        <span className="n">{commits.length}</span>
        <button className="commits-close" onClick={onClose} aria-label="Close commits">
          ×
        </button>
      </header>
      {commits.map((commit) => (
        <article className="commit" key={commit.sha}>
          <div className="commit-subject">{commit.subject}</div>
          <div className="commit-meta">
            <span className="commit-sha">{commit.sha.slice(0, 7)}</span>
            <span>{commit.author}</span>
            <span>{commit.date.slice(0, 10)}</span>
          </div>
          {commit.body && <pre className="commit-body">{commit.body}</pre>}
        </article>
      ))}
    </aside>
  );
}
