import { useCallback, useEffect, useRef, useState } from "react";

import {
  loadHunks,
  loadMarks,
  saveMarks,
  type HunkIndex,
  type HunkRef,
  type MarkFile,
  type PullRequest,
} from "./api";
import { emptyMarkFile } from "../../server/markmodel";

/**
 * The review marks for the open pull request, and the hunk index they are read
 * against. Loaded together on open, saved back on every change.
 *
 * Saves are debounced but never dropped: ticking six hunks in four seconds is
 * one write, and the last state always reaches disk. Ticket 04's storage is a
 * whole file per pull request, so there is no partial update to get wrong.
 */

const SAVE_AFTER_MS = 400;

const NO_PR = { owner: "", repo: "", number: 0 };
const EMPTY_INDEX: HunkIndex = { files: {} };

export interface MarksState {
  readonly marks: MarkFile;
  readonly index: HunkIndex;
  /** The hunks of one file, in diff order. */
  readonly hunksOf: (path: string) => readonly HunkRef[];
  readonly loading: boolean;
  readonly saving: boolean;
  readonly error: string | null;
  /** Apply a change from marks.ts and persist the result. */
  readonly update: (change: (marks: MarkFile, at: string) => MarkFile) => void;
  /** Replace wholesale — used after publishing stamps notes as posted. */
  readonly replace: (marks: MarkFile) => void;
}

export function useMarks(pr: PullRequest | null): MarksState {
  const key = pr ? `${pr.owner}/${pr.repo}#${pr.number}` : null;
  const [marks, setMarks] = useState<MarkFile>(() => emptyMarkFile(NO_PR));
  const [index, setIndex] = useState<HunkIndex>(EMPTY_INDEX);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Which PR the state in hand belongs to, so a stale save cannot cross PRs. */
  const loaded = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<MarkFile | null>(null);
  const target = useRef<PullRequest | null>(null);
  target.current = pr;

  useEffect(() => {
    if (!pr || !key) {
      loaded.current = null;
      setMarks(emptyMarkFile(NO_PR));
      setIndex(EMPTY_INDEX);
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    void Promise.all([
      loadMarks(pr.owner, pr.repo, pr.number),
      loadHunks(pr.owner, pr.repo, pr.number, pr.headSha),
    ])
      .then(([saved, hunks]) => {
        if (!live) return;
        loaded.current = key;
        setMarks(saved);
        setIndex(hunks);
      })
      .catch((cause: unknown) => {
        if (!live) return;
        // A failed load must not read as "no marks yet": that invites you to
        // review the file again and tick it, overwriting what is on disk.
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [key, pr?.headSha]);

  const flush = useCallback(async () => {
    const next = pending.current;
    const to = target.current;
    pending.current = null;
    if (!next || !to || loaded.current !== `${to.owner}/${to.repo}#${to.number}`) return;
    setSaving(true);
    try {
      setMarks(await saveMarks(to.owner, to.repo, to.number, next));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }, []);

  // A change still in flight when the tab goes away is still a change.
  useEffect(() => {
    const onHide = () => {
      if (pending.current) void flush();
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [flush]);

  const queue = useCallback(
    (next: MarkFile) => {
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
    },
    [flush],
  );

  const update = useCallback(
    (change: (marks: MarkFile, at: string) => MarkFile) => {
      if (loaded.current !== key) return; // nothing loaded: nothing to change
      setMarks((current) => {
        const next = change(current, new Date().toISOString());
        queue(next);
        return next;
      });
    },
    [key, queue],
  );

  const replace = useCallback((next: MarkFile) => setMarks(next), []);

  const hunksOf = useCallback((path: string): readonly HunkRef[] => index.files[path] ?? [], [index]);

  return { marks, index, hunksOf, loading, saving, error, update, replace };
}
