# 02 — From a PR URL to files, diff, commits and a servable tree

Type: research
Status: resolved

## Question

How does the app get from "a GitHub PR URL" to everything it needs: PR metadata, the commit list, the changed-file list, full file contents, and a working tree that language servers can be pointed at?

Answer concretely:

- **API surface** — which `gh` / GitHub API calls return PR metadata, commits with full messages, and changed files with per-file status and patch. What is paginated and what the caps are (files per PR, patch size).
- **Getting the code locally** — `gh pr checkout` vs fetching `refs/pull/N/head` directly. Can we get the PR head **without disturbing the user's working tree** — is `git worktree` the right answer, and where would those worktrees live?
- **The correct diff base** — merge-base vs base tip, and which one GitHub's own UI shows. Getting this wrong makes unrelated files look touched.
- **Locating the clone** — given a PR on `owner/repo`, how do we find the local clone? Ask once and remember, or scan `~/code`?
- **Unhappy paths** — clone missing, stale, dirty, or on an unrelated branch. Which are fatal and which are recoverable.
- **Rate limits** — what the current read-only token allows, and what needs caching.

Deliverable: the exact command/API sequence, the failure modes, and the shape of the data the frontend would receive.

## Answer

Everything below was run against real PRs in `sitoo/auth`, `sitoo/iam-mono` and
`kubernetes/kubernetes`. The user's three clones were snapshotted before and
after and verified bit-identical afterwards (one caveat, noted at the very end).

**The headline:** use the GitHub API for *one call* — PR metadata — and compute
everything else from git locally. The API's diff is capped, truncated and
paginated; git's is not, and it is byte-identical where both are available.

### Recommended sequence

One REST call, then all git. ~7 s on a Go repo, ~30 s on a TS monorepo (cold).

```
1.  GET /repos/{owner}/{repo}/pulls/{n}                        <- the ONLY API call
      -> head.sha, base.ref, base.sha, head.repo.full_name, title/body/state/draft
      NOTE: mergeable/mergeable_state are null on first read (GitHub computes
      the test-merge in the background). merge_commit_sha CHANGES between
      calls. Never anchor on either.

2.  locate the clone (see "Locating the clone")

3.  git -C $CLONE fetch --no-tags --no-write-fetch-head origin \
        +refs/pull/{n}/head:refs/prreview/{n}/head \
        +refs/heads/{base.ref}:refs/prreview/{n}/base
      One fetch covers fork PRs, merged PRs and deleted head branches:
      refs/pull/N/head lives in the BASE repo. Verified against a
      kubernetes/kubernetes fork PR and a merged sitoo/auth PR whose branch
      was deleted - both resolved via ls-remote with no fork remote added.
      Do NOT use refs/pull/N/merge: absent on both PRs I checked.

4.  MERGE_BASE=$(git merge-base refs/prreview/{n}/base refs/prreview/{n}/head)
      <- the single most important line in the whole flow

5.  git diff --merge-base --name-status -M base head      <- changed files
6.  git log MERGE_BASE..head                              <- commits (TWO dots)
7.  git worktree add --detach $CACHE/worktrees/{owner}-{repo}/pr-{n} {head.sha}
8.  make it LSP-ready (see "Language-server readiness")
```

Full runnable version: `research-02/pr-to-checkout.sh`.

### The diff base: three-dot, and it is not `base.sha`

**GitHub's PR view is a three-dot diff: `merge-base(base, head)..head`.** Proven,
not assumed. On `sitoo/auth#146`:

| method | files |
|---|---|
| `/pulls/146/files` (what GitHub shows) | **32** |
| `git diff base.sha...head` (three-dot) | **32** correct |
| `git diff --merge-base maintip head` | **32** correct |
| `git diff base.sha..head` (two-dot) | 48 WRONG |
| `git diff maintip..head` (two-dot) | 50 WRONG |

Filename sets are **identical**, not merely equal in count. The 18 phantom files
two-dot invents are an unrelated devcontainer PR that landed on `main` after the
fork point — `.devcontainer/*`, `go.mod`, `go.sum`, `Makefile`, `README.md`.
Exactly the poison the ticket worried about. Held across 6 PRs.

**`base.sha` is a trap.** It is the tip of the base branch *at API-read time*,
so it drifts ahead of the fork point as `main` moves:

- `auth#146`: `base.sha`=94d2475, merge-base=fd7e21b — **drifted**, two-dot wrong.
- `k8s#125488`: compare reports `behind_by: 19` — 19 commits of drift.
- 5 other PRs: `base.sha` happened to equal the merge base.

