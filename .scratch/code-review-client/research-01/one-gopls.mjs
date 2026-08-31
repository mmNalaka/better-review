// Single gopls measurement, one per OS process, so nothing overlaps.
// usage: node one-gopls.mjs <root> [label]
import { LspClient, locate, now, rssTreeMBSync } from "./client.mjs";
import { execSync } from "node:child_process";
import path from "node:path";

const GOPLS = "/Users/nalaka.manathunga/go/bin/gopls";
const root = process.argv[2] ?? "/Users/nalaka.manathunga/code/auth";
const label = process.argv[3] ?? "run";

async function pollUntil(fn, budgetMs, everyMs = 200) {
  const t0 = now();
  let n = 0, last;
  while (now() - t0 < budgetMs) {
    n++;
    try {
      last = await fn();
      if (Array.isArray(last) && last.length) return { ms: now() - t0, attempts: n, result: last, timedOut: false };
    } catch (e) { last = { error: String(e) }; }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return { ms: now() - t0, attempts: n, result: last, timedOut: true };
}

const t0 = now();
const c = new LspClient({ cmd: GOPLS, args: ["-mode=stdio"], cwd: root, name: label });
const out = { label, root };
try {
  await c.initialize(root, undefined, {});
  out.initializeMs = +(now() - t0).toFixed(0);
  const abs = path.join(root, "service/identity.go");
  const uri = await c.didOpen(abs);
  const dp = locate(abs, "addAttributesIfPresent(claims");
  const d = await pollUntil(() => c.req("textDocument/definition", { textDocument: { uri }, position: { line: dp.line, character: dp.character + 1 } }), 150000);
  out.firstDefinitionMs = +(now() - t0).toFixed(0);
  out.defAttempts = d.attempts;
  out.defTimedOut = d.timedOut;
  const cp = locate(abs, "func addAttributesIfPresent");
  const ch = await pollUntil(async () => {
    const p = await c.req("textDocument/prepareCallHierarchy", { textDocument: { uri }, position: { line: cp.line, character: cp.character + 6 } });
    if (!Array.isArray(p) || !p.length) return null;
    const r = await c.req("callHierarchy/incomingCalls", { item: p[0] });
    return Array.isArray(r) ? r : null;
  }, 60000);
  out.firstIncomingCallsMs = +(now() - t0).toFixed(0);
  out.callers = (Array.isArray(ch.result) ? ch.result : []).map((x) => x.from.name).sort();
  out.chTimedOut = ch.timedOut;
  const ds = [], cs = [];
  for (let i = 0; i < 30; i++) {
    const a = await c.timed("textDocument/definition", { textDocument: { uri }, position: { line: dp.line, character: dp.character + 1 } });
    ds.push(a.ms);
    const s = now();
    const p = await c.req("textDocument/prepareCallHierarchy", { textDocument: { uri }, position: { line: cp.line, character: cp.character + 6 } });
    if (p?.length) await c.req("callHierarchy/incomingCalls", { item: p[0] });
    cs.push(now() - s);
  }
  const p50 = (x) => [...x].sort((a, b) => a - b)[Math.floor(x.length / 2)];
  const p95 = (x) => [...x].sort((a, b) => a - b)[Math.floor(0.95 * x.length)];
  out.warmDef = { p50: +p50(ds).toFixed(1), p95: +p95(ds).toFixed(1) };
  out.warmCH = { p50: +p50(cs).toFixed(1), p95: +p95(cs).toFixed(1) };
  await new Promise((r) => setTimeout(r, 2500));
  out.rssMB = rssTreeMBSync(c.pid, execSync).totalMB;
  const m = /packages=(\d+)[\s\S]*?duration=([0-9.]+m?s)/.exec(c.logs.join(""));
  out.goPackagesLoad = m ? { packages: m[1], duration: m[2] } : null;
  let dg = 0; const msgs = [];
  for (const [u, arr] of c.diagnostics) { dg += arr.length; for (const x of arr.slice(0, 1)) msgs.push(`${u.split("/").pop()}: ${x.message.slice(0, 120)}`); }
  out.diagnostics = dg; out.diagSample = msgs.slice(0, 3);
} catch (e) {
  out.error = String(e);
  out.logTail = c.logs.join("").slice(-500);
}
// give gopls time to flush its cache before we go away
try { await c.conn.sendRequest("shutdown"); await c.conn.sendNotification("exit"); } catch {}
await new Promise((r) => setTimeout(r, 2500));
try { c.proc.kill("SIGKILL"); } catch {}
console.log(JSON.stringify(out));
process.exit(0);
