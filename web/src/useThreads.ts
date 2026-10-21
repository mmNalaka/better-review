import { useCallback, useEffect, useState } from "react";

import {
  loadThreads,
  replyToThread,
  resolveThread,
  type PullRequest,
  type ReviewThread,
} from "./api";

interface FetchState {
  readonly threads: readonly ReviewThread[];
  readonly loading: boolean;
  readonly error: string | null;
}

export interface ThreadsState extends FetchState {
  readonly refresh: () => void;
  /** Resolves once GitHub has the reply; rejects with its reason. */
  readonly reply: (threadId: string, body: string) => Promise<void>;
  readonly setResolved: (threadId: string, resolved: boolean) => Promise<void>;
}

const EMPTY: FetchState = { threads: [], loading: false, error: null };

const replace = (
  threads: readonly ReviewThread[],
  id: string,
  change: (thread: ReviewThread) => ReviewThread,
): readonly ReviewThread[] => threads.map((thread) => (thread.id === id ? change(thread) : thread));

/**
 * The review threads GitHub holds for the open pull request. Replies and
 * resolutions post at once and are folded into the list from GitHub's answer,
 * so the thread shows what GitHub has rather than what we hoped it would.
 */
export function useThreads(pr: PullRequest | null): ThreadsState {
  const [state, setState] = useState<FetchState>(EMPTY);
  const owner = pr?.owner ?? null;
  const repo = pr?.repo ?? null;
  const number = pr?.number ?? null;

  const load = useCallback(() => {
    if (!owner || !repo || number === null) {
      setState(EMPTY);
      return () => {};
    }
    let live = true;
    setState((current) => ({ ...current, loading: true, error: null }));
    void loadThreads(owner, repo, number)
      .then((threads) => live && setState({ threads, loading: false, error: null }))
      .catch((cause: unknown) => {
        if (live) {
          setState({
            threads: [],
            loading: false,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
      });
    return () => {
      live = false;
    };
  }, [owner, repo, number]);

  useEffect(() => load(), [load]);

  const reply = useCallback(
    async (threadId: string, body: string) => {
      if (!owner || !repo || number === null) return;
      const comment = await replyToThread(owner, repo, number, threadId, body);
      setState((current) => ({
        ...current,
        threads: replace(current.threads, threadId, (thread) => ({
          ...thread,
          comments: [...thread.comments, comment],
        })),
      }));
    },
    [owner, repo, number],
  );

  const setResolved = useCallback(
    async (threadId: string, resolved: boolean) => {
      if (!owner || !repo || number === null) return;
      const updated = await resolveThread(owner, repo, number, threadId, resolved);
      setState((current) => ({
        ...current,
        threads: replace(current.threads, threadId, () => updated),
      }));
    },
    [owner, repo, number],
  );

  return { ...state, refresh: load, reply, setResolved };
}
