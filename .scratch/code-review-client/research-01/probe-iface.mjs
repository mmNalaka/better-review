// Does gopls follow interface dispatch when the interface is in ANOTHER
// package, or in the stdlib? And do generic methods participate?
import { LspClient, locate } from "./client.mjs";
import path from "node:path";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(HERE, "fixtures/go");
const c = new LspClient({ cmd:"/Users/nalaka.manathunga/go/bin/gopls", args:[], cwd:ROOT, name:"iface" });
await c.initialize(ROOT, undefined, {});
for (const f of ["iface/iface.go","impl2/impl2.go","target/target.go","callers/callers.go"]) await c.didOpen(path.join(ROOT,f));
await new Promise(r=>setTimeout(r,6000));
const S=(u)=>decodeURIComponent(String(u).replace("file://","")).replace(ROOT+"/","");
async function inc(file, needle, off, label){
  const abs=path.join(ROOT,file); const uri=await c.didOpen(abs); const p=locate(abs,needle);
  const prep=await c.req("textDocument/prepareCallHierarchy",{textDocument:{uri},position:{line:p.line,character:p.character+off}});
  if(!Array.isArray(prep)||!prep.length){ console.log(`${label}: prepare -> NOTHING`); return; }
  const r=await c.req("callHierarchy/incomingCalls",{item:prep[0]});
  console.log(`${label}: item="${prep[0].name}" incoming=${(r||[]).length}`);
  for(const x of (r||[])) console.log(`    <- ${S(x.from.uri)}:${x.from.selectionRange.start.line+1} ${x.from.name}`);
}
console.log("=== CROSS-PACKAGE interface: impl Concrete.Do (interface iface.Doer lives elsewhere) ===");
await inc("impl2/impl2.go","func (c Concrete) Do","func (c Concrete) ".length+1,"Concrete.Do");
console.log("\n=== the cross-package interface METHOD decl itself ===");
await inc("iface/iface.go","Do(x int) int",1,"iface.Doer.Do");
console.log("\n=== STDLIB interface: MyReader.Read (io.Reader is outside the workspace) ===");
await inc("impl2/impl2.go","func (m MyReader) Read","func (m MyReader) ".length+1,"MyReader.Read");
console.log("\n=== GENERIC method Box[T].Get ===");
await inc("impl2/impl2.go","func (b Box[T]) Get","func (b Box[T]) ".length+1,"Box.Get");
console.log("\n=== control: SAME-package interface impl (Alpha.Handle) ===");
await inc("target/target.go","func (a Alpha) Handle","func (a Alpha) ".length+1,"Alpha.Handle");
console.log("\n=== implementation() for cross-pkg iface.Doer.Do ===");
{ const abs=path.join(ROOT,"iface/iface.go"); const uri=await c.didOpen(abs); const p=locate(abs,"Do(x int) int");
  const im=await c.req("textDocument/implementation",{textDocument:{uri},position:{line:p.line,character:p.character+1}});
  console.log(JSON.stringify((im||[]).map(l=>S(l.uri??l.targetUri)+":"+((l.range??l.targetSelectionRange).start.line+1)))); }
await c.shutdown(); process.exit(0);
