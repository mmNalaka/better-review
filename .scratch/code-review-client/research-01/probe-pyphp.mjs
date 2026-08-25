import { LspClient, locate } from "./client.mjs";
import path from "node:path";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const KEYS=["definitionProvider","referencesProvider","callHierarchyProvider","implementationProvider","typeHierarchyProvider","documentSymbolProvider"];
const cases=[
 {name:"pyright-langserver", cmd:process.execPath, args:[path.join(HERE,"node_modules/pyright/langserver.index.js"),"--stdio"],
  root:path.join(HERE,"fixtures/py"), files:["target.py","callers.py"], tf:"target.py", needle:"def TARGET", off:4},
 {name:"basedpyright-langserver", cmd:process.execPath, args:[path.join(HERE,"node_modules/basedpyright/langserver.index.js"),"--stdio"],
  root:path.join(HERE,"fixtures/py"), files:["target.py","callers.py"], tf:"target.py", needle:"def TARGET", off:4},
 {name:"intelephense", cmd:process.execPath, args:[path.join(HERE,"node_modules/intelephense/lib/intelephense.js"),"--stdio"],
  root:path.join(HERE,"fixtures/php"), files:["target.php","callers.php"], tf:"target.php", needle:"function TARGET", off:9},
];
for(const t of cases){
  console.log(`\n=== ${t.name} ===`);
  let c;
  try{
    c=new LspClient({cmd:t.cmd,args:t.args,cwd:t.root,name:t.name});
    await Promise.race([c.initialize(t.root,{storagePath:"/tmp/ip-storage",clearCache:true},{}),
      new Promise((_,rj)=>setTimeout(()=>rj(new Error("init timeout 45s")),45000))]);
    console.log(" serverInfo:",JSON.stringify(c.serverInfo));
    for(const k of KEYS){const v=c.capabilities?.[k];console.log(`   ${k.padEnd(24)} ${v===undefined?"-":typeof v==="object"?"OBJECT":v}`);}
    for(const f of t.files) await c.didOpen(path.join(t.root,f));
    await new Promise(r=>setTimeout(r,6000));
    const abs=path.join(t.root,t.tf); const uri=await c.didOpen(abs); const p=locate(abs,t.needle);
    const prep=await c.req("textDocument/prepareCallHierarchy",{textDocument:{uri},position:{line:p.line,character:p.character+t.off+1}}).catch(e=>({err:String(e).slice(0,90)}));
    console.log("   prepareCallHierarchy ->",Array.isArray(prep)?JSON.stringify(prep.map(i=>i.name)):JSON.stringify(prep));
    if(Array.isArray(prep)&&prep.length){
      const inc=await c.req("callHierarchy/incomingCalls",{item:prep[0]}).catch(e=>({err:String(e).slice(0,90)}));
      console.log("   incomingCalls ->",Array.isArray(inc)?JSON.stringify(inc.map(x=>`${x.from.uri.split("/").pop()} ${x.from.name}`)):JSON.stringify(inc));
    }
    const refs=await c.req("textDocument/references",{textDocument:{uri},position:{line:p.line,character:p.character+t.off+1},context:{includeDeclaration:false}}).catch(e=>({err:String(e).slice(0,90)}));
    console.log("   references ->",Array.isArray(refs)?refs.length:JSON.stringify(refs));
  }catch(e){console.log("  FAILED:",String(e).slice(0,200)); console.log("  log:",(c?.logs??[]).join("").slice(-300));}
  finally{ await c?.shutdown(); }
}
process.exit(0);
