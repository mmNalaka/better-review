# Map: Code Review Client

Label: wayfinder:map

## Destination

A working MVP in this repo: a local web app you point at a GitHub PR that lets you click a function reference to jump to its definition, always shows where you are — both how far you have navigated and how close the code sits to the change — lets you mark files reviewed with the marks visible in the explorer, browses the whole repo tree with PR-touched files clearly distinct, and shows the PR's commit messages.

Reached when you can run it locally against a real PR in one of your own repos and prefer it to GitHub's diff view.

## Notes

**Domain:** a local, single-user developer tool. Not hosted, not multi-user.

**This map carries execution.** Overriding wayfinder's plan-don't-do default: later tickets build the MVP, they do not hand off a spec.

**Skills every session should consult:** `/grilling` and `/domain-modeling` for decision tickets, `/prototype` for feel questions, `/research` for AFK research tickets, `/tdd` once code exists.

**Vocabulary is settled** — see [`CONTEXT.md`](../../CONTEXT.md). Hops and rings; "depth" is retired and should not reappear in any ticket, prototype or identifier.

### Locked at charting

- **Destination shape** — a working MVP in this repo, not a spec to hand off.
- **Platform** — local web app: Vite + React frontend, small local server. Rejected VS Code extension (owns the explorer chrome you want to control), TUI, desktop app.
- **Review source** — a GitHub PR for metadata/commits/touched-files via the authed `gh` token, plus the local clone for file contents and code intelligence.
- **Depth** — *both* readings are in scope: the navigation trail (how far you have clicked) *and* the blast radius (call-graph distance from the changed lines).
- **Code intelligence** — LSP proxy driving real language servers. Chosen over tree-sitter heuristics because `callHierarchy/incomingCalls` is the blast-radius primitive and a wrong blast radius is worse than none. **Verified and refined by [01](./issues/01-lsp-proxy-viability.md):** the decision holds, but the TypeScript server is `tsc --lsp --stdio` from `typescript@7` (the native Go port), not `typescript-language-server`.
- **Write-back** — none. Read-only reading surface, marks stored locally.

### Environment facts

