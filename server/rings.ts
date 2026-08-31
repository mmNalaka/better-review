import { languageOf, specFor } from "./servers";
import { serverFor, type CallHierarchyItem, type DocumentSymbol, type LspClient } from "./lsp";
import { git } from "./git";

/**
 * The blast radius: how far code sits from the changed lines in the call graph.
 *
 * Ticket 10 settled the shape from measurement - walk outward until the
 * frontier runs dry, capped on symbol count and elapsed time rather than depth,
 * because fan-out is what runs away. On sitoo/auth#146 the whole depth-3 radius
 * took 2.7 s and the frontier collapsed 111 -> 8 -> 5 -> 3.
 *
 * Ticket 09 settled what a file with no ring says.
 */

export type RingKind = "changed" | "ring" | "out-of-range" | "unknown" | "not-applicable";

export interface FileRing {
  readonly path: string;
  readonly kind: RingKind;
  /** Present only when kind is "ring". */
  readonly ring?: number;
  /** Why we could not place it. Present only when kind is "unknown". */
  readonly reason?: string;
}

export interface RingProgress {
  /** 0 for the changed set, 1..n outward, -1 for the closing batch. */
  readonly ring: number;
  readonly files: readonly FileRing[];
  readonly symbols: number;
  readonly elapsedMs: number;
  readonly done: boolean;
  /** Set when a cap stopped the walk. Never truncate silently (ticket 10). */
  readonly capped?: string;
}

export const MAX_SYMBOLS = 2000;
export const MAX_ELAPSED_MS = 15_000;

/** SymbolKind values that can have callers: function, method, constructor. */
const CALLABLE = new Set([6, 9, 12]);

const FILE_URI_PREFIX = "file://";
const HUNK_RANGE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

function pathOf(uri: string, root: string): string | null {
  const absolute = decodeURIComponent(
    uri.startsWith(FILE_URI_PREFIX) ? uri.slice(FILE_URI_PREFIX.length) : uri,
  );
  return absolute.startsWith(`${root}/`) ? absolute.slice(root.length + 1) : null;
}

const keyOf = (item: CallHierarchyItem) =>
  `${item.uri}:${item.selectionRange.start.line}:${item.selectionRange.start.character}`;

function flatten(symbols: readonly DocumentSymbol[]): DocumentSymbol[] {
  return symbols.flatMap((symbol) => [symbol, ...flatten(symbol.children ?? [])]);
}

/** Head-side lines each file changed, from one `git diff -U0` for the whole PR. */
export async function changedLinesByFile(
  repoDir: string,
  base: string,
  head: string,
): Promise<Map<string, number[]>> {
  const diff = await git(repoDir, "diff", "-U0", "--no-color", base, head);
  const byFile = new Map<string, number[]>();
  let current: string | null = null;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      current = line.slice(6);
      byFile.set(current, []);
      continue;
    }
    if (!current || !line.startsWith("@@")) continue;
    const match = HUNK_RANGE.exec(line);
    if (!match?.[1]) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    const lines = byFile.get(current) ?? [];
    for (let i = 0; i < count; i += 1) lines.push(start + i - 1); // 0-based
    byFile.set(current, lines);
  }
  return byFile;
}

/** Innermost callable enclosing each changed line, as call-hierarchy items. */
async function levelZero(
  client: LspClient,
  repoDir: string,
  path: string,
  lines: readonly number[],
): Promise<{ items: CallHierarchyItem[]; reason?: string }> {
  const language = languageOf(path);
  if (!language) return { items: [], reason: "no language server covers this file" };

  const absolute = `${repoDir}/${path}`;
  let symbols: readonly DocumentSymbol[];
  try {
    symbols = flatten(await client.documentSymbols(absolute, language));
  } catch (error) {
    return { items: [], reason: error instanceof Error ? error.message : String(error) };
  }

  const enclosing = new Map<string, DocumentSymbol>();
  for (const line of lines) {
    const candidates = symbols.filter(
      (symbol) =>
        CALLABLE.has(symbol.kind) &&
        symbol.range.start.line <= line &&
        line <= symbol.range.end.line,
    );
    if (candidates.length === 0) continue;
    // Innermost wins: the smallest range containing the line.
    candidates.sort(
      (a, b) => a.range.end.line - a.range.start.line - (b.range.end.line - b.range.start.line),
    );
    const innermost = candidates[0];
    if (innermost) enclosing.set(`${innermost.name}:${innermost.range.start.line}`, innermost);
  }

  if (enclosing.size === 0) {
    return { items: [], reason: "no callable encloses the changed lines" };
  }

  const items: CallHierarchyItem[] = [];
  for (const symbol of enclosing.values()) {
    try {
      items.push(
        ...(await client.prepareCallHierarchy(absolute, language, symbol.selectionRange.start)),
      );
    } catch {
      // One symbol refusing does not invalidate the rest of the file.
    }
  }
  return items.length > 0 ? { items } : { items: [], reason: "no call-hierarchy identity" };
}

