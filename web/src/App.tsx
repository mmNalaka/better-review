import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

import {
  loadBlob,
  loadCommitFiles,
  loadDiff,
  loadReview,
  resolveDefinition,
  type ChangedFile,
  type FileDiff,
  type FileRevision,
  type ReviewPayload,
} from "./api";
import { CommitsPanel } from "./CommitsPanel";
import { ComparePane } from "./ComparePane";
import { HistoryPanel } from "./HistoryPanel";
import { Findings } from "./Findings";
import { Help } from "./Help";
import { Overview } from "./Overview";
import { useConversation } from "./useConversation";
import { useThreads } from "./useThreads";
import { nextOpenThread } from "../../server/threads";
import { Branches } from "./Branches";
import { CopyPath } from "./CopyPath";
import { ThemePicker } from "./ThemePicker";
import { DiffPane } from "./DiffPane";
import { FullscreenButton } from "./FullscreenButton";
import { useExplorerWidth } from "./useExplorerWidth";
import { useFullscreen } from "./useFullscreen";
import { useKeys } from "./useKeys";
import { stepHunk } from "./hunkScroll";
import { useTheme } from "./useTheme";
import { useRings } from "./useRings";
import { CodePane } from "./CodePane";
import { Explorer } from "./Explorer";
import { findings, moveNotes, setFileReviewed, setLineNote, toggleHunk } from "./marks";
import { useMarks } from "./useMarks";
import { usePrHead } from "./usePrHead";
import { useSince } from "./useSince";
import { SinceBar } from "./SinceBar";
import { CallersPanel, type CallersTarget } from "./CallersPanel";
import { LeftBehindPanel } from "./LeftBehindPanel";
import { useLeftBehind } from "./useLeftBehind";
import { orderFiles, type ReadingOrder } from "./readingOrder";
import { recordPass } from "../../server/markmodel";
import { passAt } from "../../server/rereview";
import { StartPage } from "./StartPage";
import { Trail } from "./Trail";
import {
  NO_WALK,
  decodeTrail,
  encodeTrail,
  hereOf,
  moveTo,
  pushHop,
  startTrail,
  type Hop,
  type Walk,
} from "./hops";

const readParams = () => new URLSearchParams(location.search);

const ORDER_KEY = "better-review:reading-order";

/** A remembered preference only: unreadable storage just means the default. */
function savedOrder(): ReadingOrder {
  try {
    const saved = localStorage.getItem(ORDER_KEY);
    return saved === "callees" || saved === "entries" ? saved : "path";
  } catch {
    return "path";
  }
}

const refOf = (pr: ReviewPayload["pr"]) => `${pr.owner}/${pr.repo}#${pr.number}`;

/**
 * Every move along the trail is its own browser history entry, so Back,
 * Forward and the mouse's side buttons retrace what you looked at.
 */
