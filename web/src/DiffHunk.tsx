import { Fragment, memo } from "react";

import type { Hunk, MarkFile } from "./api";
import type { LineNote } from "../../server/markmodel";
import { parseNoteBody, withSuggestion } from "../../server/suggestion";
import { coveredLines, isReviewed, noteAt, notesByLastLine } from "./marks";
import { DiffRow } from "./DiffRow";
import type { ThemedToken } from "./highlighter";

/**
 * One hunk: its bar, its lines, and the comments hanging off them.
 *
 * Memoised per hunk, so a drag inside one hunk leaves the other seven alone.
 * `selection` is null for every hunk but the one being dragged over, which is
 * what keeps their props identical between renders and lets them skip entirely.
 */

/** Some hunks in a long-lived branch carry ten commits. Show the story, not the log. */
const SHOWN = 2;

export type Rows = readonly (readonly ThemedToken[])[];

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

export interface Selection {
  readonly from: number;
  readonly to: number;
}

/** The line, or lines, an anchor covers — in the numbers shown in the gutter. */
export function whereOf(hunk: Hunk, anchor: NoteAnchor): string {
  if (anchor.lineIndex === null) return "the whole hunk";
  const number = (index: number): string => {
    const line = hunk.lines[index];
    return String(line?.newLine ?? line?.oldLine ?? "?");
  };
  const from = number(anchor.lineIndex);
  const to = number(anchor.endLineIndex ?? anchor.lineIndex);
  return from === to ? `line ${from}` : `lines ${from}–${to}`;
}

/** The text of the lines an anchor covers, for seeding a suggestion. */
const linesOf = (hunk: Hunk, anchor: NoteAnchor): readonly string[] => {
  if (anchor.lineIndex === null) return [];
  const end = anchor.endLineIndex ?? anchor.lineIndex;
  return hunk.lines.slice(anchor.lineIndex, end + 1).map((line) => line.text);
};

interface DiffHunkProps {
  readonly path: string;
  readonly hunk: Hunk;
  readonly tokens: Rows | undefined;
  readonly marks: MarkFile;
  readonly expanded: boolean;
  /** Non-null only while this hunk is the one being dragged over. */
  readonly selection: Selection | null;
  /** Non-null only when the open composer belongs to this hunk. */
  readonly composing: NoteAnchor | null;
  readonly draft: string;
  readonly onJump: (line: number) => void;
  readonly onToggleHunk: (id: string, header: string) => void;
  readonly onToggleCommits: (header: string) => void;
  readonly onPointerDown: (hunkId: string, index: number, shift: boolean) => void;
  readonly onPointerEnter: (hunkId: string, index: number) => void;
  readonly onOpen: (anchor: NoteAnchor, existing: LineNote | null) => void;
  readonly onDraft: (body: string) => void;
  readonly onCommit: (anchor: NoteAnchor) => void;
  readonly onCancel: () => void;
  readonly onNote: (anchor: NoteAnchor, body: string) => void;
}

