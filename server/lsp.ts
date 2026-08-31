import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";

import { languageOf, missingServerMessage, specFor, type LanguageId } from "./servers";

/** Minimal slice of LSP we actually use. Ported from the ticket 01 probe. */

export interface Position {
  readonly line: number;
  readonly character: number;
}

export interface Range {
  readonly start: Position;
  readonly end: Position;
}

interface Location {
  readonly uri: string;
  readonly range: Range;
}

interface LocationLink {
  readonly targetUri: string;
  readonly targetRange: Range;
  readonly targetSelectionRange?: Range;
}

export interface CallHierarchyItem {
  readonly name: string;
  readonly uri: string;
  readonly range: Range;
  readonly selectionRange: Range;
  readonly kind: number;
  readonly data?: unknown;
}

export interface DocumentSymbol {
  readonly name: string;
  readonly kind: number;
  readonly range: Range;
  readonly selectionRange: Range;
  readonly children?: readonly DocumentSymbol[];
}

export interface Definition {
  /** Repo-relative, so it is safe to put in a URL. */
  readonly path: string;
  readonly line: number;
  readonly character: number;
}

const CLIENT_CAPABILITIES = {
  general: { positionEncodings: ["utf-16"] },
  workspace: {
    workspaceFolders: true,
    configuration: true,
    didChangeConfiguration: { dynamicRegistration: true },
  },
  textDocument: {
    synchronization: { dynamicRegistration: true, didSave: true },
    definition: { dynamicRegistration: true, linkSupport: true },
    references: { dynamicRegistration: true },
    documentSymbol: { dynamicRegistration: true, hierarchicalDocumentSymbolSupport: true },
    callHierarchy: { dynamicRegistration: true },
  },
  window: { workDoneProgress: true },
} as const;

const FILE_URI_PREFIX = "file://";

/** Ticket 01 measured gopls cold start at up to 38 s on an empty cache. */
const FILE_READY_BUDGET_MS = 45_000;

class LspClient {
  private readonly proc: ChildProcessWithoutNullStreams;
  private readonly conn: MessageConnection;
  private readonly opened = new Set<string>();
  private ready: Promise<void> | null = null;

