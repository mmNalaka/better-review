import { useEffect, useMemo, useState } from "react";

import { loadComparison, type CompareRow, type CompareSide, type FileRevision, type PullRequest } from "./api";
import { tokenise, type ThemedToken } from "./highlighter";
import type { ThemeName } from "./themes";

/**
 * A past version of the open file on the left, the pull request head on the
 * right, aligned row for row. One scroll container, so the sides cannot drift.
 */

interface ComparePaneProps {
  readonly pr: PullRequest;
  readonly path: string;
  readonly revision: FileRevision;
  readonly theme: ThemeName;
  readonly onClose: () => void;
}

type Tokens = readonly (readonly ThemedToken[])[];

type Load =
  | { readonly state: "loading" }
  | { readonly state: "error"; readonly message: string }
  | { readonly state: "ready"; readonly rows: readonly CompareRow[]; readonly binary: boolean };

const isChange = (row: CompareRow | undefined): boolean =>
  row !== undefined &&
  ((row.left?.kind ?? "context") !== "context" || (row.right?.kind ?? "context") !== "context");

/** Each side's whole text, rebuilt from the rows — the diff carried every line. */
const sideText = (rows: readonly CompareRow[], pick: (row: CompareRow) => CompareSide | null) =>
  rows
    .flatMap((row) => {
      const side = pick(row);
      return side ? [side.text] : [];
    })
    .join("\n");

function Cell({ side, tokens }: { readonly side: CompareSide | null; readonly tokens: Tokens }) {
  if (!side) {
    return (
      <>
        <span className="cmp-num" />
        <span className="cmp-text blank" />
      </>
    );
  }
  const line = tokens[side.line - 1];
  return (
    <>
      <span className="cmp-num">{side.line}</span>
      <span className={`cmp-text ${side.kind}`}>
        {line
          ? line.map((token, i) => (
              <span key={i} style={token.color ? { color: token.color } : undefined}>
                {token.content}
              </span>
            ))
          : side.text}
      </span>
    </>
  );
}

export function ComparePane({ pr, path, revision, theme, onClose }: ComparePaneProps) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [tokens, setTokens] = useState<{ left: Tokens; right: Tokens }>({ left: [], right: [] });

  useEffect(() => {
    let live = true;
    setLoad({ state: "loading" });
    setTokens({ left: [], right: [] });
    loadComparison(pr.owner, pr.repo, pr.number, pr.headSha, path, revision.sha, revision.path)
      .then((result) => live && setLoad({ state: "ready", ...result }))
      .catch((cause: unknown) => {
        if (live) setLoad({ state: "error", message: cause instanceof Error ? cause.message : String(cause) });
      });
    return () => {
      live = false;
    };
  }, [pr.owner, pr.repo, pr.number, pr.headSha, path, revision.sha, revision.path]);

  const rows = load.state === "ready" ? load.rows : null;

  useEffect(() => {
    if (!rows) return;
    let live = true;
    void Promise.all([
      tokenise(sideText(rows, (row) => row.left), revision.path, theme),
      tokenise(sideText(rows, (row) => row.right), path, theme),
    ]).then(([left, right]) => live && setTokens({ left, right }));
    return () => {
      live = false;
    };
  }, [rows, revision.path, path, theme]);

  /** Where each change block starts: these are what n and p step between. */
  const starts = useMemo(
    () =>
      new Set(
        (rows ?? []).flatMap((row, i) => (isChange(row) && !isChange(rows?.[i - 1]) ? [i] : [])),
      ),
    [rows],
  );

  return (
    <div className="comparepane">
      <header className="filehead cmp-head">
        <span className="cmp-side">
          <span className="commit-sha">{revision.sha.slice(0, 7)}</span>
          <span className="fname">{revision.path}</span>
          <span className="cmp-subject" title={revision.subject}>{revision.subject}</span>
        </span>
        <span className="cmp-side">
          <span className="commit-sha">head</span>
          <span className="fname">{path}</span>
          {rows && (
            <span className="resolving">
              {starts.size === 0 ? "identical" : `${starts.size} ${starts.size === 1 ? "change" : "changes"}`}
            </span>
          )}
        </span>
        <button className="commits-close cmp-close" onClick={onClose} aria-label="Close compare" title="Close — Esc">
          ×
        </button>
      </header>
      {load.state === "loading" && <div className="pane-loading" />}
      {load.state === "error" && <p className="pane-empty pane-error">{load.message}</p>}
      {load.state === "ready" && load.binary && (
        <p className="pane-empty">Binary file — nothing to lay side by side.</p>
      )}
      {rows && load.state === "ready" && !load.binary && (
        <div className="cmp-grid">
          {rows.map((row, i) => (
            <div className={`cmp-row${starts.has(i) ? " cmp-change" : ""}`} key={i}>
              <Cell side={row.left} tokens={tokens.left} />
              <Cell side={row.right} tokens={tokens.right} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
