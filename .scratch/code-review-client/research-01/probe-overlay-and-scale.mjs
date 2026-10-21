// Two questions:
//  1. OVERLAY: a PR's version of a file differs from the working tree. Can we
//     didOpen with the PR blob's text and get answers about THAT text?
//  2. SCALE: how long does a wide incomingCalls BFS take on a hot symbol?
import { LspClient, locate, now } from "./client.mjs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const GOPLS = "/Users/nalaka.manathunga/go/bin/gopls";
const TS7 = path.join(HERE, "node_modules/@typescript/typescript-darwin-arm64/lib/tsc");
const IAM = "/Users/nalaka.manathunga/code/iam-mono";
const AUTH = "/Users/nalaka.manathunga/code/auth";

const key = (i) => `${i.uri}#${i.name}@${i.selectionRange.start.line}`;
const shortU = (u, root) => decodeURIComponent(String(u).replace("file://", "")).replace(root + "/", "");

async function ready(c, uri, budget = 90000) {
  const t0 = now();
  while (now() - t0 < budget) {
    const s = await c.req("textDocument/documentSymbol", { textDocument: { uri } });
    if (Array.isArray(s) && s.length) return now() - t0;
    await new Promise((r) => setTimeout(r, 200));
  }
  return -1;
}

// ---------------- 1. OVERLAY ----------------
async function overlayTest() {
  const out = {};
  const rel = "services/iam-api/src/db/transaction.ts";
  const abs = path.join(IAM, rel);
  const uri = pathToFileURL(abs).href;
  const onDisk = fs.readFileSync(abs, "utf8");

  // A synthetic "PR version" of the file: same exported API plus one extra
  // exported function that does NOT exist on disk.
  const prVersion =
    onDisk +
    `
export async function prOnlyHelper(db: Kysely<Database>): Promise<number> {
	return withTransaction(db, async () => 1);
}
`;

  const c = new LspClient({ cmd: TS7, args: ["--lsp", "--stdio"], cwd: IAM, name: "overlay" });
  await c.initialize(IAM, undefined, {});
  // didOpen with the PR text, NOT the disk text
  await c.conn.sendNotification("textDocument/didOpen", {
    textDocument: { uri, languageId: "typescript", version: 1, text: prVersion },
  });
  c.open = new Set([uri]);
  out.projectReadyMs = +(await ready(c, uri)).toFixed(0);

  const lines = prVersion.split("\n");
  const prLine = lines.findIndex((l) => l.includes("export async function prOnlyHelper"));
  const ch = lines[prLine].indexOf("prOnlyHelper") + 1;

  // Does the server see a symbol that exists only in our buffer?
  const syms = await c.req("textDocument/documentSymbol", { textDocument: { uri } });
  const flat = (s, a = []) => { for (const x of s ?? []) { a.push(x.name); if (x.children) flat(x.children, a); } return a; };
  out.symbolsSeen = flat(syms);
  out.prOnlySymbolVisible = out.symbolsSeen.includes("prOnlyHelper");

  // definition FROM the overlay-only line, into the real project
  const wtCh = lines[prLine + 1].indexOf("withTransaction") + 1;
  const def = await c.req("textDocument/definition", {
    textDocument: { uri }, position: { line: prLine + 1, character: wtCh },
  });
  out.definitionFromOverlayLine = (def ?? []).map((l) => shortU(l.uri ?? l.targetUri, IAM) + ":" + ((l.range ?? l.targetSelectionRange).start.line + 1));

  // call hierarchy on the overlay-only symbol
  const prep = await c.req("textDocument/prepareCallHierarchy", { textDocument: { uri }, position: { line: prLine, character: ch } });
  out.prepareOnOverlayOnlySymbol = (prep ?? []).map((i) => i.name);

  // and does the overlay's new call show up as an incoming call to withTransaction?
  const wtPos = locate(abs, "export async function withTransaction");
  const p2 = await c.req("textDocument/prepareCallHierarchy", {
    textDocument: { uri }, position: { line: wtPos.line, character: wtPos.character + "export async function ".length + 1 },
  });
  const inc = p2?.length ? await c.req("callHierarchy/incomingCalls", { item: p2[0] }) : [];
  out.incomingCallsIncludesOverlayCaller = (inc ?? []).some((x) => x.from.name === "prOnlyHelper");
  out.incomingCallers = (inc ?? []).map((x) => x.from.name).sort();

  // now flip it: didChange back to disk content, confirm the overlay symbol disappears
  await c.conn.sendNotification("textDocument/didChange", {
    textDocument: { uri, version: 2 },
    contentChanges: [{ text: onDisk }],
  });
  await new Promise((r) => setTimeout(r, 800));
  const p3 = await c.req("textDocument/prepareCallHierarchy", {
    textDocument: { uri }, position: { line: wtPos.line, character: wtPos.character + "export async function ".length + 1 },
  });
  const inc2 = p3?.length ? await c.req("callHierarchy/incomingCalls", { item: p3[0] }) : [];
  out.afterRevertIncludesOverlayCaller = (inc2 ?? []).some((x) => x.from.name === "prOnlyHelper");
  await c.shutdown();
  return out;
}

// ---------------- 2. SCALE ----------------
async function scaleTest(name, spec, root, relFile, needle, offset, maxDepth = 4) {
  const c = new LspClient({ ...spec, cwd: root, name });
  await c.initialize(root, spec.initializationOptions, {});
  const abs = path.join(root, relFile);
  const uri = await c.didOpen(abs);
  const readyMs = await ready(c, uri);
  const pos = locate(abs, needle);
  const prep = await c.req("textDocument/prepareCallHierarchy", { textDocument: { uri }, position: { line: pos.line, character: pos.character + offset } });
  const seen = new Map();
  let frontier = prep ?? [];
  for (const i of frontier) seen.set(key(i), 0);
  const perDepth = [];
  let reqs = 0;
  const t0 = now();
  for (let d = 1; d <= maxDepth && frontier.length; d++) {
    const tD = now();
    const next = [];
    for (const item of frontier) {
      reqs++;
      let inc;
      try { inc = await c.req("callHierarchy/incomingCalls", { item }); } catch { inc = []; }
      for (const call of inc ?? []) {
        const k = key(call.from);
        if (!seen.has(k)) { seen.set(k, d); next.push(call.from); }
      }
    }
    perDepth.push({ depth: d, requests: frontier.length, newSymbols: next.length, ms: +(now() - tD).toFixed(0) });
    frontier = next;
  }
  const files = new Set([...seen.keys()].map((k) => k.split("#")[0]));
  const out = {
    name, root, seed: needle, projectReadyMs: +readyMs.toFixed(0),
    totalBfsMs: +(now() - t0).toFixed(0), incomingCallsRequests: reqs,
    msPerRequest: +(((now() - t0) / Math.max(reqs, 1))).toFixed(1),
    totalSymbols: seen.size, totalFiles: files.size, perDepth,
  };
  await c.shutdown();
  return out;
}

const results = {};
results.overlay = await overlayTest();
results.scaleTS = await scaleTest("tsgo @ iam-mono withTransaction", { cmd: TS7, args: ["--lsp", "--stdio"] }, IAM,
  "services/iam-api/src/db/transaction.ts", "export async function withTransaction", "export async function ".length + 1, 5);
results.scaleGo = await scaleTest("gopls @ auth CreateUser", { cmd: GOPLS, args: ["-mode=stdio"] }, AUTH,
  "repository/mysql/user.go", "func CreateUser", 6, 5);

fs.writeFileSync(path.join(HERE, "out-overlay-scale.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
process.exit(0);
