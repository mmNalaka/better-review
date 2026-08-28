import { Fragment, useEffect, useRef, useState } from "react";

import type { FileDiff, Hunk, MarkFile } from "./api";
import { coveredLines, isReviewed, noteAt, notesByLastLine } from "./marks";
import { parseNoteBody, withSuggestion } from "../../server/suggestion";
import { tokenise, type ThemedToken } from "./highlighter";
import type { BundledTheme } from "shiki";
import type { LineNote } from "../../server/markmodel";

/**
 * Ticket 14: the changed hunks, beside the whole file rather than instead of it.
 * Clicking a hunk moves the file pane to the same line.
 *
 * Comments are inline, as they are on GitHub: the `+` on a line opens a box
 * under that line, and a saved note stays there to be read in place. The hunk
 * bar's ⚑ writes a note about the whole hunk instead — which is also where a
 * note saved before line anchoring existed shows up.
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

/**
 * Where a note hangs. A null line index means the note is about the hunk;
 * an end index means it spans from the first line to that one.
 */
export interface NoteAnchor {
  readonly hunkId: string;
  readonly lineIndex: number | null;
  readonly lineText: string | null;
  readonly endLineIndex?: number | null;
  readonly endLineText?: string | null;
}

/** A range being dragged out in the gutter, before the composer opens. */
interface Selecting {
  readonly hunkId: string;
  readonly from: number;
  readonly to: number;
}

const lowest = (selection: Selecting) => Math.min(selection.from, selection.to);
const highest = (selection: Selecting) => Math.max(selection.from, selection.to);

/** The line, or lines, an anchor covers — in the numbers shown in the gutter. */
function whereOf(hunk: Hunk, anchor: NoteAnchor): string {
  if (anchor.lineIndex === null) return "the whole hunk";
  const first = hunk.lines[anchor.lineIndex];
  const last = hunk.lines[anchor.endLineIndex ?? anchor.lineIndex];
  const number = (line: (typeof hunk.lines)[number] | undefined) =>
    line ? (line.newLine ?? line.oldLine ?? "?") : "?";
  const from = number(first);
  const to = number(last);
  return from === to ? `line ${from}` : `lines ${from}–${to}`;
}

interface DiffPaneProps {
  readonly diff: FileDiff | null;
  readonly loading: boolean;
  readonly theme: BundledTheme;
  readonly marks: MarkFile;
  readonly onJump: (line: number) => void;
  readonly onToggleHunk: (id: string, header: string) => void;
  readonly onNote: (anchor: NoteAnchor, body: string) => void;
}

