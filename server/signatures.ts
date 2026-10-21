/**
 * Did a function's signature change? Pure: given the head file, its symbols,
 * and the PR's change blocks, say which callables had their header rewritten
 * and what the header read before.
 *
 * "Header" is the declaration up to where the body opens — the first line
 * carrying `{` or `=>`, or ending in `:` for Python. Crude, language-agnostic,
 * and enough to tell "the parameters moved" from "the body moved".
 */

import type { DocumentSymbol } from "./lsp";

/** One `-U0` hunk: a contiguous run of removed lines replaced by added lines. */
export interface ChangeBlock {
  /**
   * 0-based head line where the block sits. For a pure deletion, the head
   * line the removed lines used to precede.
   */
  readonly at: number;
  readonly removed: readonly string[];
  readonly added: readonly string[];
}

const FILE_HEADER = "+++ b/";
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/** Every file's change blocks, from one `git diff -U0`. */
export function parseBlocks(diff: string): ReadonlyMap<string, readonly ChangeBlock[]> {
  const byFile = new Map<string, ChangeBlock[]>();
  let blocks: ChangeBlock[] | null = null;
  let current: { at: number; removed: string[]; added: string[] } | null = null;

  const close = () => {
    if (current && blocks) blocks.push(current);
    current = null;
  };

  for (const line of diff.split("\n")) {
    if (line.startsWith(FILE_HEADER)) {
      close();
      blocks = [];
      byFile.set(line.slice(FILE_HEADER.length), blocks);
      continue;
    }
    if (line.startsWith("diff --git")) {
      close();
      blocks = null;
      continue;
    }
    const hunk = HUNK.exec(line);
    if (hunk?.[1] && blocks) {
      close();
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      // `+N,0` names the line *before* the gap; `+N,M` the first added line.
      current = { at: count === 0 ? start : start - 1, removed: [], added: [] };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("-") && !line.startsWith("---")) current.removed.push(line.slice(1));
    else if (line.startsWith("+") && !line.startsWith("+++")) current.added.push(line.slice(1));
  }
  close();
  return byFile;
}

/** Function, method, constructor. */
const CALLABLE = new Set([6, 9, 12]);
/** Variable, constant — callable when they hold an arrow or function expression. */
const BINDING = new Set([13, 14]);

/** A header longer than this is a body we failed to see the start of. */
const HEADER_MAX = 15;

const opensBody = (line: string): boolean =>
  line.includes("{") || line.includes("=>") || line.trimEnd().endsWith(":");

/** Lines up to and including the one that opens the body. */
export function cutHeader(lines: readonly string[]): readonly string[] {
  const end = lines.findIndex(opensBody);
  return lines.slice(0, end === -1 ? HEADER_MAX : Math.min(end + 1, HEADER_MAX));
}

/** 0-based, inclusive head lines of a symbol's header. */
export function headerSpan(
  fileLines: readonly string[],
  symbol: DocumentSymbol,
): { readonly start: number; readonly end: number } {
  const start = symbol.range.start.line;
  const last = Math.min(symbol.range.end.line, start + HEADER_MAX - 1);
  for (let line = Math.max(start, symbol.selectionRange.start.line); line <= last; line += 1) {
    if (opensBody(fileLines[line] ?? "")) return { start, end: line };
  }
  return { start, end: last };
}

const blockEnd = (block: ChangeBlock) => block.at + block.added.length - 1;

/** A deletion touches the lines either side of its gap. */
const touches = (block: ChangeBlock, start: number, end: number): boolean =>
  block.added.length === 0
    ? block.at - 1 <= end && block.at >= start
    : block.at <= end && blockEnd(block) >= start;

/**
 * From the line that names the symbol: a block that starts above the header
 * brings a comment or a neighbour's tail with it, which is not the signature.
 */
export function fromName(lines: readonly string[], name: string): readonly string[] {
  const at = lines.findIndex((line) => line.includes(name));
  return at === -1 ? lines : lines.slice(at);
}

/**
 * The header as it read at the base: walk the head header and put back what
 * each block removed in place of what it added. Blocks that run on into the
 * body bring body lines with them, so the result is cut at the body again.
 */
