import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { tokenise, type ThemedToken } from "./highlighter";
import type { ThemeName } from "./themes";

/**
 * Shiki tokens bundle whitespace and punctuation with identifiers, so a token
 * is not a symbol. Split each one into identifier runs and everything between,
 * keeping exact character offsets — the language server is asked about a
 * position, so an offset that is off by one asks about the wrong thing.
 */
const IDENTIFIER_RUN = /[A-Za-z_$][\w$]*|[^A-Za-z_$]+/g;
const IS_IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

interface Piece {
  readonly text: string;
  readonly at: number;
  readonly symbol: boolean;
}

/** A double-click's first click must not navigate away before the word is selected. */
const DOUBLE_CLICK_MS = 250;

/** The selected text, when it is a single identifier worth highlighting. */
function selectedIdentifier(): string | null {
  const text = window.getSelection()?.toString().trim() ?? "";
  return IS_IDENTIFIER.test(text) ? text : null;
}

function selectionIsCollapsed(): boolean {
  return window.getSelection()?.isCollapsed ?? true;
}

function splitToken(content: string, start: number): readonly Piece[] {
  const pieces: Piece[] = [];
  let at = start;
  for (const [run] of content.matchAll(IDENTIFIER_RUN)) {
    pieces.push({ text: run, at, symbol: IS_IDENTIFIER.test(run) });
    at += run.length;
  }
  return pieces;
}

interface CodePaneProps {
  readonly path: string | null;
  readonly text: string | null;
  readonly ring: string;
  readonly focusLine: number | null;
  /** 0-based head-side lines the PR changed, marked in the gutter. */
  readonly changedLines: ReadonlySet<number>;
  readonly resolving: boolean;
  readonly notice: string | null;
  readonly theme: ThemeName;
  /** `callers` is set for ⌥-click: who calls this, rather than where it is defined. */
  readonly onSymbolClick: (line: number, character: number, callers: boolean) => void;
}

export function CodePane({
  path, text, ring, focusLine, changedLines, resolving, notice, theme, onSymbolClick,
}: CodePaneProps) {
  const [lines, setLines] = useState<readonly (readonly ThemedToken[])[]>([]);
  const [term, setTerm] = useState<string | null>(null);
  const pendingClick = useRef<number | null>(null);

  useEffect(() => setTerm(null), [path]);
  useEffect(() => () => {
    if (pendingClick.current !== null) window.clearTimeout(pendingClick.current);
  }, []);

  const hits = useMemo(() => {
    if (term === null) return 0;
    return lines.reduce(
      (count, tokens) =>
        count + tokens.reduce(
          (n, token) => n + splitToken(token.content, 0).filter((piece) => piece.text === term).length,
          0,
        ),
      0,
    );
  }, [lines, term]);

  const onSymClick = (event: MouseEvent, line: number, character: number) => {
    if (pendingClick.current !== null) window.clearTimeout(pendingClick.current);
    pendingClick.current = null;
    if (event.detail > 1) return;
    const callers = event.altKey;
    pendingClick.current = window.setTimeout(() => {
      pendingClick.current = null;
      // A drag is selecting a word to highlight, not navigating. Read late: a
      // click inside an existing selection collapses it only after the event.
      if (selectionIsCollapsed()) onSymbolClick(line, character, callers);
    }, DOUBLE_CLICK_MS);
  };

  useEffect(() => {
    if (text === null || path === null) {
      setLines([]);
      return;
    }
    let live = true;
    void (async () => {
      const rows = await tokenise(text, path, theme);
      if (live) setLines(rows);
    })();
    return () => {
      live = false;
    };
  }, [path, text, theme]);

  useEffect(() => {
    if (focusLine === null) return;
    document.getElementById(`ln-${focusLine}`)?.scrollIntoView({ block: "center" });
  }, [focusLine, lines]);

  if (!path) return <div className="pane-empty">Pick a file to read it.</div>;
  if (text === null) {
    // Fills the pane rather than collapsing it: a one-line message made the
    // layout jump on every file change.
    return (
      <div className="codepane">
        <header className="filehead">
          <span className="fname">{path}</span>
          <span className="resolving">reading…</span>
        </header>
        <div className="pane-loading" />
      </div>
    );
  }

  return (
    <div className="codepane">
      <header className="filehead">
        <span className="fname">{path}</span>
        <span className="ring" title={`ring: ${ring}`}>
          <i className={`dot ${ring === "changed" ? "r0" : ring.startsWith("ring") ? "r1" : "unk"}`} />{" "}
          {ring}
        </span>
        {resolving && <span className="resolving">resolving…</span>}
        {notice && <span className="notice">{notice}</span>}
        {term !== null && (
          <span className="resolving" title="Select another word, or click anywhere to clear">
            {hits} × <code>{term}</code>
          </span>
        )}
      </header>
      <div
        className={`code${resolving ? " busy" : ""}`}
        onMouseUp={() => window.setTimeout(() => setTerm(selectedIdentifier()), 0)}
      >
        {lines.map((tokens, lineIndex) => {
          let character = 0;
          return (
            <div
              className={`ln${focusLine === lineIndex ? " focus" : ""}${
                changedLines.has(lineIndex) ? " changed" : ""
              }`}
              id={`ln-${lineIndex}`}
              key={lineIndex}
            >
              <span className="gutter-ring" />
              <span className="gutter-num">{lineIndex + 1}</span>
              <span className="ln-text">
                {tokens.flatMap((token, i) => {
                  const pieces = splitToken(token.content, character);
                  character += token.content.length;
                  const style = token.color ? { color: token.color } : undefined;
                  return pieces.map((piece, j) =>
                    piece.symbol ? (
                      <span
                        key={`${i}-${j}`}
                        className={`sym${piece.text === term ? " hit" : ""}`}
                        style={style}
                        onClick={(event) => onSymClick(event, lineIndex, piece.at)}
                      >
                        {piece.text}
                      </span>
                    ) : (
                      <span key={`${i}-${j}`} style={style}>
                        {piece.text}
                      </span>
                    ),
                  );
                })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
