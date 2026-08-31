import { useMemo, useState } from "react";

import type { ChangedFile, HunkIndex, MarkFile } from "./api";
import { fileState, flagged, type FileState } from "./marks";
import { RingMark } from "./RingMark";
import type { RingState } from "./useRings";

/**
 * The "Changed files" mode from ticket 06: grouped by review state, not by path,
 * and carrying no ring column — every file here is ring state `changed`,
 * so the column would be a constant.
 */

const KIND_TITLE: Readonly<Record<string, string>> = {
  A: "added", M: "modified", D: "deleted", R: "renamed",
};

/** changed first, then outward, then unknown, out of range, not applicable. */
function rank(file: { kind: string; ring?: number }): number {
  switch (file.kind) {
    case "changed": return 0;
    case "ring": return 1 + (file.ring ?? 0);
    case "unknown": return 900;
    case "out-of-range": return 950;
    default: return 999;
  }
}

const dirOf = (path: string) => (path.includes("/") ? `${path.slice(0, path.lastIndexOf("/"))}/` : "");
const baseOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * One glyph per state, per ticket 06's budget: the row cannot afford a word.
 * `changed` is *changed since reviewed* — you did the work and the ground
 * moved — so it reads as a warning rather than as unreviewed.
 */
const STATE_GLYPH: Readonly<Record<FileState, string>> = {
  // Empty, because the control is drawn as a box: an empty box reads as
  // "tick me" where a faint dot read as decoration and was missed entirely.
  none: "",
  partial: "◑",
  reviewed: "✓",
  changed: "⚠",
};

const STATE_TITLE: Readonly<Record<FileState, string>> = {
  none: "Not reviewed — click to mark the whole file",
  partial: "Some hunks reviewed — click to mark the rest",
  reviewed: "Reviewed — click to clear",
  changed: "Changed since you reviewed it — click to mark it again",
};

interface ExplorerProps {
  readonly changed: readonly ChangedFile[];
  readonly marks: MarkFile;
  readonly index: HunkIndex;
  readonly selected: string | null;
  readonly rings: RingState;
  readonly onSelect: (path: string) => void;
  readonly onToggleReviewed: (path: string) => void;
}

/**
 * Ticket 06: two modes, each signal only where it varies. `Changed files`
 * carries no ring column — every file in it is `changed`, so the column would
 * be a constant. `Whole repo` is the only surface rings vary on, so it is the
 * only one that shows them.
 */
type Mode = "changed" | "repo";

export function Explorer({
  changed, marks, index, selected, rings, onSelect, onToggleReviewed,
}: ExplorerProps) {
  const [mode, setMode] = useState<Mode>("changed");
  const [byRing, setByRing] = useState(false);

  const changedPaths = useMemo(() => new Set(changed.map((file) => file.path)), [changed]);

  const repoRows = useMemo(() => {
    const rows = [...rings.byPath.values()];
    return byRing
      ? [...rows].sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path))
      : [...rows].sort((a, b) => a.path.localeCompare(b.path));
  }, [rings, byRing]);

  const stateOf = (path: string): FileState =>
    fileState(marks, path, (index.files[path] ?? []).map((hunk) => hunk.id));

  const reviewed = changed.filter((file) => stateOf(file.path) === "reviewed");
  // Partial and changed-since-reviewed both still want your attention, so they
  // stay in the open group and say which they are with their glyph.
  const open = changed.filter((file) => stateOf(file.path) !== "reviewed");
  const percent = changed.length === 0 ? 0 : Math.round((reviewed.length / changed.length) * 100);

  const section = (title: string, files: readonly ChangedFile[]) =>
    files.length === 0 ? null : (
      <div key={title}>
        <div className="group">
          <h3>{title}</h3>
          <span className="n">{files.length}</span>
        </div>
        {files.map((file) => (
          <div
            key={file.path}
            className={`row${file.path === selected ? " sel" : ""}`}
            onClick={() => onSelect(file.path)}
          >
            <button
              className={`rev ${stateOf(file.path)}`}
              title={STATE_TITLE[stateOf(file.path)]}
              /* The box is empty when unreviewed, so it carries no text to
                 name it. */
              aria-label={`${file.path}: ${STATE_TITLE[stateOf(file.path)]}`}
              aria-pressed={stateOf(file.path) === "reviewed"}
              onClick={(event) => {
                event.stopPropagation();
                onToggleReviewed(file.path);
              }}
            >
              {STATE_GLYPH[stateOf(file.path)]}
            </button>
            <span className={`kind ${file.kind}`} title={KIND_TITLE[file.kind] ?? "modified"}>
              {file.kind}
            </span>
            <span className="name" title={file.path}>
              <span className="path-prefix">{dirOf(file.path)}</span>
              <span className="path-base">{baseOf(file.path)}</span>
            </span>
            {flagged(marks, file.path) && (
              <span className="rowflag" title="This file carries a note">
                ⚑
              </span>
            )}
            <span className="churn">
              {file.additions > 0 && <span className="p">+{file.additions}</span>}
              {file.deletions > 0 && <span className="m">−{file.deletions}</span>}
            </span>
          </div>
        ))}
      </div>
    );

  if (mode === "repo") {
    return (
      <nav className="explorer" aria-label="Whole repo">
        <div className="exhead">
          <div className="seg">
            <button aria-pressed={false} onClick={() => setMode("changed")}>
              Changed files
            </button>
            <button aria-pressed>Whole repo</button>
          </div>
          <div className="seg">
            <button aria-pressed={!byRing} onClick={() => setByRing(false)}>
              by path
            </button>
            <button aria-pressed={byRing} onClick={() => setByRing(true)}>
              by ring
            </button>
            {!rings.done && <span className="eyebrow">working…</span>}
            {rings.capped && <span className="capped">{rings.capped}</span>}
          </div>
        </div>
        {repoRows.map((file) => (
          <div
            key={file.path}
            className={`row${file.path === selected ? " sel" : ""}`}
            onClick={() => onSelect(file.path)}
          >
            <RingMark ring={file} done={rings.done} />
            <span
              className={`name${changedPaths.has(file.path) ? "" : " dim"}`}
              title={file.path}
            >
              <span className="path-prefix">{dirOf(file.path)}</span>
              <span className="path-base">{baseOf(file.path)}</span>
            </span>
            {changedPaths.has(file.path) && <span className="churn">changed</span>}
          </div>
        ))}
      </nav>
    );
  }

  return (
    <nav className="explorer" aria-label="Changed files">
      <div className="exhead">
        <div className="seg">
          <button aria-pressed>Changed files</button>
          <button aria-pressed={false} onClick={() => setMode("repo")}>
            Whole repo
          </button>
        </div>
        <span className="eyebrow">
          This review · {reviewed.length} of {changed.length} files
        </span>
        <div className="bar">
          <i style={{ width: `${percent}%` }} />
        </div>
      </div>
      {section("Not reviewed", open)}
      {section("Reviewed", reviewed)}
    </nav>
  );
}
