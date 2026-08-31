# better-review

Read a GitHub pull request properly.

Open a PR, navigate by clicking function references rather than scrolling, see how far
each file sits from the change, tick hunks off as you read them, comment inline — and
publish the whole thing as a GitHub review when you are done.

It runs on your machine, against your own clone. One GitHub API call fetches the PR's
metadata; everything else is `git`.

```bash
bun install
bun run build
bun start sitoo/auth#146
```

That opens <http://localhost:4317> with the pull request loaded.

---

## Requirements

| | |
|---|---|
| [Bun](https://bun.sh) ≥ 1.2 | runs the server and the CLI |
| `git` | every diff, blob and log comes from it |
| [`gh`](https://cli.github.com), logged in | PR metadata, and posting the review |
| A local clone of the repo | found by scanning `~/code` — see [Configuration](#configuration) |

Check all of it at once:

```bash
bun run doctor
```

```
✓ git            git version 2.50.1
✓ gh             gh version 2.87.3
✓ gh auth        logged in
✓ built client   /Users/you/code/better-review/web/dist
✓ clone roots    /Users/you/code
  marks          /Users/you/Library/Application Support/better-review/marks
  optional       · gopls (Go)   · typescript-language-server (TypeScript)
```

The two optional entries are language servers. Without them everything works except
jump-to-definition and the blast radius, which report *not applicable* for languages
they cannot read.

## Installing

**From a clone** — the usual way, since you need local clones of the repos you review
anyway:

```bash
git clone <this repo> && cd better-review
bun install
bun run build
bun start                       # http://localhost:4317
```

**As a command anywhere** on your machine:

```bash
bun link                        # once, from the repo
better-review sitoo/auth#146    # from anywhere
```

**Publishing to a registry** is not set up: `package.json` still says `"private": true`
and the repo has no licence. To publish, add a `LICENSE`, drop that flag, then
`npm publish` — `prepublishOnly` builds, tests and typechecks first.

## Using it

```
better-review [pr] [options]

  pr                 owner/repo#123, or a pull request URL, opened on start

  --port <n>         port to listen on (default 4317)
  --no-open          do not open a browser
  --doctor           check the things this needs, then exit
  --help, --version
```

You can also paste a pull request link straight into the field at the top — pasting is
the whole gesture, it loads immediately.

### Reading

- **The explorer** lists the changed files, grouped by what you have reviewed.
  `Whole repo` switches to the full tree with the changed files marked in place.
- **Click any symbol** in the file pane to jump to its definition. Each jump adds a
  **hop** to the trail across the top; click any hop to go back to it.
- **Rings** say how far code sits from the change: `changed`, then ring 1 for its
  callers, ring 2 for theirs. It is the only number on screen.
- **View** switches between `Diff + file`, `Diff only` and `Whole file`.
- **Commits** narrows the whole review to a single commit, for a PR whose history is
  worth reading one step at a time.
- **f** toggles full screen.

### Marking

Tick a hunk with the `✓` in its header bar, or a whole file with the mark beside its
name in the explorer. A file is `reviewed` when every hunk is, `partial` when some are,
and `⚠ changed since reviewed` when a hunk you ticked is no longer in the diff — you
did the work and the ground moved, which is not the same as unreviewed.

Marks are content-addressed: a hunk is identified by a hash of its added and removed
lines, so a rebase that only shifts code keeps your progress, and one that rewrites it
does not pretend otherwise.

### Commenting

Press the `+` on any line. Drag down the gutter, or shift-click another line, to take
in a range. Write the note and save it with ⌘↵.

**Suggest a change** in the composer seeds a ```suggestion block with the lines you
selected; edit them into what you would rather see. That is GitHub's own format, so the
comment arrives with an "Apply suggestion" button on it.

Notes anchor to the hunk and line they were written against, the same way marks do. If
the line is gone by the time you publish, the note is reported as skipped rather than
posted somewhere it does not belong.

### Publishing

The **⚑ findings** button collects every note. From there you can copy them all as
plain text, or publish them to GitHub:

1. Pick **Comment**, **Request changes** or **Approve**, and optionally write a summary.
2. **Preview** — computed from a diff taken right then, so it lists exactly what would
   be posted, on the lines it would land on, plus anything being skipped and why.
3. **Post to owner/repo#123**, then confirm. Nothing reaches GitHub before that
   confirmation.

Posted notes are stamped, so publishing twice never double-posts. Editing a note clears
its stamp, because the new words have not been posted yet.

## Configuration

All optional.

| Variable | Default | What it does |
|---|---|---|
| `BR_CLONE_ROOTS` | `~/code` | Colon-separated directories scanned for clones, matched by `origin` remote |
| `BR_SERVER_PORT` | `4317` | Port (`--port` wins) |
| `BR_MARKS_DIR` | `~/Library/Application Support/better-review/marks` | Where review marks are stored |
| `BR_WORKTREE_ROOT` | `~/Library/Application Support/better-review/worktrees` | Where PR worktrees are materialised for language servers |
| `BR_WEB_DIST` | `web/dist` | Where the built client lives |

### Where your review is kept

One JSON file per pull request, `owner__repo__number.json`, outside the repo being
reviewed — so a re-clone, a `git clean -xdf` or a deleted worktree cannot take your
progress with it, and the repo stays pristine. Writes are atomic.

## How it reads a pull request

- `refs/pull/N/head` is fetched into `refs/prreview/N/head`, a private namespace, so no
  branch of yours is ever touched.
- The diff base is `git merge-base` — **not** the API's `base.sha`, which drifts and
  silently invents changed files.
- File contents come from `git cat-file`; no checkout is needed. A worktree is only
  materialised when a language server needs real files on disk.
- Diffs are computed locally rather than taken from the API, which silently drops the
  patch for large files.

## Troubleshooting

**"No answer from the better-review server"** — the server is not running. `bun start`.

**`Repository not found` on a private repo.** Your ssh key and your `gh` login are
different identities, and the key cannot see the org's repos. better-review notices and
retries the fetch over HTTPS with `gh`'s own credentials, so this usually resolves
itself. If it still fails, `gh auth status` and `ssh -T git@github.com` will show you
which account each one is.

**`No local clone of owner/repo found`** — clone it under `~/code`, or point
`BR_CLONE_ROOTS` at wherever you keep clones. Matching is by the `origin` remote, not
the directory name.

**Ring state says "not applicable"** for a whole language — that language has no
language server installed. `brew install gopls`, or
`bun add -g typescript-language-server typescript`.

**Port already in use** — `--port 4318`.

## Development

```bash
bun run dev        # API on :4317, Vite on :5173 with hot reload
bun test
bun run typecheck
```

`bun run dev` is the two-process setup with hot reloading; `bun start` is the packaged
one, where the server serves the built client itself on a single port.

```
bin/        the CLI
server/     Bun HTTP server — git plumbing, GitHub via gh, no framework
web/        Vite + React client; Shiki for highlighting
.scratch/   the wayfinder map and decision tickets — the why behind all of it
```

The vocabulary is deliberate and documented in [CONTEXT.md](./CONTEXT.md): travel is
measured in **hops**, distance from the change in **rings**, and the word *depth* is
retired because it fits both. Read that before naming anything new.

## Status

Early, and used daily. `.scratch/code-review-client/map.md` records what is decided and
what is still fog.
