import { normalize, resolve, sep } from "node:path";

/**
 * Serving the built client from the same origin as the API.
 *
 * In development Vite serves the page and proxies `/api`; packaged, there is
 * one process and one port, so starting the app is a single command. That makes
 * this server a file server, which means it has to be careful: a request path
 * is untrusted input, and the only rule is that what it names must sit inside
 * the build directory.
 */

const INDEX = "index.html";

/**
 * The file a request path names, or null if it names anything outside the
 * root. Pure, so the rule can be tested without a filesystem.
 */
export function resolveAsset(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null; // malformed encoding: refuse rather than guess
  }
  if (decoded.includes("\0")) return null;

  const wanted = decoded.endsWith("/") ? `${decoded}${INDEX}` : decoded;
  // `normalize` collapses the `..` segments and `resolve` makes the result
  // absolute; the prefix check below is what actually enforces the rule.
  const candidate = resolve(root, `.${normalize(wanted)}`);
  const base = resolve(root);

  if (candidate !== base && !candidate.startsWith(base + sep)) return null;
  return candidate;
}

/**
 * The built page and its assets. Returns null when the path names nothing —
 * the caller decides whether that is a 404 or a fall back to the page itself.
 */
export async function serveAsset(root: string, pathname: string): Promise<Response | null> {
  const path = resolveAsset(root, pathname);
  if (path === null) return null;

  const file = Bun.file(path);
  if (!(await file.exists())) return null;

  return new Response(file, {
    headers: {
      // Vite fingerprints asset names, so they can be cached hard; the page
      // itself must not be, or a rebuild would keep serving the old one.
      "cache-control": path.endsWith(INDEX) ? "no-cache" : "public, max-age=31536000, immutable",
    },
  });
}

/** Whether there is a build to serve at all. */
export const hasBuild = (root: string): Promise<boolean> =>
  Bun.file(resolve(root, INDEX)).exists();