function writeParams(pr: string, walk: Walk, how: "push" | "replace") {
  const url = new URL(location.href);
  url.searchParams.set("pr", pr);
  const { trail, at } = encodeTrail(walk);
  for (const [key, value] of [["trail", trail], ["at", at]] as const) {
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  if (url.href === location.href) return;
  if (how === "push") history.pushState(null, "", url);
  else history.replaceState(null, "", url);
}

export function App() {
  const [ref, setRef] = useState(() => readParams().get("pr") ?? "");
  const [review, setReview] = useState<ReviewPayload | null>(null);
  const [walk, setWalk] = useState<Walk>(NO_WALK);
  const [body, setBody] = useState<{ path: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [mode, setMode] = useState<"split" | "diff" | "file">("split");
  const [showCommits, setShowCommits] = useState(false);
  const [showFindings, setShowFindings] = useState(false);
  const [showOverview, setShowOverview] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  /** A past version of the open file, laid beside the head. Null: the normal panes. */
  const [compareWith, setCompareWith] = useState<FileRevision | null>(null);
  const explorer = useExplorerWidth();
  const theme = useTheme();
  const fullscreen = useFullscreen();

  /** Ticket 04: hunk ticks and notes, persisted per pull request. */
  const marks = useMarks(review?.pr ?? null);

  /** Re-review after a push: what moved since the last finished pass. */
  const since = useSince(review?.pr ?? null, marks.marks, marks.index);
  const prHead = usePrHead(review?.pr ?? null);
  const [sinceFilter, setSinceFilter] = useState(false);
  const fresh = useMemo(() => new Set(since.summary?.paths ?? []), [since.summary]);

  // Nothing to compare against any more — a finished pass, or another PR.
  useEffect(() => {
    if (!since.summary) setSinceFilter(false);
  }, [since.summary]);

  /**
   * Optional: narrow the whole review to one commit. Ticket 05 rejected this as
   * the default (84 commits is 84 passes) but it earns its place as a mode —
   * the "address review feedback" commit here is 3 files, not 32.
   */
  const [commitFilter, setCommitFilter] = useState<string | null>(null);
  const [commitFiles, setCommitFiles] = useState<readonly ChangedFile[] | null>(null);

  // Ticket 10: the radius starts as soon as the PR is open, and streams in.
  const rings = useRings(
    review?.pr.owner ?? null,
    review?.pr.repo ?? null,
    review?.pr.number ?? null,
    review?.pr.headSha ?? null,
  );
  const [resolving, setResolving] = useState(false);

  /** GitHub's own description and conversation — never our findings, just what's already there. */
  const conversation = useConversation(
    review?.pr.owner ?? null,
    review?.pr.repo ?? null,
    review?.pr.number ?? null,
  );

  /** Review threads already on the diff, drawn under the lines they were left on. */
  const threads = useThreads(review?.pr ?? null);
  const openThreads = threads.threads.filter((thread) => !thread.resolved).length;
  /** The thread last jumped to from the counter; the next click goes on from it. */
  const [focusThread, setFocusThread] = useState<{ id: string; n: number } | null>(null);

  /** What the explorer lists: the whole PR, or just the selected commit. */
  const visibleChanged =
    commitFilter && commitFiles
      ? commitFiles
      : sinceFilter
        ? (review?.changed ?? []).filter((file) => fresh.has(file.path))
        : (review?.changed ?? []);

  const changedPaths = useMemo(
    () => new Set(visibleChanged.map((file) => file.path)),
    [visibleChanged],
  );

  /** Every file the PR changed, whatever the filter — callers are marked against it. */
  const prPaths = useMemo(() => new Set(review?.changed.map((file) => file.path)), [review]);

  /** Reading order, from the calls between changed files the ring walk found. */
  const [order, setOrderState] = useState<ReadingOrder>(savedOrder);
  const setOrder = useCallback((next: ReadingOrder) => {
    setOrderState(next);
    try {
      localStorage.setItem(ORDER_KEY, next);
    } catch {
      // not remembered across reloads; the choice still applies now
    }
  }, []);
  const orderedChanged = useMemo(
    () => orderFiles(visibleChanged, rings.edges, order),
    [visibleChanged, rings.edges, order],
  );

  /** The callers panel's symbol, and the last symbol clicked, for `r`. */
  const [callersOf, setCallersOf] = useState<CallersTarget | null>(null);
  /** Callers a changed signature left behind — fetched the first time it is opened. */
  const [showLeftBehind, setShowLeftBehind] = useState(false);
  const leftBehind = useLeftBehind(review?.pr ?? null, showLeftBehind);
  const leftBehindCount =
    leftBehind.state === "ready"
      ? leftBehind.report.changes.reduce((sum, change) => sum + change.stale.length, 0)
      : null;
  const [lastSymbol, setLastSymbol] = useState<CallersTarget | null>(null);
  useEffect(() => {
    setCallersOf(null);
    setLastSymbol(null);
  }, [review]);

  useEffect(() => {
    if (!review || !commitFilter) {
      setCommitFiles(null);
      return;
    }
    let live = true;
    void loadCommitFiles(
      review.pr.owner, review.pr.repo, review.pr.number, review.pr.headSha, commitFilter,
    )
      .then((result) => live && setCommitFiles(result.changed))
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      live = false;
    };
  }, [review, commitFilter]);

  const here = hereOf(walk);
  const isChanged = here !== null && changedPaths.has(here.path);

  // GitHub anchors threads to the PR head; a single commit's diff numbers its
  // lines differently, so threads are left out while narrowed to one.
  const threadsHere = useMemo(
    () =>
      here && !commitFilter ? threads.threads.filter((thread) => thread.path === here.path) : [],
    [threads.threads, here?.path, commitFilter],
  );

  // A comparison belongs to one file: moving to another file ends it.
  useEffect(() => setCompareWith(null), [here?.path, review]);

  const prShas = useMemo(() => new Set(review?.commits.map((commit) => commit.sha)), [review]);

  const open = useCallback(async (prRef: string, restore: string | null, restoreAt: string | null) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setReview(null);
    setWalk(NO_WALK);
    setBody(null);
    try {
      const payload = await loadReview(prRef);
      setReview(payload);
      // Normalise: a pasted link is long and noisy in the field and the URL.
      setRef(refOf(payload.pr));
      const paths = new Set(payload.changed.map((file) => file.path));
      const restored = decodeTrail(restore, restoreAt, paths);
      setWalk(restored);
      writeParams(refOf(payload.pr), restored, "replace");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  /** Back to the start page: no pull request named, nothing open. */
  const close = useCallback(() => {
    setError(null);
    setNotice(null);
    setReview(null);
    setWalk(NO_WALK);
    setBody(null);
    setRef("");
  }, []);

  // Restore whatever the URL described, once. No `pr` means the start page.
  useEffect(() => {
    const params = readParams();
    const pr = params.get("pr");
    if (pr) void open(pr, params.get("trail"), params.get("at"));
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
    void loadDiff(
      review.pr.owner, review.pr.repo, review.pr.number, review.pr.headSha, here.path,
      commitFilter,
    )
      .then((result) => live && setDiff(result))
      .catch(() => live && setDiff(null))
      .finally(() => live && setDiffLoading(false));
    return () => {
      live = false;
    };
  }, [review, here?.path, changedPaths, commitFilter]);

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

  const flags = useMemo(() => findings(marks.marks, marks.index), [marks.marks, marks.index]);


  /** Move along the trail, or start a new one; a click in the diff no longer pins the view. */
  const go = useCallback(
    (next: Walk) => {
      setWalk(next);
      setJumpLine(null);
      if (review) writeParams(refOf(review.pr), next, "push");
    },
    [review],
  );

  // Browser Back and Forward: the URL already describes the walk to stand on.
  useEffect(() => {
    const onPop = () => {
      const params = readParams();
      const pr = params.get("pr");
      if (!pr) {
        close();
        return;
      }
      if (!review || pr !== refOf(review.pr)) {
        void open(pr, params.get("trail"), params.get("at"));
        return;
      }
      setWalk(decodeTrail(params.get("trail"), params.get("at"), changedPaths));
      setJumpLine(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [review, changedPaths, open, close]);

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
      go(startTrail({ path, line: 0, ring: ringOf(path) }));
    },
    [ringOf, go],
  );

  /**
   * The open-threads counter: each click opens the next open thread's file and
   * brings the thread into view. Whatever would hide it — narrowing to one
   * commit, the new-since filter, the whole-file view — is set aside first.
   */
  const jumpToNextThread = useCallback(() => {
    const next = nextOpenThread(
      threads.threads,
      orderedChanged.map((file) => file.path),
      focusThread?.id ?? null,
    );
    if (!next) return;
    if (commitFilter) setCommitFilter(null);
    if (!changedPaths.has(next.path)) setSinceFilter(false);
    if (mode === "file") setMode("split");
    setCompareWith(null);
    if (here?.path !== next.path) selectFile(next.path);
    setFocusThread((current) => ({ id: next.id, n: (current?.n ?? 0) + 1 }));
  }, [threads.threads, orderedChanged, focusThread, commitFilter, changedPaths, mode, here, selectFile]);

  /** Step through the changed files without reaching for the mouse. */
  const stepFile = useCallback(
    (direction: 1 | -1) => {
      const paths = orderedChanged.map((file) => file.path);
      if (paths.length === 0) return;
      const at = here ? paths.indexOf(here.path) : -1;
      const next = at === -1 ? (direction === 1 ? 0 : paths.length - 1) : at + direction;
      const path = paths[Math.max(0, Math.min(paths.length - 1, next))];
      if (path) selectFile(path);
    },
    [orderedChanged, here, selectFile],
  );

  const toggleReviewedHere = useCallback(() => {
    if (!here) return;
    const hunks = marks.hunksOf(here.path);
    marks.update((current, at) =>
      setFileReviewed(
        current,
        here.path,
        hunks,
        hunks.some((hunk) => !current.hunks[`${here.path}@${hunk.id}`]?.reviewed),
        at,
      ),
    );
  }, [here, marks]);

  /**
   * Record a finished pass at this head: the baseline the next push is read
   * against. Refused until the hunk index is in, since a pass with no hunks
   * would make every hunk of the next push look new.
   */
  const finishPass = useCallback(() => {
    if (!review || marks.loading) return;
    if (Object.keys(marks.index.files).length === 0 && review.changed.length > 0) return;
    const { headSha, mergeBase } = review.pr;
    marks.update((current, at) => recordPass(current, passAt(headSha, mergeBase, marks.index, at)));
    setSinceFilter(false);
  }, [review, marks]);

  const toggleSinceFilter = useCallback(() => {
    if (!since.summary) return;
    setCommitFilter(null);
    setSinceFilter((on) => !on);
    go(NO_WALK);
  }, [since.summary, go]);

  const reload = useCallback(() => {
    if (!review) return;
    const params = readParams();
    void open(refOf(review.pr), params.get("trail"), params.get("at"));
  }, [review, open]);

  const onMoveNotes = useCallback(
    (fromId: string, to: { id: string; lines: readonly { text: string }[] }) => {
      if (!here) return;
      marks.update((current, at) => moveNotes(current, here.path, fromId, to, at));
    },
    [here, marks],
  );

  /** Open a call site from the callers panel: a hop, so Back returns to the symbol. */
  const openCallSite = useCallback(
    (site: { path: string; line: number }) => {
      if (!review || !callersOf) return;
      const next = pushHop(walk, callersOf.line, {
        path: site.path,
        line: site.line,
        ring: ringOf(site.path),
      });
      writeParams(refOf(review.pr), { ...next, at: next.at - 1 }, "replace");
      go(next);
    },
    [review, callersOf, walk, ringOf, go],
  );

  /** Open a place from the left-behind panel: a hop, so Back returns to where you were. */
  const openLeftBehindSite = useCallback(
    (site: { path: string; line: number }) => {
      if (!review) return;
      const next = pushHop(walk, here?.line ?? 0, {
        path: site.path,
        line: site.line,
        ring: ringOf(site.path),
      });
      writeParams(refOf(review.pr), { ...next, at: next.at - 1 }, "replace");
      go(next);
    },
    [review, walk, here, ringOf, go],
  );

  /** Esc closes one thing at a time, nearest first. */
  const closeTop = useCallback(() => {
    if (showHelp) setShowHelp(false);
    else if (showOverview) setShowOverview(false);
    else if (showFindings) setShowFindings(false);
    else if (showCommits) setShowCommits(false);
    else if (showHistory) setShowHistory(false);
    else if (callersOf) setCallersOf(null);
    else if (showLeftBehind) setShowLeftBehind(false);
    else if (compareWith) setCompareWith(null);
  }, [
    showHelp,
    showOverview,
    showFindings,
    showCommits,
    showHistory,
    callersOf,
    showLeftBehind,
    compareWith,
  ]);

  useKeys({
    j: () => stepFile(1),
    k: () => stepFile(-1),
    n: () => void stepHunk(1),
    p: () => void stepHunk(-1),
    Backspace: () => go(NO_WALK),
    "[": () => go(moveTo(walk, walk.at - 1)),
    "]": () => go(moveTo(walk, walk.at + 1)),
    "/": () => document.querySelector<HTMLInputElement>(".prform input")?.select(),
    v: toggleReviewedHere,
    c: () => setShowFindings((open) => !open),
    s: () => setShowCommits((open) => !open),
    o: () => setShowOverview((open) => !open),
    h: () => here && setShowHistory((open) => !open),
    P: finishPass,
    w: toggleSinceFilter,
    r: () => setCallersOf((open) => (open ? null : lastSymbol)),
    b: () => review && setShowLeftBehind((open) => !open),
    "1": () => isChanged && setMode("split"),
    "2": () => isChanged && setMode("diff"),
    "3": () => setMode("file"),
    f: fullscreen.toggle,
    "?": () => setShowHelp((open) => !open),
    Escape: closeTop,
  });

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
          const next = pushHop(walk, line, {
            path: target.path,
            line: target.line,
            ring: ringOf(target.path),
          });
          // The entry you leave remembers the line you clicked, so Back lands on it.
          writeParams(refOf(review.pr), { ...next, at: next.at - 1 }, "replace");
          go(next);
        }
      } catch (cause) {
        setNotice(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setResolving(false);
      }
    },
    [review, here, walk, ringOf, go],
  );

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">better-review</span>
        <form
          className="prform"
          onSubmit={(event) => {
            event.preventDefault();
            if (ref.trim()) void open(ref.trim(), null, null);
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
              void open(pasted, null, null);
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
            {commitFilter && (
              <button
                className="badge filter"
                onClick={() => {
                  setCommitFilter(null);
                  go(NO_WALK);
                }}
                title="Back to the whole pull request"
              >
                commit {commitFilter.slice(0, 7)} &times;
              </button>
            )}
            <span className="counts">
              <span><b>{review.changed.length}</b> changed</span>
              <button className="counts-link" onClick={() => setShowCommits((open) => !open)}>
                <b>{review.commits.length}</b> commits
              </button>
              <button
                className="counts-link"
                onClick={() => setShowOverview((open) => !open)}
                title="Description and comments — o"
              >
                <b>{conversation.entries.length}</b> comments
              </button>
              {threads.threads.length > 0 && (
                <button
                  className="counts-link"
                  onClick={jumpToNextThread}
                  disabled={openThreads === 0}
                  title={`Jump to the next open thread · ${threads.threads.length - openThreads} resolved`}
                >
                  <b>{openThreads}</b> open threads
                </button>
              )}
              {threads.error && (
                <button className="counts-link" onClick={threads.refresh} title={threads.error}>
                  threads failed — retry
                </button>
              )}
              <button
                className="counts-link"
                aria-pressed={showLeftBehind}
                onClick={() => setShowLeftBehind((open) => !open)}
                title="Calls to changed signatures on lines this PR did not touch — b"
              >
                {leftBehindCount === null ? "callers left behind" : <><b>{leftBehindCount}</b> left behind</>}
              </button>
            </span>
          </>
        )}
        <button
          className="helpopen"
          aria-pressed={showHelp}
          title="How this works, and the keys — ?"
          onClick={() => setShowHelp((open) => !open)}
        >
          ?
        </button>
        <FullscreenButton fullscreen={fullscreen} />
      </header>

      {error && <p className="banner">{error}</p>}

      <Trail
        walk={walk}
        onJump={(index) => go(moveTo(walk, index))}
        onBackToChanges={() => go(NO_WALK)}
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
                onClick={() => {
                  setMode(option);
                  setCompareWith(null);
                }}
              >
                {option === "split" ? "Diff + file" : option === "diff" ? "Diff only" : "Whole file"}
              </button>
            ))}
          </div>
          {here && <CopyPath path={here.path} line={here.line > 0 ? here.line : null} />}
          {here && (
            <button
              className="findings-open"
              aria-pressed={showHistory || compareWith !== null}
              onClick={() => setShowHistory((open) => !open)}
              title="Every commit that touched this file — h"
            >
              History
            </button>
          )}
          <button
            className={`findings-open${flags.length > 0 ? " some" : ""}`}
            aria-pressed={showFindings}
            onClick={() => setShowFindings((open) => !open)}
            title="Flagged hunks, and publishing them to GitHub"
          >
            <span className="findings-flag" aria-hidden="true">
              ⚑
            </span>{" "}
            {flags.length} {flags.length === 1 ? "finding" : "findings"}
          </button>
          <button
            className="findings-open"
            onClick={finishPass}
            disabled={marks.loading}
            title={
              since.pass
                ? `Last finished at ${since.pass.headSha.slice(0, 7)}, ${new Date(since.pass.at).toLocaleString()} — P`
                : "Remember this head, so the next push shows only what changed — P"
            }
          >
            {since.pass?.headSha === review.pr.headSha ? "✓ Pass finished" : "Finish pass"}
          </button>
          {marks.saving && <span className="seg-label">saving…</span>}
          {marks.error && <span className="notice">{marks.error}</span>}
          {diffLoading && <span className="seg-label">reading diff…</span>}
          <ThemePicker choice={theme.choice} onChange={theme.setChoice} />
        </div>
      )}

      {review && (
        <SinceBar
          since={since}
          pushed={prHead.moved !== null}
          filtering={sinceFilter}
          onFilter={toggleSinceFilter}
          onReload={reload}
        />
      )}

      {showHelp && <Help onClose={() => setShowHelp(false)} />}

      {review && showFindings && (
        <Findings
          findings={flags}
          pr={review.pr}
          onClose={() => setShowFindings(false)}
          onOpen={(path) => {
            selectFile(path);
            setShowFindings(false);
          }}
          onPublished={(stamped) => {
            marks.replace(stamped);
            // Publishing is the end of a pass: the next push is read against it.
            finishPass();
            // A submitted review is now part of the pull request's own
            // conversation — refetch so the Overview panel is not stale.
            conversation.refresh();
            threads.refresh();
          }}
        />
      )}

      {review && showOverview && (
        <Overview pr={review.pr} conversation={conversation} onClose={() => setShowOverview(false)} />
      )}

      {review && here && showHistory && (
        <HistoryPanel
          pr={review.pr}
          path={here.path}
          prCommits={prShas}
          selected={compareWith?.sha ?? null}
          onCompare={(revision) => {
            setCompareWith(revision);
            setShowHistory(false);
          }}
          onClose={() => setShowHistory(false)}
        />
      )}

      {review && showLeftBehind && (
        <LeftBehindPanel
          load={leftBehind}
          onOpen={openLeftBehindSite}
          onClose={() => setShowLeftBehind(false)}
        />
      )}

      {review && callersOf && (
        <CallersPanel
          pr={review.pr}
          target={callersOf}
          changed={prPaths}
          onOpen={openCallSite}
          onClose={() => setCallersOf(null)}
        />
      )}

      {review && showCommits && (
        <CommitsPanel
          commits={review.commits}
          selected={commitFilter}
          onSelect={(sha) => {
            setCommitFilter(sha);
            setSinceFilter(false);
            go(NO_WALK);
          }}
          onClose={() => setShowCommits(false)}
        />
      )}

      {!review && !busy && (
        <StartPage busy={busy} onOpen={(prRef) => void open(prRef, null, null)} />
      )}

      {(review || busy) && (
      <div
        className={`panes mode-${compareWith ? "compare" : isChanged ? mode : "file"}`}
        style={{ "--explorer-w": `${explorer.width}px` } as CSSProperties}
      >
        {review ? (
          <Explorer
            changed={orderedChanged}
            order={order}
            onOrder={setOrder}
            hasGraph={rings.edges.length > 0}
            graphPending={!rings.done}
            marks={marks.marks}
            index={marks.index}
            selected={here?.path ?? null}
            rings={rings}
            onSelect={selectFile}
            fresh={fresh}
            onToggleReviewed={(path) =>
              marks.update((current, at) =>
                setFileReviewed(
                  current,
                  path,
                  marks.hunksOf(path),
                  // Anything short of fully reviewed means "mark the rest".
                  marks.hunksOf(path).some((hunk) => !current.hunks[`${path}@${hunk.id}`]?.reviewed),
                  at,
                ),
              )
            }
          />
        ) : (
          <nav className="explorer">
            <p className="pane-empty">Opening the pull request…</p>
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

        {review && here && compareWith && (
          <ComparePane
            pr={review.pr}
            path={here.path}
            revision={compareWith}
            theme={theme.resolved}
            onClose={() => setCompareWith(null)}
          />
        )}
        {!compareWith && isChanged && mode !== "file" && (
          <DiffPane
            diff={diff}
            loading={diffLoading}
            theme={theme.resolved}
            marks={marks.marks}
            onJump={setJumpLine}
            onToggleHunk={(id, header) =>
              here && marks.update((current, at) => toggleHunk(current, here.path, id, header, at))
            }
            since={since.summary}
            matches={since.matches}
            onMoveNotes={onMoveNotes}
            threads={threadsHere}
            focusThread={focusThread}
            onReply={threads.reply}
            onResolve={threads.setResolved}
            onNote={(anchor, body) =>
              here &&
              marks.update((current, at) =>
                setLineNote(current, { path: here.path, ...anchor }, body, at),
              )
            }
          />
        )}
        {!compareWith && !(isChanged && mode === "diff") && (
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
          theme={theme.resolved}
          onSymbolClick={(line, character, callers) => {
            if (!here) return;
            const target = { path: here.path, line, character };
            setLastSymbol(target);
            if (callers) {
              setShowHistory(false);
              setShowCommits(false);
              setCallersOf(target);
            } else {
              void onSymbolClick(line, character);
            }
          }}
        />
        )}
      </div>
      )}
    </div>
  );
}
