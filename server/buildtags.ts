import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Go build tags the PR's own changed files need.
 *
 * Measured in ticket 13: `sitoo/auth#146` has 44 of 155 symbols behind
 * `//go:build integration_test`, and gopls answers with a hard error rather
 * than an empty result for every one of them. Passing the tag makes them
 * resolvable.
 *
 * Only tags the changed files actually carry are enabled. Enabling every tag
 * in a repo can activate two mutually exclusive files at once, which produces
 * duplicate declarations across the whole project rather than in one file.
 */

const BUILD_LINE = /^\/\/go:build (.+)$/m;
const TAG = /[a-z_][a-z_0-9]*/g;

/** Constraints that describe the platform, never something we should force on. */
const PLATFORM = new Set([
  "linux", "darwin", "windows", "freebsd", "netbsd", "openbsd", "plan9", "js", "wasip1",
  "amd64", "arm64", "arm", "386", "riscv64", "s390x", "ppc64", "ppc64le", "mips", "mips64",
  "cgo", "race", "unix", "gc", "gccgo", "ignore",
]);

async function tagsInFile(root: string, relativePath: string): Promise<readonly string[]> {
  const source = await readFile(join(root, relativePath), "utf8").catch(() => "");
  // Only the header matters, and reading the whole file to find it is wasteful.
  const match = BUILD_LINE.exec(source.slice(0, 512));
  if (!match?.[1]) return [];
  return [...match[1].matchAll(TAG)].map(([tag]) => tag).filter((tag) => !PLATFORM.has(tag));
}

export async function buildTagsFor(
  root: string,
  changedPaths: readonly string[],
): Promise<readonly string[]> {
  const goFiles = changedPaths.filter((path) => path.endsWith(".go"));
  const found = await Promise.all(goFiles.map((path) => tagsInFile(root, path)));
  return [...new Set(found.flat())].sort();
}
