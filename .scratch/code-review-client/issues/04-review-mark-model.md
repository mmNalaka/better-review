# 04 — What "mark as reviewed" actually means

Type: grilling
Status: resolved

## Question

Decide the review-mark model:

- **Granularity** — whole file only, or per hunk, or arbitrary line ranges?
- **States** — just reviewed / not-reviewed, or is there a "needs another look" or "has a question" state? Does anything beyond reviewed earn a slot?
- **Storage** — inside the repo, outside it, sqlite, or browser storage? Must a mark survive a re-clone, a `git clean`, or switching machines?
- **Identity** — is a mark keyed to a path, or a path plus blob sha? This decides the next point.
- **Invalidation** — the PR gets a new commit touching a file you already reviewed. Does the mark silently persist, clear entirely, or survive as "changed since you reviewed it"? This is the question that makes the feature trustworthy or not.
- **Rendering** — how the mark reads in the explorer next to the PR-touched marker and the blast-radius marker without the row becoming noise. (Feeds [06](./06-explorer-row-signal-budget.md).)

## Answer

Terms recorded in [`CONTEXT.md`](../../../CONTEXT.md) under *Review progress*.

### Granularity — file, with hunks underneath

Mark a whole file in one action, or tick hunks individually. **The file state is derived**: `reviewed` when every hunk is marked, `partial` otherwise. One state per explorer row, so the explorer stays a list of files, which is the surface you asked for the marks to be visible on.

```
explorer                     changed 12 · reviewed 5
✓ auth.ts        ⬣ changed
◑ handlers.ts    ⬣ changed      2 of 4 hunks
  cache.ts       ⬡ 2

  handlers.ts
  ✓ @@ 12,8    validateRole()
  ⚑ @@ 44,15   assignScope()
      "scope check runs after the write — ordering?"
  ✓ @@ 210,30  migrateLegacy()
    @@ 388,6   teardown()        ← next unreviewed
```

Rejected arbitrary line ranges: they must be re-anchored on every change, and a set of ranges cannot be summarised into one legible explorer row.

### Identity — content-addressed

- **File mark** → keyed to `path + blob sha`.
- **Hunk mark** → keyed to a hash of that hunk's own added and removed lines, **line numbers excluded**, so pure line-shift does not break it.

Cheap: `git ls-tree -r --long <head>` yields every blob sha in 0.1 s with no checkout ([02](./02-pr-to-local-checkout.md)).

### Invalidation — survive what didn't change

The driving scenario is a force-pushed rebase touching 2 of 12 files. Marks whose content still hashes the same survive; the rest become **changed since reviewed**, which is a state of its own — not a silent reset to unreviewed. You did the work; the record says the ground moved.

```
before force-push        after
✓ auth.ts                ✓ auth.ts          untouched
✓ policy.ts              ⚠ policy.ts        changed since reviewed
◑ handlers.ts  2/4       ◑ handlers.ts 2/4  hunks 1,2 rehash identical
✓ config.ts              ✓ config.ts
```

Rejected path-keyed-and-cleared (a whitespace rebase destroys real progress) and path-keyed-and-persistent (code changes under a tick and you never know — the one failure a review tool must not have).

### Storage — JSON per PR, outside the repo

One file per PR under the app's data directory, keyed `owner__repo__number.json`:

```
~/Library/Application Support/better-review/marks/sitoo__auth__146.json
```

Survives re-clone, `git clean -xdf`, branch switches and worktree deletion — none of which touch it. The reviewed repo stays pristine: nothing to gitignore, nothing to commit by accident. Writes must be atomic (temp file + rename). SQLite was rejected for now: at a few hundred hunks per PR it buys only cross-PR querying, which is still fog.

### States — reviewed, plus flag with a note

Two states you set (`reviewed`, `flagged`), two the app derives (`partial`, `changed since reviewed`).

A **flag** carries a line of text and collects into a **findings** list you copy out at the end. This is the half of the read-only decision that was missing: findings have to travel to GitHub somehow, and without capture you keep a scratchpad in another window — breaking exactly the reading flow this app exists to protect. The app never posts them; export is a manual copy, deliberately.

Notes are the first thing here that stores your words rather than your progress. That raises a durability question the storage decision above does not fully answer — see the map's fog.

### Consequences for other tickets

- [06](./06-explorer-row-signal-budget.md) is unblocked, and its budget grew: a row must now carry filename, change kind, **four** review states, flag presence, and **four** ring states plus a digit. That is more than five signals — cutting is now part of that ticket's job, not an option.
- [05](./05-commit-message-surface.md) interacts: if the diff can be filtered per commit, hunk identity must stay stable across that filtering.
