// PROOF OF CONCEPT for the actual feature.
// Given a git commit (standing in for a PR), compute the blast radius:
//   level 0 = symbols enclosing the changed lines
//   level N = incomingCalls transitive closure
// and measure how long that takes on a real repo.
//
// usage: node blast-radius.mjs <repo> <commit> <server> [maxDepth]
//   server: gopls | tsgo | tls
import { LspClient, now } from "./client.mjs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const GOPLS = "/Users/nalaka.manathunga/go/bin/gopls";
const TS7 = path.join(HERE, "node_modules/@typescript/typescript-darwin-arm64/lib/tsc");
const TS5_LIB = path.join(HERE, "ts5/node_modules/typescript/lib");

const refused = [];
const [, , REPO, BASE, HEAD, SERVER, DEPTH = "3"] = process.argv;
const COMMIT = HEAD;
const maxDepth = Number(DEPTH);

const SPECS = {
  gopls: { cmd: GOPLS, args: ["-mode=stdio"] },
  tsgo: { cmd: TS7, args: ["--lsp", "--stdio"] },
  tls: {
    cmd: process.execPath,
    args: [path.join(HERE, "node_modules/typescript-language-server/lib/cli.mjs"), "--stdio"],
    initializationOptions: { tsserver: { path: path.join(TS5_LIB, "tsserver.js"), logVerbosity: "off" } },
  },
};
const CODE_EXT = SERVER === "gopls" ? [".go"] : [".ts", ".tsx", ".mts", ".cts"];

