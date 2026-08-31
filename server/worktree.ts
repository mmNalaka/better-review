import { existsSync, symlinkSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

import { WORKTREE_ROOT } from "./config";
import { git } from "./git";

/**
 * A detached worktree holding the PR head, so language servers have real files.
 *
 * `--detach` is mandatory, not stylistic (ticket 02): `git worktree add` with a
 * branch name fails outright when that branch is already checked out, which is
 * exactly the case when you are reviewing the branch you are on.
 */

const slug = (owner: string, repo: string) => `${owner}__${repo}`;

export interface Worktree {
  readonly dir: string;
  /** How many node_modules directories were linked in. Zero is normal for Go. */
  readonly linkedModules: number;
}

/** Deep enough for `services/<pkg>/node_modules` in a monorepo. */
const MODULE_SEARCH_DEPTH = 3;

/**
 * Ticket 02, measured: a bare TypeScript worktree gives the language server 163
 * unresolved-module errors and a worthless call graph. Symlinking the clone's
 * node_modules fixes it in ~16 ms. Go needs nothing — gopls resolves from the
 * machine-global module cache.
 */
async function findModuleDirs(root: string, depth: number): Promise<readonly string[]> {
  if (depth < 0) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules") {
      found.push(join(root, entry.name));
      continue; // never descend into one
    }
    found.push(...(await findModuleDirs(join(root, entry.name), depth - 1)));
  }
  return found;
}

async function linkNodeModules(clone: string, worktree: string): Promise<number> {
  const sources = await findModuleDirs(clone, MODULE_SEARCH_DEPTH);
  let linked = 0;
  for (const source of sources) {
    const relative = source.slice(clone.length + 1);
    const target = join(worktree, relative);
    if (existsSync(target)) continue;
    try {
      await mkdir(join(target, ".."), { recursive: true });
      symlinkSync(source, target, "dir");
      linked += 1;
    } catch {
      // a package that exists in the clone but not in the head tree: skip
    }
  }
  return linked;
}

export async function ensureWorktree(
  clone: string,
  owner: string,
  repo: string,
  number: number,
  headSha: string,
): Promise<Worktree> {
  const dir = join(WORKTREE_ROOT, slug(owner, repo), `pr-${number}`);

  if (existsSync(join(dir, ".git"))) {
    const current = (await git(dir, "rev-parse", "HEAD")).trim();
    if (current !== headSha) {
      // The PR moved: re-point this worktree rather than making another.
      await git(dir, "checkout", "--detach", headSha);
    }
    return { dir, linkedModules: await linkNodeModules(clone, dir) };
  }

  await mkdir(join(dir, ".."), { recursive: true });
  // Reap our own stale records only — never a bare `git worktree prune`, which
  // would also clear records this app did not create.
  await git(clone, "worktree", "prune").catch(() => "");
  await git(clone, "worktree", "add", "--detach", dir, headSha);

  return { dir, linkedModules: await linkNodeModules(clone, dir) };
}
