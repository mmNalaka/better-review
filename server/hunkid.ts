import { createHash } from "node:crypto";

/**
 * A hunk's identity, per ticket 04: the hash of its own added and removed
 * lines, line numbers excluded, so a rebase that only shifts code keeps the
 * mark and a rebase that rewrites it does not. Context lines are excluded too —
 * a change to the code around your hunk is not a change to your hunk.
 *
 * The server is the only thing that hashes. Ids travel on the diff payload so
 * the client can never disagree about what a mark is attached to.
 */

export interface HashableLine {
  readonly kind: "context" | "added" | "removed";
  readonly text: string;
}

/** 64 bits, hex: ample for the few hundred hunks a pull request has. */
const WIDTH = 16;

const MARKER: Readonly<Record<HashableLine["kind"], string>> = {
  added: "+",
  removed: "-",
  context: " ",
};

export function hunkId(lines: readonly HashableLine[]): string {
  const digest = createHash("sha256");
  for (const line of lines) {
    if (line.kind === "context") continue;
    // The marker is part of the input: adding "x" and deleting "x" are
    // different hunks. The newline terminator keeps a text that contains one
    // from imitating two lines.
    digest.update(`${MARKER[line.kind]}${line.text}\n`);
  }
  return digest.digest("hex").slice(0, WIDTH);
}
