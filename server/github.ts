import type { PullRequest } from "./types";

export class GitHubError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubError";
  }
}

interface PrApiResponse {
  readonly title?: string;
  readonly head?: { readonly sha?: string };
  readonly base?: { readonly ref?: string };
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
      throw new GitHubError(
        `${owner}/${repo}#${number} not found — it may not exist, or your gh token may not have access.`,
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

  return { owner, repo, number, title: parsed.title ?? "", headSha, baseRef };
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
