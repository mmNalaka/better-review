// Degradation + index-persistence probe.
import { LspClient, locate, now, rssTreeMBSync } from "./client.mjs";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const GOPLS = "/Users/nalaka.manathunga/go/bin/gopls";
const TS7 = path.join(HERE, "node_modules/@typescript/typescript-darwin-arm64/lib/tsc");
const TS5_LIB = path.join(HERE, "ts5/node_modules/typescript/lib");
const rss = (pid) => rssTreeMBSync(pid, execSync);

async function pollUntil(fn, ok, budgetMs = 90000, everyMs = 200) {
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
const nonEmpty = (r) => (Array.isArray(r) ? r.length > 0 : !!r);
const shortLoc = (l, root) => {
  const u = l.uri ?? l.targetUri;
  const r = l.range ?? l.targetSelectionRange;
  return `${decodeURIComponent(String(u).replace("file://", "")).replace(root + "/", "")}:${r ? r.start.line + 1 : "?"}`;
};

async function scenario({ label, spec, root, file, defNeedle, defOffset, chNeedle, chOffset, env }) {
  const out = { label, root };
  const t0 = now();
  const c = new LspClient({ ...spec, cwd: root, env, name: label });
  try {
    await c.initialize(root, spec.initializationOptions, {});
    const abs = path.join(root, file);
    const uri = await c.didOpen(abs);
    const dPos = locate(abs, defNeedle);
    const d = await pollUntil(
      () =>
        c.req("textDocument/definition", {
          textDocument: { uri },
          position: { line: dPos.line, character: dPos.character + defOffset },
        }),
      nonEmpty,
      45000,
    );
    out.definition = {
      ms: +d.ms.toFixed(0),
      msFromSpawn: +(now() - t0).toFixed(0),
      attempts: d.attempts,
      timedOut: d.timedOut,
      answer: (Array.isArray(d.result) ? d.result : []).slice(0, 2).map((l) => shortLoc(l, root)),
    };
    const cPos = locate(abs, chNeedle);
    const ch = await pollUntil(
      async () => {
        const p = await c.req("textDocument/prepareCallHierarchy", {
          textDocument: { uri },
          position: { line: cPos.line, character: cPos.character + chOffset },
        });
        if (!p?.length) return null;
        return c.req("callHierarchy/incomingCalls", { item: p[0] });
      },
      nonEmpty,
      45000,
    );
    out.incomingCalls = {
      msFromSpawn: +(now() - t0).toFixed(0),
      attempts: ch.attempts,
      timedOut: ch.timedOut,
      n: Array.isArray(ch.result) ? ch.result.length : 0,
      callers: (ch.result ?? []).map((x) => x.from.name).sort(),
    };
    // wait for diagnostics to settle, then count them
    await new Promise((r) => setTimeout(r, 4000));
    let diagCount = 0;
    for (const [, ds] of c.diagnostics) diagCount += ds.length;
    out.diagnosticsOnOpenFiles = diagCount;
    out.diagnosticsSample = [...c.diagnostics.entries()]
      .flatMap(([u, ds]) => ds.slice(0, 2).map((d) => `${u.split("/").pop()}: ${d.message.slice(0, 110)}`))
      .slice(0, 5);
    out.rssMB = rss(c.pid).totalMB;
  } catch (e) {
    out.error = String(e);
    out.serverLogTail = c.logs.join("").slice(-600);
  } finally {
    await c.shutdown();
  }
  return out;
}

const DEG = path.join(HERE, "degrade");
const tlsSpec = {
  cmd: process.execPath,
  args: [path.join(HERE, "node_modules/typescript-language-server/lib/cli.mjs"), "--stdio"],
  initializationOptions: { tsserver: { path: path.join(TS5_LIB, "tsserver.js"), logVerbosity: "off" } },
};
const tsgoSpec = { cmd: TS7, args: ["--lsp", "--stdio"] };
const goplsSpec = { cmd: GOPLS, args: ["-mode=stdio"] };

const TS_FILE = "services/iam-api/src/db/transaction.ts";
const TS_DEF = "db.transaction().execute(fn)";
const TS_CH = "export async function withTransaction";
const GO_FILE = "service/identity.go";
const GO_DEF = "addAttributesIfPresent(claims";
const GO_CH = "func addAttributesIfPresent";

const results = [];

// ---------- A. TypeScript with NO node_modules at all ----------
for (const [n, spec] of [["tls+ts5.9", tlsSpec], ["tsgo", tsgoSpec]]) {
  results.push(
    await scenario({
      label: `${n} @ iam-mono COPY with NO node_modules`,
      spec,
      root: path.join(DEG, "iam-mono-nodeps"),
      file: TS_FILE,
      defNeedle: TS_DEF,
      defOffset: 4,
      chNeedle: TS_CH,
      chOffset: "export async function ".length + 1,
    }),
  );
}

// ---------- B. Go with a real type error in the package ----------
results.push(
  await scenario({
    label: "gopls @ auth COPY with a TYPE ERROR in the same package",
    spec: goplsSpec,
    root: path.join(DEG, "auth-broken"),
    file: GO_FILE,
    defNeedle: GO_DEF,
    defOffset: 1,
    chNeedle: GO_CH,
    chOffset: 6,
  }),
);

// ---------- C. Go with the module cache unavailable (deps not downloaded) ----------
const emptyModCache = path.join(DEG, "empty-modcache");
fs.mkdirSync(emptyModCache, { recursive: true });
results.push(
  await scenario({
    label: "gopls @ auth with EMPTY GOMODCACHE + GOPROXY=off (deps missing)",
    spec: goplsSpec,
    root: "/Users/nalaka.manathunga/code/auth",
    file: GO_FILE,
    defNeedle: GO_DEF,
    defOffset: 1,
    chNeedle: GO_CH,
    chOffset: 6,
    env: { GOMODCACHE: emptyModCache, GOPROXY: "off", GOFLAGS: "-mod=mod" },
  }),
);

// ---------- D. index persistence between PROCESSES ----------
// gopls: cache dir was moved aside before the first bench run, so it is warm now.
for (const pass of [1, 2]) {
  results.push(
    await scenario({
      label: `gopls @ auth  process-restart pass ${pass} (on-disk cache WARM)`,
      spec: goplsSpec,
      root: "/Users/nalaka.manathunga/code/auth",
      file: GO_FILE,
      defNeedle: GO_DEF,
      defOffset: 1,
      chNeedle: GO_CH,
      chOffset: 6,
    }),
  );
}
for (const pass of [1, 2]) {
  results.push(
    await scenario({
      label: `tsgo @ iam-mono  process-restart pass ${pass}`,
      spec: tsgoSpec,
      root: "/Users/nalaka.manathunga/code/iam-mono",
      file: TS_FILE,
      defNeedle: TS_DEF,
      defOffset: 4,
      chNeedle: TS_CH,
      chOffset: "export async function ".length + 1,
    }),
  );
}

fs.writeFileSync(path.join(HERE, "out-degrade.json"), JSON.stringify(results, null, 2));
for (const r of results) {
  console.log(`\n===== ${r.label}`);
  if (r.error) {
    console.log("  ERROR", r.error);
    console.log("  log:", r.serverLogTail);
    continue;
  }
  console.log("  definition   ", JSON.stringify(r.definition));
  console.log("  incomingCalls", JSON.stringify(r.incomingCalls));
  console.log("  diagnostics  ", r.diagnosticsOnOpenFiles, JSON.stringify(r.diagnosticsSample));
  console.log("  rssMB        ", r.rssMB);
}
process.exit(0);
