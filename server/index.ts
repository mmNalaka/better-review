import { MARKS_DIR, SERVER_PORT, WEB_DIST } from "./config";
import {
  changedFiles,
  changedFilesInCommit,
  commits,
  fetchPrHead,
  findClone,
  listTree,
  mergeBase,
  parentOf,
  readBlob,
} from "./git";
import { fetchPullRequest, parsePrRef, postReview } from "./github";
import { planReview, REVIEW_EVENTS, reviewSubmission, type ReviewEvent } from "./publish";
import { MarkError, type PrRef } from "./markmodel";
import { readMarks, writeMarks } from "./markstore";
import { findDefinition, UnsupportedLanguageError } from "./lsp";
import { ensureWorktree } from "./worktree";
import { buildTagsFor } from "./buildtags";
import { hasBuild, serveAsset } from "./static";
import { allHunks, fileDiff, indexHunks } from "./diff";
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

/** The pull request a request is about. Marks need no clone, only a name. */
function requirePr(url: URL): PrRef {
  const owner = url.searchParams.get("owner");
  const repo = url.searchParams.get("repo");
  if (!owner || !repo) throw new BadRequest("Missing owner or repo");
  return { owner, repo, number: requireInteger(url, "pr") };
}

function requireRelativePath(url: URL): string {
  const path = url.searchParams.get("path");
  if (!path) throw new BadRequest("Missing path");
  if (path.startsWith("/") || path.split("/").includes("..")) {
    throw new BadRequest("Path must be repo-relative and may not traverse upward");
  }
  return path;
}

const SHA = /^[0-9a-f]{7,40}$/;

/** Optional `commit=` — reviewing one commit rather than the whole PR. */
function optionalCommit(url: URL): string | null {
  const sha = url.searchParams.get("commit");
  if (!sha) return null;
  if (!SHA.test(sha)) throw new BadRequest("commit must be a hex sha");
  return sha;
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
  const headSha = await fetchPrHead(clonePath, owner, repo, number);
  const base = await mergeBase(clonePath, meta.baseRef, headSha);

  const [changed, log] = await Promise.all([
    changedFiles(clonePath, base, headSha),
    commits(clonePath, base, headSha),
  ]);

  const payload = { pr: { ...meta, headSha, mergeBase: base }, changed, commits: log };
  reviewCache.set(cacheKey(owner, repo, number, headSha), payload);
  return payload;
}

async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new BadRequest("Body must be JSON");
  }
}

