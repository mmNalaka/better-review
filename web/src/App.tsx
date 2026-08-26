import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

import {
  loadBlob,
  loadDiff,
  loadReview,
  resolveDefinition,
  type FileDiff,
  type ReviewPayload,
} from "./api";
import { CommitsPanel } from "./CommitsPanel";
import { Branches } from "./Branches";
import { CopyPath } from "./CopyPath";
import { DiffPane } from "./DiffPane";
import { useExplorerWidth } from "./useExplorerWidth";
import { useRings } from "./useRings";
import { CodePane } from "./CodePane";
import { Explorer } from "./Explorer";
import { emptyMarks, toggleReviewed, type Marks } from "./marks";
import { Trail } from "./Trail";
import { decodeTrail, encodeTrail, pushHop, startTrail, truncateTo, type Hop } from "./hops";

const DEFAULT_PR = "sitoo/auth#146";

const readParams = () => new URLSearchParams(location.search);

function writeParams(pr: string, trail: readonly Hop[]) {
  const url = new URL(location.href);
  url.searchParams.set("pr", pr);
  if (trail.length > 0) url.searchParams.set("trail", encodeTrail(trail));
  else url.searchParams.delete("trail");
  history.replaceState(null, "", url);
}

export function App() {
  const [ref, setRef] = useState(() => readParams().get("pr") ?? DEFAULT_PR);
  const [review, setReview] = useState<ReviewPayload | null>(null);
  const [marks, setMarks] = useState<Marks>(emptyMarks);
  const [trail, setTrail] = useState<readonly Hop[]>([]);
  const [body, setBody] = useState<{ path: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [mode, setMode] = useState<"split" | "diff" | "file">("split");
  const [showCommits, setShowCommits] = useState(false);
  const explorer = useExplorerWidth();

  // Ticket 10: the radius starts as soon as the PR is open, and streams in.
  const rings = useRings(
    review?.pr.owner ?? null,
    review?.pr.repo ?? null,
    review?.pr.number ?? null,
    review?.pr.headSha ?? null,
  );
  const [resolving, setResolving] = useState(false);

  const changedPaths = useMemo(
    () => new Set((review?.changed ?? []).map((file) => file.path)),
    [review],
  );

  const here = trail.at(-1) ?? null;
  const isChanged = here !== null && changedPaths.has(here.path);

  const open = useCallback(async (prRef: string, restore: string | null) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setReview(null);
    setTrail([]);
    setBody(null);
    try {
      const payload = await loadReview(prRef);
      setReview(payload);
      // Normalise: a pasted link is long and noisy in the field and the URL.
      setRef(`${payload.pr.owner}/${payload.pr.repo}#${payload.pr.number}`);
      setMarks(emptyMarks);
      const paths = new Set(payload.changed.map((file) => file.path));
      setTrail(decodeTrail(restore, paths));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  // Restore whatever the URL described, once.
  useEffect(() => {
    const params = readParams();
    void open(params.get("pr") ?? DEFAULT_PR, params.get("trail"));
  }, [open]);

  // Load the file the current hop points at.
  useEffect(() => {
    if (!review || !here) {
      setBody(null);
      return;
    }
    let live = true;
    void loadBlob(review.pr.owner, review.pr.repo, review.pr.headSha, here.path)
      .then((blob) => live && setBody({ path: here.path, text: blob.text }))
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      live = false;
    };
  }, [review, here?.path]);

  // The diff only exists for files the PR changed.
  useEffect(() => {
    if (!review || !here || !changedPaths.has(here.path)) {
      setDiff(null);
      return;
    }
    let live = true;
    setDiffLoading(true);
    void loadDiff(review.pr.owner, review.pr.repo, review.pr.number, review.pr.headSha, here.path)
      .then((result) => live && setDiff(result))
      .catch(() => live && setDiff(null))
      .finally(() => live && setDiffLoading(false));
    return () => {
      live = false;
    };
  }, [review, here?.path, changedPaths]);

  const changedLines = useMemo(() => {
    const lines = new Set<number>();
    for (const hunk of diff?.hunks ?? []) {
      for (const line of hunk.lines) {
        if (line.kind === "added" && line.newLine !== null) lines.add(line.newLine - 1);
      }
    }
    return lines;
  }, [diff]);

  const [jumpLine, setJumpLine] = useState<number | null>(null);

  useEffect(() => {
    if (review) writeParams(ref, trail);
  }, [review, ref, trail]);

  const ringOf = useCallback(
    (path: string): Hop["ring"] => (changedPaths.has(path) ? "changed" : "unknown"),
    [changedPaths],
  );

  /** Real ring for the file being read, once the walk has placed it. */
  const ringHere = here ? rings.byPath.get(here.path) : undefined;

  /** Explorer click starts a fresh trail at hop zero — ticket 07. */
  const selectFile = useCallback(
    (path: string) => {
      setNotice(null);
      setTrail(startTrail({ path, line: 0, ring: ringOf(path) }));
    },
    [ringOf],
  );

  const onSymbolClick = useCallback(
    async (line: number, character: number) => {
      if (!review || !here) return;
      setNotice(null);
      setResolving(true);
      try {
        const { definitions, external, unsupported, unknown, reason } = await resolveDefinition(
          review.pr.owner, review.pr.repo, review.pr.number, review.pr.headSha,
          here.path, line, character,
        );
        const target = definitions[0];
        if (unsupported) {
          setNotice(reason ?? "Not applicable — no language server for this file type.");
        } else if (unknown) {
          setNotice(`Unknown — the language server could not place this. ${unknown}`);
        } else if (external) {
          setNotice("Defined outside this repo — a dependency or the standard library.");
        } else if (!target) {
          setNotice("No definition found here.");
        } else if (target.path === here.path && target.line === here.line) {
          setNotice("Already at the definition.");
        } else {
          setTrail((current) =>
            pushHop(current, current.length - 1, {
              path: target.path,
              line: target.line,
              ring: ringOf(target.path),
            }),
          );
        }
      } catch (cause) {
        setNotice(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setResolving(false);
      }
    },
    [review, here, ringOf],
  );

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">better-review</span>
        <form
          className="prform"
          onSubmit={(event) => {
            event.preventDefault();
            void open(ref, null);
          }}
        >
          <input
            value={ref}
            onChange={(event) => setRef(event.target.value)}
            onPaste={(event) => {
              // Pasting a PR link is the whole gesture — do not also make the
              // user find the button.
              const pasted = event.clipboardData.getData("text").trim();
              if (!pasted) return;
              event.preventDefault();
              setRef(pasted);
              void open(pasted, null);
            }}
            placeholder="Paste a PR link, or owner/repo#123"
            aria-label="Pull request"
            spellCheck={false}
          />
          <button type="submit" disabled={busy}>
            {busy ? "Opening…" : "Open"}
          </button>
        </form>
        {review && (
          <>
            <Branches pr={review.pr} />
            {review.pr.draft && <span className="badge draft">draft</span>}
            {review.pr.state !== "open" && <span className="badge">{review.pr.state}</span>}
            <span className="pr-title">{review.pr.title}</span>
            <span className="counts">
              <span><b>{review.changed.length}</b> changed</span>
              <button className="counts-link" onClick={() => setShowCommits((open) => !open)}>
                <b>{review.commits.length}</b> commits
              </button>
            </span>
          </>
        )}
      </header>

      {error && <p className="banner">{error}</p>}

      <Trail
        trail={trail}
        onJump={(index) => setTrail((current) => truncateTo(current, index))}
        onBackToChanges={() => setTrail([])}
      />

      {review && (
        <div className="modebar">
          <span className="seg-label">View</span>
          <div className="seg">
            {(["split", "diff", "file"] as const).map((option) => (
              <button
                key={option}
                aria-pressed={isChanged ? mode === option : option === "file"}
                disabled={!isChanged}
                title={isChanged ? undefined : "This file is not changed by the pull request"}
                onClick={() => setMode(option)}
              >
                {option === "split" ? "Diff + file" : option === "diff" ? "Diff only" : "Whole file"}
              </button>
            ))}
          </div>
          {here && <CopyPath path={here.path} line={here.line > 0 ? here.line : null} />}
          {diffLoading && <span className="seg-label">reading diff…</span>}
        </div>
      )}

      {review && showCommits && (
        <CommitsPanel commits={review.commits} onClose={() => setShowCommits(false)} />
      )}

      <div
        className={`panes mode-${isChanged ? mode : "file"}`}
        style={{ "--explorer-w": `${explorer.width}px` } as CSSProperties}
      >
        {review ? (
          <Explorer
            changed={review.changed}
            marks={marks}
            selected={here?.path ?? null}
            rings={rings}
            onSelect={selectFile}
            onToggleReviewed={(path) => setMarks((current) => toggleReviewed(current, path))}
          />
        ) : (
          <nav className="explorer">
            <p className="pane-empty">Open a pull request to begin.</p>
          </nav>
        )}
        <div
          className="resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the file explorer"
          aria-valuenow={explorer.width}
          tabIndex={0}
          onPointerDown={explorer.startDrag}
          onKeyDown={explorer.nudge}
          onDoubleClick={explorer.reset}
          title="Drag to resize · double-click to reset"
        />

        {isChanged && mode !== "file" && (
          <DiffPane diff={diff} loading={diffLoading} onJump={setJumpLine} />
        )}
        {!(isChanged && mode === "diff") && (
        <CodePane
          path={here?.path ?? null}
          text={body && here && body.path === here.path ? body.text : null}
          ring={
            ringHere?.kind === "changed"
              ? "changed"
              : ringHere?.kind === "ring"
                ? `ring ${ringHere.ring}`
                : ringHere?.kind === "out-of-range"
                  ? "out of range"
                  : ringHere?.kind === "not-applicable"
                    ? "not applicable"
                    : rings.done
                      ? "unknown"
                      : "working"
          }
          focusLine={jumpLine ?? (here && here.line > 0 ? here.line : null)}
          changedLines={changedLines}
          resolving={resolving}
          notice={notice}
          onSymbolClick={(line, character) => void onSymbolClick(line, character)}
        />
        )}
      </div>
    </div>
  );
}
