import { useState } from "react";

import type { FileDiff } from "./api";

/**
 * Ticket 14: the changed hunks, beside the whole file rather than instead of it.
 * Clicking a hunk moves the file pane to the same line.
 */

/** Some hunks in a long-lived branch carry ten commits. Show the story, not the log. */
const SHOWN = 2;

const MARKER: Readonly<Record<string, string>> = {
  added: "+",
  removed: "−",
  context: " ",
};

interface DiffPaneProps {
  readonly diff: FileDiff | null;
  readonly loading: boolean;
  readonly onJump: (line: number) => void;
}

export function DiffPane({ diff, loading, onJump }: DiffPaneProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (header: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(header)) next.delete(header);
      else next.add(header);
      return next;
    });

  if (loading) return <div className="pane-empty">Reading the diff…</div>;
  if (!diff) return <div className="pane-empty">This file is not changed by the pull request.</div>;
  if (diff.binary) return <div className="pane-empty">Binary file — no textual diff.</div>;
  if (diff.hunks.length === 0) {
    return <div className="pane-empty">No textual changes (mode or rename only).</div>;
  }

  return (
    <div className="diffpane">
      <header className="diffhead">
        <span className="eyebrow">Changed hunks</span>
        <span className="n">{diff.hunks.length}</span>
      </header>
      {diff.hunks.map((hunk) => {
        // Jump to the first line that exists on the head side.
        const anchor = hunk.lines.find((line) => line.newLine !== null)?.newLine ?? hunk.newStart;
        return (
          <section className="hunkblock" key={hunk.header}>
            <button className="hunkhead" onClick={() => onJump(anchor - 1)}>
              {hunk.header}
            </button>
            {(hunk.commits ?? []).length > 0 && (
              <div className="attrib">
                {(expanded.has(hunk.header) ? hunk.commits! : hunk.commits!.slice(0, SHOWN)).map(
                  (commit) => (
                    <div className="attrib-row" key={commit.sha} title={commit.sha.slice(0, 10)}>
                      <span className="attrib-sha">{commit.sha.slice(0, 7)}</span>
                      {commit.subject}
                    </div>
                  ),
                )}
                {hunk.commits!.length > SHOWN && (
                  <button className="attrib-more" onClick={() => toggle(hunk.header)}>
                    {expanded.has(hunk.header)
                      ? "fewer"
                      : `+${hunk.commits!.length - SHOWN} more commits`}
                  </button>
                )}
              </div>
            )}
            {hunk.lines.map((line, index) => (
              <div className={`dl ${line.kind}`} key={index}>
                <span className="dl-old">{line.oldLine ?? ""}</span>
                <span className="dl-new">{line.newLine ?? ""}</span>
                <span className="dl-mark">{MARKER[line.kind]}</span>
                <span className="dl-text">{line.text || " "}</span>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
