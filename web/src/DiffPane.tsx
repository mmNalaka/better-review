import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { FileDiff, Hunk, MarkFile } from "./api";
import type { LineNote } from "../../server/markmodel";
import { noteAt } from "./marks";
import { DiffHunk, type NoteAnchor, type Rows } from "./DiffHunk";
import { tokenise } from "./highlighter";
import type { ThemeName } from "./themes";

/**
 * Ticket 14: the changed hunks, beside the whole file rather than instead of it.
 * Clicking a hunk moves the file pane to the same line.
 *
 * Comments are inline, as they are on GitHub: press the `+` on a line and drag
 * down the gutter to take in more, and the composer opens under the last line
 * of the range. This file holds only the state and the drag lifecycle — the
 * rendering lives in DiffHunk and DiffRow, both memoised, because a pointer
 * move that re-rendered a thousand syntax-highlighted rows was the whole reason
 * dragging felt slow.
 */

export type { NoteAnchor } from "./DiffHunk";

interface Selecting {
  readonly hunkId: string;
  readonly from: number;
  readonly to: number;
}

/**
 * Highlight each hunk's old and new sides as separate blocks, then take every
 * line's tokens from the side it belongs to.
 *
 * Not per line: a line alone loses the context a tokeniser needs (a block
 * comment, an unterminated string). Not the hunk as one block either — mixing
 * removed and added lines produces source that never existed and tokenises
 * badly. Two coherent sides is the closest either half gets to real syntax.
 */
async function highlightHunk(hunk: Hunk, path: string, theme: ThemeName): Promise<Rows> {
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

interface DiffPaneProps {
  readonly diff: FileDiff | null;
  readonly loading: boolean;
  readonly theme: ThemeName;
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
  /**
   * The drag, as the pointer knows it. The ref is the source of truth and the
   * state is only for rendering: a press and release faster than React can
   * commit — a quick click — left a render-populated ref still empty, and the
   * release opened nothing.
   */
  const live = useRef<Selecting | null>(null);

  const pick = useCallback((next: Selecting | null) => {
    live.current = next;
    setSelecting(next);
  }, []);

  const close = useCallback(() => {
    setComposing(null);
    setDraft("");
  }, []);

  // Changing file closes the composer: it belonged to a line no longer shown.
  useEffect(() => {
    close();
    pick(null);
  }, [diff?.path, close, pick]);

  useEffect(() => {
    if (!diff || diff.binary) {
      setRows(new Map());
      return;
    }
    let alive = true;
    void (async () => {
      const entries = await Promise.all(
        diff.hunks.map(
          async (hunk) => [hunk.header, await highlightHunk(hunk, diff.path, theme)] as const,
        ),
      );
      if (alive) setRows(new Map(entries));
    })();
    return () => {
      alive = false;
    };
  }, [diff, theme]);

  const open = useCallback((anchor: NoteAnchor, existing: LineNote | null) => {
    setComposing(anchor);
    setDraft(existing?.body ?? "");
  }, []);

  /**
   * Releasing the pointer is what opens the composer — not the click that
   * follows it. A drag has to be read while the selection still exists, and by
   * click time the press is over.
   *
   * Subscribed once and reading the drag from a ref: re-subscribing on every
   * pointer move would put a listener swap in every frame of the drag.
   */
  useEffect(() => {
    const finish = (ended: boolean) => {
      const selection = live.current;
      document.body.classList.remove("picking-lines");

      if (closing.current) {
        closing.current = false;
        pick(null);
        close();
        return;
      }
      if (!selection) return;
      pick(null);
      if (!ended) return; // cancelled: leave whatever was open alone

      const hunk = diff?.hunks.find((candidate) => candidate.id === selection.hunkId);
      const path = diff?.path;
      if (!hunk || !path) return;

      const start = Math.min(selection.from, selection.to);
      const end = Math.max(selection.from, selection.to);
      const anchor: NoteAnchor = {
        hunkId: selection.hunkId,
        lineIndex: start,
        lineText: hunk.lines[start]?.text ?? null,
        endLineIndex: end === start ? null : end,
        endLineText: end === start ? null : (hunk.lines[end]?.text ?? null),
      };
      open(anchor, noteAt(marks, path, anchor.hunkId, start, end === start ? null : end));
    };

    const up = () => finish(true);
    const cancel = () => finish(false);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [diff, marks, open, close, pick]);

  const onPointerDown = useCallback(
    (hunkId: string, index: number, shift: boolean) => {
      // Text selection would fight the drag for the pointer.
      document.body.classList.add("picking-lines");

      const openHere =
        composing !== null &&
        composing.hunkId === hunkId &&
        composing.lineIndex !== null &&
        (composing.endLineIndex ?? composing.lineIndex) === index;

      if (openHere && !shift) {
        closing.current = true;
        pick({ hunkId, from: index, to: index });
        return;
      }
      // Shift extends from where the open composer began — how a range is
      // picked without dragging.
      const from =
        shift && composing?.hunkId === hunkId && composing.lineIndex !== null
          ? composing.lineIndex
          : index;
      pick({ hunkId, from, to: index });
    },
    [composing, pick],
  );

  const onPointerEnter = useCallback(
    (hunkId: string, index: number) => {
      const current = live.current;
      if (closing.current || !current) return;
      // Already this line: nothing to change, so nothing re-renders.
      if (current.hunkId !== hunkId || current.to === index) return;
      pick({ ...current, to: index });
    },
    [pick],
  );

  const onToggleCommits = useCallback((header: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(header)) next.delete(header);
      else next.add(header);
      return next;
    });
  }, []);

  const onCommit = useCallback(
    (anchor: NoteAnchor) => {
      onNote(anchor, draft);
      close();
    },
    [draft, onNote, close],
  );

  // One stable bundle: a hunk nobody is touching sees identical props.
  const handlers = useMemo(
    () => ({
      onJump,
      onToggleHunk,
      onToggleCommits,
      onPointerDown,
      onPointerEnter,
      onOpen: open,
      onDraft: setDraft,
      onCommit,
      onCancel: close,
      onNote,
    }),
    [
      onJump,
      onToggleHunk,
      onToggleCommits,
      onPointerDown,
      onPointerEnter,
      open,
      onCommit,
      close,
      onNote,
    ],
  );

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
      {diff.hunks.map((hunk) => (
        <DiffHunk
          key={hunk.header}
          path={diff.path}
          hunk={hunk}
          tokens={rows.get(hunk.header)}
          marks={marks}
          expanded={expanded.has(hunk.header)}
          selection={selecting?.hunkId === hunk.id ? selecting : null}
          composing={composing?.hunkId === hunk.id ? composing : null}
          draft={composing?.hunkId === hunk.id ? draft : ""}
          {...handlers}
        />
      ))}
    </div>
  );
}