export function oldHeader(
  fileLines: readonly string[],
  span: { readonly start: number; readonly end: number },
  blocks: readonly ChangeBlock[],
  name: string,
): readonly string[] {
  const out: string[] = [];
  for (let line = span.start; line <= span.end; line += 1) {
    // A block that began above the header gives its old lines at the top.
    for (const block of blocks) {
      if (Math.max(block.at, span.start) === line && touches(block, span.start, span.end)) {
        out.push(...block.removed);
      }
    }
    const inside = blocks.some(
      (block) => block.added.length > 0 && block.at <= line && line <= blockEnd(block),
    );
    if (!inside) out.push(fileLines[line] ?? "");
  }
  return cutHeader(fromName(out, name));
}

/** Whitespace is never the signature; a lone trailing brace is not either. */
export const normalise = (lines: readonly string[]): string =>
  lines.join(" ").replace(/\s+/g, " ").replace(/\s*\{\s*$/, "").trim();

/**
 * Up to the arrow of `= (a) => body`: a one-line arrow keeps its body on the
 * header line, and a new body is not a new signature. The arrow is the first
 * one outside brackets — `(cb: () => void) =>` has one inside first.
 */
export function arrowHead(text: string): string {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.startsWith("=>", i)) {
      if (depth === 0) return text.slice(0, i + 2);
      i += 1; // past the `>`, which is not a closing bracket
      continue;
    }
    const char = text[i] ?? "";
    if ("([{<".includes(char)) depth += 1;
    else if (")]}>".includes(char)) depth = Math.max(0, depth - 1);
  }
  return text;
}

/** `const f = (a) => body` up to its arrow; the binding's own `=` comes first. */
function bindingHead(text: string): string {
  const assign = text.indexOf("=");
  return assign === -1 ? text : text.slice(0, assign + 1) + arrowHead(text.slice(assign + 1));
}

export interface SignatureChange {
  readonly name: string;
  /** 0-based position of the name — what call hierarchy is asked about. */
  readonly line: number;
  readonly character: number;
  readonly before: string;
  readonly after: string;
}

function flatten(symbols: readonly DocumentSymbol[]): DocumentSymbol[] {
  return symbols.flatMap((symbol) => [symbol, ...flatten(symbol.children ?? [])]);
}

/** `= (a) =>`, `= async x =>`, `= function` — a binding whose value is itself a function. */
const FUNCTION_VALUE =
  /=\s*(?:async\s+)?(?:function\b|<[^>]*>\s*\(|\([^)]*\)\s*(?::[^=]+)?=>|[\w$]+\s*=>)/;

/**
 * Language servers name anonymous functions — `find() callback`, `<function>`.
 * Nobody calls those by name, so they have no callers to leave behind.
 */
const ANONYMOUS = /\s|<|>/;

function isCallable(symbol: DocumentSymbol, header: string): boolean {
  if (ANONYMOUS.test(symbol.name)) return false;
  if (CALLABLE.has(symbol.kind)) return true;
  return BINDING.has(symbol.kind) && FUNCTION_VALUE.test(header);
}

/**
 * Callables whose header the PR rewrote. A header with no old text is a new
 * function: everything that calls it is part of the PR already, so it is not
 * reported.
 */
export function signatureChanges(
  fileLines: readonly string[],
  symbols: readonly DocumentSymbol[],
  blocks: readonly ChangeBlock[],
): readonly SignatureChange[] {
  const changes: SignatureChange[] = [];
  for (const symbol of flatten(symbols)) {
    const span = headerSpan(fileLines, symbol);
    if (!blocks.some((block) => touches(block, span.start, span.end))) continue;

    const header = normalise(fromName(fileLines.slice(span.start, span.end + 1), symbol.name));
    if (!isCallable(symbol, header)) continue;

    const binding = BINDING.has(symbol.kind);
    const after = binding ? bindingHead(header) : header;
    const old = normalise(oldHeader(fileLines, span, blocks, symbol.name));
    const before = binding ? bindingHead(old) : old;
    if (before === "" || before === after) continue;

    changes.push({
      name: symbol.name,
      line: symbol.selectionRange.start.line,
      character: symbol.selectionRange.start.character,
      before,
      after,
    });
  }
  return changes;
}
