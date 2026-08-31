import { git } from "./git";
import { hunkId } from "./hunkid";
import type { ChangeKind } from "./types";

/**
 * Unified diff, parsed into hunks. Computed locally rather than taken from the
 * GitHub API: ticket 02 measured `patch: null` on a 97 KB file, well below the
 * documented limits, so the API silently drops large ones.
 */

export type DiffLineKind = "context" | "added" | "removed";

export interface DiffLine {
  readonly kind: DiffLineKind;
  readonly text: string;
  /** 1-based line number on the base side, null for additions. */
  readonly oldLine: number | null;
  /** 1-based line number on the head side, null for deletions. */
  readonly newLine: number | null;
}

export interface HunkCommit {
  readonly sha: string;
  readonly subject: string;
}

export interface Hunk {
  /** Content-addressed identity — see hunkid.ts. What a review mark keys to. */
  readonly id: string;
  readonly header: string;
  readonly oldStart: number;
  readonly newStart: number;
  readonly lines: readonly DiffLine[];
  /**
   * Commits from this PR that introduced the hunk's added lines, oldest first.
   * Usually one; more when a later commit revised an earlier one in place.
   */
  readonly commits?: readonly HunkCommit[];
}

export interface FileDiff {
  readonly path: string;
  readonly kind: ChangeKind;
  readonly hunks: readonly Hunk[];
  /** True when the file is binary or the diff was otherwise not textual. */
  readonly binary: boolean;
}

const BLAME_HEADER = /^([0-9a-f]{40}) \d+ (\d+)/;
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

export function parseUnifiedDiff(patch: string): { hunks: Hunk[]; binary: boolean } {
  if (patch.includes("\nBinary files ") || patch.startsWith("Binary files ")) {
    return { hunks: [], binary: true };
  }

  const hunks: Hunk[] = [];
  let lines: DiffLine[] = [];
  let header = "";
  let oldStart = 0;
  let newStart = 0;
  let oldNo = 0;
  let newNo = 0;

  const flush = () => {
    if (header) hunks.push({ id: hunkId(lines), header, oldStart, newStart, lines });
  };

  for (const raw of patch.split("\n")) {
    const match = HUNK_HEADER.exec(raw);
    if (match) {
      flush();
      oldStart = Number(match[1]);
      newStart = Number(match[2]);
      oldNo = oldStart;
      newNo = newStart;
      header = raw;
      lines = [];
      continue;
    }
    if (!header) continue; // file headers, index lines, ---/+++
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"

    const marker = raw[0];
    const text = raw.slice(1);
    if (marker === "+") {
      lines.push({ kind: "added", text, oldLine: null, newLine: newNo++ });
    } else if (marker === "-") {
      lines.push({ kind: "removed", text, oldLine: oldNo++, newLine: null });
    } else if (marker === " ") {
      lines.push({ kind: "context", text, oldLine: oldNo++, newLine: newNo++ });
    }
  }
  flush();
  return { hunks, binary: false };
}

export interface FileHunks {
  readonly hunks: readonly Hunk[];
  readonly binary: boolean;
}

/** Only the header lines above the first hunk may name the file. */
const pathOf = (block: string): string | null => {
  const head = block.split("\n@@")[0] ?? "";
  const lines = head.split("\n");
  const named = (prefix: string): string | null => {
    for (const line of lines) {
      if (!line.startsWith(prefix)) continue;
      // git appends a tab when the path contains a space.
      const raw = line.slice(prefix.length).replace(/\s+$/, "");
      if (raw === "/dev/null") return null;
      return raw.replace(/^[ab]\//, "");
    }
    return null;
  };
  // Head side names the file; a deletion has none, so fall back to the base.
  // A binary file has neither, and only the `diff --git a/x b/x` line is left.
  const git = /^a\/(.*) b\/(.*)$/.exec(lines[0] ?? "");
  return named("+++ ") ?? named("--- ") ?? git?.[2] ?? null;
};

/**
 * One `git diff` of the whole pull request, split per file. The client needs
 * every file's hunk ids to derive review state in the explorer — the alternative
 * was one diff per changed file, which is 32 git invocations for one column.
 */
export function splitDiffByFile(patch: string): Map<string, FileHunks> {
  const byFile = new Map<string, FileHunks>();
  for (const block of patch.split(/^diff --git /m)) {
    if (!block.trim()) continue;
    const path = pathOf(block);
    if (!path) continue;
    const { hunks, binary } = parseUnifiedDiff(block);
    byFile.set(path, { hunks, binary });
  }
  return byFile;
}

export interface HunkRef {
  readonly id: string;
  readonly header: string;
}

/**
 * Every hunk the pull request has, as ids only. This is what the explorer
 * derives review state from: a file is `reviewed` when every id here is
 * marked, and `changed since reviewed` when a mark names an id that is gone.
 */
export interface HunkIndex {
  readonly files: Readonly<Record<string, readonly HunkRef[]>>;
}

export const indexHunks = (byFile: Map<string, FileHunks>): HunkIndex => ({
  files: Object.fromEntries(
    [...byFile].map(([path, file]) => [
      path,
      file.hunks.map((hunk) => ({ id: hunk.id, header: hunk.header })),
    ]),
  ),
});

/** Every hunk in the pull request, by path. One git call. */
export async function allHunks(
  repoDir: string,
  base: string,
  head: string,
): Promise<Map<string, FileHunks>> {
  return splitDiffByFile(await git(repoDir, "diff", "--no-color", base, head));
}

/**
 * head-side line number -> commit sha, from one blame per file.
 * Ticket 05: lets a hunk say which commit introduced it, so original work is
 * distinguishable from a later fixup while reading.
 */
async function blameByLine(
  repoDir: string,
  head: string,
  path: string,
): Promise<Map<number, string>> {
  const output = await git(repoDir, "blame", "--line-porcelain", head, "--", path).catch(() => "");
  const byLine = new Map<number, string>();
  for (const line of output.split("\n")) {
    // Porcelain header line: "<sha> <oldLine> <newLine> [<count>]"
    const match = BLAME_HEADER.exec(line);
    if (match?.[1] && match[2]) byLine.set(Number(match[2]), match[1]);
  }
  return byLine;
}

export async function fileDiff(
  repoDir: string,
  base: string,
  head: string,
  path: string,
  kind: ChangeKind,
  prCommits: readonly { sha: string; subject: string }[] = [],
): Promise<FileDiff> {
  const patch = await git(repoDir, "diff", "--no-color", base, head, "--", path);
  const { hunks, binary } = parseUnifiedDiff(patch);
  if (binary || hunks.length === 0 || prCommits.length === 0) {
    return { path, kind, hunks, binary };
  }

  const subjects = new Map(prCommits.map((commit) => [commit.sha, commit.subject]));
  // `commits` arrives newest first; show attribution oldest first.
  const order = new Map(prCommits.map((commit, index) => [commit.sha, -index]));
  const byLine = await blameByLine(repoDir, head, path);

  const attributed = hunks.map((hunk) => {
    const shas = new Set<string>();
    for (const line of hunk.lines) {
      if (line.kind !== "added" || line.newLine === null) continue;
      const sha = byLine.get(line.newLine);
      // Ignore blame landing outside this PR: pre-existing code caught up in a rewrite.
      if (sha && subjects.has(sha)) shas.add(sha);
    }
    const commits = [...shas]
      .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
      .map((sha) => ({ sha, subject: subjects.get(sha) ?? "" }));
    return { ...hunk, commits };
  });

  return { path, kind, hunks: attributed, binary };
}
