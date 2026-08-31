import { memo } from "react";

import type { DiffLine } from "./api";
import type { ThemedToken } from "./highlighter";

/**
 * One line of a diff.
 *
 * Memoised, and that is the whole point of the file. Dragging a selection down
 * the gutter changes state on every pointer move, and a long file is a thousand
 * rows whose tokens each map to a dozen spans. Re-rendering all of them per
 * move made selecting twenty lines visibly lag; with this, only the rows that
 * enter or leave the selection do any work.
 *
 * Everything it takes is therefore either a primitive or a stable reference — a
 * fresh object or inline closure from the parent would defeat the comparison.
 */

const MARKER: Readonly<Record<DiffLine["kind"], string>> = {
  added: "+",
  removed: "−",
  context: " ",
};

interface DiffRowProps {
  /** Passed back to the handlers, so they can stay one stable pair. */
  readonly hunkId: string;
  readonly line: DiffLine;
  readonly tokens: readonly ThemedToken[] | undefined;
  readonly index: number;
  /** Carries a saved note. */
  readonly noted: boolean;
  /** Inside the range being selected, or the one the open composer covers. */
  readonly picking: boolean;
  /** First and last of that range, so the block can round its corners. */
  readonly pickTop: boolean;
  readonly pickBottom: boolean;
  readonly onPointerDown: (hunkId: string, index: number, shift: boolean) => void;
  readonly onPointerEnter: (hunkId: string, index: number) => void;
}

export const DiffRow = memo(function DiffRow({
  hunkId,
  line,
  tokens,
  index,
  noted,
  picking,
  pickTop,
  pickBottom,
  onPointerDown,
  onPointerEnter,
}: DiffRowProps) {
  const classes = [
    "dl",
    line.kind,
    noted ? "noted" : "",
    picking ? "picking" : "",
    picking && pickTop ? "pick-top" : "",
    picking && pickBottom ? "pick-bottom" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <button
        className="dl-add"
        title="Comment on this line — drag or shift-click for a range"
        aria-label={`Comment on line ${line.newLine ?? line.oldLine ?? ""}`}
        onPointerDown={(event) => onPointerDown(hunkId, index, event.shiftKey)}
        onPointerEnter={() => onPointerEnter(hunkId, index)}
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
  );
});
