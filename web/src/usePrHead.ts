import { useEffect, useState } from "react";

import { loadHead, type PullRequest } from "./api";

/**
 * Notices a push while the page is open. Asks GitHub for the head every couple
 * of minutes, and on returning to the tab — never while it is hidden, since
 * nobody is reading. It only reports; reloading stays your decision.
 */

const EVERY_MS = 2 * 60 * 1000;

export interface PrHeadState {
  /** The head GitHub has, when it differs from the one loaded. */
  readonly moved: string | null;
  /** Why the last check failed. Quiet in the UI: a missed check is not news. */
  readonly error: string | null;
}

export function usePrHead(pr: PullRequest | null): PrHeadState {
  const [moved, setMoved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMoved(null);
    setError(null);
    if (!pr) return;
    let live = true;

    const check = () => {
      if (document.visibilityState !== "visible") return;
      void loadHead(pr.owner, pr.repo, pr.number)
        .then(({ headSha }) => {
          if (!live) return;
          setMoved(headSha !== pr.headSha ? headSha : null);
          setError(null);
        })
        .catch((cause: unknown) => {
          if (live) setError(cause instanceof Error ? cause.message : String(cause));
        });
    };

    const timer = setInterval(check, EVERY_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [pr?.owner, pr?.repo, pr?.number, pr?.headSha]);

  return { moved, error };
}
