import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { commits, git } from "./git";
import { allHunks, indexHunks } from "./diff";
import { passAt } from "./rereview";
import { pinPasses, sinceReport } from "./since";

const AT = "2026-10-01T09:00:00.000Z";
const BODY = ["one", "two", "three", "four", "five", "six"];

const commitFile = async (dir: string, name: string, lines: readonly string[], amend = false) => {
  await writeFile(join(dir, name), `${lines.join("\n")}\n`);
  await git(dir, "add", name);
  const author = ["-c", "user.name=t", "-c", "user.email=t@t"];
  await git(dir, ...author, "commit", "-q", ...(amend ? ["--amend"] : []), "-m", name);
  return (await git(dir, "rev-parse", "HEAD")).trim();
};

describe("since a pass", () => {
  let dir: string;
  let base: string;
  let first: string;

  const passFor = async (head: string) =>
    passAt(head, base, indexHunks(await allHunks(dir, base, head)), AT);

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "br-since-"));
    await git(dir, "init", "-q", "-b", "main");
    base = await commitFile(dir, "a.txt", ["base"]);
    await git(dir, "checkout", "-q", "-b", "feature");
    first = await commitFile(dir, "a.txt", ["base", ...BODY]);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("a plain push lists only the new commits and keeps unchanged hunks out of it", async () => {
    const pass = await passFor(first);
    const second = await commitFile(dir, "b.txt", ["new file"]);
    const report = await sinceReport(
      dir,
      pass,
      { headSha: second, mergeBase: base },
      await commits(dir, base, second),
    );

    expect(report.available).toBe(true);
    expect(report.forcePushed).toBe(false);
    expect(report.baseMoved).toBe(false);
    expect(report.commits.map((commit) => commit.sha)).toEqual([second]);
    expect(report.matches).toEqual([]);
  });

  test("a force push is named, and an edited hunk is matched to the one it replaced", async () => {
    const pass = await passFor(first);
    const amended = await commitFile(
      dir,
      "a.txt",
      ["base", "one", "two", "THREE", "four", "five", "six"],
      true,
    );
    const report = await sinceReport(
      dir,
      pass,
      { headSha: amended, mergeBase: base },
      await commits(dir, base, amended),
    );

    expect(report.forcePushed).toBe(true);
    expect(report.commits.map((commit) => commit.sha)).toEqual([amended]);
    expect(report.matches).toHaveLength(1);
    expect(report.matches[0]?.oldId).toBe(pass.hunks["a.txt"]?.[0]);
    expect(report.matches[0]?.delta.some((row) => row.change === "dropped" && row.text === "three"))
      .toBe(true);
  });

  test("a pinned head survives the force push and a gc", async () => {
    const pass = await passFor(first);
    await pinPasses(dir, 7, [pass]);
    await commitFile(dir, "a.txt", ["base", "rewritten"], true);
    await git(dir, "reflog", "expire", "--expire=now", "--all");
    await git(dir, "gc", "-q", "--prune=now");

    expect((await git(dir, "cat-file", "-t", first)).trim()).toBe("commit");
    const refs = await git(dir, "for-each-ref", "--format=%(refname)", "refs/prreview/7/pass/");
    expect(refs.trim().split("\n")).toEqual([
      `refs/prreview/7/pass/${first}`,
      `refs/prreview/7/pass/${first}-base`,
    ]);
  });

  test("dropping a pass drops its pins", async () => {
    await pinPasses(dir, 7, [await passFor(first)]);
    await pinPasses(dir, 7, []);
    expect((await git(dir, "for-each-ref", "refs/prreview/7/pass/")).trim()).toBe("");
  });

  test("a head this clone no longer has is reported as unavailable, not as an error", async () => {
    const pass = { ...(await passFor(first)), headSha: "f".repeat(40) };
    const report = await sinceReport(dir, pass, { headSha: first, mergeBase: base }, []);
    expect(report.available).toBe(false);
    expect(report.matches).toEqual([]);
  });

  test("a moved fork point is named", async () => {
    const pass = { ...(await passFor(first)), mergeBase: first };
    const report = await sinceReport(dir, pass, { headSha: first, mergeBase: base }, []);
    expect(report.baseMoved).toBe(true);
  });
});
