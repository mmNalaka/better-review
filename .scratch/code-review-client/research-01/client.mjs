// Minimal, reusable LSP client over a child process' stdio.
// Uses vscode-jsonrpc (node entrypoint) only — no VS Code API anywhere.
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node";

export const now = () => Number(process.hrtime.bigint()) / 1e6;

export class LspClient {
  constructor({ cmd, args, cwd, env, name, trace = false }) {
    this.name = name ?? cmd;
    this.trace = trace;
    this.diagnostics = new Map();
    this.logs = [];
    this.proc = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...(env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stderr.on("data", (d) => {
      const s = d.toString();
      this.logs.push(s);
      if (trace) process.stderr.write(`[${this.name} stderr] ${s}`);
    });
    this.conn = createMessageConnection(
      new StreamMessageReader(this.proc.stdout),
      new StreamMessageWriter(this.proc.stdin),
    );
    this.conn.onNotification("textDocument/publishDiagnostics", (p) => {
      this.diagnostics.set(p.uri, p.diagnostics);
    });
    this.conn.onNotification("window/logMessage", (p) => {
      this.logs.push(p.message);
      if (trace) process.stderr.write(`[${this.name} log] ${p.message}\n`);
    });
    this.conn.onNotification("$/progress", (p) => {
      if (trace) process.stderr.write(`[${this.name} progress] ${JSON.stringify(p).slice(0, 200)}\n`);
      this.lastProgress = p;
    });
    // Servers may ask us things. Answer minimally so they do not stall.
    this.conn.onRequest("workspace/configuration", (p) => p.items.map(() => this.settings ?? {}));
    this.conn.onRequest("client/registerCapability", () => null);
    this.conn.onRequest("client/unregisterCapability", () => null);
    this.conn.onRequest("window/workDoneProgress/create", () => null);
    this.conn.onRequest("workspace/applyEdit", () => ({ applied: false }));
    this.conn.onRequest("window/showMessageRequest", () => null);
    this.conn.listen();
  }

  get pid() {
    return this.proc.pid;
  }

  async initialize(rootPath, initializationOptions, settings) {
    this.settings = settings;
    const rootUri = pathToFileURL(rootPath).href;
    const t0 = now();
    const res = await this.conn.sendRequest("initialize", {
      processId: process.pid,
      rootPath,
      rootUri,
      clientInfo: { name: "better-review-probe", version: "0.0.1" },
      capabilities: {
        general: { positionEncodings: ["utf-16"] },
        workspace: {
          workspaceFolders: true,
          configuration: true,
          didChangeConfiguration: { dynamicRegistration: true },
          symbol: { symbolKind: { valueSet: Array.from({ length: 26 }, (_, i) => i + 1) } },
        },
        textDocument: {
          synchronization: { dynamicRegistration: true, didSave: true },
          definition: { dynamicRegistration: true, linkSupport: true },
          typeDefinition: { dynamicRegistration: true, linkSupport: true },
          implementation: { dynamicRegistration: true, linkSupport: true },
          references: { dynamicRegistration: true },
          documentSymbol: { dynamicRegistration: true, hierarchicalDocumentSymbolSupport: true },
          hover: { dynamicRegistration: true, contentFormat: ["plaintext", "markdown"] },
          callHierarchy: { dynamicRegistration: true },
          typeHierarchy: { dynamicRegistration: true },
          publishDiagnostics: { relatedInformation: true },
        },
        window: { workDoneProgress: true },
      },
      initializationOptions,
      workspaceFolders: [{ uri: rootUri, name: rootPath.split("/").pop() }],
    });
    const tInit = now() - t0;
    this.capabilities = res.capabilities;
    this.serverInfo = res.serverInfo;
    await this.conn.sendNotification("initialized", {});
    await this.conn.sendNotification("workspace/didChangeConfiguration", {
      settings: settings ?? {},
    });
    return { initializeMs: tInit, result: res };
  }

  langIdFor(file) {
    if (file.endsWith(".tsx")) return "typescriptreact";
    if (file.endsWith(".ts") || file.endsWith(".mts") || file.endsWith(".cts")) return "typescript";
    if (file.endsWith(".jsx")) return "javascriptreact";
    if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")) return "javascript";
    if (file.endsWith(".go")) return "go";
    if (file.endsWith(".py")) return "python";
    if (file.endsWith(".php")) return "php";
    return "plaintext";
  }

  async didOpen(file) {
    const uri = pathToFileURL(file).href;
    if (!this.open) this.open = new Set();
    if (this.open.has(uri)) return uri;
    const text = fs.readFileSync(file, "utf8");
    await this.conn.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId: this.langIdFor(file), version: 1, text },
    });
    this.open.add(uri);
    return uri;
  }

  req(method, params) {
    return this.conn.sendRequest(method, params);
  }

  async timed(method, params) {
    const t0 = now();
    const r = await this.conn.sendRequest(method, params);
    return { ms: now() - t0, result: r };
  }

  async definition(file, line, character) {
    const uri = await this.didOpen(file);
    return this.timed("textDocument/definition", {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async prepareCallHierarchy(file, line, character) {
    const uri = await this.didOpen(file);
    return this.timed("textDocument/prepareCallHierarchy", {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async incomingCalls(item) {
    return this.timed("callHierarchy/incomingCalls", { item });
  }

  async outgoingCalls(item) {
    return this.timed("callHierarchy/outgoingCalls", { item });
  }

  async references(file, line, character, includeDeclaration = false) {
    const uri = await this.didOpen(file);
    return this.timed("textDocument/references", {
      textDocument: { uri },
      position: { line, character },
      context: { includeDeclaration },
    });
  }

  // NOTE (measured): some servers never reply to `shutdown`. Always race it
  // against a timer, or the client hangs forever on teardown.
  async shutdown(graceMs = 1500) {
    try {
      await Promise.race([
        this.conn.sendRequest("shutdown"),
        new Promise((r) => setTimeout(r, graceMs)),
      ]);
      this.conn.sendNotification("exit").catch(() => {});
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
    try {
      this.proc.kill("SIGKILL");
    } catch {}
    try {
      this.conn.dispose();
    } catch {}
  }
}

// RSS of a pid tree, in MB (macOS `ps`).
export function rssTreeMB(pid) {
  const { execSync } = require("node:child_process");
  return rssTreeMBSync(pid, execSync);
}

export function rssTreeMBSync(pid, execSync) {
  try {
    const out = execSync(`ps -Ao pid,ppid,rss,comm`, { encoding: "utf8" });
    const rows = out
      .trim()
      .split("\n")
      .slice(1)
      .map((l) => l.trim().split(/\s+/))
      .map(([p, pp, rss, ...c]) => ({ pid: +p, ppid: +pp, rss: +rss, comm: c.join(" ") }));
    const wanted = new Set([pid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of rows) {
        if (wanted.has(r.ppid) && !wanted.has(r.pid)) {
          wanted.add(r.pid);
          changed = true;
        }
      }
    }
    const members = rows.filter((r) => wanted.has(r.pid));
    return {
      totalMB: +(members.reduce((a, r) => a + r.rss, 0) / 1024).toFixed(1),
      procs: members.map((r) => ({ pid: r.pid, rssMB: +(r.rss / 1024).toFixed(1), comm: r.comm })),
    };
  } catch (e) {
    return { totalMB: -1, procs: [], error: String(e) };
  }
}

// find 0-based line/col of a needle in a file
export function locate(file, needle, occurrence = 1) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    let idx = -1;
    while ((idx = lines[i].indexOf(needle, idx + 1)) !== -1) {
      seen++;
      if (seen === occurrence) return { line: i, character: idx };
    }
  }
  throw new Error(`needle ${JSON.stringify(needle)} #${occurrence} not found in ${file}`);
}

export const rel = (uri, root) =>
  decodeURIComponent(String(uri).replace("file://", "")).replace(root + "/", "");
