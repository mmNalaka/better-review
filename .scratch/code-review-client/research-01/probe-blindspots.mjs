// Exact blind-spot diff: every reference to TARGET, and whether
// callHierarchy/incomingCalls attributed it to some caller.
import { LspClient, locate } from "./client.mjs";
import path from "node:path";
import fs from "node:fs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const GOPLS = "/Users/nalaka.manathunga/go/bin/gopls";
const TS7 = path.join(HERE, "node_modules/@typescript/typescript-darwin-arm64/lib/tsc");
const TS5_LIB = path.join(HERE, "ts5/node_modules/typescript/lib");

const short = (uri, root) =>
  decodeURIComponent(String(uri).replace(/^file:\/\//, "")).replace(root + "/", "");

async function run(label, spec, root, files, targetRel, targetNeedle, needleOffset) {
  const c = new LspClient({ ...spec, cwd: root, name: label });
  await c.initialize(root, spec.initializationOptions, {});
  for (const f of files) await c.didOpen(path.join(root, f));
  await new Promise((r) => setTimeout(r, 3000));

  const targetFile = path.join(root, targetRel);
  const pos = locate(targetFile, targetNeedle);
  const ch = pos.character + needleOffset;

  const prep = await c.prepareCallHierarchy(targetFile, pos.line, ch);
  const item = prep.result?.[0];
  const inc = item ? (await c.incomingCalls(item)).result ?? [] : [];
  const refs = (await c.references(targetFile, pos.line, ch, false)).result ?? [];

  // every fromRange, flattened
  const attributed = new Set();
  const byRange = new Map();
  for (const call of inc) {
    for (const r of call.fromRanges ?? []) {
      const key = `${short(call.from.uri, root)}:${r.start.line + 1}:${r.start.character}`;
      attributed.add(key);
      byRange.set(key, call.from.name);
    }
  }

  const srcCache = new Map();
  const lineText = (rel, ln) => {
    if (!srcCache.has(rel)) srcCache.set(rel, fs.readFileSync(path.join(root, rel), "utf8").split("\n"));
    return (srcCache.get(rel)[ln] ?? "").trim();
  };

  const rows = refs
    .map((r) => {
      const rel = short(r.uri, root);
      const key = `${rel}:${r.range.start.line + 1}:${r.range.start.character}`;
      return {
        key,
        rel,
        line: r.range.start.line,
        text: lineText(rel, r.range.start.line),
        attributedTo: byRange.get(key) ?? null,
      };
    })
    .sort((a, b) => (a.rel + String(a.line).padStart(4, "0")).localeCompare(b.rel + String(b.line).padStart(4, "0")));

  await c.shutdown();
  return { label, rows, incCount: inc.length, refCount: refs.length };
}

const TS_ROOT = path.join(HERE, "fixtures/ts");
const TS_FILES = fs.readdirSync(path.join(TS_ROOT, "src")).map((f) => "src/" + f);
const GO_ROOT = path.join(HERE, "fixtures/go");
const GO_FILES = ["target/target.go", "callers/callers.go", "gen/gen.pb.go", "orphan/orphan.go"];

const jobs = [
  [
    "typescript-language-server+ts5.9",
    {
      cmd: process.execPath,
      args: [path.join(HERE, "node_modules/typescript-language-server/lib/cli.mjs"), "--stdio"],
      initializationOptions: { tsserver: { path: path.join(TS5_LIB, "tsserver.js"), logVerbosity: "off" } },
    },
    TS_ROOT,
    TS_FILES,
    "src/target.ts",
    "export function TARGET",
    "export function ".length + 1,
  ],
  [
    "tsgo 7.0.2 --lsp",
    { cmd: TS7, args: ["--lsp", "--stdio"] },
    TS_ROOT,
    TS_FILES,
    "src/target.ts",
    "export function TARGET",
    "export function ".length + 1,
  ],
  ["gopls 0.23.0", { cmd: GOPLS, args: ["-mode=stdio"] }, GO_ROOT, GO_FILES, "target/target.go", "func TARGET", 6],
];

for (const j of jobs) {
  const r = await run(...j);
  console.log(`\n############ ${r.label}  (references=${r.refCount}, incomingCalls items=${r.incCount}) ############`);
  console.log("ATTR? | location                    | caller attributed      | source line");
  for (const row of r.rows) {
    const mark = row.attributedTo ? " OK  " : " MISS";
    console.log(
      `${mark} | ${(row.rel + ":" + (row.line + 1)).padEnd(28)} | ${(row.attributedTo ?? "—").padEnd(22)} | ${row.text.slice(0, 70)}`,
    );
  }
  const missed = r.rows.filter((x) => !x.attributedTo);
  console.log(`--> ${missed.length}/${r.rows.length} references NOT attributed to any caller`);
}
process.exit(0);
