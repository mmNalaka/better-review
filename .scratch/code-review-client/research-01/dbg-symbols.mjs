import { LspClient } from "./client.mjs";
import { execFileSync } from "node:child_process";
import path from "node:path";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const TS7 = path.join(HERE, "node_modules/@typescript/typescript-darwin-arm64/lib/tsc");
const REPO = "/Users/nalaka.manathunga/code/iam-mono";
const REL = "services/iam-api/src/modules/role-assignments/role-assignments.controller.ts";
const c = new LspClient({ cmd: TS7, args: ["--lsp","--stdio"], cwd: REPO, name:"dbg" });
await c.initialize(REPO, undefined, {});
const uri = await c.didOpen(path.join(REPO, REL));
let syms=[]; for(let i=0;i<60;i++){ syms = await c.req("textDocument/documentSymbol",{textDocument:{uri}}); if(Array.isArray(syms)&&syms.length) break; await new Promise(r=>setTimeout(r,300)); }
const KIND={1:"File",2:"Module",3:"Namespace",4:"Package",5:"Class",6:"Method",7:"Property",8:"Field",9:"Constructor",10:"Enum",11:"Interface",12:"Function",13:"Variable",14:"Constant",15:"String",16:"Number",17:"Boolean",18:"Array",19:"Object",20:"Key",21:"Null",22:"EnumMember",23:"Struct",24:"Event",25:"Operator",26:"TypeParameter"};
const walk=(s,d=0)=>{for(const x of s){console.log(" ".repeat(d*2)+`${KIND[x.kind]||x.kind} ${x.name}  L${x.range.start.line+1}-${x.range.end.line+1}`); if(x.children)walk(x.children,d+1);}};
walk(syms);
console.log("--- changed lines in this file (1-based) ---");
const diff = execFileSync("git",["diff","-U0","b6e213d~1","b6e213d","--",REL],{cwd:REPO,encoding:"utf8"});
console.log(diff.split("\n").filter(l=>l.startsWith("@@")).join("\n"));
await c.shutdown(); process.exit(0);
