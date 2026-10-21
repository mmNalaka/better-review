import { useEffect, useMemo, useState } from "react";

import { loadCallers, type CallSite, type CallersResult, type PullRequest } from "./api";

/**
 * Who calls the symbol you ⌥-clicked. Grouped by file, changed files first,
 * since a caller the pull request also touched is the one most likely to
 * need reading next. Picking a site hops there, as a definition does.
 */

export interface CallersTarget {
  readonly path: string;
  /** 0-based. */
  readonly line: number;
  readonly character: number;
}

interface CallersPanelProps {
  readonly pr: PullRequest;
  readonly target: CallersTarget;
  readonly changed: ReadonlySet<string>;
  readonly onOpen: (site: CallSite) => void;
  readonly onClose: () => void;
}

type Load =
  | { readonly state: "loading" }
  | { readonly state: "error"; readonly message: string }
  | { readonly state: "unsupported"; readonly reason: string }
  | { readonly state: "ready"; readonly result: CallersResult };

function groupByFile(
  sites: readonly CallSite[],
  changed: ReadonlySet<string>,
): readonly (readonly [string, readonly CallSite[]])[] {
  const groups = new Map<string, CallSite[]>();
  for (const site of sites) groups.set(site.path, [...(groups.get(site.path) ?? []), site]);
  return [...groups].sort(
    ([a], [b]) => Number(changed.has(b)) - Number(changed.has(a)) || a.localeCompare(b),
  );
}

export function CallersPanel({ pr, target, changed, onOpen, onClose }: CallersPanelProps) {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    let live = true;
    setLoad({ state: "loading" });
    loadCallers(pr.owner, pr.repo, pr.number, pr.headSha, target.path, target.line, target.character)
      .then((result) => {
        if (!live) return;
        setLoad(
          "unsupported" in result
            ? { state: "unsupported", reason: result.reason }
            : { state: "ready", result },
        );
      })
      .catch((cause: unknown) => {
        if (live) setLoad({ state: "error", message: cause instanceof Error ? cause.message : String(cause) });
      });
    return () => {
      live = false;
    };
  }, [pr.owner, pr.repo, pr.number, pr.headSha, target.path, target.line, target.character]);

  const groups = useMemo(
    () => (load.state === "ready" ? groupByFile(load.result.sites, changed) : []),
    [load, changed],
  );

  const result = load.state === "ready" ? load.result : null;
  const heading = result?.via === "references" ? "References" : "Callers";

  return (
    <aside className="commits callers" aria-label={heading}>
      <header className="commits-head">
        <span className="eyebrow">{heading}</span>
        {result && <span className="n">{result.sites.length}</span>}
        <button className="commits-close" onClick={onClose} aria-label={`Close ${heading.toLowerCase()}`}>
          ×
        </button>
      </header>
      <p className="history-path">
        {result?.symbol ? <b>{result.symbol}</b> : "Symbol"} at {target.path}:{target.line + 1}
      </p>

      {load.state === "loading" && <p className="pane-empty">Asking the language server…</p>}
      {load.state === "error" && <p className="pane-empty pane-error">{load.message}</p>}
      {load.state === "unsupported" && <p className="pane-empty">Not applicable — {load.reason}</p>}
      {result?.unknown && (
        <p className="pane-empty pane-error">
          Unknown — the language server could not place this. {result.unknown}
        </p>
      )}
      {result && !result.unknown && result.sites.length === 0 && (
        <p className="pane-empty">
          {result.external > 0
            ? `Only used outside this repo (${result.external}).`
            : "Nothing in this repo calls it."}
        </p>
      )}
      {result?.capped && <p className="capped callers-note">Showing the first {result.sites.length}.</p>}
      {result && result.external > 0 && result.sites.length > 0 && (
        <p className="callers-note">Plus {result.external} outside this repo.</p>
      )}

      {groups.map(([path, sites]) => (
        <section className="callers-file" key={path}>
          <h4 title={path}>
            {path}
            {changed.has(path) && <span className="badge">changed</span>}
          </h4>
          {sites.map((site) => (
            <button
              className="callers-site"
              key={`${site.line}:${site.character}`}
              onClick={() => onOpen(site)}
              title={`Open ${path}:${site.line + 1}`}
            >
              <span className="callers-line">{site.line + 1}</span>
              {site.caller && <span className="callers-fn">{site.caller}</span>}
              <code className="callers-preview">{site.preview}</code>
            </button>
          ))}
        </section>
      ))}
    </aside>
  );
}
