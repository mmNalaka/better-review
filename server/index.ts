import { SERVER_PORT } from "./config";
import {
  changedFiles,
  commits,
  fetchPrHead,
  findClone,
  listTree,
  mergeBase,
  readBlob,
} from "./git";
import { fetchPullRequest, parsePrRef } from "./github";
import { findDefinition, UnsupportedLanguageError } from "./lsp";
import { ensureWorktree } from "./worktree";
import { buildTagsFor } from "./buildtags";
import { fileDiff } from "./diff";
import { walkBlastRadius } from "./rings";
import type { ReviewPayload } from "./types";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const fail = (message: string, status: number) => json({ error: message }, status);

class BadRequest extends Error {}

/**
 * The clone is resolved here from owner/repo, never passed in by the client.
 * Ticket 12: a client-supplied absolute path is neither portable across
 * machines (trails are shareable URLs) nor something to accept from outside.
 */
async function resolveClone(url: URL): Promise<{ dir: string; owner: string; repo: string }> {
  const owner = url.searchParams.get("owner");
  const repo = url.searchParams.get("repo");
  if (!owner || !repo) throw new BadRequest("Missing owner or repo");
  const dir = await findClone(owner, repo);
  if (!dir) throw new BadRequest(`No local clone of ${owner}/${repo} found`);
  return { dir, owner, repo };
}

function requireRelativePath(url: URL): string {
  const path = url.searchParams.get("path");
  if (!path) throw new BadRequest("Missing path");
  if (path.startsWith("/") || path.split("/").includes("..")) {
    throw new BadRequest("Path must be repo-relative and may not traverse upward");
  }
  return path;
}

function requireInteger(url: URL, name: string): number {
  const raw = url.searchParams.get(name);
  const value = Number(raw);
  if (raw === null || !Number.isSafeInteger(value) || value < 0) {
    throw new BadRequest(`${name} must be a non-negative integer`);
  }
  return value;
}

/**
 * Reviews are cached per head sha: the definition route needs the changed-file
 * list to work out which build tags to give the language server, and
 * recomputing a diff on every click would be wasteful.
 */
const reviewCache = new Map<string, ReviewPayload>();

const cacheKey = (owner: string, repo: string, number: number, headSha: string) =>
  `${owner}/${repo}#${number}@${headSha}`;

async function loadReview(ref: string): Promise<ReviewPayload> {
  const parsed = parsePrRef(ref);
  if (!parsed) throw new BadRequest(`Not a pull request reference: "${ref}"`);

  const { owner, repo, number } = parsed;
  const clonePath = await findClone(owner, repo);
  if (!clonePath) {
    throw new BadRequest(
      `No local clone of ${owner}/${repo} found. Clone it, or set BR_CLONE_ROOTS.`,
    );
  }

  const meta = await fetchPullRequest(owner, repo, number);
  const headSha = await fetchPrHead(clonePath, number);
  const base = await mergeBase(clonePath, meta.baseRef, headSha);

  const [changed, log] = await Promise.all([
    changedFiles(clonePath, base, headSha),
    commits(clonePath, base, headSha),
  ]);

  const payload = { pr: { ...meta, headSha, mergeBase: base }, changed, commits: log };
  reviewCache.set(cacheKey(owner, repo, number, headSha), payload);
  return payload;
}

const routes: Record<string, (url: URL) => Promise<Response>> = {
  "/api/review": async (url) => {
    const ref = url.searchParams.get("pr");
    if (!ref) throw new BadRequest("Missing ?pr= — pass a PR URL or owner/repo#123");
    return json(await loadReview(ref));
  },

  "/api/blob": async (url) => {
    const { dir } = await resolveClone(url);
    const rev = url.searchParams.get("rev");
    if (!rev) throw new BadRequest("Missing rev");
    const path = requireRelativePath(url);
    return json({ path, text: await readBlob(dir, rev, path) });
  },

  /**
   * One hop. Resolves the symbol at a position to where it is defined,
   * against a worktree materialised at the PR head.
   */
  /** Hunks for one changed file, computed from the merge-base diff. */
  "/api/diff": async (url) => {
    const { dir, owner, repo } = await resolveClone(url);
    const path = requireRelativePath(url);
    const number = requireInteger(url, "pr");
    const rev = url.searchParams.get("rev");
    if (!rev) throw new BadRequest("Missing rev");

    const cached = reviewCache.get(cacheKey(owner, repo, number, rev));
    if (!cached) throw new BadRequest("Open the pull request first");
    const file = cached.changed.find((entry) => entry.path === path);
    if (!file) throw new BadRequest(`${path} is not changed by this pull request`);

    return json(
      await fileDiff(dir, cached.pr.mergeBase, rev, path, file.kind, cached.commits),
    );
  },

  /**
   * The blast radius, streamed. Ticket 10: computed eagerly on PR open, one
   * server-sent event per ring, so the explorer fills in as rings resolve
   * rather than waiting for the whole walk.
   */
  "/api/rings": async (url) => {
    const { dir, owner, repo } = await resolveClone(url);
    const number = requireInteger(url, "pr");
    const rev = url.searchParams.get("rev");
    if (!rev) throw new BadRequest("Missing rev");

    const cached = reviewCache.get(cacheKey(owner, repo, number, rev));
    if (!cached) throw new BadRequest("Open the pull request first");

    const worktree = await ensureWorktree(dir, owner, repo, number, rev);
    const buildTags = await buildTagsFor(
      worktree.dir,
      cached.changed.map((file) => file.path),
    );
    const allPaths = await listTree(worktree.dir, rev);

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (progress: unknown) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));
        try {
          for await (const progress of walkBlastRadius({
            repoDir: worktree.dir,
            base: cached.pr.mergeBase,
            head: rev,
            buildTags,
            allPaths,
          })) {
            send(progress);
          }
        } catch (error) {
          send({ error: error instanceof Error ? error.message : String(error), done: true });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  },

  "/api/definition": async (url) => {
    const { dir, owner, repo } = await resolveClone(url);
    const path = requireRelativePath(url);
    const number = requireInteger(url, "pr");
    const rev = url.searchParams.get("rev");
    if (!rev) throw new BadRequest("Missing rev");
    const position = { line: requireInteger(url, "line"), character: requireInteger(url, "character") };
    // Language servers read real files, so the PR head is materialised in a
    // detached worktree of our own. The user's working tree is never touched.
    const worktree = await ensureWorktree(dir, owner, repo, number, rev);
    const cached = reviewCache.get(cacheKey(owner, repo, number, rev));
    const buildTags = cached
      ? await buildTagsFor(worktree.dir, cached.changed.map((file) => file.path))
      : [];
    try {
      return json(await findDefinition(worktree.dir, path, position, buildTags));
    } catch (error) {
      if (error instanceof UnsupportedLanguageError) {
        return json({
          definitions: [],
          external: false,
          unsupported: true,
          reason: error.message,
        });
      }
      throw error;
    }
  },
};

Bun.serve({
  port: SERVER_PORT,
  idleTimeout: 120, // gopls cold start can exceed the default
  async fetch(request) {
    const url = new URL(request.url);
    const route = routes[url.pathname];
    if (!route) return fail(`No route for ${url.pathname}`, 404);
    try {
      return await route(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${url.pathname}]`, message);
      return fail(message, error instanceof BadRequest ? 400 : 502);
    }
  },
});

console.log(`better-review server on http://localhost:${SERVER_PORT}`);
