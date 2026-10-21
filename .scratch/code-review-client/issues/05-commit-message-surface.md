# 05 — What "see the commit messages" means

Type: grilling
Status: resolved

## Question

Decide what the commit surface is, concretely:

- A commits panel listing the PR's commits with full messages — where does it live and is it always visible?
- Can you **filter the diff to a single commit**, reviewing commit-by-commit rather than as one squashed change?
- When reading a changed hunk, do you see **which commit introduced it** — blame-style attribution in the gutter?
- Does the PR title and description sit alongside the commits, or somewhere else entirely?
- Underneath all of it: does commit history actually matter to how you review, or is the end-state diff the thing you really read and the commit list just context you occasionally check? The honest answer here decides how much this feature is worth.

## Answer

### What the data said first

`sitoo/auth#146` has **84 commits, one author, spanning a month**, 83 of them conventional-format, 49 with bodies, no merges. Reading a PR of that shape commit-by-commit is not realistic — but the messages are unusually informative, and three of the five newest are `address PR #146 review feedback` / `drop stale comment` rather than feature work.

That killed the "filter the diff to one commit" option and pointed at attribution instead: the useful question while reading is not *what happened over the month* but **is this line original work or a second thought?**

### Per-hunk attribution

Each hunk lists the PR commits that introduced its added lines, oldest first, from one `git blame --line-porcelain` per file. Blame landing outside the PR range is ignored — pre-existing code caught up in a rewrite is not attributable to this PR.

```
@@ -62,65 +72,64 @@ func (s Scim) CreateUser
  bf44d90  feat(scim): route CreateUser through IAM when ROLESV2 enabled
  b542b34  feat(scim): CreateUser routes by slug classifier (drop ROLESV2 write check)
  +5 more commits
```

Capped at two rows with an expander: on a long-lived branch a single hunk can carry **ten** commits, and one of `service/scim.go`'s hunks contains a `Revert`. Showing all of them turns the diff into a changelog.

Cost: ~50 ms per file, one blame per file opened.

### Commits panel

The `84 commits` count in the header is a button; it opens a panel with every commit — subject, short sha, author, date, and the full body where there is one. Rendering only: the data already arrives in the review payload.

### Verified

| | |
|---|---|
| hunks attributed on `service/scim.go` | 8 of 8 |
| attribution rows before / after expand | 2 / 6 |
| commits listed in panel | 84 |
| bodies rendered | 49 |

### Not done

- **No PR description.** The panel shows commits only; the PR body is not fetched. Deliberate for now — it is one more API field, but it belongs beside the review, not in a commit list.
- **No per-commit diff filtering**, by decision above.
- Attribution is line-level via blame, so a hunk whose added lines were later reformatted attributes to the reformatting commit, not the original. Correct, occasionally unhelpful.

## Revision — per-commit review, added as an option

This ticket rejected filtering the diff to one commit. That judgement was about
it as the *primary* workflow: at 84 commits by one author over a month, walking
the branch chronologically means 84 passes over code that later commits rewrite.
That reasoning still holds for the default.

As an **optional mode** it is a different question, and the measurement supports
it. Picking `0d1d102 refactor(scim): address PR #146 follow-up review comments`:

| | whole PR | that commit |
|---|---|---|
| changed files | 32 | **3** |
| hunks in `service/scim.go` | 8 | **5** |
| diff lines in `service/scim.go` | 993 | **60** |

Reading a 60-line follow-up commit on its own is obviously worth doing; reading
all 84 that way is not. Both are now possible.

### Built

- `GET /api/commit-files?…&commit=<sha>` — the files one commit changed. Its
  parent comes from `rev-list --parents`, falling back to git's empty-tree
  object so a root commit still diffs.
- `GET /api/diff?…&commit=<sha>` — diffs that commit against its own parent, and
  attributes the hunks to it alone.
- The commits panel gains **Review this commit** per commit and a
  **Review the whole pull request** reset; a chip in the header names the active
  commit and clears it.
- Selecting a commit narrows the explorer, the diff, and the counts. The trail
  resets, since a hop into code outside the commit would be misleading.

### Not done

- **Rings still cover the whole PR**, not the selected commit. A blast radius
  scoped to one commit is a coherent idea and is not built.
- Marks are not per-commit: marking a file reviewed while filtered marks the
  file, not the file-within-that-commit. [04](./04-review-mark-model.md)'s
  content-addressed hunk marks would make this well-defined; file-level marks do
  not.
