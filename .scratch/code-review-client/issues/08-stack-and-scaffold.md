# 08 — Lock the stack and scaffold it

Type: task
Status: resolved
Blocked by: 01, 02

## Question

Lock the runtime shape, then build the skeleton. Decide:

- **Server runtime** — Bun or Node, given it must manage long-lived language-server child processes.
- **Frontend** — Vite + React confirmed; pick the routing and state approach.
- **Transport** — REST, tRPC, or a websocket. Language-server round-trips and streaming blast-radius results may argue for the last.
- **Code viewer** — which component renders code with syntax highlighting, clickable identifiers, and gutter marks. This is a load-bearing choice; a plain `<pre>` will not carry it.
- **Repo shape** — single package or a small monorepo, and the test runner.

Then do the work: `git init`, scaffold, and get a hello-world serving one real file from one real local repo end to end.

Informed by what [01](./01-lsp-proxy-viability.md) and [02](./02-pr-to-local-checkout.md) found about the server's actual job.

## Answer

Stack locked and scaffolded. `git init` done on `main`; **staged but not committed** — the commit is the user's call.

### Locked

| | choice | why |
|---|---|---|
| server runtime | **Bun** | [01](./01-lsp-proxy-viability.md)'s Bun warning was about hosting *JS* language servers; tsgo and gopls are native binaries, so nothing JS is hosted. The Bun LSP *client* was verified against both. |
| frontend | **Vite + React 19** | locked at charting |
| router / state | **none** | two modes and a trail in search params; a router earns its place later |
| transport | **HTTP JSON**, SSE for streaming rings later | one producer, one consumer — tRPC is not earning a layer yet |
| code viewer | **Shiki**, own DOM | read-only means an editor is dead weight. We own every span, so clickable identifiers and gutter rings are ordinary DOM work. Virtual scrolling is ours to build — the known cost. |
| repo shape | single package, `server/` + `web/` | |
| tests | `bun test` | none written yet |

### Built, and verified end to end against `sitoo/auth#146`

```
GET /api/review?pr=owner/repo%23123   → PR meta, changed files, commits, clone path
GET /api/blob?clone=&rev=&path=       → file contents
```

Verified against the live PR, not asserted:

- **32 changed files** — matches [02](./02-pr-to-local-checkout.md)'s measurement and GitHub's own count.
- **merge base `fd7e21b`** — matches the research capture exactly.
- **84 commits** — checked against `gh api .../pulls/146/commits --paginate`, which also returns 84. The `A..B` vs `A...B` trap from [02](./02-pr-to-local-checkout.md) is not present.
- **Blob endpoint** returns the real 29-line `middleware/forwarded_authorization.go`.
- **UI**: entering the PR renders all 32 files grouped per [06](./06-explorer-row-signal-budget.md), clicking one loads and Shiki-highlights it, marking one moves it into "Reviewed" and advances the progress bar. Only console message is a missing-favicon 404.

`tsc --noEmit` is clean.

### Two bugs found and fixed while building

1. **`git log --format=…\0` is impossible** — argv cannot contain NUL. Fixed by using `git log -z`, which NUL-separates commits.
2. Shiki's `codeToTokens` requires a `BundledLanguage`, not `string`; the extension map is now typed and unknown extensions fall back to `text` rather than throwing.

### Deliberately stubbed — do not mistake these for done

- **Marks are in memory.** [04](./04-review-mark-model.md)'s content-addressed, JSON-per-PR persistence is specified but not built. Reloading loses them, and nothing is content-addressed yet.
- **No hunks.** File-level marking only; [04](./04-review-mark-model.md)'s hunk model is unbuilt.
- **No language servers.** No hops, no rings, no click-through. The code pane's `changed` badge and `hop 0` label are static.
- **No `Whole repo` mode**, no commits surface, no flags or findings.
