import { useCallback, useEffect, useState } from "react";

import { loadConversation, type ConversationEntry } from "./api";

interface FetchState {
  readonly entries: readonly ConversationEntry[];
  readonly loading: boolean;
  readonly error: string | null;
}

export interface ConversationState extends FetchState {
  /** Refetch — call after publishing, so a just-posted review shows up here too. */
  readonly refresh: () => void;
}

const EMPTY: FetchState = { entries: [], loading: false, error: null };

/**
 * The pull request's own description and conversation, fetched once a review
 * is open. Exposes `refresh` because this app can itself add to that
 * conversation — publishing a review should not leave this list looking stale.
 */
export function useConversation(
  owner: string | null,
  repo: string | null,
  pr: number | null,
): ConversationState {
  const [state, setState] = useState<FetchState>(EMPTY);

  const load = useCallback(() => {
    if (!owner || !repo || pr === null) {
      setState(EMPTY);
      return () => {};
    }
    let live = true;
    setState({ entries: [], loading: true, error: null });
    void loadConversation(owner, repo, pr)
      .then((entries) => live && setState({ entries, loading: false, error: null }))
      .catch((cause: unknown) => {
        if (live) {
          setState({
            entries: [],
            loading: false,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
      });
    return () => {
      live = false;
    };
  }, [owner, repo, pr]);

  useEffect(() => load(), [load]);

  return { ...state, refresh: load };
}
