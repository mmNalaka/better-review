import { useEffect, useState } from "react";

import type { FileDiff, Hunk } from "./api";
import { tokenise, type ThemedToken } from "./highlighter";
import type { BundledTheme } from "shiki";

/**
 * Ticket 14: the changed hunks, beside the whole file rather than instead of it.
 * Clicking a hunk moves the file pane to the same line.
 */

/** Some hunks in a long-lived branch carry ten commits. Show the story, not the log. */
const SHOWN = 2;

type Rows = readonly (readonly ThemedToken[])[];

/**
 * Highlight each hunk's old and new sides as separate blocks, then take every
 * line's tokens from the side it belongs to.
 *
 * Not per line: a line alone loses the context a tokeniser needs (a block
 * comment, an unterminated string). Not the hunk as one block either — mixing
 * removed and added lines produces source that never existed and tokenises
 * badly. Two coherent sides is the closest either half gets to real syntax.
 */
async function highlightHunk(hunk: Hunk, path: string, theme: BundledTheme): Promise<Rows> {
  const oldText: string[] = [];
  const newText: string[] = [];
  const side: { from: "old" | "new"; index: number }[] = [];

  for (const line of hunk.lines) {
    if (line.kind === "removed") {
      side.push({ from: "old", index: oldText.length });
      oldText.push(line.text);
    } else if (line.kind === "added") {
      side.push({ from: "new", index: newText.length });
      newText.push(line.text);
    } else {
      side.push({ from: "new", index: newText.length });
      oldText.push(line.text);
      newText.push(line.text);
    }
  }

  const [oldRows, newRows] = await Promise.all([
    oldText.length > 0 ? tokenise(oldText.join("\n"), path, theme) : Promise.resolve([]),
    newText.length > 0 ? tokenise(newText.join("\n"), path, theme) : Promise.resolve([]),
  ]);

  return side.map(({ from, index }) => (from === "old" ? oldRows[index] : newRows[index]) ?? []);
}

const MARKER: Readonly<Record<string, string>> = {
  added: "+",
  removed: "−",
  context: " ",
};

interface DiffPaneProps {
  readonly diff: FileDiff | null;
  readonly loading: boolean;
  readonly theme: BundledTheme;
  readonly onJump: (line: number) => void;
}

export function DiffPane({ diff, loading, theme, onJump }: DiffPaneProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [rows, setRows] = useState<ReadonlyMap<string, Rows>>(new Map());

  useEffect(() => {
    if (!diff || diff.binary) {
      setRows(new Map());
      return;
    }
    let live = true;
    void (async () => {
      const entries = await Promise.all(
        diff.hunks.map(
          async (hunk) => [hunk.header, await highlightHunk(hunk, diff.path, theme)] as const,
        ),
      );
      if (live) setRows(new Map(entries));
    })();
    return () => {
      live = false;
    };
  }, [diff, theme]);

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
            {hunk.lines.map((line, index) => {
              const tokens = rows.get(hunk.header)?.[index];
              return (
                <div className={`dl ${line.kind}`} key={index}>
                  <span className="dl-old">{line.oldLine ?? ""}</span>
                  <span className="dl-new">{line.newLine ?? ""}</span>
                  <span className="dl-mark">{MARKER[line.kind]}</span>
                  <span className="dl-text">
                    {tokens && tokens.length > 0
                      ? tokens.map((token, i) => (
                          <span key={i} style={token.color ? { color: token.color } : undefined}>
                            {token.content}
                          </span>
                        ))
                      : line.text || " "}
                  </span>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
