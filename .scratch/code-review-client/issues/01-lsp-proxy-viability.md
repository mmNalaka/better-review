# 01 — LSP proxy viability for TypeScript and Go

Type: research
Status: resolved

## Question

Can one Node/Bun LSP client drive real language servers well enough to power both click-through-to-definition and the blast radius?

Answer concretely:

- **Servers and install** — which binaries are needed for TypeScript, Go, Python and PHP; how each is detected or installed; whether any can be vendored as an npm dependency.
- **Definition from a read-only buffer** — does `textDocument/definition` resolve correctly when we open a file from disk at an arbitrary position, without an editor attached? What does the server need told first (`initialize` rootUri, `didOpen`, workspace folders)?
- **Call hierarchy** — do `textDocument/prepareCallHierarchy` and `callHierarchy/incomingCalls` actually work in `tsserver` and `gopls`? Where do they go blind: interface dispatch, methods, callbacks, re-exports, generated code?
- **Cold start and latency** — measured, not guessed. Time to first useful response on `~/code/iam-mono` (TS monorepo) and `~/code/auth` (Go). Memory footprint. Whether the index survives between requests.
- **Degradation** — does a server need the project to typecheck or build cleanly first? What happens on a repo with errors, missing deps, or no `node_modules` installed?
- **Client libraries** — is `vscode-languageserver-protocol` / `vscode-jsonrpc` usable outside VS Code, and what else exists.

Deliverable: a recommendation, the measured numbers, and a minimal working proof that resolves one definition and one `incomingCalls` in each of TS and Go.

## Answer

### Recommendation

**The LSP-proxy decision holds. Do not redraw it.** One Node/Bun client driving real
language servers over stdio does resolve definitions and does produce a trustworthy
call graph, measured against both real repos. Everything below is measured on this
machine, not read from docs. Four refinements, one of which is load-bearing:

1. **Use `tsc --lsp --stdio` from `typescript@7` (the native Go port, "tsgo"), not
   `typescript-language-server`.** This is the biggest single finding. TypeScript 7.0.2
   is `latest` on npm today and **no longer ships `tsserver.js` at all**; the package
   is a thin wrapper over a per-platform native binary that speaks LSP directly.
   Measured against `typescript-language-server@6.0.0 + typescript@5.9.3` on
   `iam-mono`: **cold start 2.2 s vs 30.0 s, memory 244 MB in 1 process vs 591 MB
   across 4**, identical `incomingCalls` results — and, critically, tsgo *blocks*
   until the project is loaded whereas typescript-language-server returns **103
   consecutive empty answers** over ~24 s. An empty array that means "not ready yet"
   is exactly the quietly-wrong blast radius this ticket was written to avoid.

2. **Keep one server process alive per repo, forever.** In-process the index is hot:
   definition p50 1–5 ms, `prepareCallHierarchy`+`incomingCalls` p50 5–56 ms. Across a
   process restart you pay 3.4 s (tsgo) or **12 s (gopls, even with its on-disk cache
   warm)**. There is no version of this that survives a per-request server.

3. **Never treat a first empty answer as "no callers".** Poll until the project
   reports ready. This is the single most dangerous failure mode found.

4. **Derive blast-radius edges from `references` + `documentSymbol` attribution, not
   from `incomingCalls` alone.** `incomingCalls` in the TypeScript servers only counts
   *syntactic call expressions*, so a function passed as a callback is invisible.
   Validated mitigation below; it is also the only option for PHP.

### Servers and install

| Language | Server | Invocation | Vendorable via npm? |
|---|---|---|---|
| TypeScript | **`typescript@7.0.2`** (native, recommended) | `node_modules/@typescript/typescript-darwin-arm64/lib/tsc --lsp --stdio` | **Yes** — `typescript` + per-platform `optionalDependencies` |
| TypeScript | `typescript-language-server@6.0.0` | `node .../lib/cli.mjs --stdio`, `initializationOptions.tsserver.path` → an explicit `typescript@5` `lib/tsserver.js` | Yes, but needs TS 5 pinned alongside |
| TypeScript | `@vtsls/language-server@0.3.0` | `node .../bin/vtsls.js --stdio` | Yes |
| Go | **`gopls` v0.23.0** | `gopls` (or `gopls serve`) | **No** — `go install golang.org/x/tools/gopls@latest`, found at `$(go env GOPATH)/bin/gopls` |
| Python | `pyright` / `basedpyright@1.39.10` | `node .../langserver.index.js --stdio` | Yes |
| PHP | `intelephense` | `node .../lib/intelephense.js --stdio` | Yes, but see below |

