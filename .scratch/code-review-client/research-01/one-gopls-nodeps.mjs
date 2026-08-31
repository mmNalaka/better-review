import { LspClient, locate, now } from "./client.mjs";
import path from "node:path";
const root = "/Users/nalaka.manathunga/code/auth";
const c = new LspClient({
  cmd: "/Users/nalaka.manathunga/go/bin/gopls", args: ["-mode=stdio"], cwd: root, name: "nodeps",
  env: { GOMODCACHE: path.resolve("degrade/empty-modcache"), GOPROXY: "off", GOFLAGS: "-mod=mod" },
});
const t0 = now();
await c.initialize(root, undefined, {});
const abs = path.join(root, "service/identity.go");
const uri = await c.didOpen(abs);
const dp = locate(abs, "addAttributesIfPresent(claims");
const cp = locate(abs, "func addAttributesIfPresent");
let def = null, ch = null;
for (let i = 0; i < 100; i++) {
  await new Promise(r => setTimeout(r, 600));
  try { const d = await c.req("textDocument/definition", { textDocument:{uri}, position:{line:dp.line,character:dp.character+1} }); if (Array.isArray(d)&&d.length) { def = { ms: +(now()-t0).toFixed(0), n: d.length }; } } catch(e){}
  try { const p = await c.req("textDocument/prepareCallHierarchy", { textDocument:{uri}, position:{line:cp.line,character:cp.character+6} });
        if (Array.isArray(p)&&p.length) { const r = await c.req("callHierarchy/incomingCalls",{item:p[0]}); if (Array.isArray(r)) ch = { ms:+(now()-t0).toFixed(0), n:r.length, callers:r.map(x=>x.from.name) }; } } catch(e){}
  if (def && ch) break;
}
await new Promise(r=>setTimeout(r,3000));
let dg=0; const msgs=[];
for (const [u,arr] of c.diagnostics){dg+=arr.length; for(const x of arr.slice(0,2)) msgs.push(u.split("/").pop()+": "+x.message.slice(0,140));}
console.log(JSON.stringify({ definition:def, incomingCalls:ch, diagnostics:dg, diagSample:msgs.slice(0,6),
  logTail: c.logs.join("").slice(-900).replace(/\n/g," | ") }, null, 2));
await c.shutdown(); process.exit(0);
