import { LspClient, locate, now } from "./client.mjs";
import path from "node:path";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const TS7 = path.join(HERE, "node_modules/@typescript/typescript-darwin-arm64/lib/tsc");
const runtime = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`;
console.log("runtime:", runtime);
const cases = [
  ["gopls", {cmd:"/Users/nalaka.manathunga/go/bin/gopls",args:[]}, path.join(HERE,"fixtures/go"), "target/target.go", "func TARGET", 6],
  ["tsgo",  {cmd:TS7,args:["--lsp","--stdio"]}, path.join(HERE,"fixtures/ts"), "src/target.ts", "export function TARGET", "export function ".length+1],
];
for (const [name,spec,root,file,needle,off] of cases) {
  const t0=now();
  try {
    const c = new LspClient({...spec, cwd:root, name});
    await c.initialize(root, undefined, {});
    const abs=path.join(root,file); const uri=await c.didOpen(abs);
    await new Promise(r=>setTimeout(r, name==="gopls"?6000:2500));
    const p=locate(abs,needle);
    const prep=await c.req("textDocument/prepareCallHierarchy",{textDocument:{uri},position:{line:p.line,character:p.character+off}});
    const inc=prep?.length? await c.req("callHierarchy/incomingCalls",{item:prep[0]}) : [];
    const def=await c.req("textDocument/definition",{textDocument:{uri},position:{line:p.line,character:p.character+off}});
    console.log(`  ${name}: OK  incomingCalls=${(inc||[]).length}  definition=${Array.isArray(def)?def.length:typeof def}  ${(now()-t0).toFixed(0)}ms`);
    await c.shutdown();
  } catch(e){ console.log(`  ${name}: FAILED ${String(e).slice(0,200)}`); }
}
