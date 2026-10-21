import { LspClient } from "./client.mjs";
const WT = process.env.HOME + "/Library/Application Support/better-review/worktrees/sitoo__auth/pr-146";
const FILE = WT + "/integrationtest/scim_iam_test.go";
const GOPLS = process.env.HOME + "/go/bin/gopls";
const POS = { line: 25, character: 13 }; // mysql.SetupSQL()

for (const [label, settings, env] of [
  ["no tags at all", undefined, {}],
  ["nested build.buildFlags", { build: { buildFlags: ["-tags=integration_test"] } }, {}],
  ["flat 'build.buildFlags'", { "build.buildFlags": ["-tags=integration_test"] }, {}],
  ["GOFLAGS env", undefined, { GOFLAGS: "-tags=integration_test" }],
]) {
  const c = new LspClient({ cmd: GOPLS, args: [], cwd: WT, name: label, env });
  try {
    await c.initialize(WT, settings, settings ?? {});
    const uri = await c.didOpen(FILE);
    await new Promise((r) => setTimeout(r, 3000)); // let the build load
    let out;
    try {
      const d = await c.req("textDocument/definition", { textDocument: { uri }, position: POS });
      const n = Array.isArray(d) ? d.length : d ? 1 : 0;
      out = `OK ${n} definition(s)`;
    } catch (e) { out = "REFUSED " + String(e.message).slice(0, 40); }
    console.log(label.padEnd(26), out);
  } finally { await c.shutdown(); }
}