- `gh` authenticated as `nalakamm`, scopes `admin:public_key, read:org, repo` (read-only token — no write scope, consistent with the read-only decision).
- node 24.11.1, bun 1.3.10, pnpm, git all present.
- `~/code` is ~7 TypeScript repos, ~6 Go, plus Python (`airflow`) and PHP (`platform-framework`). TS-only code intelligence would miss half of real PRs. Good test subjects: `~/code/iam-mono` (TS, monorepo), `~/code/auth` (Go).
- Repo is now git-initialised on `main` with the scaffold staged (uncommitted). Bulky research scratch is gitignored; ticket findings are tracked.
- **Language-server readiness is asymmetric** (from [02](./issues/02-pr-to-local-checkout.md)): a bare Go worktree is instantly usable via the global `GOMODCACHE`; a bare TS worktree is not — no `node_modules` means 163 unresolved-module errors and worthless call hierarchy. Symlinking the main clone's `node_modules` fixes it in 0.016s, guarded by a lockfile-blob comparison.
- **`didOpen` text overrides what is on disk** (verified in both servers) — a PR's blobs can be fed to a language server without checking them out. Weakens, but does not remove, the case for worktrees.
- **Go refuses outright when module deps are not downloaded** — `go mod download` is a hard precondition, not a degradation. TypeScript with no `node_modules` still gives a 100%-correct blast radius; only jump-into-dependency breaks.
- This user has a git `insteadOf` rewrite for `sitoo/*`, so `git config --get remote.origin.url` and `git remote get-url origin` disagree. Use the latter.

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [01 — LSP proxy viability for TypeScript and Go](./issues/01-lsp-proxy-viability.md) — **holds.** gopls attributed 14/14 references with zero misses; TS misses exactly three "referenced but not called" shapes, all recoverable via a references + documentSymbol fallback. Use `tsc --lsp` from TS7: 2.2s cold vs 30s, and `typescript-language-server` returns 103 empty answers while warming — a silently-wrong blast radius. Real gap is level 0, not the edges: `prepareCallHierarchy` returns nothing for anonymous callables.
- [02 — From a PR URL to files, diff, commits and a servable tree](./issues/02-pr-to-local-checkout.md) — one API call plus git does it: fetch `refs/pull/N/head` into a private ref, then `git worktree add --detach` (the `--detach` is mandatory, not stylistic). Diff base is **three-dot / merge-base**; `base.sha` drifts and is right often enough to be dangerous. Almost nothing needs the checkout — only the language servers do.
- [03 — Name the two depths](./issues/03-name-the-two-depths.md) — **"depth" retired.** Travel is measured in **hops**, distance from the change in **rings**; they share an origin (`the changes`, where hop 0 is always ring state `changed`). Exactly one digit on screen, always a ring. Four ring states: `changed` / `1,2,3…` / `out of range` / `unknown`, the last two kept distinct on purpose. Glossary now at [`CONTEXT.md`](../../CONTEXT.md).
- [04 — What "mark as reviewed" actually means](./issues/04-review-mark-model.md) — file marks with hunks underneath, file state derived (`partial` when some are done). **Content-addressed**: file keyed to blob sha, hunk to a hash of its own added/removed lines, so a rebase invalidates only what actually changed and the rest becomes `changed since reviewed` rather than silently resetting. Stored as JSON per PR outside the repo. Flags carry a note and collect into a copyable **findings** list — the missing half of the read-only decision.
- [06 — Explorer row: how much signal can one row carry?](./issues/06-explorer-row-signal-budget.md) — **two modes, each signal only where it varies.** `Changed files` is the default, grouped by review state, with no ring column: every touched file is ring state `changed`, so the column would be a constant. `Whole repo` is the second mode, and rings earn their slot there because it is the only surface they vary on. Ring-sorting survives as an ordering, not a surface. [Prototype](https://claude.ai/code/artifact/34ef55c8-325c-4f6b-8f5b-64fa18f14bdf).
- [08 — Lock the stack and scaffold it](./issues/08-stack-and-scaffold.md) — **Bun server + Vite/React + Shiki**, single package, HTTP JSON, no router. Scaffolded and verified end to end against `sitoo/auth#146`: 32 changed files and 84 commits, both matching GitHub exactly, merge base `fd7e21b` matching the research. Marks are in memory, no language servers yet — the app reads a real PR and highlights real files, nothing more.
- [07 — Navigation trail mechanics](./issues/07-navigation-trail-ux.md) — **linear chain, truncating on divergence.** The explorer chooses where to start, the trail records travel from there; opening any file starts a fresh trail at hop zero. **This revised [03](./issues/03-name-the-two-depths.md)**: hop zero is the trail's origin, not necessarily `changed` code. Each hop carries its ring marker, so leaving the change is visible without new vocabulary. Trail lives in the URL, and a stale hop must degrade to "symbol has moved".
- [12 — The server, not the client, should resolve the clone path](./issues/12-server-owns-the-clone-path.md) — endpoints take `owner`/`repo` and resolve the clone server-side; no filesystem path crosses the wire, so trail URLs are portable. External definitions now report as `external`, not as "not found".
- [10 — How far the blast radius walks, and when](./issues/10-blast-radius-walk.md) — **the ticket's premise was wrong.** Measured on the real PR, the whole depth-3 radius takes **2.7 s** and 5.6 ms per `incomingCalls`, not the ~1.7 s-per-package that was feared. So: computed **eagerly on PR open and streamed**, walking **until the frontier runs dry** (it collapses 111 → 8 → 5 → 3 on its own), capped on symbol count and time rather than depth, and never truncated silently. Callers only. Cached on head sha.
- [09 — Representing "unknown" versus "zero"](./issues/09-unknown-versus-zero.md) — **half of this PR's changed files carry no ring**, for five reasons. Rendered as **three** states, split by what the reader can conclude: `working` (transient), `not applicable` (no server — 28% of the PR), `unknown` (should have been placeable, was not). Cause on hover, not as a glyph. Both coverage recoveries get built, with inferred edges marked `1~` so they are never mistaken for measured ones.
- [13 — Build-tagged files make the language server throw](./issues/13-build-tagged-files-error.md) — refusals now return `unknown` instead of a 502, and the tags a PR's own changed files need are passed to gopls (`-tags=integration_test` here). Two measured gotchas: gopls **silently ignores nested settings** — the flat `"build.buildFlags"` key is required — and `documentSymbol` cannot signal readiness because it succeeds for files in no package at all.
- [14 — Diff view, split against the whole file](./issues/14-diff-view.md) — hunks in one pane, whole file in the other, with **Diff + file** / **Diff only** / **Whole file** modes. Clicking a hunk moves the file pane; added lines are marked in its gutter. Diffs computed locally from the merge base, never from the API. Accepted cost: no base-versus-head comparison anywhere.
- [05 — What "see the commit messages" means](./issues/05-commit-message-surface.md) — **per-hunk attribution plus a commits panel.** With 84 commits by one author over a month, commit-by-commit review is unrealistic; the useful question while reading is whether a line is original work or a second thought. Each hunk names the commits that introduced it (via `git blame`, capped at two with an expander — one hunk here carries ten, including a `Revert`). Rejected per-commit diff filtering.
- [11 — Which languages, at what fidelity](./issues/11-language-support-tiers.md) — the sample reframed it: **zero Python and zero PHP** across ~209 changed files, while Terraform (13) is the third-largest code language. TypeScript and Go are the supported tier; Python and Terraform are registered and light up if their binary is present, otherwise reading as `not applicable` with the install command named. PHP ruled out of scope.

## Decided but not built

Every decision ticket is resolved, but the destination — a working MVP — is not reached.
The frontier being empty means nothing is left to *decide*, not that the app is finished.
This is execution, and needs tickets before it is worked.

- **Mark persistence.** [04](./04-review-mark-model.md) specified content-addressed JSON per PR; marks are in memory and die on reload.
- **Hunk-level marking**, the derived `partial` state, and `changed since reviewed` — all [04](./issues/04-review-mark-model.md), none built.
- **Flags and the findings list** — [04](./issues/04-review-mark-model.md).
- **Coverage recoveries** — the TypeScript references fallback and anonymous attribution, both [09](./issues/09-unknown-versus-zero.md). Until these exist the radius is measured-only and nothing renders an inferred `1~` edge.
- **Blast-radius caching** — [10](./issues/10-blast-radius-walk.md) specified a head-sha key; every PR open currently re-walks (1.5 s, so tolerable).
- **Stale-hop handling** — [07](./issues/07-navigation-trail-ux.md) requires a restored trail to degrade to "that symbol has moved"; the flag exists in the model and nothing sets it.

## Not yet specified

<!-- in-scope fog: real, but not sharp enough to ticket -->

- **Scroll-linking the diff and file panes** — [14](./issues/14-diff-view.md) built click-to-jump only. Whether scrolling one should move the other, and which is the master, is untested.
- **Worktree cache lifecycle** — worktrees now materialise under `~/Library/Application Support/better-review/worktrees/`, but nothing reaps them. Growth is small (2–3 MB each) and they are re-pointed rather than duplicated when a PR moves, so this is untidiness rather than urgency.
- **Language-server lifecycle** — servers are pooled per repo and never shut down while the process lives. No eviction, no restart on crash, no UI while one is cold-starting. gopls cold start was measured at up to 38 s; the app currently just waits.
- **Syntax highlighting and the code viewer** — follows whichever editor component the stack lands on.
- **Keyboard model** — shortcuts for pop-frame, jump-to-definition, and a "next unreviewed" jump. [06](./issues/06-explorer-row-signal-budget.md) settled where things live but not how you move between them without the mouse.
- **Large PRs** — what a 100-file PR does to the explorer, the blast radius, and language-server startup. [06](./issues/06-explorer-row-signal-budget.md) was built at 32 changed files against a 231-file tree and held; 10x that is untested.
- **Monorepo behaviour** — `tsc --lsp` is cross-project aware, which helps, but where the server root goes in `iam-mono` and how many servers run at once is still open.
- **Server lifecycle** — [01](./issues/01-lsp-proxy-viability.md) says keep one server alive per repo (restart is never cheap). When does it start, when is it killed, what happens across PR switches, and what the UI shows while it warms.
- **Multi-PR** — switching PRs, a recent-PRs list, whether the trail is per-PR (marks now are, keyed `owner__repo__number`).
- **Durability of findings** — [04](./issues/04-review-mark-model.md) makes notes the first user-authored content in the app. A JSON file in an app data dir is fine for progress you can rebuild, less obviously fine for words you cannot. Backup, recovery, and what happens if the file is lost mid-review.
- **Cross-PR blob reuse** — you have reviewed this exact blob in another PR. Worth surfacing, and the content-addressed marks from [04](./issues/04-review-mark-model.md) make it nearly free — but it is the one thing that would argue for SQLite over JSON.

## Out of scope

_Ruled beyond this destination. Returns only as a fresh effort._

- **Posting comments, review threads, approve / request-changes** — the read-only decision. You finish the review in GitHub's UI.
- **Syncing GitHub's own "Viewed" checkbox** — needs a write scope the current token lacks, and it is file-level only.
- **Non-GitHub hosts** (GitLab, Gerrit, plain local branch diffing without a PR).
- **Multi-user, hosted, or team features** — this is a single-user local tool.
- **Editing code in the app** — it is a reading surface.
- **PHP support** — [11](./issues/11-language-support-tiers.md) found no PHP in any sampled PR, and no PHP server implements call hierarchy. Supporting it would mean designing a definition-only fidelity tier for a language absent from the work.
