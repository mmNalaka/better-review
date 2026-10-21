import { LspClient } from "./client.mjs";
import path from "node:path";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const TS7 = path.join(HERE, "node_modules/@typescript/typescript-darwin-arm64/lib/tsc");
const TS5_LIB = path.join(HERE, "ts5/node_modules/typescript/lib");
const REPO = "/Users/nalaka.manathunga/code/iam-mono";
const REL = "services/iam-api/src/modules/role-assignments/role-assignments.controller.ts";
const specs = {
  tsgo: { cmd: TS7, args:["--lsp","--stdio"] },
  tls:  { cmd: process.execPath, args:[path.join(HERE,"node_modules/typescript-language-server/lib/cli.mjs"),"--stdio"],
          initializationOptions:{ tsserver:{ path: path.join(TS5_LIB,"tsserver.js"), logVerbosity:"off" } } },
};
const flat=(s,a=[])=>{for(const x of s??[]){a.push(x); if(x.children)flat(x.children,a);} return a;};
for (const [name,spec] of Object.entries(specs)) {
  const c = new LspClient({ ...spec, cwd: REPO, name });
  await c.initialize(REPO, spec.initializationOptions, {});
  const uri = await c.didOpen(path.join(REPO, REL));
  let syms=[]; for(let i=0;i<80;i++){ syms=await c.req("textDocument/documentSymbol",{textDocument:{uri}}); if(Array.isArray(syms)&&syms.length)break; await new Promise(r=>setTimeout(r,300)); }
  const all = flat(syms);
  console.log(`\n=== ${name} ===`);
  for (const s of all.filter(x=>x.kind===12||x.kind===6)) {
    const p = await c.req("textDocument/prepareCallHierarchy",{textDocument:{uri},position:{line:s.selectionRange.start.line,character:s.selectionRange.start.character}});
    const got = Array.isArray(p)&&p.length ? p.map(i=>`${i.name}[kind=${i.kind}]`).join(",") : "NOTHING";
    let inc = "-";
    if (Array.isArray(p)&&p.length) { const r = await c.req("callHierarchy/incomingCalls",{item:p[0]}); inc = Array.isArray(r)? String(r.length):"null"; }
    console.log(`  L${s.range.start.line+1}-${s.range.end.line+1} "${s.name}" -> prepare=${got} incoming=${inc}`);
  }
  await c.shutdown();
}
process.exit(0);
