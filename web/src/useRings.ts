import { useEffect, useState } from "react";

import type { FileRing, RingProgress } from "../../server/rings";

export type { FileRing, RingKind } from "../../server/rings";

export interface RingState {
  readonly byPath: ReadonlyMap<string, FileRing>;
  readonly reachedRing: number;
  readonly done: boolean;
  readonly capped: string | null;
  readonly symbols: number;
  readonly elapsedMs: number;
}

const EMPTY: RingState = {
  byPath: new Map(),
  reachedRing: -1,
  done: false,
  capped: null,
  symbols: 0,
  elapsedMs: 0,
};

/**
 * Ticket 10: the radius is computed eagerly when a PR opens and streamed in,
 * so rings appear as they resolve. Until a file has one it is `working`, which
 * ticket 09 keeps visibly distinct from having no callers.
 */
export function useRings(
  owner: string | null,
  repo: string | null,
  pr: number | null,
  rev: string | null,
): RingState {
  const [state, setState] = useState<RingState>(EMPTY);

  useEffect(() => {
    if (!owner || !repo || pr === null || !rev) {
      setState(EMPTY);
      return;
    }
    setState(EMPTY);

    const query = new URLSearchParams({ owner, repo, pr: String(pr), rev });
    const source = new EventSource(`/api/rings?${query}`);

    source.onmessage = (event) => {
      const progress = JSON.parse(event.data) as RingProgress & { error?: string };
      if (progress.error) {
        setState((current) => ({ ...current, done: true }));
        source.close();
        return;
      }
      setState((current) => {
        const byPath = new Map(current.byPath);
        for (const file of progress.files) byPath.set(file.path, file);
        return {
          byPath,
          reachedRing: Math.max(current.reachedRing, progress.ring),
          done: progress.done,
          capped: progress.capped ?? current.capped,
          symbols: progress.symbols,
          elapsedMs: progress.elapsedMs,
        };
      });
      if (progress.done) source.close();
    };

    source.onerror = () => {
      setState((current) => ({ ...current, done: true }));
      source.close();
    };

    return () => source.close();
  }, [owner, repo, pr, rev]);

  return state;
}
