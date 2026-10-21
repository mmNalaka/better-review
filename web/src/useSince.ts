import { useEffect, useMemo, useState } from "react";

import { loadSince, type HunkIndex, type MarkFile, type PullRequest, type SinceReport } from "./api";
import { lastPass, markKey, type ReviewPass } from "../../server/markmodel";
import { classify, type HunkMatch, type SinceSummary } from "../../server/rereview";

/**
 * What changed since your last finished pass, for the open pull request.
 *
 * Nothing to say before the first pass, or when the last pass is at this very
 * head. The report is fetched once per (pass, head); classification is redone
 * locally on every tick, since ticking is what turns `new` into done.
 */

export interface SinceState {
  readonly pass: ReviewPass | null;
  readonly report: SinceReport | null;
  readonly summary: SinceSummary | null;
  /** Matches by the new hunk's `markKey`, for the diff pane. */
  readonly matches: ReadonlyMap<string, HunkMatch>;
  readonly loading: boolean;
  readonly error: string | null;
}

const NO_MATCHES: ReadonlyMap<string, HunkMatch> = new Map();

export function useSince(pr: PullRequest | null, marks: MarkFile, index: HunkIndex): SinceState {
  const pass = pr ? lastPass(marks) : null;
  const from = pass && pr && pass.headSha !== pr.headSha ? pass.headSha : null;
  const [report, setReport] = useState<SinceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReport(null);
    setError(null);
    if (!pr || !from) return;
    let live = true;
    setLoading(true);
    void loadSince(pr.owner, pr.repo, pr.number, pr.headSha, from)
      .then((result) => live && setReport(result))
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [pr?.owner, pr?.repo, pr?.number, pr?.headSha, from]);

  const summary = useMemo(
    () => (pass && from && report ? classify(index, marks, pass, report.matches) : null),
    [pass, from, report, index, marks],
  );

  const matches = useMemo(
    () =>
      report
        ? new Map(report.matches.map((match) => [markKey(match.path, match.newId), match]))
        : NO_MATCHES,
    [report],
  );

  return { pass, report, summary, matches, loading, error };
}