  constructor(
    command: string,
    args: readonly string[],
    private readonly root: string,
    private readonly initializationOptions: unknown,
  ) {
    this.proc = spawn(command, [...args], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    this.conn = createMessageConnection(
      new StreamMessageReader(this.proc.stdout),
      new StreamMessageWriter(this.proc.stdin),
    );

    // Servers stall if these go unanswered. Measured in ticket 01.
    // Answer with the real settings: gopls asks for configuration after
    // `initialize`, and replying `{}` silently discards the build flags it was
    // just given (ticket 13).
    this.conn.onRequest("workspace/configuration", (p: { items: unknown[] }) =>
      p.items.map(() => this.initializationOptions ?? {}),
    );
    this.conn.onRequest("client/registerCapability", () => null);
    this.conn.onRequest("client/unregisterCapability", () => null);
    this.conn.onRequest("window/workDoneProgress/create", () => null);
    this.conn.onRequest("window/showMessageRequest", () => null);
    this.conn.onRequest("workspace/applyEdit", () => ({ applied: false }));
    this.conn.listen();
  }

  initialize(): Promise<void> {
    return (this.ready ??= (async () => {
      const rootUri = pathToFileURL(this.root).href;
      await this.conn.sendRequest("initialize", {
        processId: process.pid,
        rootPath: this.root,
        rootUri,
        clientInfo: { name: "better-review", version: "0.0.0" },
        capabilities: CLIENT_CAPABILITIES,
        initializationOptions: this.initializationOptions,
        workspaceFolders: [{ uri: rootUri, name: this.root.split("/").pop() ?? "root" }],
      });
      await this.conn.sendNotification("initialized", {});
          await this.conn.sendNotification("workspace/didChangeConfiguration", {
        settings: this.initializationOptions ?? {},
      });
    })());
  }

  /**
   * didOpen text overrides what is on disk (verified in ticket 01), so a PR's
   * blob can be analysed without ever checking it out.
   */
  private async didOpen(
    absolutePath: string,
    language: LanguageId,
    text?: string,
  ): Promise<string> {
    const uri = pathToFileURL(absolutePath).href;
    if (this.opened.has(uri)) return uri;
    await this.conn.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: language,
        version: 1,
        text: text ?? readFileSync(absolutePath, "utf8"),
      },
    });
    this.opened.add(uri);
    return uri;
  }

  /**
   * A freshly opened file is not immediately in a package: gopls answers
   * "no package metadata" until it has loaded the build. Retry the real
   * request rather than a proxy — `documentSymbol` is syntactic and succeeds
   * even when the file is in no package at all, so it cannot signal readiness.
   */
  private async withRetry<T>(request: () => Promise<T>, budgetMs: number): Promise<T> {
    const deadline = Date.now() + budgetMs;
    for (;;) {
      try {
        return await request();
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }

  async definition(
    absolutePath: string,
    language: LanguageId,
    position: Position,
    text?: string,
  ): Promise<readonly (Location | LocationLink)[]> {
    await this.initialize();
    const first = !this.opened.has(pathToFileURL(absolutePath).href);
    const uri = await this.didOpen(absolutePath, language, text);
    const ask = () =>
      this.conn.sendRequest<Location | LocationLink | (Location | LocationLink)[] | null>(
        "textDocument/definition",
        { textDocument: { uri }, position },
      );
    // Only the first request on a file waits; after that a refusal is real.
    const result = first ? await this.withRetry(ask, FILE_READY_BUDGET_MS) : await ask();
    if (!result) return [];
    return Array.isArray(result) ? result : [result];
  }

  async documentSymbols(
    absolutePath: string,
    language: LanguageId,
  ): Promise<readonly DocumentSymbol[]> {
    await this.initialize();
    const uri = await this.didOpen(absolutePath, language);
    const result = await this.conn.sendRequest<DocumentSymbol[] | null>(
      "textDocument/documentSymbol",
      { textDocument: { uri } },
    );
    return result ?? [];
  }

  async prepareCallHierarchy(
    absolutePath: string,
    language: LanguageId,
    position: Position,
  ): Promise<readonly CallHierarchyItem[]> {
    await this.initialize();
    const uri = await this.didOpen(absolutePath, language);
    const result = await this.conn.sendRequest<CallHierarchyItem[] | null>(
      "textDocument/prepareCallHierarchy",
      { textDocument: { uri }, position },
    );
    return result ?? [];
  }

  /** Items are stateless in gopls and tsgo (ticket 01), so no prepare round-trip. */
  async incomingCalls(item: CallHierarchyItem): Promise<readonly CallHierarchyItem[]> {
    const result = await this.conn.sendRequest<{ from: CallHierarchyItem }[] | null>(
      "callHierarchy/incomingCalls",
      { item },
    );
    return (result ?? []).map((call) => call.from);
  }

  async dispose(): Promise<void> {
    // Measured in ticket 01: some servers never reply to shutdown. Always race it.
    try {
      await Promise.race([
        this.conn.sendRequest("shutdown"),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
      void this.conn.sendNotification("exit").catch(() => {});
    } catch {
      // teardown is best effort
    }
    try {
      this.proc.kill("SIGKILL");
    } catch {
      // already gone
    }
    this.conn.dispose();
  }
}

/**
 * One server per (repo, language pool), kept alive. Ticket 01 measured cold
 * start at 2.2 s for tsgo and up to 38 s for gopls, and neither has a cheap
 * restart -- so servers are never torn down between requests.
 */
const pool = new Map<string, LspClient>();

/**
 * Build tags cannot be changed after `initialize`, so a different tag set is a
 * different server. The pool key includes them rather than silently reusing a
 * server that was started without them.
 */
function initOptionsFor(language: LanguageId, buildTags: readonly string[]): unknown {
  if (language !== "go" || buildTags.length === 0) return undefined;
  // Flat dotted key, not `{ build: { buildFlags } }`. Measured in ticket 13:
  // gopls silently ignores the nested form, so the flag looks applied and is not.
  return { "build.buildFlags": [`-tags=${buildTags.join(",")}`] };
}

function clientFor(
  repoDir: string,
  language: LanguageId,
  buildTags: readonly string[],
): LspClient {
  const spec = specFor(language);
  if (!spec) throw new Error(missingServerMessage(language));
  const key = `${repoDir} ${spec.pool} ${buildTags.join(",")}`;
  const existing = pool.get(key);
  if (existing) return existing;
  const created = new LspClient(
    spec.command,
    spec.args,
    repoDir,
    initOptionsFor(language, buildTags),
  );
  pool.set(key, created);
  return created;
}

function toDefinition(target: Location | LocationLink, repoDir: string): Definition | null {
  const uri = "uri" in target ? target.uri : target.targetUri;
  const range =
    "range" in target ? target.range : (target.targetSelectionRange ?? target.targetRange);
  const absolute = decodeURIComponent(
    uri.startsWith(FILE_URI_PREFIX) ? uri.slice(FILE_URI_PREFIX.length) : uri,
  );
  // Definitions outside the repo (stdlib, dependencies) are not navigable here.
  if (!absolute.startsWith(`${repoDir}/`)) return null;
  return {
    path: absolute.slice(repoDir.length + 1),
    line: range.start.line,
    character: range.start.character,
  };
}

export class UnsupportedLanguageError extends Error {}

export interface DefinitionResult {
  readonly definitions: readonly Definition[];
  /**
   * The symbol resolved, but into a dependency or the standard library.
   * Distinct from finding nothing: "defined elsewhere" is not "not defined".
   */
  readonly external: boolean;
  /**
   * The server refused to answer — ticket 09's `unknown`, not "no definition".
   * Carries the server's own words so the cause is inspectable.
   */
  readonly unknown?: string;
}

/** Resolve the symbol at a position to where it is defined, repo-relative. */
export async function findDefinition(
  repoDir: string,
  relativePath: string,
  position: Position,
  buildTags: readonly string[] = [],
): Promise<DefinitionResult> {
  const language = languageOf(relativePath);
  if (!language) {
    throw new UnsupportedLanguageError(`No language server covers ${relativePath}`);
  }
  if (!specFor(language)) {
    // Registered but not installed: ticket 11 treats this as `not applicable`
    // with the install command named, never as a failure.
    throw new UnsupportedLanguageError(missingServerMessage(language));
  }
  let targets: readonly (Location | LocationLink)[];
  try {
    targets = await clientFor(repoDir, language, buildTags).definition(
      `${repoDir}/${relativePath}`,
      language,
      position,
    );
  } catch (error) {
    // A refusal is not a failure of the app. Ticket 13: files behind a build
    // tag the server was not given make gopls throw rather than return empty.
    const detail = error instanceof Error ? error.message : String(error);
    return { definitions: [], external: false, unknown: detail };
  }
  const definitions = targets
    .map((target) => toDefinition(target, repoDir))
    .filter((value): value is Definition => value !== null);
  return { definitions, external: definitions.length === 0 && targets.length > 0 };
}

/** Direct access to a pooled client, for the blast-radius walk. */
export function serverFor(
  repoDir: string,
  language: LanguageId,
  buildTags: readonly string[],
): LspClient | null {
  return specFor(language) ? clientFor(repoDir, language, buildTags) : null;
}

export type { LspClient };

export async function shutdownAll(): Promise<void> {
  const clients = [...pool.values()];
  pool.clear();
  await Promise.all(clients.map((client) => client.dispose()));
}