export function DiffPane({
  diff,
  loading,
  theme,
  marks,
  onJump,
  onToggleHunk,
  onNote,
}: DiffPaneProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [rows, setRows] = useState<ReadonlyMap<string, Rows>>(new Map());
  const [composing, setComposing] = useState<NoteAnchor | null>(null);
  const [draft, setDraft] = useState("");
  const [selecting, setSelecting] = useState<Selecting | null>(null);
  /** Set when the press was on an open composer's own line: that press closes it. */
  const closing = useRef(false);

  // Changing file closes the composer: it belonged to a line no longer shown.
  useEffect(() => {
    setComposing(null);
    setDraft("");
    setSelecting(null);
  }, [diff?.path]);

  /**
   * Releasing the pointer is what opens the composer — not the click that
   * follows it. A drag has to be read while the selection still exists, and by
   * click time the press is over; an earlier version cleared the range on
   * pointerup and every dragged range collapsed to its last line.
   *
   * The listener is on the window so a drag that leaves the gutter still ends.
   */
  useEffect(() => {
    if (!selecting && !closing.current) return;

    const finish = (ended: boolean) => {
      if (closing.current) {
        closing.current = false;
        close();
        setSelecting(null);
        return;
      }
      if (!selecting) return;
      setSelecting(null);
      if (!ended) return; // cancelled: leave whatever was open alone

      const hunk = diff?.hunks.find((candidate) => candidate.id === selecting.hunkId);
      if (!hunk) return;

      const start = lowest(selecting);
      const end = highest(selecting);
      const anchor: NoteAnchor = {
        hunkId: selecting.hunkId,
        lineIndex: start,
        lineText: hunk.lines[start]?.text ?? null,
        endLineIndex: end === start ? null : end,
        endLineText: end === start ? null : (hunk.lines[end]?.text ?? null),
      };
      const path = diff?.path;
      if (!path) return;
      open(anchor, noteAt(marks, path, selecting.hunkId, start, end === start ? null : end));
    };

    const up = () => finish(true);
    const cancel = () => finish(false);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [selecting, diff, marks]);

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

  const open = (anchor: NoteAnchor, existing: LineNote | null) => {
    setComposing(anchor);
    setDraft(existing?.body ?? "");
  };

  const close = () => {
    setComposing(null);
    setDraft("");
  };

  /** The lines a composer covers, for seeding a suggestion with their text. */
  const linesOf = (hunk: Hunk, anchor: NoteAnchor): readonly string[] => {
    if (anchor.lineIndex === null) return [];
    const end = anchor.endLineIndex ?? anchor.lineIndex;
    return hunk.lines.slice(anchor.lineIndex, end + 1).map((line) => line.text);
  };

  const commit = (anchor: NoteAnchor) => {
    onNote(anchor, draft);
    close();
  };

  /** A composer is open on the anchor whose *last* line this is. */
  const isOpen = (hunkId: string, lineIndex: number | null) =>
    composing?.hunkId === hunkId &&
    (composing.lineIndex === null
      ? lineIndex === null
      : (composing.endLineIndex ?? composing.lineIndex) === lineIndex);

  const composer = (anchor: NoteAnchor, hunk: Hunk) => {
    const covers = linesOf(hunk, anchor);
    const suggesting = parseNoteBody(draft).suggestion !== null;

    return (
      <div className="dl-compose">
        <div className="dl-compose-head">
          <span className="dl-compose-where">{whereOf(hunk, anchor)}</span>
          {anchor.lineIndex !== null && !suggesting && (
            <button
              className="dl-suggest"
              title="Replace these lines with your own — GitHub renders it as an applicable suggestion"
              onClick={() => setDraft(withSuggestion(draft, covers.join("\n")))}
            >
              Suggest a change
            </button>
          )}
        </div>
        <textarea
          value={draft}
          autoFocus
          rows={suggesting ? 6 : 2}
          placeholder={
            anchor.lineIndex === null ? "A note about this hunk" : "A note about these lines"
          }
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter is a newline in a note; the modifier commits.
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              commit(anchor);
            } else if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
        />
        <div className="noterow">
          <button className="notesave" onClick={() => commit(anchor)}>
            Save
          </button>
          <button className="notecancel" onClick={close}>
            Cancel
          </button>
          <span className="notehint">⌘↵ to save · Esc to cancel</span>
        </div>
      </div>
    );
  };

  const comment = (note: LineNote, anchor: NoteAnchor, hunk: Hunk) => {
    const { prose, suggestion } = parseNoteBody(note.body);
    const replaced = linesOf(hunk, anchor);

    return (
      <div className="dl-comment">
        <span className="dl-comment-flag" aria-hidden="true">
          ⚑
        </span>
        <div className="dl-comment-body">
          <span className="dl-comment-where">{whereOf(hunk, anchor)}</span>
          {prose && <div className="dl-comment-prose">{prose}</div>}
          {suggestion !== null && (
            <div className="dl-suggestion">
              <span className="eyebrow">Suggested change</span>
              {replaced.map((text, i) => (
                <div className="dl-suggestion-line out" key={`out-${i}`}>
                  <span className="dl-mark">−</span>
                  {text || " "}
                </div>
              ))}
              {suggestion.split("\n").map((text, i) => (
                <div className="dl-suggestion-line in" key={`in-${i}`}>
                  <span className="dl-mark">+</span>
                  {text || " "}
                </div>
              ))}
              {suggestion === "" && <div className="dl-suggestion-note">deletes these lines</div>}
            </div>
          )}
          <div className="dl-comment-row">
            <button onClick={() => open(anchor, note)}>Edit</button>
            <button onClick={() => onNote(anchor, "")}>Delete</button>
            {note.published && (
              <a className="badge posted" href={note.published.url} target="_blank" rel="noreferrer">
                posted
              </a>
            )}
          </div>
        </div>
      </div>
    );
  };

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
        const jumpTo = hunk.lines.find((line) => line.newLine !== null)?.newLine ?? hunk.newStart;
        const reviewed = isReviewed(marks, diff.path, hunk.id);
        const hunkNote = noteAt(marks, diff.path, hunk.id, null);
        const byLastLine = notesByLastLine(marks, diff.path, hunk.id);
        const covered = coveredLines(marks, diff.path, hunk.id);
        const hunkAnchor: NoteAnchor = { hunkId: hunk.id, lineIndex: null, lineText: null };

        return (
          <section className={`hunkblock${reviewed ? " done" : ""}`} key={hunk.header}>
            <div className="hunkbar">
              <button
                className={`hunktick${reviewed ? " on" : ""}`}
                aria-pressed={reviewed}
                title={reviewed ? "Reviewed — click to clear" : "Mark this hunk reviewed"}
                onClick={() => onToggleHunk(hunk.id, hunk.header)}
              >
                {reviewed ? "✓" : "·"}
              </button>
              <button className="hunkhead" onClick={() => onJump(jumpTo - 1)}>
                {hunk.header}
              </button>
              <button
                className={`hunkflag${hunkNote ? " on" : ""}`}
                aria-pressed={hunkNote !== null}
                title={hunkNote ? "Edit the note on this hunk" : "Note about the whole hunk"}
                onClick={() => (isOpen(hunk.id, null) ? close() : open(hunkAnchor, hunkNote))}
              >
                ⚑
              </button>
            </div>

            {isOpen(hunk.id, null)
              ? composer(hunkAnchor, hunk)
              : hunkNote && comment(hunkNote, hunkAnchor, hunk)}

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
              const ending = byLastLine.get(index) ?? null;
              const endingAnchor: NoteAnchor | null = ending
                ? {
                    hunkId: hunk.id,
                    lineIndex: ending.lineIndex,
                    lineText: ending.lineText,
                    endLineIndex: ending.endLineIndex ?? null,
                    endLineText: ending.endLineText ?? null,
                  }
                : null;

              const dragging =
                selecting?.hunkId === hunk.id &&
                index >= lowest(selecting) &&
                index <= highest(selecting);

              const inComposer =
                composing?.hunkId === hunk.id &&
                composing.lineIndex !== null &&
                index >= composing.lineIndex &&
                index <= (composing.endLineIndex ?? composing.lineIndex);

              return (
                <Fragment key={index}>
                  <div
                    className={`dl ${line.kind}${covered.has(index) ? " noted" : ""}${
                      dragging || inComposer ? " picking" : ""
                    }`}
                  >
                    <button
                      className="dl-add"
                      title="Comment on this line — drag or shift-click for a range"
                      aria-label={`Comment on line ${line.newLine ?? line.oldLine ?? ""}`}
                      onPointerDown={(event) => {
                        // Pressing the line a composer is already on closes it.
                        if (isOpen(hunk.id, index) && !event.shiftKey) {
                          closing.current = true;
                          setSelecting({ hunkId: hunk.id, from: index, to: index });
                          return;
                        }
                        // Shift extends from where the open composer began —
                        // how a range is picked without dragging.
                        const from =
                          event.shiftKey && composing?.hunkId === hunk.id && composing.lineIndex !== null
                            ? composing.lineIndex
                            : index;
                        setSelecting({ hunkId: hunk.id, from, to: index });
                      }}
                      onPointerEnter={() =>
                        setSelecting((current) =>
                          current && current.hunkId === hunk.id && !closing.current
                            ? { ...current, to: index }
                            : current,
                        )
                      }
                    >
                      +
                    </button>
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
                  {isOpen(hunk.id, index) && composing
                    ? composer(composing, hunk)
                    : ending && endingAnchor && comment(ending, endingAnchor, hunk)}
                </Fragment>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
