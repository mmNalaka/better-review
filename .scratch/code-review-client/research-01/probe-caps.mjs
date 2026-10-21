// Capability probe: what does each candidate server actually advertise?
import { LspClient } from "./client.mjs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const GOPLS = "/Users/nalaka.manathunga/go/bin/gopls";
const TS7 = path.join(HERE, "node_modules/@typescript/typescript-darwin-arm64/lib/tsc");
const TS5_LIB = path.join(HERE, "ts5/node_modules/typescript/lib");

const targets = [
  {
    name: "typescript-language-server(6.0.0)+tsserver 5.9.3",
    cmd: process.execPath,
    args: [path.join(HERE, "node_modules/typescript-language-server/lib/cli.mjs"), "--stdio"],
    root: "/Users/nalaka.manathunga/code/iam-mono",
    initializationOptions: { tsserver: { path: path.join(TS5_LIB, "tsserver.js"), logVerbosity: "off" } },
  },
  {
    name: "tsgo/TypeScript 7.0.2 native --lsp",
    cmd: TS7,
    args: ["--lsp", "--stdio"],
    root: "/Users/nalaka.manathunga/code/iam-mono",
  },
  {
    name: "vtsls",
    cmd: process.execPath,
    args: [path.join(HERE, "node_modules/@vtsls/language-server/bin/vtsls.js"), "--stdio"],
    root: "/Users/nalaka.manathunga/code/iam-mono",
    initializationOptions: { typescript: { tsdk: TS5_LIB } },
  },
  {
    name: "gopls",
    cmd: GOPLS,
    args: ["-mode=stdio"],
    root: "/Users/nalaka.manathunga/code/auth",
  },
];

const KEYS = [
  "definitionProvider",
  "typeDefinitionProvider",
  "implementationProvider",
  "referencesProvider",
  "callHierarchyProvider",
  "typeHierarchyProvider",
  "documentSymbolProvider",
  "workspaceSymbolProvider",
  "hoverProvider",
  "renameProvider",
];

for (const t of targets) {
  process.stdout.write(`\n=== ${t.name} ===\n`);
  let c;
  try {
    c = new LspClient({ cmd: t.cmd, args: t.args, cwd: t.root, name: t.name });
    const { initializeMs } = await Promise.race([
      c.initialize(t.root, t.initializationOptions, {}),
      new Promise((_, rj) => setTimeout(() => rj(new Error("initialize timeout 60s")), 60000)),
    ]);
    console.log("serverInfo:", JSON.stringify(c.serverInfo));
    console.log("initialize round-trip ms:", initializeMs.toFixed(0));
    for (const k of KEYS) {
      const v = c.capabilities?.[k];
      console.log(
        `  ${k.padEnd(24)} ${v === undefined ? "-" : typeof v === "object" ? "OBJECT " + JSON.stringify(v).slice(0, 90) : v}`,
      );
    }
  } catch (e) {
    console.log("FAILED:", e.message);
    console.log("stderr tail:", (c?.logs ?? []).join("").slice(-800));
  } finally {
    await c?.shutdown();
  }
}
process.exit(0);