const routes: Record<string, (url: URL, request: Request) => Promise<Response>> = {
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
   * Review marks: the whole file per pull request, read on open and written
   * back on every change. Small enough (a few hundred hunks) that a partial
   * update protocol would buy nothing but a way to disagree with itself.
   */
  "/api/marks": async (url, request) => {
    const pr = requirePr(url);
    if (request.method === "GET") return json(await readMarks(MARKS_DIR, pr));
    if (request.method !== "PUT") throw new BadRequest("Use GET or PUT");
    await writeMarks(MARKS_DIR, pr, (await jsonBody(request)) as never);
    return json(await readMarks(MARKS_DIR, pr));
  },

  /**
   * One hop. Resolves the symbol at a position to where it is defined,
   * against a worktree materialised at the PR head.
   */
  /**
   * The files one commit changed. Lets the explorer narrow to a single commit
   * without re-fetching the whole review.
   */
  "/api/commit-files": async (url) => {
    const { dir, owner, repo } = await resolveClone(url);
    const number = requireInteger(url, "pr");
    const rev = url.searchParams.get("rev");
    const sha = optionalCommit(url);
    if (!rev) throw new BadRequest("Missing rev");
    if (!sha) throw new BadRequest("Missing commit");

    const cached = reviewCache.get(cacheKey(owner, repo, number, rev));
    if (!cached) throw new BadRequest("Open the pull request first");
    if (!cached.commits.some((commit) => commit.sha.startsWith(sha))) {
      throw new BadRequest("That commit is not part of this pull request");
    }
    return json({ changed: await changedFilesInCommit(dir, sha) });
  },

  /**
   * Every hunk in the pull request, ids only, from one diff of the whole PR.
   * The explorer needs them for files it has not opened — review state is
   * derived from which ids are marked, and a per-file request each would be
   * one git invocation per changed file for a single column.
   */
  "/api/hunks": async (url) => {
    const { dir, owner, repo } = await resolveClone(url);
    const number = requireInteger(url, "pr");
    const rev = url.searchParams.get("rev");
    if (!rev) throw new BadRequest("Missing rev");

    const cached = reviewCache.get(cacheKey(owner, repo, number, rev));
    if (!cached) throw new BadRequest("Open the pull request first");
    return json(indexHunks(await allHunks(dir, cached.pr.mergeBase, rev)));
  },

  /** Hunks for one changed file, computed from the merge-base diff. */
  "/api/diff": async (url) => {
    const { dir, owner, repo } = await resolveClone(url);
    const path = requireRelativePath(url);
    const number = requireInteger(url, "pr");
    const rev = url.searchParams.get("rev");
    if (!rev) throw new BadRequest("Missing rev");

    const cached = reviewCache.get(cacheKey(owner, repo, number, rev));
    if (!cached) throw new BadRequest("Open the pull request first");
    const sha = optionalCommit(url);
    if (sha) {
      // One commit only: diff it against its own parent, and attribute to it.
      const commit = cached.commits.find((entry) => entry.sha.startsWith(sha));
      if (!commit) throw new BadRequest("That commit is not part of this pull request");
      const base = await parentOf(dir, sha);
      return json(await fileDiff(dir, base, sha, path, "M", [commit]));
    }

    const file = cached.changed.find((entry) => entry.path === path);
    if (!file) throw new BadRequest(`${path} is not changed by this pull request`);

    return json(
      await fileDiff(dir, cached.pr.mergeBase, rev, path, file.kind, cached.commits),
    );
  },

  /**
   * Publishing the notes as a GitHub pull request review — the only write this
   * app makes. A bare POST is a preview: `dryRun: false` has to be asked for,
   * so nothing reaches the pull request by accident.
   *
   * Anchors are recomputed here from a diff taken now, never from the line
   * numbers stored with the note.
   */
  "/api/publish": async (url, request) => {
    if (request.method !== "POST") throw new BadRequest("Use POST");
    const { dir, owner, repo } = await resolveClone(url);
    const number = requireInteger(url, "pr");
    const rev = url.searchParams.get("rev");
    if (!rev) throw new BadRequest("Missing rev");

    const cached = reviewCache.get(cacheKey(owner, repo, number, rev));
    if (!cached) throw new BadRequest("Open the pull request first");

    const sent = (await jsonBody(request)) as Record<string, unknown>;
    const event = sent.event;
    if (typeof event !== "string" || !REVIEW_EVENTS.includes(event as ReviewEvent)) {
      throw new BadRequest(`event must be one of ${REVIEW_EVENTS.join(", ")}`);
    }
    const summary = sent.body ?? "";
    if (typeof summary !== "string" || summary.length > 65536) {
      throw new BadRequest("body must be a string of at most 65536 characters");
    }

    const pr = { owner, repo, number };
    const marks = await readMarks(MARKS_DIR, pr);
    const plan = planReview(marks, await allHunks(dir, cached.pr.mergeBase, rev));
    const submission = reviewSubmission(rev, event as ReviewEvent, summary, plan);

    if (sent.dryRun !== false) return json({ posted: false, plan, submission });

    if (plan.comments.length === 0 && summary.trim() === "") {
      throw new BadRequest("Nothing to post: no unpublished notes, and no summary either");
    }

    const posted = await postReview(owner, repo, number, submission);

    // Stamp only what actually landed: a comment GitHub refused is still
    // unpublished, and must not look posted the next time round.
    const at = new Date().toISOString();
    const notes = { ...marks.notes };
    for (const index of posted.posted) {
      const key = plan.keys[index];
      const note = key === undefined ? undefined : notes[key];
      if (key !== undefined && note) notes[key] = { ...note, published: { at, url: posted.url } };
    }
    const stamped = { ...marks, notes };
    await writeMarks(MARKS_DIR, pr, stamped);

    return json({
      posted: true,
      url: posted.url,
      count: posted.posted.length,
      failures: posted.failures,
      plan,
      marks: stamped,
    });
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

export interface ServerOptions {
  readonly port?: number;
  /** Where the built client lives. Absent in development, where Vite serves it. */
  readonly webDist?: string;
}

export async function startServer(options: ServerOptions = {}) {
  const port = options.port ?? SERVER_PORT;
  const dist = options.webDist ?? WEB_DIST;
  const serving = await hasBuild(dist);

  return Bun.serve({
    port,
    idleTimeout: 120, // gopls cold start can exceed the default
    async fetch(request) {
      const url = new URL(request.url);
      const route = routes[url.pathname];

      if (!route) {
        // Anything that is not an API call is the packaged client, if there is
        // one. Unknown paths fall back to the page: the app keeps its state in
        // the query string, so a reload of any URL has to reach it.
        if (!url.pathname.startsWith("/api/") && serving) {
          const asset =
            (await serveAsset(dist, url.pathname)) ?? (await serveAsset(dist, "/index.html"));
          if (asset) return asset;
        }
        return fail(`No route for ${url.pathname}`, 404);
      }

      try {
        return await route(url, request);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[${url.pathname}]`, message);
        const bad = error instanceof BadRequest || error instanceof MarkError;
        return fail(message, bad ? 400 : 502);
      }
    },
  });
}

// `bun server/index.ts` still starts it; the CLI imports startServer instead.
if (import.meta.main) {
  await startServer();
  console.log(`better-review server on http://localhost:${SERVER_PORT}`);
}