Detection: for Go, resolve `$(go env GOPATH)/bin/gopls` then `$PATH`. For TypeScript,
prefer the repo's own `typescript` dependency, falling back to a bundled one.

**`gopls -mode=stdio` is a no-op flag** (its help text is literally "no effect"). It
worked in my probes only because bare `gopls` defaults to `serve`. Use `gopls`.

### Definition from a read-only buffer — yes, and better than required

`textDocument/definition` resolves correctly with no editor attached. The server needs,
in order: `initialize` with `rootUri` **and** `workspaceFolders`, the `initialized`
notification, then `textDocument/didOpen` carrying the file's full text.

Two findings that matter more than the baseline:

- **`didOpen` text overrides disk.** I opened `services/iam-api/src/db/transaction.ts`
  with a synthetic "PR version" containing an extra exported function that does not
  exist on disk. The server saw the buffer, not the file: the PR-only symbol appeared in
  `documentSymbol`, `prepareCallHierarchy` worked on it, a definition *from* an
  overlay-only line resolved into the real project, and `incomingCalls` on
  `withTransaction` **included the PR-only caller**. A `didChange` back to disk content
  reverted it cleanly. **This means the tool can review a PR's content without checking
  the PR out** — feed it the blobs from `gh`.
- **Opening a file under `services/iam-api` while rooted at the monorepo root works.**
  The root `tsconfig.json` includes only `packages/**/*`, yet the server picked the
  right nested project and resolved into the pnpm store
  (`node_modules/.pnpm/kysely@0.29.2/...`). Rooting at the repo root is fine for
  `iam-mono`; it was also *faster* than rooting at the package (30.0 s vs 25.4 s cold is
  within noise, but `incomingCalls` was 33.6 s vs 47.7 s).

### Call hierarchy — does it work, and where is it blind

Both work, and both advertise `callHierarchyProvider`. To characterise them I built a
fixture with a known ground truth (`research-01/fixtures/`) and diffed every
`references` hit against what `incomingCalls` attributed.

**gopls: 14 of 14 references attributed. Zero misses.** It found the direct call, a
function value returned without being called, a local alias, `go f()`, `defer f()`, a
package-level `var` initialiser, a map-literal dispatch table, a generic function, a
closure, an unexported interface implementation, **generated code** (`gen.pb.go`), and a
package **nothing in the module imports**. Promoted methods from an embedded struct are
found. gopls' call hierarchy is reference-based, so it over-approximates toward
inclusion — exactly the right bias for a blast radius.

**TypeScript (all three servers give byte-identical results): 12 of 12 *call
expressions*, but it misses every non-call reference.** It correctly follows re-export
aliases (`export { TARGET as RENAMED_TARGET }`), namespace-barrel imports
(`Barrel.TARGET()`), `await import()`, JSX component usage, nested arrows, object-literal
methods, top-level module scope, generated code, and orphan files. It misses exactly
three shapes, all of them "function referenced, not syntactically called":

```
MISS  src/callers.ts:22   return xs.map(TARGET);                    // callback
MISS  src/callers.ts:27   const f = TARGET;                          // alias, later f(4)
MISS  src/callers.ts:43   const table = { t: TARGET };               // dispatch table
```

**Interface dispatch is handled by both, better than expected.** This was the assumption
most likely to sink the feature and it survived:

- gopls, `incomingCalls` on the *concrete* `Alpha.Handle`, returns the interface-typed
  call site **and** the direct concrete call, and **correctly excludes** the call on the
  sibling implementation `Beta.Handle`. Verified working when the interface lives in a
  **different package**, and even when it is a **stdlib interface** (`io.Reader`).
  Generic methods participate. `textDocument/implementation` is available as a
  belt-and-braces cross-check.
- TypeScript bridges interface↔implementation too, but **over-approximates**:
  `incomingCalls` on `AlphaHandler.handle` also returns `directBetaCall`, a call that
  only ever touches `BetaHandler`. A false positive, not a false negative — tolerable
  for a blast radius, but it means TS blast radii are wider than the truth.