/** Parse `git diff -U0` into { file -> [changed 0-based line numbers on the NEW side] }. */
function changedLines(repo, commit) {
  const diff = execFileSync("git", ["diff", "-U0", BASE, HEAD], {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const byFile = new Map();
  let cur = null;
  for (const line of diff.split("\n")) {
    const f = /^\+\+\+ b\/(.*)$/.exec(line);
    if (f) {
      cur = f[1] === "/dev/null" ? null : f[1];
      continue;
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h && cur) {
      const start = Number(h[1]);
      const count = h[2] === undefined ? 1 : Number(h[2]);
      if (!byFile.has(cur)) byFile.set(cur, []);
      for (let i = 0; i < count; i++) byFile.get(cur).push(start - 1 + i);
    }
  }
  return [...byFile.entries()].filter(([f]) => CODE_EXT.some((e) => f.endsWith(e)));
}

/** flatten DocumentSymbol tree */
function flatten(syms, acc = []) {
  for (const s of syms ?? []) {
    acc.push(s);
    if (s.children) flatten(s.children, acc);
  }
  return acc;
}
const CALLABLE = new Set([6 /*Method*/, 9 /*Constructor*/, 12 /*Function*/]);
const key = (i) => `${i.uri}#${i.name}@${i.selectionRange.start.line}:${i.selectionRange.start.character}`;
const shortU = (u) => decodeURIComponent(String(u).replace("file://", "")).replace(REPO + "/", "");

const t0 = now();
const c = new LspClient({ ...SPECS[SERVER], cwd: REPO, name: SERVER });
await c.initialize(REPO, SPECS[SERVER].initializationOptions, {});

const files = changedLines(REPO, COMMIT);
if (!files.length) {
  console.log(JSON.stringify({ error: "no code files changed in that commit" }));
  process.exit(0);
}

// wait for the project to be ready: poll documentSymbol on the first changed file
const firstAbs = path.join(REPO, files[0][0]);
const firstUri = await c.didOpen(firstAbs);
let ready = false;
const tReady = now();
for (let i = 0; i < 400 && !ready; i++) {
  const s = await c.req("textDocument/documentSymbol", { textDocument: { uri: firstUri } });
  if (Array.isArray(s) && s.length) ready = true;
  else await new Promise((r) => setTimeout(r, 200));
}
const readyMs = now() - tReady;

// ---- level 0: symbols enclosing changed lines ----
const tL0 = now();
const level = new Map(); // key -> {item, depth}
const level0Names = [];
for (const [rel, lines] of files) {
  const abs = path.join(REPO, rel);
  if (!fs.existsSync(abs)) continue;
  const uri = await c.didOpen(abs);
  let raw;
  try {
    raw = await c.req("textDocument/documentSymbol", { textDocument: { uri } });
  } catch (e) {
    refused.push(`${rel}: ${String(e.message).slice(0, 60)}`);
    continue;
  }
  const syms = flatten(raw);
  const hit = new Set();
  for (const ln of lines) {
    // innermost callable containing the line
    const cands = syms.filter((s) => CALLABLE.has(s.kind) && s.range.start.line <= ln && ln <= s.range.end.line);
    if (!cands.length) continue;
    cands.sort((a, b) => a.range.end.line - a.range.start.line - (b.range.end.line - b.range.start.line));
    hit.add(cands[0]);
  }
  for (const s of hit) {
    let prep;
    try {
    prep = await c.req("textDocument/prepareCallHierarchy", {
      textDocument: { uri },
      position: { line: s.selectionRange.start.line, character: s.selectionRange.start.character },
    });
    } catch (e) {
      refused.push(`prepare ${s.name}: ${String(e.message).slice(0, 50)}`);
      prep = [];
    }
    for (const item of prep ?? []) {
      if (!level.has(key(item))) {
        level.set(key(item), { item, depth: 0 });
        level0Names.push(`${shortU(item.uri)}:${item.selectionRange.start.line + 1} ${item.name}`);
      }
    }
  }
}
const l0Ms = now() - tL0;

// ---- BFS outward on incomingCalls ----
const tBfs = now();
let frontier = [...level.values()].map((v) => v.item);
const perDepth = [{ depth: 0, n: frontier.length, ms: +l0Ms.toFixed(0) }];
let requests = 0;
for (let d = 1; d <= maxDepth && frontier.length; d++) {
  const tD = now();
  const next = [];
  for (const item of frontier) {
    requests++;
    let inc;
    try {
      inc = await c.req("callHierarchy/incomingCalls", { item });
    } catch {
      inc = [];
    }
    for (const call of inc ?? []) {
      const k = key(call.from);
      if (!level.has(k)) {
        level.set(k, { item: call.from, depth: d });
        next.push(call.from);
      }
    }
  }
  perDepth.push({ depth: d, n: next.length, ms: +(now() - tD).toFixed(0), incomingCallsRequests: frontier.length });
  frontier = next;
}
const bfsMs = now() - tBfs;

// ---- per-file rollup: the minimum depth reached in each file ----
const byFile = new Map();
for (const { item, depth } of level.values()) {
  const f = shortU(item.uri);
  byFile.set(f, Math.min(byFile.get(f) ?? 99, depth));
}

const result = {
  repo: REPO,
  commit: COMMIT,
  server: SERVER,
  maxDepth,
  changedCodeFiles: files.map(([f, l]) => `${f} (${l.length} lines)`),
  projectReadyMs: +readyMs.toFixed(0),
  level0Ms: +l0Ms.toFixed(0),
  bfsMs: +bfsMs.toFixed(0),
  totalMsFromSpawn: +(now() - t0).toFixed(0),
  incomingCallsRequestsIssued: requests,
  refusedByServer: refused,
  msPerIncomingCallsRequest: requests ? +(bfsMs / requests).toFixed(1) : null,
  symbolsPerDepth: perDepth,
  totalSymbolsInRadius: level.size,
  filesInRadius: byFile.size,
  level0Symbols: level0Names,
  fileDepths: [...byFile.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([f, d]) => `L${d} ${f}`),
};
fs.writeFileSync(path.join(HERE, `out-blast-${SERVER}-${COMMIT}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await c.shutdown();
process.exit(0);
