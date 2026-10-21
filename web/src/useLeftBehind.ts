import { useEffect, useRef, useState } from "react";

import { loadLeftBehind, type LeftBehindReport, type PullRequest } from "./api";

export type LeftBehindLoad =
  | { readonly state: "idle" }
  | { readonly state: "loading" }
  | { readonly state: "error"; readonly message: string }
  | { readonly state: "ready"; readonly report: LeftBehindReport };

const IDLE: LeftBehindLoad = { state: "idle" };

/**
 * Callers left behind by a changed signature. Asked for only once wanted —
 * it is a language-server round trip per changed function — and then kept
 * for this head, so closing and reopening the panel does not ask again.
 */
export function useLeftBehind(pr: PullRequest | null, wanted: boolean): LeftBehindLoad {
  const [load, setLoad] = useState<LeftBehindLoad>(IDLE);
  /** The head an answer is held, or being fetched, for. A ref: setting it must not re-run the fetch. */
  const heldFor = useRef<string | null>(null);
  const head = pr?.headSha ?? null;

  useEffect(() => {
    if (!pr || !head) {
      heldFor.current = null;
      setLoad(IDLE);
      return;
    }
    if (!wanted || heldFor.current === head) return;

    let live = true;
    let settled = false;
    heldFor.current = head;
    setLoad({ state: "loading" });
    loadLeftBehind(pr.owner, pr.repo, pr.number, head)
      .then((report) => {
        settled = true;
        if (live) setLoad({ state: "ready", report });
      })
      .catch((cause: unknown) => {
        settled = true;
        if (!live) return;
        heldFor.current = null; // the next open tries again
        setLoad({ state: "error", message: cause instanceof Error ? cause.message : String(cause) });
      });
    return () => {
      live = false;
      // Abandoned mid-flight — closed, or a push: ask again next time.
      if (!settled) heldFor.current = null;
    };
  }, [pr, head, wanted]);

  return load;
}
