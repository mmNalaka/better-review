import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { CLONE_ROOTS, PR_REF_NAMESPACE } from "./config";
import type { ChangedFile, ChangeKind, Commit } from "./types";

const NUL = "\0";

export class GitError extends Error {
  constructor(args: readonly string[], stderr: string) {
    super(`git ${args.join(" ")} failed: ${stderr.trim() || "no stderr"}`);
    this.name = "GitError";
  }
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new GitError(args, stderr);
  return stdout;
}

/**
 * `git remote get-url` rather than `git config --get remote.origin.url`:
 * an `insteadOf` rewrite makes the two disagree. See ticket 02.
 */
function parseRemote(url: string): { owner: string; repo: string } | null {
  const match = url
    .trim()
    .replace(/\.git$/, "")
    .match(/[/:]([^/:]+)\/([^/]+)$/);
  if (!match?.[1] || !match[2]) return null;
  return { owner: match[1], repo: match[2] };
}

let cloneCache: ReadonlyMap<string, string> | null = null;

async function scanClones(): Promise<ReadonlyMap<string, string>> {
  const found = new Map<string, string>();
  for (const root of CLONE_ROOTS) {
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      continue; // a configured root that does not exist is not fatal
    }
    for (const entry of entries) {
      const dir = join(root, entry);
      try {
        const remote = parseRemote(await git(dir, "remote", "get-url", "origin"));
        if (remote) found.set(`${remote.owner}/${remote.repo}`.toLowerCase(), dir);
      } catch {
        continue; // not a git repo, or no origin
      }
    }
  }
  return found;
}

export async function findClone(owner: string, repo: string): Promise<string | null> {
  cloneCache ??= await scanClones();
  const hit = cloneCache.get(`${owner}/${repo}`.toLowerCase());
  if (hit) return hit;
  cloneCache = await scanClones(); // a clone may have appeared since startup
  return cloneCache.get(`${owner}/${repo}`.toLowerCase()) ?? null;
}

/**
 * Fetches the PR head into a private ref. Works for forks, merged PRs and
 * deleted head branches, because `refs/pull/N/head` lives in the base repo.
 */
export async function fetchPrHead(dir: string, number: number): Promise<string> {
  const ref = `${PR_REF_NAMESPACE}/${number}/head`;
  await git(
    dir,
    "fetch",
    "--no-tags",
    "--no-write-fetch-head",
    "origin",
    `+refs/pull/${number}/head:${ref}`,
  );
  return (await git(dir, "rev-parse", ref)).trim();
}

export async function mergeBase(dir: string, baseRef: string, headSha: string): Promise<string> {
  const base = await git(dir, "rev-parse", `origin/${baseRef}`).catch(() => git(dir, "rev-parse", baseRef));
  return (await git(dir, "merge-base", base.trim(), headSha)).trim();
}

function toChangeKind(raw: string): ChangeKind {
  const head = raw[0];
  return head === "A" || head === "D" || head === "R" ? head : "M";
}

/** Three-dot / merge-base diff. Two-dot invents phantom files. See ticket 02. */
export async function changedFiles(
  dir: string,
  base: string,
  head: string,
): Promise<readonly ChangedFile[]> {
  const [status, numstat] = await Promise.all([
    git(dir, "diff", "--name-status", "-z", base, head),
    git(dir, "diff", "--numstat", "-z", base, head),
  ]);

  const kinds = new Map<string, ChangeKind>();
  const statusFields = status.split(NUL).filter(Boolean);
  for (let i = 0; i < statusFields.length; ) {
    const raw = statusFields[i] ?? "";
    const kind = toChangeKind(raw);
    // Renames carry two paths; the destination is the one we show.
    const span = raw.startsWith("R") ? 3 : 2;
    const path = statusFields[i + span - 1];
    if (path) kinds.set(path, kind);
    i += span;
  }

  const numFields = numstat.split(NUL).filter(Boolean);
  const files: ChangedFile[] = [];
  for (const field of numFields) {
    const [add, del, path] = field.split("\t");
    if (!path) continue;
    files.push({
      path,
      kind: kinds.get(path) ?? "M",
      additions: add === "-" ? 0 : Number(add ?? 0),
      deletions: del === "-" ? 0 : Number(del ?? 0),
    });
  }
  return files;
}

const LOG_SEP = "␞";

/**
 * `A..B`, not `A...B` — for log, three dots is the symmetric difference and
 * wrongly pulls in commits from the base side. See ticket 02.
 */
export async function commits(dir: string, base: string, head: string): Promise<readonly Commit[]> {
  const out = await git(
    dir,
    "log",
    "-z",
    `--format=%H${LOG_SEP}%s${LOG_SEP}%an${LOG_SEP}%ad${LOG_SEP}%b`,
    "--date=iso-strict",
    `${base}..${head}`,
  );
  return out
    .split(NUL)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha = "", subject = "", author = "", date = "", body = ""] = entry.split(LOG_SEP);
      return { sha, subject, author, date, body: body.trim() };
    });
}

/** git's well-known empty tree object, for diffing a root commit. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * The parent a commit should be diffed against — its first parent, or the
 * empty tree when it has none.
 */
export async function parentOf(dir: string, sha: string): Promise<string> {
  const parents = (await git(dir, "rev-list", "--parents", "-n", "1", sha)).trim().split(/\s+/);
  return parents[1] ?? EMPTY_TREE;
}

/**
 * The files one commit changed, rather than the whole PR.
 * Ticket 05 revision: reviewing commit by commit is optional, not the default.
 */
export async function changedFilesInCommit(
  dir: string,
  sha: string,
): Promise<readonly ChangedFile[]> {
  return changedFiles(dir, await parentOf(dir, sha), sha);
}

export async function readBlob(dir: string, ref: string, path: string): Promise<string> {
  return git(dir, "cat-file", "-p", `${ref}:${path}`);
}

export async function listTree(dir: string, ref: string): Promise<readonly string[]> {
  const out = await git(dir, "ls-tree", "-r", "--name-only", "-z", ref);
  return out.split(NUL).filter(Boolean);
}
