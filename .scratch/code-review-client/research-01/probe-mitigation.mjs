// MITIGATION for the TypeScript call-hierarchy blind spots.
//
// tsserver's incomingCalls only counts syntactic call expressions, so
// `xs.map(TARGET)`, `const f = TARGET`, and `{ t: TARGET }` are invisible.
// textDocument/references DOES see them. So: take references, drop the ones
// that are import/export specifiers, and attribute each surviving reference to
// its innermost enclosing symbol from textDocument/documentSymbol.
//
// This file proves the union recovers every real edge, and measures the cost.
import { LspClient, locate, now } from "./client.mjs";
import path from "node:path";
import fs from "node:fs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const TS7 = path.join(HERE, "node_modules/@typescript/typescript-darwin-arm64/lib/tsc");
const GOPLS = "/Users/nalaka.manathunga/go/bin/gopls";

const short = (u, root) => decodeURIComponent(String(u).replace("file://", "")).replace(root + "/", "");
const flat = (s, a = []) => { for (const x of s ?? []) { a.push(x); if (x.children) flat(x.children, a); } return a; };
const NAMEABLE = new Set([5, 6, 9, 11, 12, 13, 14]); // Class Method Ctor Interface Function Variable Constant

/** Is this reference position part of an import/export statement rather than a use? */
function isModuleSpecifierLine(text) {
  const t = text.trim();
  return /^import[\s{]/.test(t) || /^export\s*\{/.test(t) || /^export\s\*/.test(t) || /^\}\s*from\s/.test(t);
}

async function referenceEdges(c, root, targetFile, needle, offset) {
  const uri = await c.didOpen(targetFile);
  const pos = locate(targetFile, needle);
  const t0 = now();
  const refs = (await c.req("textDocument/references", {
    textDocument: { uri },
    position: { line: pos.line, character: pos.character + offset },
    context: { includeDeclaration: false },
  })) ?? [];
  const refMs = now() - t0;

  const symCache = new Map();
  const srcCache = new Map();
  const edges = [];
  let symbolRequests = 0;
  const t1 = now();
  for (const r of refs) {
    const rel = short(r.uri, root);
    const abs = path.join(root, rel);
    if (!srcCache.has(rel)) {
      try { srcCache.set(rel, fs.readFileSync(abs, "utf8").split("\n")); }
      catch (e) { console.error("SKIP unreadable ref file:", rel, String(e).slice(0,90)); srcCache.set(rel, []); }
    }
    const line = srcCache.get(rel)[r.range.start.line] ?? "";
    if (isModuleSpecifierLine(line)) continue; // not a use
    if (!symCache.has(rel)) {
      if (!fs.existsSync(abs)) { symCache.set(rel, []); }
      else {
      const u = await c.didOpen(abs);
      symbolRequests++;
      symCache.set(rel, flat(await c.req("textDocument/documentSymbol", { textDocument: { uri: u } })));
      }
    }
    const ln = r.range.start.line;
    const cands = symCache
      .get(rel)
      .filter((s) => NAMEABLE.has(s.kind) && s.range.start.line <= ln && ln <= s.range.end.line);
    cands.sort((a, b) => (a.range.end.line - a.range.start.line) - (b.range.end.line - b.range.start.line));
    edges.push({
      loc: `${rel}:${ln + 1}`,
      enclosing: cands[0]?.name ?? "<module>",
      kind: cands[0]?.kind ?? 2,
      line: line.trim().slice(0, 68),
    });
  }
  return { edges, refMs: +refMs.toFixed(0), attributeMs: +(now() - t1).toFixed(0), symbolRequests, rawRefs: refs.length };
}

async function callHierarchyEdges(c, root, targetFile, needle, offset) {
  const uri = await c.didOpen(targetFile);
  const pos = locate(targetFile, needle);
  const t0 = now();
  const prep = await c.req("textDocument/prepareCallHierarchy", {
    textDocument: { uri }, position: { line: pos.line, character: pos.character + offset },
  });
  const inc = prep?.length ? (await c.req("callHierarchy/incomingCalls", { item: prep[0] })) ?? [] : [];
  const ms = now() - t0;
  const out = [];
  for (const call of inc) for (const fr of call.fromRanges ?? [])
    out.push({ loc: `${short(call.from.uri, root)}:${fr.start.line + 1}`, enclosing: call.from.name });
  return { edges: out, ms: +ms.toFixed(0) };
}

const results = {};

// ---- fixture: prove the union recovers the known-missing edges ----
{
  const root = path.join(HERE, "fixtures/ts");
  const c = new LspClient({ cmd: TS7, args: ["--lsp", "--stdio"], cwd: root, name: "mitigation-fixture" });
  await c.initialize(root, undefined, {});
  for (const f of fs.readdirSync(path.join(root, "src"))) await c.didOpen(path.join(root, "src", f));
  await new Promise((r) => setTimeout(r, 2500));
  const tf = path.join(root, "src/target.ts");
  const ch = await callHierarchyEdges(c, root, tf, "export function TARGET", "export function ".length + 1);
  const rf = await referenceEdges(c, root, tf, "export function TARGET", "export function ".length + 1);
  const chLocs = new Set(ch.edges.map((e) => e.loc));
  results.fixture = {
    callHierarchyEdges: ch.edges.length,
    callHierarchyMs: ch.ms,
    referenceEdges: rf.edges.length,
    referencesMs: rf.refMs,
    attributionMs: rf.attributeMs,
    documentSymbolRequests: rf.symbolRequests,
    recoveredByReferencesOnly: rf.edges.filter((e) => !chLocs.has(e.loc)),
    missedByReferencesButFoundByCH: ch.edges.filter((e) => !rf.edges.some((x) => x.loc === e.loc)),
  };
  await c.shutdown();
}

// ---- real repo: cost of the union on iam-mono ----
{
  const root = "/Users/nalaka.manathunga/code/iam-mono";
  const c = new LspClient({ cmd: TS7, args: ["--lsp", "--stdio"], cwd: root, name: "mitigation-iam" });
  await c.initialize(root, undefined, {});
  const tf = path.join(root, "services/iam-api/src/db/transaction.ts");
  await c.didOpen(tf);
  for (let i = 0; i < 80; i++) {
    const s = await c.req("textDocument/documentSymbol", { textDocument: { uri: (await c.didOpen(tf)) } });
    if (Array.isArray(s) && s.length) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const ch = await callHierarchyEdges(c, root, tf, "export async function withTransaction", "export async function ".length + 1);
  const rf = await referenceEdges(c, root, tf, "export async function withTransaction", "export async function ".length + 1);
  const chLocs = new Set(ch.edges.map((e) => e.loc));
  results.iamMono = {
    symbol: "withTransaction",
    callHierarchyEdges: ch.edges.length,
    callHierarchyMs: ch.ms,
    rawReferences: rf.rawRefs,
    referenceEdgesAfterFilter: rf.edges.length,
    referencesMs: rf.refMs,
    attributionMs: rf.attributeMs,
    documentSymbolRequests: rf.symbolRequests,
    extraEdgesFoundOnlyByReferences: rf.edges.filter((e) => !chLocs.has(e.loc)),
  };
  await c.shutdown();
}

fs.writeFileSync(path.join(HERE, "out-mitigation.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
process.exit(0);
