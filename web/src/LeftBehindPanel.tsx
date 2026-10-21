import type { CallSite, LeftBehind } from "./api";
import type { LeftBehindLoad } from "./useLeftBehind";

/**
 * Callers left behind: functions whose signature the PR changed, with the
 * calls to them on lines the PR did not touch. Those are the places a missed
 * update hides. Picking one hops there, as a caller does.
 */

interface LeftBehindPanelProps {
  readonly load: LeftBehindLoad;
  readonly onOpen: (site: { readonly path: string; readonly line: number }) => void;
  readonly onClose: () => void;
}

function Change({ change, onOpen }: { change: LeftBehind; onOpen: LeftBehindPanelProps["onOpen"] }) {
  const stale = change.stale.length;
  return (
    <section className="callers-file left-behind">
      <h4 title={`${change.path}:${change.line + 1}`}>
        <button className="left-behind-name" onClick={() => onOpen(change)}>
          {change.name}
        </button>
        <span className="left-behind-where">
          {change.path}:{change.line + 1}
        </span>
        <span className={`badge${stale > 0 ? " stale" : ""}`}>
          {change.unknown ? "unknown" : `${stale} left behind`}
        </span>
      </h4>
      <div className="left-behind-sig">
        <code className="out">− {change.before}</code>
        <code className="in">+ {change.after}</code>
      </div>
      {change.unknown && (
        <p className="callers-note pane-error">The language server would not say: {change.unknown}</p>
      )}
      {change.stale.map((site: CallSite) => (
        <button
          className="callers-site"
          key={`${site.path}:${site.line}:${site.character}`}
          onClick={() => onOpen(site)}
          title={`Open ${site.path}:${site.line + 1}`}
        >
          <span className="callers-line">{site.line + 1}</span>
          <span className="callers-fn">{site.path}</span>
          <code className="callers-preview">{site.preview}</code>
        </button>
      ))}
      {(change.updated > 0 || change.external > 0) && (
        <p className="callers-note">
          {change.updated > 0 && `${change.updated} on lines this PR changed. `}
          {change.external > 0 && `${change.external} outside this repo.`}
        </p>
      )}
    </section>
  );
}

export function LeftBehindPanel({ load, onOpen, onClose }: LeftBehindPanelProps) {
  const report = load.state === "ready" ? load.report : null;
  const total = report?.changes.reduce((sum, change) => sum + change.stale.length, 0) ?? 0;

  return (
    <aside className="commits callers" aria-label="Callers left behind">
      <header className="commits-head">
        <span className="eyebrow">Callers left behind</span>
        {report && <span className="n">{total}</span>}
        <button className="commits-close" onClick={onClose} aria-label="Close callers left behind" title="Close — Esc">
          ×
        </button>
      </header>
      <p className="history-path">
        Functions whose signature this PR changed, and calls to them on lines it did not touch.
      </p>

      {(load.state === "loading" || load.state === "idle") && (
        <p className="pane-empty">Asking the language server about each changed signature…</p>
      )}
      {load.state === "error" && <p className="pane-empty pane-error">{load.message}</p>}
      {report?.capped && <p className="capped callers-note">Incomplete — {report.capped}.</p>}
      {report && report.changes.length === 0 && (
        <p className="pane-empty">No function's signature changed in a file a language server reads.</p>
      )}
      {report && report.skipped.length > 0 && (
        <p className="callers-note" title={report.skipped.map((s) => `${s.path}: ${s.reason}`).join("\n")}>
          {report.skipped.length} changed {report.skipped.length === 1 ? "file" : "files"} could not be read.
        </p>
      )}

      {report?.changes.map((change) => (
        <Change key={`${change.path}:${change.line}:${change.name}`} change={change} onOpen={onOpen} />
      ))}
    </aside>
  );
}
