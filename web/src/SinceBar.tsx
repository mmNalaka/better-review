import type { SinceState } from "./useSince";

/**
 * The re-review strip: how the pull request moved since your last finished
 * pass, and the one button that narrows the explorer to what is new.
 *
 * Shown only when there is something to say — a push noticed while open, or a
 * head that differs from the last pass.
 */

interface SinceBarProps {
  readonly since: SinceState;
  /** Set when GitHub has a head newer than the one loaded. */
  readonly pushed: boolean;
  readonly filtering: boolean;
  readonly onFilter: () => void;
  readonly onReload: () => void;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function SinceBar({ since, pushed, filtering, onFilter, onReload }: SinceBarProps) {
  const { pass, report, summary, loading, error } = since;
  const moved = pass !== null && (summary !== null || loading || error !== null);
  if (!pushed && !moved) return null;

  return (
    <div className="sincebar" role="status">
      {pushed && (
        <span className="since-part">
          <b>New commits were pushed.</b>{" "}
          <button className="since-link" onClick={onReload}>
            Reload
          </button>
        </span>
      )}

      {pass && moved && (
        <span className="since-part">
          Since your pass on {when(pass.at)}
          {loading && " — working out what changed…"}
          {error && <span className="notice"> — {error}</span>}
          {report && (
            <>
              {" · "}
              {plural(report.commits.length, "new commit")}
              {report.forcePushed && <span className="badge">force-pushed</span>}
              {report.baseMoved && <span className="badge">rebased</span>}
            </>
          )}
        </span>
      )}

      {summary && (
        <>
          <span className="since-counts">
            <span className="since-chip new">
              <b>{summary.counts.new}</b> new
            </span>
            <span className="since-chip edited">
              <b>{summary.counts.edited}</b> edited
            </span>
            <span className="since-chip gone">
              <b>{summary.counts.gone}</b> gone
            </span>
          </span>
          <button
            className="findings-open"
            aria-pressed={filtering}
            disabled={summary.paths.length === 0}
            onClick={onFilter}
            title="Only the files with new, edited or gone hunks — w"
          >
            What's new · {summary.paths.length}
          </button>
        </>
      )}

      {report && !report.available && (
        <span className="since-part faint">
          The head you reviewed is no longer in this clone, so edited hunks cannot be matched.
        </span>
      )}
    </div>
  );
}
