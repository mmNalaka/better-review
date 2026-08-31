import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { emptyMarkFile, MarkError, parseMarkFile, type MarkFile, type PrRef } from "./markmodel";

/**
 * Marks on disk: one JSON file per pull request, outside the repo being
 * reviewed. Ticket 04 — it survives a re-clone, a `git clean -xdf` and a
 * deleted worktree, and the reviewed repo stays pristine: nothing to gitignore,
 * nothing to commit by accident.
 */

/** Slugs become filenames, so they may not contain a separator of any kind. */
const NAME = /^[A-Za-z0-9._-]+$/;

export function marksPath(dir: string, pr: PrRef): string {
  if (!NAME.test(pr.owner) || !NAME.test(pr.repo)) {
    throw new MarkError(`Not a usable repository name: ${pr.owner}/${pr.repo}`);
  }
  if (!Number.isSafeInteger(pr.number) || pr.number <= 0) {
    throw new MarkError(`Not a pull request number: ${String(pr.number)}`);
  }
  return join(dir, `${pr.owner}__${pr.repo}__${pr.number}.json`);
}

export async function readMarks(dir: string, pr: PrRef): Promise<MarkFile> {
  const file = marksPath(dir, pr);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (cause) {
    // Nothing saved yet is the normal first read; anything else is real.
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return emptyMarkFile(pr);
    throw cause;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MarkError(
      `${file} is not valid JSON. Your review progress is in there — move it aside rather than letting the app overwrite it.`,
    );
  }
  return parseMarkFile(parsed, pr);
}

let counter = 0;
const nonce = () => (counter = (counter + 1) % Number.MAX_SAFE_INTEGER).toString(36);

/**
 * Atomic: a temp file in the same directory, then a rename. A half-written
 * marks file would lose a review, and `rename(2)` within one filesystem cannot
 * leave one behind. The temp name carries the pid so two savers never share it.
 */
export async function writeMarks(dir: string, pr: PrRef, file: MarkFile): Promise<void> {
  const validated = parseMarkFile(file, pr); // never write what we would refuse to read
  const target = marksPath(dir, pr);
  await mkdir(dir, { recursive: true });

  const temp = `${target}.${process.pid}.${nonce()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    await rename(temp, target);
  } catch (cause) {
    await unlink(temp).catch(() => {}); // a failed save must not litter
    throw cause;
  }
}
