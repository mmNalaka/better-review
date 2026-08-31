// Failure-mode probe: for a controlled fixture with a known ground truth,
// what does callHierarchy/incomingCalls actually return?
import { LspClient, locate } from "./client.mjs";
import path from "node:path";
import fs from "node:fs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const GOPLS = "/Users/nalaka.manathunga/go/bin/gopls";
const TS7 = path.join(HERE, "node_modules/@typescript/typescript-darwin-arm64/lib/tsc");
const TS5_LIB = path.join(HERE, "ts5/node_modules/typescript/lib");

const which = process.argv[2] ?? "all";

const short = (uri, root) =>
  decodeURIComponent(String(uri).replace(/^file:\/\//, "")).replace(root + "/", "");

function fmtCalls(calls, root) {
  if (!calls) return ["<null>"];
  return calls
    .map((c) => {
      const f = c.from;
      const r = f.selectionRange ?? f.range;
      const nRanges = (c.fromRanges ?? []).length;
      return `${short(f.uri, root)}:${r.start.line + 1} ${f.name}${f.detail ? " " + f.detail : ""} [kind=${f.kind}, fromRanges=${nRanges}]`;
    })
    .sort();
}

async function probeTS(label, spawnSpec) {
  const root = path.join(HERE, "fixtures/ts");
  const c = new LspClient({ ...spawnSpec, cwd: root, name: label });
  await c.initialize(root, spawnSpec.initializationOptions, spawnSpec.settings ?? {});
  // Open every fixture file: some servers only see what is open or what the
  // project graph reaches. We want maximum charity toward the server.
  const files = fs
    .readdirSync(path.join(root, "src"))
    .map((f) => path.join(root, "src", f));
  for (const f of files) await c.didOpen(f);
  await new Promise((r) => setTimeout(r, 2500)); // let the project load

  const targetFile = path.join(root, "src/target.ts");
  const out = {};

  // --- A. incoming calls to a plain exported function ---
  {
    const pos = locate(targetFile, "export function TARGET");
    const prep = await c.prepareCallHierarchy(targetFile, pos.line, pos.character + "export function ".length + 1);
    out.prepareTARGET = prep.result;
    if (prep.result?.length) {
      const inc = await c.incomingCalls(prep.result[0]);
      out.incomingTARGET = fmtCalls(inc.result, root);
      out.incomingTARGETms = inc.ms;
    }
  }

  // --- B. interface method declaration ---
  {
    const pos = locate(targetFile, "handle(x: number): number;");
    const prep = await c.prepareCallHierarchy(targetFile, pos.line, pos.character + 1);
    if (prep.result?.length) {
      const inc = await c.incomingCalls(prep.result[0]);
      out.incomingIfaceDecl = fmtCalls(inc.result, root);
    } else out.incomingIfaceDecl = ["<prepare returned nothing>"];
  }

  // --- C. the CONCRETE implementation of that interface method ---
  {
    const src = fs.readFileSync(targetFile, "utf8").split("\n");
    const ln = src.findIndex((l) => l.includes("return TARGET(x); // CASE-IFACE-IMPL-A"));
    const declLn = ln - 1; // the `handle(x: number): number {` line
    const ch = src[declLn].indexOf("handle") + 1;
    const prep = await c.prepareCallHierarchy(targetFile, declLn, ch);
    if (prep.result?.length) {
      const inc = await c.incomingCalls(prep.result[0]);
      out.incomingIfaceImpl = fmtCalls(inc.result, root);
    } else out.incomingIfaceImpl = ["<prepare returned nothing>"];
    // and: does textDocument/implementation bridge the gap?
    const posIface = locate(targetFile, "handle(x: number): number;");
    const impl = await c.timed("textDocument/implementation", {
      textDocument: { uri: (await c.didOpen(targetFile)) },
      position: { line: posIface.line, character: posIface.character + 1 },
    });
    out.implementationOfIfaceMethod = (impl.result ?? []).map(
      (l) => `${short(l.uri ?? l.targetUri, root)}:${(l.range ?? l.targetSelectionRange).start.line + 1}`,
    );
  }

  // --- D. base class method overridden in a subclass ---
  {
    const pos = locate(targetFile, "render(): number {");
    const prep = await c.prepareCallHierarchy(targetFile, pos.line, pos.character + 1);
    if (prep.result?.length) {
      const inc = await c.incomingCalls(prep.result[0]);
      out.incomingBaseRender = fmtCalls(inc.result, root);
    } else out.incomingBaseRender = ["<prepare returned nothing>"];
  }

  // --- E. JSX component ---
  {
    const f = path.join(root, "src/component.tsx");
    const pos = locate(f, "export function Leaf");
    const prep = await c.prepareCallHierarchy(f, pos.line, pos.character + "export function ".length + 1);
    if (prep.result?.length) {
      const inc = await c.incomingCalls(prep.result[0]);
      out.incomingJsxLeaf = fmtCalls(inc.result, root);
    } else out.incomingJsxLeaf = ["<prepare returned nothing>"];
  }

  // --- F. outgoing calls from a caller function ---
  {
    const f = path.join(root, "src/callers.ts");
    const pos = locate(f, "export function interfaceEntryPoint");
    const prep = await c.prepareCallHierarchy(f, pos.line, pos.character + "export function ".length + 1);
    if (prep.result?.length) {
      const outg = await c.outgoingCalls(prep.result[0]);
      out.outgoingInterfaceEntryPoint = (outg.result ?? []).map(
        (x) => `${short(x.to.uri, root)}:${(x.to.selectionRange ?? x.to.range).start.line + 1} ${x.to.name}`,
      );
    }
  }

  // --- G. references, for comparison with incomingCalls ---
  {
    const pos = locate(targetFile, "export function TARGET");
    const refs = await c.references(targetFile, pos.line, pos.character + "export function ".length + 1, false);
    out.referencesTARGET = (refs.result ?? [])
      .map((r) => `${short(r.uri, root)}:${r.range.start.line + 1}`)
      .sort();
    out.referencesTARGETcount = (refs.result ?? []).length;
  }

  await c.shutdown();
  return out;
}

async function probeGo(label) {
  const root = path.join(HERE, "fixtures/go");
  const c = new LspClient({ cmd: GOPLS, args: ["-mode=stdio"], cwd: root, name: label });
  await c.initialize(root, undefined, {});
  const files = [
    "target/target.go",
    "callers/callers.go",
    "gen/gen.pb.go",
    "orphan/orphan.go",
  ].map((f) => path.join(root, f));
  for (const f of files) await c.didOpen(f);
  await new Promise((r) => setTimeout(r, 3000));

  const targetFile = path.join(root, "target/target.go");
  const out = {};

  {
    const pos = locate(targetFile, "func TARGET");
    const prep = await c.prepareCallHierarchy(targetFile, pos.line, pos.character + 6);
    out.prepareTARGET = prep.result;
    if (prep.result?.length) {
      const inc = await c.incomingCalls(prep.result[0]);
      out.incomingTARGET = fmtCalls(inc.result, root);
      out.incomingTARGETms = inc.ms;
    }
  }

  {
    const pos = locate(targetFile, "Handle(x int) int");
    const prep = await c.prepareCallHierarchy(targetFile, pos.line, pos.character + 1);
    if (prep.result?.length) {
      const inc = await c.incomingCalls(prep.result[0]);
      out.incomingIfaceDecl = fmtCalls(inc.result, root);
    } else out.incomingIfaceDecl = ["<prepare returned nothing>"];
  }

  {
    const pos = locate(targetFile, "func (a Alpha) Handle");
    const prep = await c.prepareCallHierarchy(targetFile, pos.line, pos.character + "func (a Alpha) ".length + 1);
    if (prep.result?.length) {
      const inc = await c.incomingCalls(prep.result[0]);
      out.incomingIfaceImpl = fmtCalls(inc.result, root);
    } else out.incomingIfaceImpl = ["<prepare returned nothing>"];
    const posIface = locate(targetFile, "Handle(x int) int");
    const impl = await c.timed("textDocument/implementation", {
      textDocument: { uri: await c.didOpen(targetFile) },
      position: { line: posIface.line, character: posIface.character + 1 },
    });
    out.implementationOfIfaceMethod = (impl.result ?? []).map(
      (l) => `${short(l.uri ?? l.targetUri, root)}:${(l.range ?? l.targetSelectionRange).start.line + 1}`,
    );
  }

  {
    const pos = locate(targetFile, "func (b *Base) Method");
    const prep = await c.prepareCallHierarchy(targetFile, pos.line, pos.character + "func (b *Base) ".length + 1);
    if (prep.result?.length) {
      const inc = await c.incomingCalls(prep.result[0]);
      out.incomingPromotedMethod = fmtCalls(inc.result, root);
    } else out.incomingPromotedMethod = ["<prepare returned nothing>"];
  }

  {
    const f = path.join(root, "callers/callers.go");
    const pos = locate(f, "func InterfaceEntryPoint");
    const prep = await c.prepareCallHierarchy(f, pos.line, pos.character + 5);
    if (prep.result?.length) {
      const outg = await c.outgoingCalls(prep.result[0]);
      out.outgoingInterfaceEntryPoint = (outg.result ?? []).map(
        (x) => `${short(x.to.uri, root)}:${(x.to.selectionRange ?? x.to.range).start.line + 1} ${x.to.name}`,
      );
    }
  }

  {
    const pos = locate(targetFile, "func TARGET");
    const refs = await c.references(targetFile, pos.line, pos.character + 6, false);
    out.referencesTARGET = (refs.result ?? [])
      .map((r) => `${short(r.uri, root)}:${r.range.start.line + 1}`)
      .sort();
    out.referencesTARGETcount = (refs.result ?? []).length;
  }

  await c.shutdown();
  return out;
}

const TS_SERVERS = {
  tls: {
    cmd: process.execPath,
    args: [path.join(HERE, "node_modules/typescript-language-server/lib/cli.mjs"), "--stdio"],
    initializationOptions: {
      tsserver: { path: path.join(TS5_LIB, "tsserver.js"), logVerbosity: "off" },
      preferences: { includeCompletionsForModuleExports: true },
    },
  },
  tsgo: { cmd: TS7, args: ["--lsp", "--stdio"] },
  vtsls: {
    cmd: process.execPath,
    args: [path.join(HERE, "node_modules/@vtsls/language-server/bin/vtsls.js"), "--stdio"],
    initializationOptions: { typescript: { tsdk: TS5_LIB } },
  },
};

const results = {};
if (which === "all" || which === "ts") {
  for (const [k, v] of Object.entries(TS_SERVERS)) {
    process.stderr.write(`\n--- probing ${k} ---\n`);
    try {
      results[k] = await probeTS(k, v);
    } catch (e) {
      results[k] = { error: String(e) };
    }
  }
}
if (which === "all" || which === "go") {
  process.stderr.write(`\n--- probing gopls ---\n`);
  try {
    results.gopls = await probeGo("gopls");
  } catch (e) {
    results.gopls = { error: String(e) };
  }
}

fs.writeFileSync(
  path.join(HERE, `out-callhierarchy-${which}.json`),
  JSON.stringify(results, null, 2),
);

for (const [server, r] of Object.entries(results)) {
  console.log(`\n################ ${server} ################`);
  if (r.error) {
    console.log("ERROR", r.error);
    continue;
  }
  console.log(`prepareCallHierarchy(TARGET) ->`, JSON.stringify(r.prepareTARGET?.map((i) => i.name)));
  console.log(`incomingCalls(TARGET)  [${r.incomingTARGETms?.toFixed(0)}ms]  n=${r.incomingTARGET?.length}`);
  for (const l of r.incomingTARGET ?? []) console.log("    " + l);
  console.log(`references(TARGET) n=${r.referencesTARGETcount}`);
  for (const l of r.referencesTARGET ?? []) console.log("    " + l);
  console.log(`incomingCalls(interface method DECL) n=${r.incomingIfaceDecl?.length}`);
  for (const l of r.incomingIfaceDecl ?? []) console.log("    " + l);
  console.log(`incomingCalls(concrete IMPL of that method) n=${r.incomingIfaceImpl?.length}`);
  for (const l of r.incomingIfaceImpl ?? []) console.log("    " + l);
  console.log(`textDocument/implementation(iface method) ->`, JSON.stringify(r.implementationOfIfaceMethod));
  if (r.incomingBaseRender)
    console.log(`incomingCalls(Widget.render base) ->`, JSON.stringify(r.incomingBaseRender));
  if (r.incomingPromotedMethod)
    console.log(`incomingCalls((*Base).Method, promoted) ->`, JSON.stringify(r.incomingPromotedMethod));
  if (r.incomingJsxLeaf) console.log(`incomingCalls(JSX <Leaf/>) ->`, JSON.stringify(r.incomingJsxLeaf));
  console.log(`outgoingCalls(interfaceEntryPoint) ->`, JSON.stringify(r.outgoingInterfaceEntryPoint));
}
process.exit(0);
