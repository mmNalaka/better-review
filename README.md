# better-review

A local, single-user web app for reading a GitHub pull request. Navigate by clicking
function references, see how far you have travelled and how close code sits to the
change, mark what you have reviewed.

Read-only: it never posts to GitHub. You finish the review in GitHub's own UI.

## Running it

```bash
bun install
bun run dev          # server on :4317, web on :5173
```

Open http://localhost:5173 and enter `owner/repo#123` or a pull request URL.

Requires `gh` authenticated (`gh auth status`) and a local clone of the repo being
reviewed. Clones are found by scanning `~/code`; override with `BR_CLONE_ROOTS`
(colon-separated).

## How it reads a PR

One GitHub API call for metadata; everything else is git:

- `refs/pull/N/head` is fetched into `refs/prreview/N/head`, a private namespace,
  so no branch of yours is ever touched.
- The diff base is `git merge-base` — **not** the API's `base.sha`, which drifts and
  silently invents changed files.
- File contents come from `git cat-file`, so no checkout is needed. A worktree is
  only required once language servers arrive.

## Vocabulary

See [CONTEXT.md](./CONTEXT.md). Briefly: travel is measured in **hops**, distance from
the change in **rings**, and the word *depth* is deliberately retired because it fits
both. Rings carry the only number on screen.

## Layout

```
server/    Bun HTTP server — git plumbing, GitHub API, no framework
web/       Vite + React client; Shiki for highlighting, our own DOM for marks
.scratch/  Wayfinder map and decision tickets — the why behind all of the above
```

## Status

Early. See `.scratch/code-review-client/map.md` for what is decided and what is not.
