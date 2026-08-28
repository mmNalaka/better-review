import type { PullRequest } from "./types";

export class GitHubError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubError";
  }
}

interface PrApiResponse {
  readonly title?: string;
  readonly draft?: boolean;
  readonly state?: string;
  readonly head?: {
    readonly sha?: string;
    readonly ref?: string;
    readonly repo?: { readonly full_name?: string };
  };
  readonly base?: { readonly ref?: string; readonly repo?: { readonly full_name?: string } };
}

/**
 * The one API call this app makes. Everything else comes from git.
 * Auth comes from the user's own `gh` keyring — no token is stored here.
 */
export async function fetchPullRequest(
  owner: string,
  repo: string,
  number: number,
): Promise<Omit<PullRequest, "mergeBase">> {
  const proc = Bun.spawn(["gh", "api", `repos/${owner}/${repo}/pulls/${number}`], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (code !== 0) {
    const detail = stderr.trim();
    if (detail.includes("404")) {
      // Keep gh's own words: the friendly message alone hid a keychain failure
      // that had nothing to do with the PR existing.
      throw new GitHubError(
        `${owner}/${repo}#${number} not found — it may not exist, or your gh token may not have access. gh said: ${detail}`,
      );
    }
    throw new GitHubError(`gh api failed: ${detail || "no stderr"}`);
  }

  let parsed: PrApiResponse;
  try {
    parsed = JSON.parse(stdout) as PrApiResponse;
  } catch {
    throw new GitHubError("gh api returned output that was not JSON");
  }

  const headSha = parsed.head?.sha;
  const baseRef = parsed.base?.ref;
  if (!headSha || !baseRef) {
    throw new GitHubError("PR response is missing head.sha or base.ref");
  }

  const headRepo = parsed.head?.repo?.full_name ?? null;
  const baseRepo = parsed.base?.repo?.full_name ?? `${owner}/${repo}`;

  return {
    owner,
    repo,
    number,
    title: parsed.title ?? "",
    headSha,
    baseRef,
    headRef: parsed.head?.ref ?? "",
    forkOf: headRepo && headRepo !== baseRepo ? headRepo : null,
    draft: parsed.draft ?? false,
    state: parsed.state ?? "open",
  };
}

const PR_URL = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;
const PR_SHORT = /^([^/\s]+)\/([^/#\s]+)#(\d+)$/;

/** Accepts a full PR URL or `owner/repo#123`. Returns null on anything else. */
export function parsePrRef(
  input: string,
): { owner: string; repo: string; number: number } | null {
  const match = PR_URL.exec(input) ?? PR_SHORT.exec(input.trim());
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const number = Number(match[3]);
  return Number.isSafeInteger(number) && number > 0
    ? { owner: match[1], repo: match[2], number }
    : null;
}

/**
 * Posts a pull request review — the one write this app makes, and only when
 * the user asks for it. Auth is the user's own `gh` login; no token here.
 */
export async function postReview(
  owner: string,
  repo: string,
  number: number,
  payload: unknown,
): Promise<{ url: string }> {
  const proc = Bun.spawn(
    ["gh", "api", "--method", "POST", `repos/${owner}/${repo}/pulls/${number}/reviews`, "--input", "-"],
    { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  );
  proc.stdin.write(JSON.stringify(payload));
  await proc.stdin.end();

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (code !== 0) {
    // Keep gh's words: a 422 here names the line it refused, which is the
    // difference between "fix the anchor" and "fix your token".
    throw new GitHubError(`Posting the review failed. gh said: ${stderr.trim() || "no stderr"}`);
  }

  try {
    const parsed = JSON.parse(stdout) as { html_url?: string };
    return { url: parsed.html_url ?? `https://github.com/${owner}/${repo}/pull/${number}` };
  } catch {
    throw new GitHubError("gh api returned output that was not JSON");
  }
}
