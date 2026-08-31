// Cold start / latency / memory benchmark against the two real repos.
// Key question this answers: does a server return a WRONG (empty) answer
// before its project is loaded, or does it block? -> we poll and time it.
import { LspClient, locate, now, rssTreeMBSync } from "./client.mjs";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const GOPLS = "/Users/nalaka.manathunga/go/bin/gopls";
const TS7 = path.join(HERE, "node_modules/@typescript/typescript-darwin-arm64/lib/tsc");
const TS5_LIB = path.join(HERE, "ts5/node_modules/typescript/lib");
const rss = (pid) => rssTreeMBSync(pid, execSync);

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const stat = (xs) =>
  xs.length
    ? `n=${xs.length} min=${Math.min(...xs).toFixed(0)} p50=${pct(xs, 50).toFixed(0)} p95=${pct(xs, 95).toFixed(0)} max=${Math.max(...xs).toFixed(0)}`
    : "n=0";

/** Poll a request until the predicate says the answer looks real. */
async function pollUntil(fn, ok, budgetMs = 180000, everyMs = 150) {
  const t0 = now();
  let attempts = 0;
  let last;
  while (now() - t0 < budgetMs) {
    attempts++;
    try {
      last = await fn();
      if (ok(last)) return { ms: now() - t0, attempts, result: last, timedOut: false };
    } catch (e) {
      last = { error: String(e) };
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return { ms: now() - t0, attempts, result: last, timedOut: true };
}

const nonEmpty = (r) => Array.isArray(r) ? r.length > 0 : !!r && (!("length" in r) || r.length > 0);

async function benchmark({
  label,
  spec,
  root,
  openFile,
  defNeedle,
  defOffset,
  chNeedle,
  chOffset,
  expectDefFileHint,
  warmFiles = [],
}) {
  const out = { label, root };
  const tSpawn = now();
  const c = new LspClient({ ...spec, cwd: root, name: label });
  const init = await c.initialize(root, spec.initializationOptions, spec.settings ?? {});
  out.initializeMs = +init.initializeMs.toFixed(0);
  out.rssAfterInitMB = rss(c.pid).totalMB;

  const file = path.join(root, openFile);
  const tOpen = now();
  await c.didOpen(file);
  out.didOpenMs = +(now() - tOpen).toFixed(0);

  const dPos = locate(file, defNeedle);
  const uri = await c.didOpen(file);

  // --- COLD: time until textDocument/definition first returns a real answer ---
  const coldDef = await pollUntil(
    () =>
      c.req("textDocument/definition", {
        textDocument: { uri },
        position: { line: dPos.line, character: dPos.character + defOffset },
      }),
    nonEmpty,
  );
  out.coldDefinition = {
    msFromInitialize: +coldDef.ms.toFixed(0),
    msFromSpawn: +(now() - tSpawn).toFixed(0),
    pollAttempts: coldDef.attempts,
    timedOut: coldDef.timedOut,
    answer: (Array.isArray(coldDef.result) ? coldDef.result : [coldDef.result])
      .filter(Boolean)
      .slice(0, 3)
      .map((l) => {
        const u = l.uri ?? l.targetUri;
        const r = l.range ?? l.targetSelectionRange;
        return `${decodeURIComponent(String(u).replace("file://", "")).replace(root + "/", "")}:${r ? r.start.line + 1 : "?"}`;
      }),
  };
  out.rssAfterFirstDefMB = rss(c.pid).totalMB;

  // --- COLD: time until incomingCalls first returns something ---
  const cPos = locate(file, chNeedle);
  const coldCH = await pollUntil(async () => {
    const prep = await c.req("textDocument/prepareCallHierarchy", {
      textDocument: { uri },
      position: { line: cPos.line, character: cPos.character + chOffset },
    });
    if (!prep?.length) return null;
    return c.req("callHierarchy/incomingCalls", { item: prep[0] });
  }, nonEmpty);
  out.coldIncomingCalls = {
    msFromSpawn: +(now() - tSpawn).toFixed(0),
    pollAttempts: coldCH.attempts,
    timedOut: coldCH.timedOut,
    n: Array.isArray(coldCH.result) ? coldCH.result.length : 0,
    callers: (coldCH.result ?? []).slice(0, 8).map((x) => x.from.name),
  };
  out.rssAfterCallHierarchyMB = rss(c.pid).totalMB;

  // --- WARM: repeat the same queries 20x ---
  const defTimes = [];
  const chTimes = [];
  for (let i = 0; i < 20; i++) {
    const a = await c.timed("textDocument/definition", {
      textDocument: { uri },
      position: { line: dPos.line, character: dPos.character + defOffset },
    });
    defTimes.push(a.ms);
    const t0 = now();
    const prep = await c.req("textDocument/prepareCallHierarchy", {
      textDocument: { uri },
      position: { line: cPos.line, character: cPos.character + chOffset },
    });
    if (prep?.length) await c.req("callHierarchy/incomingCalls", { item: prep[0] });
    chTimes.push(now() - t0);
  }
  out.warmDefinitionMs = stat(defTimes);
  out.warmPrepare_plus_IncomingCallsMs = stat(chTimes);

  // --- WARM but in files never opened before (does the index cover them?) ---
  const coldFileTimes = [];
  const coldFileMisses = [];
  for (const wf of warmFiles) {
    const p = path.join(root, wf);
    if (!fs.existsSync(p)) continue;
    const u = await c.didOpen(p);
    // ask for definition at the first import-ish identifier we can find
    const src = fs.readFileSync(p, "utf8").split("\n");
    let li = -1,
      ci = -1;
    for (let i = 0; i < Math.min(src.length, 200); i++) {
      const m = /\b([A-Za-z_][A-Za-z0-9_]{4,})\s*\(/.exec(src[i]);
      if (m && !src[i].trim().startsWith("//")) {
        li = i;
        ci = m.index + 1;
        break;
      }
    }
    if (li < 0) continue;
    const t0 = now();
    const r = await c.req("textDocument/definition", {
      textDocument: { uri: u },
      position: { line: li, character: ci },
    });
    coldFileTimes.push(now() - t0);
    if (!nonEmpty(r)) coldFileMisses.push(wf);
  }
  out.firstQueryInNewlyOpenedFileMs = stat(coldFileTimes);
  out.newlyOpenedFilesWithEmptyAnswer = coldFileMisses;

  out.rssFinalMB = rss(c.pid).totalMB;
  out.procTree = rss(c.pid).procs;

  await c.shutdown();
  return out;
}

const iam = "/Users/nalaka.manathunga/code/iam-mono";
const iamApi = path.join(iam, "services/iam-api");
const auth = "/Users/nalaka.manathunga/code/auth";

const tlsSpec = {
  cmd: process.execPath,
  args: [path.join(HERE, "node_modules/typescript-language-server/lib/cli.mjs"), "--stdio"],
  initializationOptions: {
    tsserver: { path: path.join(TS5_LIB, "tsserver.js"), logVerbosity: "off" },
    preferences: { includeCompletionsForModuleExports: false },
  },
};
const tsgoSpec = { cmd: TS7, args: ["--lsp", "--stdio"] };
const goplsSpec = { cmd: GOPLS, args: ["-mode=stdio"] };

const jobs = [
  {
    label: "tls+ts5.9 @ iam-mono ROOT",
    spec: tlsSpec,
    root: iam,
    openFile: "services/iam-api/src/db/transaction.ts",
    defNeedle: "db.transaction().execute(fn)",
    defOffset: 4,
    chNeedle: "export async function withTransaction",
    chOffset: "export async function ".length + 1,
    warmFiles: [
      "services/iam-api/src/modules/roles/roles.service.ts",
      "services/iam-api/src/db/index.ts",
      "infra/cdk/src/api/index.ts",
    ],
  },
  {
    label: "tls+ts5.9 @ services/iam-api (package root)",
    spec: tlsSpec,
    root: iamApi,
    openFile: "src/db/transaction.ts",
    defNeedle: "db.transaction().execute(fn)",
    defOffset: 4,
    chNeedle: "export async function withTransaction",
    chOffset: "export async function ".length + 1,
    warmFiles: ["src/modules/roles/roles.service.ts", "src/db/index.ts"],
  },
  {
    label: "tsgo 7.0.2 @ iam-mono ROOT",
    spec: tsgoSpec,
    root: iam,
    openFile: "services/iam-api/src/db/transaction.ts",
    defNeedle: "db.transaction().execute(fn)",
    defOffset: 4,
    chNeedle: "export async function withTransaction",
    chOffset: "export async function ".length + 1,
    warmFiles: [
      "services/iam-api/src/modules/roles/roles.service.ts",
      "services/iam-api/src/db/index.ts",
      "infra/cdk/src/api/index.ts",
    ],
  },
  {
    label: "gopls 0.23 @ auth",
    spec: goplsSpec,
    root: auth,
    openFile: "service/identity.go",
    defNeedle: "addAttributesIfPresent(claims",
    defOffset: 1,
    chNeedle: "func addAttributesIfPresent",
    chOffset: 6,
    warmFiles: [
      "repository/mysql/pos_users.go",
      "generated/handler/handlers.go",
      "middleware/auth.go",
      "bootstrap/bootstrap.go",
    ],
  },
];

const results = [];
for (const j of jobs) {
  process.stderr.write(`\n>>> ${j.label}\n`);
  try {
    results.push(await benchmark(j));
  } catch (e) {
    results.push({ label: j.label, error: String(e && e.stack ? e.stack : e) });
  }
}
fs.writeFileSync(path.join(HERE, "out-bench.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
process.exit(0);
