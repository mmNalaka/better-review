import { useEffect, useState } from "react";

import { loadHistory, type FileRevision, type PullRequest } from "./api";

/**
 * Every commit that touched the open file, up to the PR head. Picking one lays
 * that version beside the head in the compare pane.
 */

interface HistoryPanelProps {
  readonly pr: PullRequest;
  readonly path: string;
  /** Shas of this pull request's own commits, so they stand out from the rest. */
  readonly prCommits: ReadonlySet<string>;
  readonly selected: string | null;
  readonly onCompare: (revision: FileRevision) => void;
  readonly onClose: () => void;
}

type Load =
  | { readonly state: "loading" }
  | { readonly state: "error"; readonly message: string }
  | { readonly state: "ready"; readonly revisions: readonly FileRevision[] };

export function HistoryPanel({ pr, path, prCommits, selected, onCompare, onClose }: HistoryPanelProps) {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    let live = true;
    setLoad({ state: "loading" });
    loadHistory(pr.owner, pr.repo, pr.number, pr.headSha, path)
      .then((result) => live && setLoad({ state: "ready", revisions: result.revisions }))
      .catch((cause: unknown) => {
        if (live) setLoad({ state: "error", message: cause instanceof Error ? cause.message : String(cause) });
      });
    return () => {
      live = false;
    };
  }, [pr.owner, pr.repo, pr.number, pr.headSha, path]);

  return (
    <aside className="commits" aria-label="File history">
      <header className="commits-head">
        <span className="eyebrow">History</span>
        {load.state === "ready" && <span className="n">{load.revisions.length}</span>}
        <button className="commits-close" onClick={onClose} aria-label="Close history">
          ×
        </button>
      </header>
      <p className="history-path">{path}</p>
      {load.state === "loading" && <p className="pane-empty">Reading history…</p>}
      {load.state === "error" && <p className="pane-empty pane-error">{load.message}</p>}
      {load.state === "ready" && load.revisions.length === 0 && (
        <p className="pane-empty">No commits touch this file.</p>
      )}
      {load.state === "ready" &&
        load.revisions.map((revision, index) => {
          // The newest commit to touch the file holds exactly what the head holds.
          const current = index === 0;
          const picked = revision.sha === selected;
          return (
            <article className={`commit${picked ? " sel" : ""}`} key={revision.sha}>
              <div className="commit-subject">{revision.subject}</div>
              <div className="commit-meta">
                <span className="commit-sha">{revision.sha.slice(0, 7)}</span>
                <span>{revision.author}</span>
                <span>{revision.date.slice(0, 10)}</span>
                {prCommits.has(revision.sha) && <span className="badge">this PR</span>}
              </div>
              {revision.path !== path && (
                <div className="history-renamed">was {revision.path}</div>
              )}
              <button
                className="commit-pick"
                aria-pressed={picked}
                disabled={current}
                onClick={() => onCompare(revision)}
                title={current ? "This is the version the pull request head has" : undefined}
              >
                {current ? "Current version" : picked ? "Comparing with head" : "Compare with head"}
              </button>
            </article>
          );
        })}
    </aside>
  );
}
