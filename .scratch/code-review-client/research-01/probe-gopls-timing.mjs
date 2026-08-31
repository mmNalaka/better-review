// Isolated gopls timing: genuinely cold on-disk cache vs warm, plus the
// missing-dependency scenario, run one at a time with no other server alive.
import { LspClient, locate, now, rssTreeMBSync } from "./client.mjs";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const GOPLS = "/Users/nalaka.manathunga/go/bin/gopls";
const AUTH = "/Users/nalaka.manathunga/code/auth";
const rss = (pid) => rssTreeMBSync(pid, execSync);

async function pollUntil(fn, ok, budgetMs, everyMs = 200) {
  const t0 = now();
  let n = 0,
    last;
  while (now() - t0 < budgetMs) {
    n++;
    try {
      last = await fn();
      if (ok(last)) return { ms: now() - t0, attempts: n, result: last, timedOut: false };
    } catch (e) {
      last = { error: String(e) };
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return { ms: now() - t0, attempts: n, result: last, timedOut: true };
}
const nonEmpty = (r) => Array.isArray(r) && r.length > 0;

async function one(label, { env, root = AUTH, cacheDir } = {}) {
  const t0 = now();
  const c = new LspClient({
    cmd: GOPLS,
    args: ["-mode=stdio"],
    cwd: root,
    env: { ...(cacheDir ? { GOPLS_CACHE: cacheDir, XDG_CACHE_HOME: cacheDir } : {}), ...(env ?? {}) },
    name: label,
  });
  const out = { label };
  try {
    await c.initialize(root, undefined, {});
    out.initializeMs = +(now() - t0).toFixed(0);
    const abs = path.join(root, "service/identity.go");
    const uri = await c.didOpen(abs);
    const dp = locate(abs, "addAttributesIfPresent(claims");
    const d = await pollUntil(
      () => c.req("textDocument/definition", { textDocument: { uri }, position: { line: dp.line, character: dp.character + 1 } }),
      nonEmpty,
      120000,
    );
    out.firstDefinitionMsFromSpawn = +(now() - t0).toFixed(0);
    out.definitionAttempts = d.attempts;
    out.definitionTimedOut = d.timedOut;
    out.definitionAnswer = (d.result ?? []).map((l) => {
      const u = l.uri ?? l.targetUri, r = l.range ?? l.targetSelectionRange;
      return `${String(u).split("/").slice(-1)[0]}:${r.start.line + 1}`;
    });
    const cp = locate(abs, "func addAttributesIfPresent");
    const ch = await pollUntil(
      async () => {
        const p = await c.req("textDocument/prepareCallHierarchy", { textDocument: { uri }, position: { line: cp.line, character: cp.character + 6 } });
        if (!Array.isArray(p) || !p.length) return null;
        const r = await c.req("callHierarchy/incomingCalls", { item: p[0] });
        return Array.isArray(r) ? r : null;
      },
      nonEmpty,
      120000,
    );
    out.firstIncomingCallsMsFromSpawn = +(now() - t0).toFixed(0);
    out.incomingCallers = (ch.result ?? []).map((x) => x.from.name).sort();
    out.incomingTimedOut = ch.timedOut;
    // warm repeats
    const ds = [], cs = [];
    for (let i = 0; i < 20; i++) {
      const a = await c.timed("textDocument/definition", { textDocument: { uri }, position: { line: dp.line, character: dp.character + 1 } });
      ds.push(a.ms);
      const s = now();
      const p = await c.req("textDocument/prepareCallHierarchy", { textDocument: { uri }, position: { line: cp.line, character: cp.character + 6 } });
      if (p?.length) await c.req("callHierarchy/incomingCalls", { item: p[0] });
      cs.push(now() - s);
    }
    const p50 = (x) => [...x].sort((a, b) => a - b)[Math.floor(x.length / 2)];
    out.warmDefP50 = +p50(ds).toFixed(1);
    out.warmCHP50 = +p50(cs).toFixed(1);
    await new Promise((r) => setTimeout(r, 3000));
    let dg = 0;
    const msgs = [];
    for (const [u, arr] of c.diagnostics) { dg += arr.length; for (const x of arr.slice(0, 2)) msgs.push(`${u.split("/").pop()}: ${x.message.slice(0, 100)}`); }
    out.diagnostics = dg;
    out.diagnosticsSample = msgs.slice(0, 4);
    out.rssMB = rss(c.pid).totalMB;
    out.logTail = c.logs.join("").slice(-400).replace(/\n/g, " | ");
  } catch (e) {
    out.error = String(e);
    out.logTail = c.logs.join("").slice(-600);
  } finally {
    await c.shutdown();
    await new Promise((r) => setTimeout(r, 1500));
  }
  return out;
}

const CACHE = path.join(os.homedir(), "Library/Caches/gopls");
const results = [];

// 1. genuinely cold: delete the gopls cache (it is a regenerable cache)
if (fs.existsSync(CACHE)) fs.rmSync(CACHE, { recursive: true, force: true });
results.push(await one("gopls COLD (on-disk cache deleted)"));
const sz = () => {
  try { return execSync(`du -sm ${CACHE} 2>/dev/null | cut -f1`).toString().trim() + " MB"; } catch { return "?"; }
};
results.push({ label: "gopls cache size after cold run", note: sz() });

// 2. warm: same process restarted, cache now populated
results.push(await one("gopls WARM restart #1"));
results.push(await one("gopls WARM restart #2"));

// 3. missing dependencies
const empty = path.join(HERE, "degrade/empty-modcache");
fs.mkdirSync(empty, { recursive: true });
results.push(
  await one("gopls with EMPTY GOMODCACHE + GOPROXY=off", {
    env: { GOMODCACHE: empty, GOPROXY: "off", GOFLAGS: "-mod=mod" },
  }),
);

// 4. broken copy with a type error, cache now warm for that content too
results.push(await one("gopls @ COPY with type error (2nd visit)", { root: path.join(HERE, "degrade/auth-broken") }));

fs.writeFileSync(path.join(HERE, "out-gopls-timing.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
process.exit(0);