So it is right *most* of the time, which is the worst possible failure mode.
GitHub's docs never describe `base.sha` at all (no schema description, no
warning) and the three-dot rule is stated only in a conceptual article, not the
API reference. Compute the merge base yourself, always.

Two ways to get it:

- **local (preferred):** `git merge-base <base> <head>`
- **remote:** `GET /repos/{o}/{r}/compare/{base}...{head}` -> `merge_base_commit.sha`.
  Useful before a clone exists. But its `files` array is silently capped at
  **300 for the entire comparison** and appears only on page 1 — pagination
  yields more *commits*, never more files. Confirmed on k8s#125488 (486 files):
  `/compare` returned exactly 300, no truncation flag.

**Footgun:** `A...B` means opposite things in the two commands.
`git diff A...B` = merge-base..B (what you want). `git log A...B` = *symmetric
difference* and wrongly includes the base side — 23 commits instead of 19 on
`auth#145`. For commits use **`git log MERGE_BASE..head`** (two dots), which
matched the API's commit SHA set exactly.

### Not disturbing the working tree

**`git worktree add --detach` is the right answer, and `--detach` is mandatory.**

Tested against the worst case: `iam-mono#129`, where the user had that very
branch checked out *and* a modified file in the tree.

```
git worktree add $WT feat/scoped-user-role-assignments
  -> fatal: 'feat/...' is already used by worktree at '/Users/.../iam-mono'
git worktree add --detach $WT <head-sha>
  -> works, 0.96 s
```

