// Can we SYNTHESIZE a CallHierarchyItem (skip prepareCallHierarchy)?
import { LspClient, locate } from "./client.mjs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const TS7 = path.join(HERE, "node_modules/@typescript/typescript-darwin-arm64/lib/tsc");
const cases = [
  { name:"gopls", spec:{cmd:"/Users/nalaka.manathunga/go/bin/gopls",args:[]}, root:path.join(HERE,"fixtures/go"),
    file:"target/target.go", needle:"func TARGET", off:5, len:6, kind:12, symName:"TARGET" },
  { name:"tsgo", spec:{cmd:TS7,args:["--lsp","--stdio"]}, root:path.join(HERE,"fixtures/ts"),
    file:"src/target.ts", needle:"export function TARGET", off:"export function ".length, len:6, kind:12, symName:"TARGET" },
];
for (const t of cases) {
  const c = new LspClient({ ...t.spec, cwd:t.root, name:t.name });
  await c.initialize(t.root, undefined, {});
  const abs = path.join(t.root, t.file);
  const uri = await c.didOpen(abs);
  await new Promise(r=>setTimeout(r, t.name==="gopls"?6000:3000));
  const p = locate(abs, t.needle);
  const real = await c.req("textDocument/prepareCallHierarchy",{textDocument:{uri},position:{line:p.line,character:p.character+t.off+1}});
  console.log(`\n=== ${t.name} ===`);
  console.log("prepare item keys:", Object.keys(real?.[0]??{}).join(","), "| has data:", real?.[0]?.data!==undefined);
  const realInc = await c.req("callHierarchy/incomingCalls",{item:real[0]});
  console.log("incoming via REAL item:", (realInc||[]).length);
  const sel = { start:{line:p.line,character:p.character+t.off}, end:{line:p.line,character:p.character+t.off+t.len} };
  const synth = { name:t.symName, kind:t.kind, uri:pathToFileURL(abs).href, range:sel, selectionRange:sel };
  try {
    const sInc = await c.req("callHierarchy/incomingCalls",{item:synth});
    console.log("incoming via SYNTHESIZED item:", Array.isArray(sInc)?sInc.length:JSON.stringify(sInc));
    const a=new Set((realInc||[]).map(x=>x.from.name).sort()), b=new Set((sInc||[]).map(x=>x.from.name).sort());
    console.log("identical set:", a.size===b.size && [...a].every(x=>b.has(x)));
  } catch(e){ console.log("SYNTHESIZED item FAILED:", String(e).slice(0,160)); }
  await c.shutdown();
}
process.exit(0);