export const DiffHunk = memo(function DiffHunk({
  path,
  hunk,
  tokens,
  marks,
  expanded,
  selection,
  composing,
  draft,
  onJump,
  onToggleHunk,
  onToggleCommits,
  onPointerDown,
  onPointerEnter,
  onOpen,
  onDraft,
  onCommit,
  onCancel,
  onNote,
}: DiffHunkProps) {
  const reviewed = isReviewed(marks, path, hunk.id);
  const hunkNote = noteAt(marks, path, hunk.id, null);
  const byLastLine = notesByLastLine(marks, path, hunk.id);
  const covered = coveredLines(marks, path, hunk.id);

  // Jump to the first line that exists on the head side.
  const jumpTo = hunk.lines.find((line) => line.newLine !== null)?.newLine ?? hunk.newStart;
  const hunkAnchor: NoteAnchor = { hunkId: hunk.id, lineIndex: null, lineText: null };

  /**
   * The highlighted band: the drag if one is in progress, otherwise the range
   * the open composer covers, so the lines stay marked while you write.
   */
  const band = selection
    ? {
        top: Math.min(selection.from, selection.to),
        bottom: Math.max(selection.from, selection.to),
      }
    : composing && composing.lineIndex !== null
      ? { top: composing.lineIndex, bottom: composing.endLineIndex ?? composing.lineIndex }
      : null;

  const openOn = (lineIndex: number | null) =>
    composing !== null &&
    (composing.lineIndex === null
      ? lineIndex === null
      : (composing.endLineIndex ?? composing.lineIndex) === lineIndex);

  const composer = (anchor: NoteAnchor) => {
    const suggesting = parseNoteBody(draft).suggestion !== null;

    return (
      <div className="dl-compose">
        <div className="dl-compose-head">
          <span className="dl-compose-where">{whereOf(hunk, anchor)}</span>
          {anchor.lineIndex !== null && !suggesting && (
            <button
              className="dl-suggest"
              title="Replace these lines with your own — GitHub renders it as an applicable suggestion"
              onClick={() => onDraft(withSuggestion(draft, linesOf(hunk, anchor).join("\n")))}
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
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter is a newline in a note; the modifier commits.
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onCommit(anchor);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
        />
        <div className="noterow">
          <button className="notesave" onClick={() => onCommit(anchor)}>
            Save
          </button>
          <button className="notecancel" onClick={onCancel}>
            Cancel
          </button>
          <span className="notehint">⌘↵ to save · Esc to cancel</span>
        </div>
      </div>
    );
  };

  const comment = (note: LineNote, anchor: NoteAnchor) => {
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
            <button onClick={() => onOpen(anchor, note)}>Edit</button>
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

  return (
    <section className={`hunkblock${reviewed ? " done" : ""}`}>
      <div className="hunkbar">
        <button
          className={`hunktick${reviewed ? " on" : ""}`}
          aria-pressed={reviewed}
          aria-label={reviewed ? "Reviewed — click to clear" : "Mark this hunk reviewed"}
          title={reviewed ? "Reviewed — click to clear" : "Mark this hunk reviewed"}
          onClick={() => onToggleHunk(hunk.id, hunk.header)}
        >
          {reviewed ? "✓" : ""}
        </button>
        <button className="hunkhead" onClick={() => onJump(jumpTo - 1)}>
          {hunk.header}
        </button>
        <button
          className={`hunkflag${hunkNote ? " on" : ""}`}
          aria-pressed={hunkNote !== null}
          title={hunkNote ? "Edit the note on this hunk" : "Note about the whole hunk"}
          onClick={() => (openOn(null) ? onCancel() : onOpen(hunkAnchor, hunkNote))}
        >
          ⚑
        </button>
      </div>

      {openOn(null) && composing ? composer(composing) : hunkNote && comment(hunkNote, hunkAnchor)}

      {(hunk.commits ?? []).length > 0 && (
        <div className="attrib">
          {(expanded ? hunk.commits! : hunk.commits!.slice(0, SHOWN)).map((commit) => (
            <div className="attrib-row" key={commit.sha} title={commit.sha.slice(0, 10)}>
              <span className="attrib-sha">{commit.sha.slice(0, 7)}</span>
              {commit.subject}
            </div>
          ))}
          {hunk.commits!.length > SHOWN && (
            <button className="attrib-more" onClick={() => onToggleCommits(hunk.header)}>
              {expanded ? "fewer" : `+${hunk.commits!.length - SHOWN} more commits`}
            </button>
          )}
        </div>
      )}

      {hunk.lines.map((line, index) => {
        const ending = byLastLine.get(index) ?? null;
        const picking = band !== null && index >= band.top && index <= band.bottom;

        return (
          <Fragment key={index}>
            <DiffRow
              hunkId={hunk.id}
              line={line}
              tokens={tokens?.[index]}
              index={index}
              noted={covered.has(index)}
              picking={picking}
              pickTop={band?.top === index}
              pickBottom={band?.bottom === index}
              onPointerDown={onPointerDown}
              onPointerEnter={onPointerEnter}
            />
            {openOn(index) && composing
              ? composer(composing)
              : ending &&
                comment(ending, {
                  hunkId: hunk.id,
                  lineIndex: ending.lineIndex,
                  lineText: ending.lineText,
                  endLineIndex: ending.endLineIndex ?? null,
                  endLineText: ending.endLineText ?? null,
                })}
          </Fragment>
        );
      })}
    </section>
  );
});
