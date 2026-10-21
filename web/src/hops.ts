/**
 * The trail, per ticket 07: a linear chain that truncates on divergence.
 * It lives in the URL, so a reload restores the walk and a path can be shared.
 */

export type Ring = "changed" | "unknown";

export interface Hop {
  readonly path: string;
  /** Where you are in this file: where you landed, then where you clicked to leave it. */
  readonly line: number;
  /** `changed` when the PR touched this file; `unknown` until rings are computed. */
  readonly ring: Ring;
  /** Set when a restored hop no longer resolves to a symbol. */
  readonly stale?: boolean;
}

/**
 * The trail and where you stand on it. Stepping back moves `at` and keeps the
 * hops ahead, so you can step forward again until you diverge.
 */
export interface Walk {
  readonly hops: readonly Hop[];
  readonly at: number;
}

export const NO_WALK: Walk = { hops: [], at: -1 };

export const hereOf = (walk: Walk): Hop | null => walk.hops[walk.at] ?? null;

/** Opening a file from the explorer ends the old trail and starts a new one. */
export const startTrail = (hop: Hop): Walk => ({ hops: [hop], at: 0 });

/**
 * A jump from `fromLine` of the current hop. The line is kept on the hop you
 * leave, so coming back lands where you clicked rather than at the top.
 * Diverging from a hop behind you discards everything that was ahead of it.
 */
export function pushHop(walk: Walk, fromLine: number, hop: Hop): Walk {
  const here = hereOf(walk);
  const kept = walk.hops.slice(0, Math.max(walk.at, 0));
  const left = here ? [...kept, { ...here, line: fromLine }] : kept;
  return { hops: [...left, hop], at: left.length };
}

/** Stand on another hop of the same trail; out of range stays put. */
export function moveTo(walk: Walk, index: number): Walk {
  const at = Math.max(0, Math.min(walk.hops.length - 1, index));
  return at === walk.at ? walk : { ...walk, at };
}

/** URL params: `trail` lists the hops, `at` is left out when you stand on the last. */
export function encodeTrail(walk: Walk): { trail: string | null; at: string | null } {
  if (walk.hops.length === 0) return { trail: null, at: null };
  return {
    trail: walk.hops.map((hop) => `${hop.path}:${hop.line}`).join(","),
    at: walk.at === walk.hops.length - 1 ? null : String(walk.at),
  };
}

export function decodeTrail(
  raw: string | null,
  rawAt: string | null,
  changedPaths: ReadonlySet<string>,
): Walk {
  if (!raw) return NO_WALK;
  const hops = raw
    .split(",")
    .map((entry) => {
      const cut = entry.lastIndexOf(":");
      if (cut < 1) return null;
      const path = entry.slice(0, cut);
      const line = Number(entry.slice(cut + 1));
      if (!Number.isSafeInteger(line) || line < 0) return null;
      return { path, line, ring: changedPaths.has(path) ? "changed" : "unknown" } satisfies Hop;
    })
    .filter((hop): hop is Hop => hop !== null);
  if (hops.length === 0) return NO_WALK;
  const at = Number(rawAt);
  const last = hops.length - 1;
  return { hops, at: rawAt !== null && Number.isSafeInteger(at) ? Math.max(0, Math.min(last, at)) : last };
}
