/**
 * The trail, per ticket 07: a linear chain that truncates on divergence.
 * It lives in the URL, so a reload restores the walk and a path can be shared.
 */

export type Ring = "changed" | "unknown";

export interface Hop {
  readonly path: string;
  readonly line: number;
  /** `changed` when the PR touched this file; `unknown` until rings are computed. */
  readonly ring: Ring;
  /** Set when a restored hop no longer resolves to a symbol. */
  readonly stale?: boolean;
}

/** Opening a file from the explorer ends the old trail and starts a new one. */
export const startTrail = (hop: Hop): readonly Hop[] => [hop];

/** Diverging from a mid-trail hop discards everything after it. */
export const pushHop = (trail: readonly Hop[], at: number, hop: Hop): readonly Hop[] => [
  ...trail.slice(0, at + 1),
  hop,
];

export const truncateTo = (trail: readonly Hop[], at: number): readonly Hop[] =>
  trail.slice(0, at + 1);

export function encodeTrail(trail: readonly Hop[]): string {
  return trail.map((hop) => `${hop.path}:${hop.line}`).join(",");
}

export function decodeTrail(raw: string | null, changedPaths: ReadonlySet<string>): readonly Hop[] {
  if (!raw) return [];
  return raw
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
}
