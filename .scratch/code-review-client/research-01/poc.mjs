#!/usr/bin/env node
// MINIMAL WORKING PROOF (the ticket's deliverable).
//
// Resolves one textDocument/definition and one callHierarchy/incomingCalls
// against a real TypeScript repo and a real Go repo, from a plain Node client
// with no editor attached.
//
//   node poc.mjs
//
// Everything it relies on is in client.mjs (~200 lines, vscode-jsonrpc only).
import { LspClient, locate, now } from "./client.mjs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const TSGO = path.join(HERE, "node_modules/@typescript/typescript-darwin-arm64/lib/tsc");
const GOPLS = "/Users/nalaka.manathunga/go/bin/gopls";

const rel = (u, root) => decodeURIComponent(String(u).replace("file://", "")).replace(root + "/", "");

/**
 * Servers differ on whether they block until the project is loaded.
 * gopls and tsgo block; typescript-language-server returns an EMPTY array for
 * ~20s while tsserver loads. Never trust a first empty answer — poll.
 */
async function untilReady(c, uri, budgetMs = 120000) {
  const t0 = now();
  while (now() - t0 < budgetMs) {
    const s = await c.req("textDocument/documentSymbol", { textDocument: { uri } });
    if (Array.isArray(s) && s.length) return now() - t0;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("project never became ready");
}

async function prove({ title, spec, root, file, defNeedle, defOffset, chNeedle, chOffset }) {
  console.log(`\n${"=".repeat(72)}\n${title}\n  root: ${root}\n${"=".repeat(72)}`);
  const t0 = now();
  const c = new LspClient({ ...spec, cwd: root, name: title });

  // 1. initialize with rootUri + workspaceFolders, then `initialized`.
  await c.initialize(root, spec.initializationOptions, {});
  console.log(`  initialize handshake            ${(now() - t0).toFixed(0)} ms`);

  // 2. didOpen the file, reading its text from disk. No editor involved.
  //    (Pass PR-blob text here instead and the server answers about THAT text.)
  const abs = path.join(root, file);
  const uri = await c.didOpen(abs);
  const readyMs = await untilReady(c, uri);
  console.log(`  project ready (polled)          ${readyMs.toFixed(0)} ms`);

  // 3. GO TO DEFINITION
  const dp = locate(abs, defNeedle);
  const d = await c.timed("textDocument/definition", {
    textDocument: { uri },
    position: { line: dp.line, character: dp.character + defOffset },
  });
  const defs = (Array.isArray(d.result) ? d.result : [d.result]).filter(Boolean);
  console.log(`\n  textDocument/definition         ${d.ms.toFixed(0)} ms -> ${defs.length} result(s)`);
  for (const l of defs) {
    const r = l.range ?? l.targetSelectionRange;
    console.log(`      ${rel(l.uri ?? l.targetUri, root)}:${r.start.line + 1}`);
  }
  if (!defs.length) throw new Error("definition FAILED");

  // 4. INCOMING CALLS.
  //    prepareCallHierarchy is optional: items are stateless in gopls and tsgo,
  //    so a { name, kind, uri, range, selectionRange } you build yourself works.
  const cp = locate(abs, chNeedle);
  const p = await c.timed("textDocument/prepareCallHierarchy", {
    textDocument: { uri },
    position: { line: cp.line, character: cp.character + chOffset },
  });
  if (!p.result?.length) throw new Error("prepareCallHierarchy returned nothing");
  const inc = await c.incomingCalls(p.result[0]);
  console.log(
    `\n  prepareCallHierarchy            ${p.ms.toFixed(0)} ms -> "${p.result[0].name}"` +
      `\n  callHierarchy/incomingCalls     ${inc.ms.toFixed(0)} ms -> ${inc.result.length} caller(s)`,
  );
  for (const call of inc.result) {
    const r = call.from.selectionRange ?? call.from.range;
    console.log(
      `      ${rel(call.from.uri, root)}:${r.start.line + 1}  ${call.from.name}  (${(call.fromRanges ?? []).length} call site(s))`,
    );
  }
  if (!inc.result.length) throw new Error("incomingCalls FAILED");

  console.log(`\n  TOTAL from spawn                ${(now() - t0).toFixed(0)} ms`);
  await c.shutdown();
}

await prove({
  title: "TypeScript — tsgo (TypeScript 7 native) on iam-mono",
  spec: { cmd: TSGO, args: ["--lsp", "--stdio"] },
  root: "/Users/nalaka.manathunga/code/iam-mono",
  file: "services/iam-api/src/db/transaction.ts",
  defNeedle: "db.transaction().execute(fn)",
  defOffset: 4,
  chNeedle: "export async function withTransaction",
  chOffset: "export async function ".length + 1,
});

await prove({
  title: "Go — gopls on auth",
  spec: { cmd: GOPLS, args: [] },
  root: "/Users/nalaka.manathunga/code/auth",
  file: "service/identity.go",
  defNeedle: "addAttributesIfPresent(claims",
  defOffset: 1,
  chNeedle: "func addAttributesIfPresent",
  chOffset: 6,
});

console.log("\nBOTH PROOFS PASSED\n");
process.exit(0);
