import { PR_REF_NAMESPACE } from "./config";
import { allHunks } from "./diff";
import { git } from "./git";
import type { ReviewPass } from "./markmodel";
import { matchHunks, type HunkMatch } from "./rereview";
import type { Commit } from "./types";

/**
 * The git side of re-reviewing after a push: keep every passed head alive,
 * and describe how the pull request moved since one.
 *
 * `refs/prreview/N/head` is overwritten on every fetch, so after a force push
 * the head you reviewed is unreachable and the next `git gc` deletes it. A ref
 * per pass keeps it — and its merge base — for as long as the pass is kept.
 */

const passPrefix = (number: number) => `${PR_REF_NAMESPACE}/${number}/pass/`;

const exists = async (dir: string, sha: string): Promise<boolean> =>
  git(dir, "cat-file", "-e", `${sha}^{commit}`).then(
    () => true,
    () => false,
  );

/** One ref per kept pass, and none for a pass that has been dropped. */
export async function pinPasses(
  dir: string,
  number: number,
  passes: readonly ReviewPass[],
): Promise<void> {
  const prefix = passPrefix(number);
  const wanted = new Map<string, string>();
  for (const pass of passes) {
    wanted.set(`${prefix}${pass.headSha}`, pass.headSha);
    wanted.set(`${prefix}${pass.headSha}-base`, pass.mergeBase);
  }

  const listed = await git(dir, "for-each-ref", "--format=%(refname)", prefix);
  for (const ref of listed.split("\n").filter(Boolean)) {
    if (!wanted.has(ref)) await git(dir, "update-ref", "-d", ref);
  }
  for (const [ref, sha] of wanted) {
    // A commit this clone never had cannot be pinned; the report says so later.
    if (await exists(dir, sha)) await git(dir, "update-ref", ref, sha);
  }
}

export interface SinceReport {
  readonly from: string;
  readonly to: string;
  /** False when the passed head is no longer in this clone: no matches, no commits. */
  readonly available: boolean;
  /** The old head is not an ancestor of the new one: history was rewritten. */
  readonly forcePushed: boolean;
  /** The fork point moved — a rebase onto a newer base, or a retargeted PR. */
  readonly baseMoved: boolean;
  /** Pull request commits that were not there at the passed head, newest first. */
  readonly commits: readonly Commit[];
  readonly matches: readonly HunkMatch[];
}

interface Head {
  readonly headSha: string;
  readonly mergeBase: string;
}

export async function sinceReport(
  dir: string,
  pass: ReviewPass,
  now: Head,
  prCommits: readonly Commit[],
): Promise<SinceReport> {
  const base = {
    from: pass.headSha,
    to: now.headSha,
    baseMoved: pass.mergeBase !== now.mergeBase,
  };
  if (!(await exists(dir, pass.headSha)) || !(await exists(dir, pass.mergeBase))) {
    return { ...base, available: false, forcePushed: false, commits: [], matches: [] };
  }

  const ancestor = await git(dir, "merge-base", "--is-ancestor", pass.headSha, now.headSha).then(
    () => true,
    () => false,
  );
  // Rebased or not, "new" means reachable from the new head and not the old.
  const fresh = new Set(
    (await git(dir, "rev-list", now.headSha, `^${pass.headSha}`)).split("\n").filter(Boolean),
  );

  const [before, after] = await Promise.all([
    allHunks(dir, pass.mergeBase, pass.headSha),
    allHunks(dir, now.mergeBase, now.headSha),
  ]);
  const matches = [...after].flatMap(([path, file]) =>
    matchHunks(path, before.get(path)?.hunks ?? [], file.hunks),
  );

  return {
    ...base,
    available: true,
    forcePushed: !ancestor,
    commits: prCommits.filter((commit) => fresh.has(commit.sha)),
    matches,
  };
}
