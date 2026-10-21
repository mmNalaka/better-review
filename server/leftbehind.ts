import { readFileSync } from "node:fs";

import { lineReader, sitesFromCalls, type CallSite } from "./callers";
import { git } from "./git";
import { serverFor } from "./lsp";
import { languageOf, specFor } from "./servers";
import {
  parseBlocks,
  signatureChanges,
  type ChangeBlock,
  type SignatureChange,
} from "./signatures";

/**
 * Callers left behind: a function whose signature the PR changed, and the
 * places that call it on lines the PR did not touch. Those are where a missed
 * update hides — the compiler catches some, defaults and dynamic languages
 * let the rest through.
 *
 * "Did not touch" is a line-level guess: a call on a changed line is taken
 * as updated, which is usually right and never proof.
 */

/** Past this many changed signatures, stop asking; say so rather than truncate quietly. */
export const MAX_SIGNATURES = 60;
export const MAX_ELAPSED_MS = 20_000;

export interface LeftBehind {
  readonly path: string;
  readonly name: string;
  /** 0-based position of the name. */
  readonly line: number;
  readonly character: number;
  readonly before: string;
  readonly after: string;
  /** Calls on lines the PR did not touch. */
  readonly stale: readonly CallSite[];
  /** Calls on lines the PR changed — probably updated alongside. */
  readonly updated: number;
  /** Calls from outside the repo. */
  readonly external: number;
  /** The language server's refusal, when it would not say who calls this. */
  readonly unknown?: string;
}

export interface LeftBehindReport {
  readonly changes: readonly LeftBehind[];
  /** Changed files no language server could read, and why. */
  readonly skipped: readonly { readonly path: string; readonly reason: string }[];
  readonly capped?: string;
}

/** Head lines each file's blocks added — where a call counts as updated. */
export function addedLines(
  blocks: ReadonlyMap<string, readonly ChangeBlock[]>,
): ReadonlyMap<string, ReadonlySet<number>> {
  const byFile = new Map<string, ReadonlySet<number>>();
  for (const [path, fileBlocks] of blocks) {
    byFile.set(
      path,
      new Set(fileBlocks.flatMap((block) => block.added.map((_, offset) => block.at + offset))),
    );
  }
  return byFile;
}

export function partitionSites(
  sites: readonly CallSite[],
  added: ReadonlyMap<string, ReadonlySet<number>>,
): { readonly stale: readonly CallSite[]; readonly updated: number } {
  const stale = sites.filter((site) => !added.get(site.path)?.has(site.line));
  return { stale, updated: sites.length - stale.length };
}

export interface LeftBehindOptions {
  readonly repoDir: string;
  readonly base: string;
  readonly head: string;
  readonly buildTags: readonly string[];
}

export async function findLeftBehind(options: LeftBehindOptions): Promise<LeftBehindReport> {
  const { repoDir, base, head, buildTags } = options;
  const startedAt = Date.now();
  const blocks = parseBlocks(await git(repoDir, "diff", "-U0", "--no-color", base, head));
  const added = addedLines(blocks);
  const readLine = lineReader(repoDir);

  const changes: LeftBehind[] = [];
  const skipped: { path: string; reason: string }[] = [];
  let asked = 0;
  let capped: string | undefined;

  for (const [path, fileBlocks] of blocks) {
    const language = languageOf(path);
    if (!language || !specFor(language)) continue; // not applicable, not a failure
    const client = serverFor(repoDir, language, buildTags);
    if (!client) continue;

    const absolute = `${repoDir}/${path}`;
    let found: readonly SignatureChange[];
    try {
      const lines = readFileSync(absolute, "utf8").split("\n");
      found = signatureChanges(lines, await client.documentSymbols(absolute, language), fileBlocks);
    } catch (error) {
      skipped.push({ path, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }

    for (const change of found) {
      if (asked >= MAX_SIGNATURES) capped = `stopped after ${MAX_SIGNATURES} changed signatures`;
      else if (Date.now() - startedAt >= MAX_ELAPSED_MS) {
        capped = `stopped after ${Math.round(MAX_ELAPSED_MS / 1000)}s`;
      }
      if (capped) break;
      asked += 1;

      const entry = { path, ...change, stale: [], updated: 0, external: 0 };
      try {
        const items = await client.prepareCallHierarchy(absolute, language, change);
        const calls = (await Promise.all(items.map((item) => client.incomingCallSites(item)))).flat();
        const { sites, external } = sitesFromCalls(calls, repoDir, readLine);
        changes.push({ ...entry, ...partitionSites(sites, added), external });
      } catch (error) {
        // One symbol refusing does not sink the report.
        changes.push({ ...entry, unknown: error instanceof Error ? error.message : String(error) });
      }
    }
    if (capped) break;
  }

  // Most left behind first: that is where to look.
  const sorted = [...changes].sort(
    (a, b) => b.stale.length - a.stale.length || a.path.localeCompare(b.path) || a.line - b.line,
  );
  return { changes: sorted, skipped, ...(capped ? { capped } : {}) };
}
