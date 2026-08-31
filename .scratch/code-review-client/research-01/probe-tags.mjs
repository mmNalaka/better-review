import { LspClient } from "./client.mjs";
const WT = process.env.HOME + "/Library/Application Support/better-review/worktrees/sitoo__auth/pr-146";
const FILE = WT + "/integrationtest/scim_iam_test.go";
const GOPLS = process.env.HOME + "/go/bin/gopls";

for (const [label, settings] of [
  ["nested   { build: { buildFlags } }", { build: { buildFlags: ["-tags=integration_test"] } }],
  ["flat     { 'build.buildFlags' }", { "build.buildFlags": ["-tags=integration_test"] }],
  ["env      GOFLAGS", null],
]) {
  const c = new LspClient({
    cmd: GOPLS, args: [], cwd: WT, name: label,
    env: label.startsWith("env") ? { GOFLAGS: "-tags=integration_test" } : {},
  });
  try {
    await c.initialize(WT, settings ?? undefined, settings ?? {});
    const uri = await c.didOpen(FILE);
    let out;
    try {
      const s = await c.req("textDocument/documentSymbol", { textDocument: { uri } });
      out = `OK ${Array.isArray(s) ? s.length : 0} symbols`;
    } catch (e) { out = "REFUSED " + String(e.message).slice(0, 45); }
    console.log(label.padEnd(38), out);
  } finally { await c.shutdown(); }
}
