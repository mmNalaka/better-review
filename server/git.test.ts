import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { changedFiles, fetchPrRefs, git, mergeBase } from "./git";

const commitFile = async (dir: string, name: string, body: string) => {
  await writeFile(join(dir, name), body);
  await git(dir, "add", name);
  await git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", name);
  return (await git(dir, "rev-parse", "HEAD")).trim();
};

describe("fetchPrRefs", () => {
  let root: string;
  let upstream: string;
  let clone: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "br-git-"));
    upstream = join(root, "upstream");
    clone = join(root, "clone");
    await git(root, "init", "-q", "-b", "main", upstream);
    await commitFile(upstream, "a.txt", "a\n");
    await git(root, "clone", "-q", upstream, clone);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("diffs against the base branch as it is now, not as the clone last fetched it", async () => {
    // main moves on after the clone was made, and the PR branches from there
    await commitFile(upstream, "landed.txt", "already on main\n");
    await git(upstream, "checkout", "-q", "-b", "feature");
    const prHead = await commitFile(upstream, "pr.txt", "the change\n");
    await git(upstream, "update-ref", "refs/pull/1/head", prHead);
    await git(upstream, "checkout", "-q", "main");
    const mainTip = await commitFile(upstream, "later.txt", "also on main\n");

    const refs = await fetchPrRefs(clone, "o", "r", 1, "main");
    expect(refs).toEqual({ headSha: prHead, baseSha: mainTip });

    const base = await mergeBase(clone, refs.baseSha, refs.headSha);
    const changed = await changedFiles(clone, base, refs.headSha);
    expect(changed.map((file) => file.path)).toEqual(["pr.txt"]);
  });
});