**The real blind spot is not the edges — it is level 0.**
`prepareCallHierarchy` **returns nothing at all on an anonymous callback**. In the actual
`role-assignments.controller.ts` in `iam-mono`, **7 of its 8 callables are anonymous
route handlers** (`assignmentsApp.openapi(route, async (c) => {...})`), and every one of
them is unaddressable:

```
L35-47   "handleServiceError"                 -> prepare=handleServiceError  incoming=1
L49-71   "assignmentsApp.openapi() callback"  -> prepare=NOTHING
L166-191 "assignmentsApp.openapi() callback"  -> prepare=NOTHING     <- the PR's changed lines
```

Changed lines that sit outside any callable (a `const`, a type, a config literal) also
produce no anchor — `app/constants.go` in the Go blast-radius run yielded nothing.
**Consequence for the UI: "blast radius unknown" must render differently from "blast
radius zero".** Conflating them is precisely the quiet wrongness this ticket guards
against.

Other characterised gaps, from gopls' own golden tests: struct fields of func type
(`s.J()`) and package-level func values are dropped from *outgoing* calls, and dropping
dynamic calls from `outgoingCalls` was closed as working-as-intended
([golang/go#68153](https://github.com/golang/go/issues/68153)). Files behind custom build
tags need `buildFlags: ["-tags=..."]` ([#65089](https://github.com/golang/go/issues/65089)).
At extreme scale (19 MLoC) gopls has been reported to need ~40 GB
([#73709](https://github.com/golang/go/issues/73709)) — irrelevant at 43 kLOC.

**Validated mitigation.** Take `textDocument/references`, drop import/export specifier
lines, and attribute each survivor to its innermost enclosing `documentSymbol`. On the
fixture this recovers **exactly** the three missing edges and finds nothing that
`incomingCalls` found but references missed — references is a strict superset:

```
callHierarchy edges  12   (40 ms)
reference edges      15   (3 ms refs + 26 ms attribution, 5 documentSymbol calls)
recovered only by references:
    src/callers.ts:22  enclosing=asCallback  | return xs.map(TARGET);
    src/callers.ts:27  enclosing=f           | const f = TARGET;
    src/callers.ts:43  enclosing=table       | const table = { t: TARGET };
```

One caveat measured on the real repo: on `withTransaction` this adds 22 spurious edges,
**all** of them `const { withTransaction } = await import("../../db/transaction.js")` in
one test file. Import *bindings* must be filtered too, not just import *statements*, or a
monorepo test file inflates the radius ~3x.

### Cold start, latency, memory, persistence — measured

Cold start = spawn → first *correct* answer, polling.

| Server | Repo | Cold definition | Cold incomingCalls | Empty answers first? |
|---|---|---|---|---|
| tls 6.0.0 + tsserver 5.9.3 | iam-mono root | **30.0 s** | 33.6 s | **yes, 103 polls** |
| tls 6.0.0 + tsserver 5.9.3 | services/iam-api | 25.4 s | 47.7 s | **yes, 78 polls** |
| **tsgo 7.0.2** | iam-mono root | **2.2 s** | **2.5 s** | no — blocks |
| tsgo, process restart | iam-mono | 3.4 s / 3.5 s | 3.8 s / 3.5 s | no |
| tsgo, OS cache hot | iam-mono | 0.2 s | 0.2 s | no |
| **gopls 0.23.0**, cache deleted | auth | **38.2 s** | 38.2 s | no — blocks |
| gopls, on-disk cache warm | auth | **11.7 / 12.1 / 18.0 s** | +0.1–0.3 s | no |
| gopls, everything hot | auth | 1.5 s | 1.5 s | no |

gopls' cost is dominated by `go/packages.Load`, which its own log reports at 2.4 s–13.2 s
across runs — genuinely variable, so budget for the high end.

**Warm, in-process (20–30 repetitions of the same symbol):**

| Server | `definition` p50 / p95 | `prepare`+`incomingCalls` p50 / p95 |
|---|---|---|
| tsgo | 5 ms / 31 ms | 56 ms / 103 ms |
| tls + tsserver | 5–7 ms / 22–560 ms | 79–106 ms / 274–548 ms |
| gopls | 1.2–2.5 ms / 5–16 ms | 5–8 ms / 13–40 ms |

**But the warm number is a lie for a graph walk.** Repeating one symbol measures a cache
hit. Walking outward to *new* symbols in *unloaded packages* is far more expensive, and
the two languages diverge sharply:

| BFS from a hot symbol | requests | total | **per request** | reach |
|---|---|---|---|---|
| tsgo, `withTransaction`, depth 4 | 22 | 468 ms | **21 ms** | 22 symbols / 13 files |
| gopls, `CreateUser`, depth 5 | 5 | 8 300 ms | **1 660 ms** | 6 symbols / 5 files |

gopls costs roughly **0.5–3 s per newly-touched package** and ~5 ms thereafter. A wide Go
blast radius must be computed in the background with results cached, never synchronously
in a request handler.

**Memory (RSS, whole process tree):** tsgo 186–244 MB in **1** process; gopls 260–698 MB
in 2 (peaks during the initial load, settles lower); typescript-language-server
474–591 MB across **4** node processes.

**Does the index persist?**
- *Within a process:* yes, decisively — that is the 1–5 ms p50.
- *Across processes, gopls:* yes, an on-disk content-addressed cache at
  `~/Library/Caches/gopls` (48 MB for `auth` alone; 1 GB budget, entries GC'd after 5
  days). It cuts restart 38 s → 12 s. Note gopls' own troubleshooting doc says "gopls has
  no persistent state" — that refers to in-memory session state and is easy to misread.
  `gopls stats` populates the cache as a side effect, which is a usable warming primitive.
- *Across processes, tsgo and tsserver:* no on-disk index. tsgo does not need one (3.4 s);
  tsserver very much does and does not have one.

### Degradation — one hard stop, one pleasant surprise

| Scenario | definition | incomingCalls | Diagnostic emitted |
|---|---|---|---|
| **TS, `node_modules` entirely absent** | **fails** (empty forever) | **fully correct, 9/9 callers** | `Cannot find module 'kysely'` |
| **Go, type error in the same package** | **correct** | **correct** | the type error, precisely |
| **Go, deps not downloaded** (`GOPROXY=off`, empty `GOMODCACHE`) | **nothing, ever** | **nothing, ever** | `No active builds contain <file>` |

The surprise is the first row: **the TypeScript blast radius survives uninstalled
dependencies completely.** Intra-repo call edges do not need external `.d.ts` files. Only
jump-to-definition *into a dependency* breaks. So a stale clone still gives a useful blast
radius.

The hard stop is the third: gopls does not degrade, it refuses. Every load after the
initial one runs with `GOPROXY=off` internally, so late-discovered missing modules fail
hard rather than resolving. **`go mod download` succeeding is a precondition**, and the
tool should check it and say so rather than showing an empty graph.

Neither server requires the project to *build* — only Go requires it to *resolve*.

### Client libraries

**`vscode-jsonrpc@9.0.1` is the right answer and has zero dependencies.** No VS Code API
anywhere. `vscode-languageserver-protocol@3.18.2` depends only on `vscode-jsonrpc` and
`vscode-languageserver-types`, and exports request *types* usable from a client; it is
optional — plain method-name strings work fine and that is what the PoC uses.
`vscode-languageclient` is the one to avoid: it does require the VS Code extension API.

One sharp edge that cost time: the import is **`vscode-jsonrpc/node`**, not
`vscode-jsonrpc/node.js`. The export map has no `.js` subpath and Node throws
`ERR_PACKAGE_PATH_NOT_EXPORTED`.

**Bun works.** Identical results under `bun 1.3.10` and `node v24.11.1` — same 14
incoming calls from gopls, same 12 from tsgo. No child_process/stdio problems.

Two implementation notes worth carrying forward:

- **`CallHierarchyItem` is stateless in both gopls and tsgo.** Neither populates `data`.
  A hand-built `{ name, kind, uri, range, selectionRange }` returns *identical* results to
  one obtained from `prepareCallHierarchy` (verified: 14/14 and 12/12, identical sets).
  A BFS can skip the prepare round-trip entirely.
- **Some servers never reply to `shutdown`.** This hung a probe. Always race `shutdown`
  against a timer, then `SIGKILL`.
- gopls' `fileWatcher` defaults to `off` — it relies on the client sending
  `workspace/didChangeWatchedFiles`, so it will not notice on-disk changes on its own.
  Its `workspace/didChangeConfiguration` payload is ignored; it is only a trigger to
  re-pull via `workspace/configuration`.

### Python and PHP

- **Python is fine.** `pyright` and `basedpyright@1.39.10` both advertise
  `callHierarchyProvider: true` and both returned correct incoming calls on a fixture.
  They share TypeScript's blind spot: `map(TARGET, xs)` is not reported as an incoming
  call. Same mitigation applies.
- **PHP is the exception. `intelephense` does not implement call hierarchy at all** —
  `textDocument/prepareCallHierarchy` returns `Unhandled method`, and
  `callHierarchyProvider` is absent from its capabilities. It does provide `definition`
  and `references`. So for PHP, jump-to-definition works and the blast radius must be
  built entirely from the references+`documentSymbol` path. `phpactor` could not be
  evaluated: **there is no `php` binary on this machine.** Given PHP is fourth in
  priority, shipping PHP with definition-only and no blast radius is a reasonable
  first cut.

### Proof of concept

Everything lives in `/Users/nalaka.manathunga/code/better-review/.scratch/code-review-client/research-01/`.

| File | What it is |
|---|---|
| **`poc.mjs`** | **The ticket's deliverable.** Resolves one definition and one `incomingCalls` against real `iam-mono` (tsgo) and real `auth` (gopls). Run `node poc.mjs`. Passes. |
| `client.mjs` | ~200-line reusable LSP client over child-process stdio. `vscode-jsonrpc` only. Carries the readiness-polling and shutdown-timeout lessons. |
| `blast-radius.mjs` | Working blast-radius walker: `node blast-radius.mjs <repo> <commit> <gopls\|tsgo\|tls> <depth>`. Parses `git diff -U0`, finds enclosing symbols, BFS on `incomingCalls`, reports per-file depth. |
| `probe-blindspots.mjs` | The reference-vs-incomingCalls diff that produced the failure-mode table. |
| `probe-callhierarchy.mjs` | Interface dispatch, subclassing, JSX, outgoing calls across all four servers. |
| `probe-iface.mjs` | Cross-package / stdlib-interface / generic-method dispatch in gopls. |
| `probe-mitigation.mjs` | Proves references+documentSymbol recovers the TS blind spots. |
| `probe-overlay-and-scale.mjs` | The PR-content overlay proof, and the BFS scaling numbers. |
| `probe-degrade.mjs`, `one-gopls*.mjs` | Missing `node_modules`, type errors, missing Go deps, cold/warm restarts. |
| `probe-synth.mjs` | Proves `CallHierarchyItem`s can be synthesized. |
| `bun-test.mjs` | Bun vs Node parity. |
| `probe-caps.mjs`, `probe-pyphp.mjs` | Capability matrices. |
| `fixtures/{ts,go,py,php}/` | Ground-truth fixtures: ~13 call shapes each. |
| `out-*.json` | Raw measurements behind every number above. |

Sample `blast-radius.mjs` output on a real Go commit — the feature working end to end:

```
auth @ fd7e21b, gopls, depth 3
  L0 repository/mysql/user.go          (CreateUser)
  L1 service/scim.go
  L2 generated/handler/api_scim_handler.go
  project ready 5.2 s | level0 1.5 s | BFS 0.7 s | total 8.1 s from spawn
```

Both real repos were left untouched — verified with `git status`; the one modified file
in `iam-mono` predates this session (mtime 11:36, session started 14:20). The user's
`~/Library/Caches/gopls` was backed up before the cold-start measurements and restored
afterwards.

### What this leaves for later tickets

- **Blast-radius caching** ([map: "Blast-radius computation and caching"]) now has
  numbers: TS ~21 ms per new symbol, Go ~1.7 s per new *package*. Go needs background
  precomputation; TS can be lazy.
- **Monorepo behaviour** is answered for `iam-mono`: root the server at the repo root.
- **Level-0 attribution** needs its own design: anonymous callbacks and non-callable
  changed lines have no call-hierarchy anchor, and the UI must distinguish "unknown"
  from "zero".
