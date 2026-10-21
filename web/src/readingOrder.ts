import type { CallEdge } from "../../server/rings";

/**
 * A reading order for the changed files, from who calls whom among them.
 *
 * `callees` reads the building blocks before what is built from them, so each
 * file meets only code you have already seen. `entries` starts where a request
 * comes in and works down. Files that neither call nor are called by another
 * changed file — docs, config, a leaf nobody else touched — go last, in their
 * original order: the graph says nothing about them.
 */

export type ReadingOrder = "path" | "callees" | "entries";

export const ORDER_LABEL: Readonly<Record<ReadingOrder, string>> = {
  path: "by path",
  callees: "callees first",
  entries: "entry points first",
};

/**
 * Callees before callers. A cycle is broken at the file with the fewest calls
 * still unread, earliest first, so the order is total and stable.
 */
function calleesFirst(paths: readonly string[], edges: readonly CallEdge[]): string[] {
  const position = new Map(paths.map((path, index) => [path, index]));
  const calls = new Map<string, Set<string>>(paths.map((path) => [path, new Set()]));
  for (const { from, to } of edges) {
    if (from !== to && position.has(from) && position.has(to)) calls.get(from)!.add(to);
  }

  const placed = new Set<string>();
  const order: string[] = [];
  const unread = (path: string) => [...calls.get(path)!].filter((to) => !placed.has(to)).length;

  while (order.length < paths.length) {
    const remaining = paths.filter((path) => !placed.has(path));
    const ready = remaining.filter((path) => unread(path) === 0);
    const next =
      ready[0] ??
      [...remaining].sort((a, b) => unread(a) - unread(b) || position.get(a)! - position.get(b)!)[0]!;
    placed.add(next);
    order.push(next);
  }
  return order;
}

export function orderFiles<T extends { readonly path: string }>(
  files: readonly T[],
  edges: readonly CallEdge[],
  order: ReadingOrder,
): readonly T[] {
  if (order === "path" || edges.length === 0) return files;

  const linked = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
  const connected = files.filter((file) => linked.has(file.path)).map((file) => file.path);
  const ranked = calleesFirst(connected, edges);
  const sequence = order === "callees" ? ranked : [...ranked].reverse();

  const byPath = new Map(files.map((file) => [file.path, file]));
  return [
    ...sequence.map((path) => byPath.get(path)!),
    ...files.filter((file) => !linked.has(file.path)),
  ];
}
