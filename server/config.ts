import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SERVER_PORT = Number(process.env.BR_SERVER_PORT ?? 4317);
export const WEB_PORT = Number(process.env.BR_WEB_PORT ?? 5173);

/** Directories scanned to find a local clone for a given owner/repo. */
export const CLONE_ROOTS: readonly string[] = (
  process.env.BR_CLONE_ROOTS ?? join(homedir(), "code")
)
  .split(":")
  .filter(Boolean);

/**
 * PR heads are fetched into this private ref namespace rather than a branch,
 * so nothing the user might have checked out is ever touched. See ticket 02.
 */
export const PR_REF_NAMESPACE = "refs/prreview";

/**
 * Where PR worktrees are materialised. Language servers need real files on
 * disk (ticket 02), and the user's own working tree is never touched.
 */
export const WORKTREE_ROOT =
  process.env.BR_WORKTREE_ROOT ??
  join(homedir(), "Library", "Application Support", "better-review", "worktrees");

/**
 * Where review marks live — outside the reviewed repo, so a re-clone or a
 * `git clean` cannot take your progress with it. Ticket 04.
 */
export const MARKS_DIR =
  process.env.BR_MARKS_DIR ??
  join(homedir(), "Library", "Application Support", "better-review", "marks");

/**
 * The built client. Packaged, the server serves this itself so the whole app
 * is one process on one port; in development Vite serves it instead and this
 * directory simply does not exist.
 */
/* `import.meta.dir` is Bun's; this file is also loaded by Node when Vite reads
   its config, where only the URL form exists. */
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export const WEB_DIST = process.env.BR_WEB_DIST ?? join(PACKAGE_ROOT, "web", "dist");
