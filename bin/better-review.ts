#!/usr/bin/env bun
import { stat } from "node:fs/promises";

import { CLONE_ROOTS, MARKS_DIR, SERVER_PORT, WEB_DIST } from "../server/config";
import { startServer } from "../server/index";
import { hasBuild } from "../server/static";

/**
 * The command people actually run.
 *
 * One process, one port: the server serves the built client itself, so there
 * is no dev server to start alongside it and no second port to remember.
 */

const HELP = `better-review — read a GitHub pull request properly

  better-review [pr] [options]

  pr                 owner/repo#123, or a pull request URL, opened on start

  --port <n>         port to listen on (default ${SERVER_PORT}, or BR_SERVER_PORT)
  --no-open          do not open a browser
  --doctor           check the things this needs, then exit
  --help, -h         this
  --version, -v      print the version

Environment:
  BR_CLONE_ROOTS     where to look for clones, colon-separated (default ~/code)
  BR_SERVER_PORT     default port
  BR_MARKS_DIR       where review marks are stored
  BR_WORKTREE_ROOT   where pull request worktrees are materialised
`;

interface Options {
  readonly port: number;
  readonly open: boolean;
  readonly pr: string | null;
  readonly doctor: boolean;
  readonly help: boolean;
  readonly version: boolean;
}

export function parseArgs(argv: readonly string[]): Options {
  let port = SERVER_PORT;
  let open = true;
  let pr: string | null = null;
  let doctor = false;
  let help = false;
  let version = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port" || arg === "-p") {
      const value = Number(argv[++i]);
      if (!Number.isSafeInteger(value) || value < 1 || value > 65535) {
        throw new Error(`--port needs a port number, not "${argv[i] ?? ""}"`);
      }
      port = value;
    } else if (arg === "--no-open") open = false;
    else if (arg === "--doctor") doctor = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--version" || arg === "-v") version = true;
    else if (arg !== undefined && arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else if (arg !== undefined && pr === null) pr = arg;
    else throw new Error(`Unexpected argument: ${String(arg)}`);
  }

  return { port, open, pr, doctor, help, version };
}

const run = async (...command: string[]): Promise<{ ok: boolean; out: string }> => {
  try {
    const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return { ok: code === 0, out: out.trim() };
  } catch {
    return { ok: false, out: "" };
  }
};

/** What this needs, and whether it is there. */
async function doctor(): Promise<boolean> {
  const git = await run("git", "--version");
  const gh = await run("gh", "--version");
  const auth = await run("gh", "auth", "status");
  const built = await hasBuild(WEB_DIST);

  // `Bun.file(...).exists()` is false for a directory, which is what these are.
  const isDir = async (path: string) => {
    try {
      return (await stat(path)).isDirectory();
    } catch {
      return false;
    }
  };
  const roots = await Promise.all(
    CLONE_ROOTS.map(async (root) => ({ root, there: await isDir(root) })),
  );

  const checks: readonly [boolean, string, string][] = [
    [git.ok, "git", git.out.split("\n")[0] ?? ""],
    [gh.ok, "gh", gh.out.split("\n")[0] ?? "not found — https://cli.github.com"],
    [auth.ok, "gh auth", auth.ok ? "logged in" : "not logged in — run `gh auth login`"],
    [built, "built client", built ? WEB_DIST : "missing — run `bun run build`"],
    [
      roots.some((entry) => entry.there),
      "clone roots",
      roots.map((entry) => `${entry.root}${entry.there ? "" : " (missing)"}`).join(", "),
    ],
  ];

  for (const [ok, name, detail] of checks) {
    console.log(`${ok ? "✓" : "✗"} ${name.padEnd(14)} ${detail}`);
  }
  console.log(`  ${"marks".padEnd(14)} ${MARKS_DIR}`);

  // Language servers are optional: without one, ring state reads "not
  // applicable" for that language and everything else still works.
  const servers = (
    [
      ["gopls", "Go"],
      ["typescript-language-server", "TypeScript"],
    ] as const
  ).map(([binary, language]) => `${Bun.which(binary) ? "✓" : "·"} ${binary} (${language})`);
  console.log(`  ${"optional".padEnd(14)} ${servers.join("   ")}`);

  return checks.every(([ok]) => ok);
}

const openBrowser = (url: string) => {
  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
  } catch {
    // A browser that will not open is a link the user can click instead.
  }
};

async function main(): Promise<number> {
  let options: Options;
  try {
    options = parseArgs(Bun.argv.slice(2));
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause));
    console.error(`\n${HELP}`);
    return 2;
  }

  if (options.help) {
    console.log(HELP);
    return 0;
  }
  if (options.version) {
    const pkg = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as {
      version?: string;
    };
    console.log(pkg.version ?? "unknown");
    return 0;
  }
  if (options.doctor) return (await doctor()) ? 0 : 1;

  if (!(await hasBuild(WEB_DIST))) {
    console.error(
      `No built client at ${WEB_DIST}.\n` +
        "Run `bun run build` first, or `bun run dev` for the development servers.",
    );
    return 1;
  }

  try {
    await startServer({ port: options.port });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    // The common one by far, and the fix is a flag away.
    if (message.includes("EADDRINUSE") || message.includes("in use")) {
      console.error(`Port ${options.port} is in use. Try \`--port ${options.port + 1}\`.`);
      return 1;
    }
    console.error(message);
    return 1;
  }

  const url = `http://localhost:${options.port}/${
    options.pr ? `?pr=${encodeURIComponent(options.pr)}` : ""
  }`;
  console.log(`better-review on ${url}`);
  console.log("Ctrl-C to stop.");
  if (options.open) openBrowser(url);

  return -1; // keep serving
}

if (import.meta.main) {
  const code = await main();
  if (code >= 0) process.exit(code);
}
