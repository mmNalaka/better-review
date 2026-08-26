import { useCopy } from "./clipboard";
import type { PullRequest } from "./api";

/**
 * The PR's branches, shown in full and each copyable.
 * Branch names are what you type into `git switch`, so they are worth copying
 * and worth never truncating.
 */

interface BranchesProps {
  readonly pr: PullRequest;
}

export function Branches({ pr }: BranchesProps) {
  const { state, what, copy } = useCopy();

  const branch = (name: string, role: "head" | "base") => (
    <button
      className={`branch ${role}`}
      onClick={() => void copy(name, name)}
      title={`Copy ${name}`}
      aria-label={`Copy ${role} branch ${name}`}
    >
      {name}
    </button>
  );

  return (
    <span className="pr-branches">
      {pr.forkOf && <span className="fork" title={`from the fork ${pr.forkOf}`}>{pr.forkOf}</span>}
      {branch(pr.headRef, "head")}
      <span className="into" aria-label="into">&rarr;</span>
      {branch(pr.baseRef, "base")}
      {state !== "idle" && (
        <span className={`copied-flash ${state}`} role="status">
          {state === "copied" ? `copied ${what ?? ""}` : "copy failed"}
        </span>
      )}
    </span>
  );
}