A named branch cannot be checked out in two worktrees, and the branch under
review is very often the one the user already has out. `--detach` claims no
branch, so the guard never fires. (This is why `gh pr checkout` is unusable
here — it switches the user's branch. It was never run against the real clones.)

After creating the worktree, the main clone was **bit-identical**: HEAD, branch,
`status --porcelain`, the index tree, all 8 stashes, and even the mtime of the
dirty file. The worktree sees the *committed* state — the user's uncommitted
edit is invisible there, which is correct for review.

Cost: `.git` is a 69-byte `gitdir:` pointer file, objects are shared. Only the
checked-out files consume space (3.1 MB for iam-mono).

**Fetching alone disturbs nothing either.** `fetch --no-tags
--no-write-fetch-head` into `refs/prreview/*` changed *only* the ref count
(+2) and repo size (+0.2 MB). FETCH_HEAD was verifiably not written
(mtime unchanged), HEAD/index/stashes/config untouched.

**Where worktrees live:** `~/.cache/better-review/worktrees/{owner}-{repo}/pr-{n}`.
Outside the repo, deliberately. Inside-the-repo placement (which is what the
leftover `.pr-review-84` in iam-mono did) shows up in `git status`, gets picked
up by the user's watchers and build tools, and confuses a whole-tree explorer
with a nested copy of the repo.

**Who cleans up:** the server must, explicitly — nothing in git does it for you.
Live proof sitting in the user's repo before I started: iam-mono carried a
`.pr-review-84` worktree record whose directory had been deleted, marked
`prunable`, still holding a claim on branch `pr-84-review` so nobody could check
it out. That is the leak, already happening. `research-02/pr-gc.sh` reclaims
only worktrees whose path is inside the server's own cache dir.

### How much needs a checkout at all

**Almost none of it.** From fetched refs, with no worktree:

| data | command | no checkout? |
|---|---|---|
| whole-repo tree | `git ls-tree -r --long <head>` | yes, 0.1 s |
| any file's content | `git cat-file -p <head>:<path>` | yes |
| file size (no read) | `git cat-file -s <head>:<path>` | yes |
| changed files | `git diff --merge-base --name-status` | yes |
| patches | `git diff --merge-base` | yes |
| commits + full messages | `git log MB..head` | yes |

So metadata, commits, the diff, the full tree and every file's contents need
**no working tree**. The worktree exists for exactly one reason: **language
servers need real files on disk.** If code intelligence were dropped, the
worktree could go entirely.

### Language-server readiness — the asymmetry that matters

A fresh worktree has no `node_modules`. This is not cosmetic:

| worktree state | `tsc --noEmit` on `services/iam-api` |
|---|---|
| bare | **374 errors**, 163 x TS2307 "Cannot find module" |
| node_modules symlinked from main clone | **46 errors**, all genuine semantic ones |

A bare TS worktree gives tsserver a broken program — imports unresolved, types
collapsed to `any`, and `callHierarchy/incomingCalls` (the blast-radius
primitive from ticket 01) would be worthless.

**Fix: symlink the main clone's `node_modules` dirs into the worktree.** 0.016 s,
restores full resolution. Guard it by comparing the head lockfile blob against
the clone's working lockfile; if they differ, the PR changed deps and the
symlink is stale — warn rather than silently mislead.

**Go needs nothing.** `gopls` resolves from the machine-global `GOMODCACHE`
(`~/go/pkg/mod`), not the repo. `go list -deps ./...` in a bare Go worktree:
19 packages, exit 0, **0.25 s**. Go/Rust worktrees are LSP-ready instantly;
Node ones are not. Plan for the split.

### Locating the clone

Scan `~/code` once, cache the map, refresh lazily. Cold scan of 27 repos took
**69 s** (macOS cold FS/security scanning); warm, **1.7 s**. So: scan in the
background on first run, ask the user only if the scan comes up empty.

Normalise all four remote URL shapes, all present in this user's `~/code`:

```
git@github.com:owner/repo.git
https://github.com/owner/repo.git
ssh://git@github.com/owner/repo.git
https://github.com/owner/repo          (no .git)
```

**Gotcha:** this user has an `insteadOf` rule
(`url.ssh://git@github.com/sitoo/.insteadof https://github.com/sitoo/`), so
`git config --get remote.origin.url` returns the *raw* https value while
`git remote get-url origin` returns the rewritten ssh one. Use
`git remote get-url origin` and normalise; either encodes `owner/repo`, but be
sure you handle both rather than assuming one form.

### Limits, measured

| thing | limit | source |
|---|---|---|
| `/pulls/{n}/files` | **3000** files, `per_page` max 100 | documented |
| `/pulls/{n}/commits` | **250** commits | documented |
| `/compare` files | **300** for the whole comparison, page 1 only | documented + confirmed on k8s#125488 |
| `git/trees?recursive=1` | 100,000 entries / 7 MB, then `truncated: true` | documented |
| `/contents/{path}` | 1 MB inline base64; 1-100 MB raw media type only; >100 MB unsupported | documented |
| REST primary | 5000 req/hr | documented + confirmed |

`--paginate` on `/pulls/125488/files?per_page=100` returned all **486** files
across 5 pages, correctly. `/compare` on the same PR returned 300 with no flag.

**Patch truncation is worse than documented.** GitHub's published diff limits are
20,000 lines / 500 KB per file. The *actual* API behaviour is far tighter — one
file in `auth#146` came back with `patch: null`:

- largest patch **returned**: 68,817 B / 1,922 lines (`iam-mono#129`)
- smallest patch **dropped**: 97,673 B / 3,319 lines (`auth#146`)

A plain markdown file, not binary, nowhere near the documented limits, silently
`patch: null` while `additions`/`deletions`/`changes` stayed accurate. Git
computed it fine locally. Practical rule: **treat `patch` as unreliable above
~64 KB and compute diffs locally.**

Where both exist they agree exactly: the API `patch` string is byte-identical to
`git diff --merge-base -U3 <base> <head> -- <file>` with the 4-line header
stripped (840 B vs 840 B, `diff` clean). So local computation is a strict
superset — never truncated, never capped, no pagination.

**Rate limits.** The recommended flow costs **1 REST call per PR load**. With
5000/hr that is a non-issue; caching is for latency, not quota.

**But `/rate_limit` lies.** Measured simultaneously: response headers reported
`X-Ratelimit-Used: 197` while `GET /rate_limit` reported `used=25`. Every call
increments the header (194 -> 195 -> 197), including repeats — there are no free
conditional requests. **Budget against `x-ratelimit-remaining` on responses you
are already making; do not trust the `/rate_limit` endpoint.**

### Data shapes

Full sketch with commentary: `research-02/types.ts`. In outline:

```ts
type PrSession = {
  source:    { owner; repo; number; url }
  anchors:   { headSha; baseSha; mergeBaseSha; baseRef; baseDrift }
  meta:      { title; body; author; state; isDraft; headRepo; isFork; ... }
  commits:   PrCommit[]      // sha, subject, body, author, parents, isMerge
  files:     ChangedFile[]   // path, previousPath, status, +/-, isBinary,
                             // patch, changedLineRanges
  tree:      TreeEntry[]     // WHOLE repo at head; `touched` marks PR files
  workspace: { clonePath; worktreePath; lspReady; lspBlockers[] }
  warnings:  Warning[]       // degrade, don't throw
}
```

Three deliberate choices:

- **`anchors` carries all three shas plus `baseDrift`.** Keeping `baseSha` and
  `mergeBaseSha` as distinct named fields makes the trap unrepresentable —
  nothing can accidentally diff against the wrong one. `baseDrift > 0` is
  exactly the condition under which a two-dot diff would have lied.
- **`tree` is the whole repo, with `touched: boolean`.** The explorer browses
  everything; PR files are a marked subset, not a separate list.
- **`warnings[]` rather than exceptions.** Most unhappy paths are recoverable
  and the session is still worth showing.

### Failure modes

**Fatal — cannot produce a session:**

- **No local clone and cloning refused/fails.** Fallback measured:
  `git clone --filter=blob:none --no-checkout` -> 3.7 s, 560 KB. But the first
  worktree checkout then triggers a lazy bulk blob fetch: **16.4 s** vs ~1 s
  from a full clone. Acceptable once; warn the user.
- **404 from the API.** Note you *cannot* distinguish "PR doesn't exist" from
  "token can't read this repo" — both return an identical 404. Probe
  `GET /repos/{owner}/{repo}` separately to tell them apart.
- **`refs/pull/N/head` missing.** `fatal: couldn't find remote ref` — clean
  failure. Means the PR number is wrong or the ref was purged.

**Recoverable — degrade and warn:**

- **Stale clone / objects missing.** Very common: merged PRs whose head branch
  was deleted are absent locally (`auth#145`, `#156`). The step-3 fetch fixes it
  in **2.4 s**. Not an error; just do it every time.
- **Dirty working tree.** Completely harmless with `--detach`. iam-mono had a
  modified file and 8 stashes throughout; nothing was touched. Do not gate on
  clean-tree.
- **User on an unrelated branch, or on the PR's own branch.** Both irrelevant —
  `--detach` never consults the main worktree's HEAD.
- **Fork PR / deleted fork.** `refs/pull/N/head` lives in the base repo, so one
  fetch from `origin` handles it. Never add the fork as a remote.
- **`node_modules` missing or lockfile changed.** Degrades code intelligence,
  not the diff. Warn via `lspBlockers`.
- **PR >3000 files or >250 commits.** API lists truncate silently; git does not.
  Another reason to compute locally.
- **`patch: null`** on large files — compute locally.
- **Worktree path occupied** -> `fatal: '<path>' already exists`. Clean error;
  gc or use a fresh path.
- **Submodules.** `git worktree`'s own docs: *"support for submodules is
  incomplete... NOT recommended to make multiple checkouts of a superproject."*
  None of the three test repos use them, so this is untested here.

**Leaks the server must clean up itself:**

- **Orphaned worktree records.** Already happening in `iam-mono` before this
  research: a `.pr-review-84` record with its directory deleted, still claiming
  branch `pr-84-review`. Nothing in git reaps these automatically.
- **`refs/prreview/*`** pin objects against gc. Delete on session close.
- **Never run bare `git worktree prune`** — it is unscoped and reaps *other*
  tools' records too. I hit this: my first `pr-gc.sh` removed that unrelated
  `.pr-review-84` record. Nothing was lost (prune never deletes branches or
  commits — branch `pr-84-review` @ 934ede4 and its commit are intact, and the
  directory had been gone before this work started; the net effect is that the
  branch is now checkout-able again). But it was not ours to reap, and the
  script has been corrected to remove only worktrees inside its own cache dir.

**Two API fields to distrust outright:**

- `mergeable` / `mergeable_state` are `null` / `"unknown"` on first read.
- `merge_commit_sha` **changed between two consecutive reads** of `auth#146`
  (52372be -> 6993a3e) as GitHub recomputed the test merge. Never anchor on it.

**One implementation gotcha:** zsh's builtin `echo` interprets backslash escapes,
which corrupts JSON round-tripped through shell variables (PR bodies broke `jq`
repeatedly during this research). Use `printf '%s'`, or `gh api --jq`
server-side.

### Scripts left behind

All in `research-02/`:

- **`pr-to-checkout.sh`** — runnable end-to-end sequence. `./pr-to-checkout.sh
  sitoo auth 146`. Verified against a drifted-base Go PR and a TS monorepo PR
  whose branch was checked out and dirty.
- **`pr-gc.sh`** — reclaims worktrees and `refs/prreview/*`, scoped to the
  server's own cache dir.
- **`types.ts`** — the frontend payload sketch, annotated.
- Captured API responses and diff comparisons (`pr146*.json`, `api-files.txt`,
  `git-threedot.txt`, `git-twodot-tip.txt`, `auth-before.txt`, `iam-before.txt`)
  for anyone wanting to re-check the diff-base result without re-running.
