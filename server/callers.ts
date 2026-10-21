import { readFileSync } from "node:fs";

import {
  serverFor,
  UnsupportedLanguageError,
  type IncomingCall,
  type Location,
  type Position,
} from "./lsp";
import { languageOf, missingServerMessage, specFor } from "./servers";

/**
 * Who calls this? The other half of a hop: definition goes down to what a line
 * uses, callers go up to what uses it.
 *
 * Call hierarchy first, because it names the calling function and points at
 * the call itself. A symbol that is not callable — a type, a constant, a
 * field — has no hierarchy, so it falls back to plain references.
 */

/** A walk this wide is a list nobody reads; say so rather than truncating quietly. */
export const SITES_MAX = 500;

const FILE_URI_PREFIX = "file://";

/** What a call made outside any function is attributed to. */
export const TOP_LEVEL = "top level";

export interface CallSite {
  /** Repo-relative. */
  readonly path: string;
  /** 0-based, as the language server counts. */
  readonly line: number;
  readonly character: number;
  /** The enclosing function making the call. Null for a plain reference. */
  readonly caller: string | null;
  /** The source line, trimmed, so the list can be read without opening each file. */
  readonly preview: string;
}

export interface CallersResult {
  /** The symbol asked about, when the server could name it. */
  readonly symbol: string | null;
  readonly via: "calls" | "references";
  readonly sites: readonly CallSite[];
  /** Uses outside the repo — dependencies, generated code elsewhere. */
  readonly external: number;
  /** Set when SITES_MAX cut the list. */
  readonly capped: boolean;
  /** The server refused; its own words. */
  readonly unknown?: string;
}

export type ReadLine = (path: string, line: number) => string;

function repoPath(uri: string, repoDir: string): string | null {
  const absolute = decodeURIComponent(
    uri.startsWith(FILE_URI_PREFIX) ? uri.slice(FILE_URI_PREFIX.length) : uri,
  );
  return absolute.startsWith(`${repoDir}/`) ? absolute.slice(repoDir.length + 1) : null;
}

const bySpot = (a: CallSite, b: CallSite) =>
  a.path.localeCompare(b.path) || a.line - b.line || a.character - b.character;

/** One site per call, not per caller: a function calling twice is two places to read. */
export function sitesFromCalls(
  calls: readonly IncomingCall[],
  repoDir: string,
  readLine: ReadLine,
): { sites: CallSite[]; external: number } {
  const sites: CallSite[] = [];
  let external = 0;
  for (const call of calls) {
    const path = repoPath(call.from.uri, repoDir);
    if (!path) {
      external += 1;
      continue;
    }
    // A server may omit the ranges; the caller's own name is the fallback spot.
    const ranges = call.fromRanges.length > 0 ? call.fromRanges : [call.from.selectionRange];
    // A call at module level comes from the file itself, which tsgo names by
    // its absolute path: not a function, and not something to show.
    const caller = call.from.name.startsWith("/") ? TOP_LEVEL : call.from.name;
    for (const range of ranges) {
      const { line, character } = range.start;
      sites.push({ path, line, character, caller, preview: readLine(path, line) });
    }
  }
  return { sites: sites.sort(bySpot), external };
}

export function sitesFromReferences(
  locations: readonly Location[],
  repoDir: string,
  readLine: ReadLine,
): { sites: CallSite[]; external: number } {
  const sites: CallSite[] = [];
  let external = 0;
  const seen = new Set<string>();
  for (const location of locations) {
    const path = repoPath(location.uri, repoDir);
    if (!path) {
      external += 1;
      continue;
    }
    const { line, character } = location.range.start;
    const key = `${path}:${line}:${character}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sites.push({ path, line, character, caller: null, preview: readLine(path, line) });
  }
  return { sites: sites.sort(bySpot), external };
}

/** Reads each file once, however many sites it has. */
function lineReader(repoDir: string): ReadLine {
  const files = new Map<string, readonly string[]>();
  return (path, line) => {
    let lines = files.get(path);
    if (!lines) {
      try {
        lines = readFileSync(`${repoDir}/${path}`, "utf8").split("\n");
      } catch {
        lines = []; // a file the server knows and the worktree lacks: no preview
      }
      files.set(path, lines);
    }
    return (lines[line] ?? "").trim();
  };
}

const capped = (sites: readonly CallSite[]) => ({
  sites: sites.slice(0, SITES_MAX),
  capped: sites.length > SITES_MAX,
});

export async function findCallers(
  repoDir: string,
  relativePath: string,
  position: Position,
  buildTags: readonly string[] = [],
): Promise<CallersResult> {
  const language = languageOf(relativePath);
  if (!language) throw new UnsupportedLanguageError(`No language server covers ${relativePath}`);
  if (!specFor(language)) throw new UnsupportedLanguageError(missingServerMessage(language));
  const client = serverFor(repoDir, language, buildTags);
  if (!client) throw new UnsupportedLanguageError(missingServerMessage(language));

  const absolute = `${repoDir}/${relativePath}`;
  const readLine = lineReader(repoDir);
  try {
    const items = await client.prepareCallHierarchy(absolute, language, position);
    if (items.length > 0) {
      const calls = (await Promise.all(items.map((item) => client.incomingCallSites(item)))).flat();
      const { sites, external } = sitesFromCalls(calls, repoDir, readLine);
      return { symbol: items[0]?.name ?? null, via: "calls", external, ...capped(sites) };
    }
    const { sites, external } = sitesFromReferences(
      await client.references(absolute, language, position),
      repoDir,
      readLine,
    );
    return { symbol: null, via: "references", external, ...capped(sites) };
  } catch (error) {
    // As with definitions: a refusal is the server's answer, not the app failing.
    const detail = error instanceof Error ? error.message : String(error);
    return { symbol: null, via: "calls", sites: [], external: 0, capped: false, unknown: detail };
  }
}