export interface RadiusOptions {
  readonly repoDir: string;
  readonly base: string;
  readonly head: string;
  readonly buildTags: readonly string[];
  /** Every file in the repo, so unreached code can be told from unanalysable. */
  readonly allPaths: readonly string[];
}

/** Walks the radius, yielding one batch per ring so the client can stream. */
export async function* walkBlastRadius(
  options: RadiusOptions,
): AsyncGenerator<RingProgress, void, void> {
  const { repoDir, base, head, buildTags, allPaths } = options;
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  const changed = await changedLinesByFile(repoDir, base, head);
  const ringByPath = new Map<string, FileRing>();
  for (const path of changed.keys()) ringByPath.set(path, { path, kind: "changed" });

  const frontier: CallHierarchyItem[] = [];
  const seen = new Set<string>();
  const unknownReasons = new Map<string, string>();

  for (const [path, lines] of changed) {
    const language = languageOf(path);
    if (!language || !specFor(language)) continue;
    const client = serverFor(repoDir, language, buildTags);
    if (!client) continue;
    const { items, reason } = await levelZero(client, repoDir, path, lines);
    if (reason) unknownReasons.set(path, reason);
    for (const item of items) {
      if (seen.has(keyOf(item))) continue;
      seen.add(keyOf(item));
      frontier.push(item);
    }
  }

  yield {
    ring: 0,
    files: [...ringByPath.values()],
    symbols: seen.size,
    elapsedMs: elapsed(),
    done: false,
  };

  let current = frontier;
  let capped: string | undefined;

  for (let ring = 1; current.length > 0; ring += 1) {
    if (seen.size >= MAX_SYMBOLS) {
      capped = `radius capped at ring ${ring - 1} - ${MAX_SYMBOLS} symbols`;
      break;
    }
    if (elapsed() >= MAX_ELAPSED_MS) {
      capped = `radius capped at ring ${ring - 1} - ${Math.round(MAX_ELAPSED_MS / 1000)}s`;
      break;
    }

    const next: CallHierarchyItem[] = [];
    const batch: FileRing[] = [];

    for (const item of current) {
      const path = pathOf(item.uri, repoDir);
      const language = path ? languageOf(path) : null;
      if (!path || !language) continue;
      const client = serverFor(repoDir, language, buildTags);
      if (!client) continue;

      let callers: readonly CallHierarchyItem[] = [];
      try {
        callers = await client.incomingCalls(item);
      } catch {
        continue; // a refusal on one symbol is not a failure of the walk
      }

      for (const caller of callers) {
        if (seen.has(keyOf(caller))) continue;
        seen.add(keyOf(caller));
        next.push(caller);

        const callerPath = pathOf(caller.uri, repoDir);
        if (!callerPath || ringByPath.has(callerPath)) continue;
        const entry: FileRing = { path: callerPath, kind: "ring", ring };
        ringByPath.set(callerPath, entry);
        batch.push(entry);
      }
    }

    if (next.length === 0 && batch.length === 0) break;
    yield { ring, files: batch, symbols: seen.size, elapsedMs: elapsed(), done: false };
    current = next;
  }

  // Everything the walk never reached.
  const rest: FileRing[] = [];
  for (const path of allPaths) {
    if (ringByPath.has(path)) continue;
    const language = languageOf(path);
    rest.push({
      path,
      kind: !language || !specFor(language) ? "not-applicable" : "out-of-range",
    });
  }
  for (const [path, reason] of unknownReasons) {
    if (ringByPath.get(path)?.kind === "changed") rest.push({ path, kind: "unknown", reason });
  }

  yield {
    ring: -1,
    files: rest,
    symbols: seen.size,
    elapsedMs: elapsed(),
    done: true,
    ...(capped ? { capped } : {}),
  };
}
