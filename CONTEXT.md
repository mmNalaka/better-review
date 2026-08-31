# Code Review Client

A local, single-user web app for reading a GitHub pull request: navigate by clicking function references, see how far you have travelled and how close code sits to the change, and mark what you have reviewed.

## Language

### Navigation

**Trail**:
The ordered chain of places you have travelled by clicking function references, starting at the changes.
_Avoid_: history, stack, breadcrumb (that is the trail's rendering, not the thing)

**Hop**:
One step along the trail — the unit of travel. Counted from hop zero, so a symbol reached by three clicks is three hops in. Each hop in the chain carries the ring marker of the code it sits in, which is how leaving changed code becomes visible.
_Avoid_: depth, level, frame

**The changes**:
The pull request's changed-file view, and the place "back to the changes" returns you to. A trail started from here has a hop zero whose ring state is `changed` — but a trail started from *Whole repo* does not, so this is a consequence of where you began, not an invariant. Revised by [07](./.scratch/code-review-client/issues/07-navigation-trail-ux.md).
_Avoid_: home, the diff, the review, the PR view

**Hop zero**:
Wherever the current trail began — the file you opened from the explorer. Opening any file from either explorer mode ends the previous trail and starts a new one at hop zero.
_Avoid_: root, origin frame, entry point

### Distance from the change

**Blast radius**:
The measure of how far code sits from the pull request's changed lines in the call graph. Answers "what could this break?".
_Avoid_: impact, reach, depth, dependency graph

**Ring**:
One band of the blast radius — the unit of distance. Code that directly calls changed code is ring 1, its callers ring 2, and so on. Rings are the only thing in this app that carries a number on screen.
_Avoid_: depth, level, degree, hop

**Changed**:
The ring state of code the pull request actually modified. Spoken as `changed`, never as "ring 0" — it is the origin, not a distance from itself.
_Avoid_: ring 0, touched, modified, base

**Out of range**:
The ring state of code the call graph reached but found no path to the change from. Says only that no call edge exists — a file can be deeply related and still be out of range.
_Avoid_: unrelated, unaffected, unconnected, safe

**Unknown**:
The ring state of code we should have been able to place and could not — a server refusal, a change with no enclosing callable, or a deletion whose lines no longer exist. Always rendered distinctly from `out of range`: "we could not tell" is not "nothing calls this". Distinct also from `not applicable`, which is not a failure.
_Avoid_: none, unresolved, empty

**Not applicable**:
The ring state of a file no language server covers — markdown, YAML, Terraform. There is no call graph to be placed in, so this is not a failure to measure. On [sitoo/auth#146](https://github.com/sitoo/auth/pull/146) it is 9 of 32 changed files.
_Avoid_: unknown, unsupported, none, n/a in prose

**Working**:
The transient state while the blast radius is still being computed. Never looks like a permanent gap — with eager streaming the first seconds of every review are spent here.
_Avoid_: pending, loading, computing

**Inferred**:
A ring edge we derived rather than measured — chiefly an anonymous callable attributed to its enclosing named symbol, which is right for an inline route handler and wrong for a callback passed elsewhere. Rendered with a tilde (`1~`) so it is never mistaken for a measured edge.
_Avoid_: approximate, guessed, estimated

### Review progress

**Mark**:
Your record of attention on a changed file or hunk. Marks are content-addressed — a file mark is keyed to its blob sha, a hunk mark to a hash of that hunk's added and removed lines — so they survive rebases that do not touch the content.
_Avoid_: check, tick, viewed, seen

**Reviewed**:
The state of a hunk you have marked, or of a file whose every hunk is marked. Set by you on a hunk; on a file it is either set directly or derived.
_Avoid_: done, checked, approved, viewed

**Partial**:
The derived state of a file where some but not all hunks are reviewed. Never set directly.
_Avoid_: in progress, half done

**Changed since reviewed**:
The derived state of a file or hunk whose content no longer matches what you marked. Not the same as unreviewed — it records that you did the work and the ground moved.
_Avoid_: stale, invalidated, dirty, outdated

**Flag**:
A mark saying "come back to this", carrying a line of text explaining why. The only place the app stores your words rather than your progress.
_Avoid_: comment, issue, todo, bookmark

**Finding**:
One flagged hunk and its note, as it appears in the collected list you copy out at the end of a review. Findings leave the app as text — the app never posts them.
_Avoid_: comment, remark, review comment

### Surfaces

**Changed files**:
The default explorer mode: only what the pull request touched, grouped by review state rather than by path. Carries no ring marker — every file in it is `changed`, so the ring would be a constant.
_Avoid_: diff list, file list, PR files

**Whole repo**:
The second explorer mode: the full tree with pull-request files highlighted in place. The only surface where rings vary, and therefore the only one that shows them.
_Avoid_: tree view, all files, browse mode

### The retired word

**Depth** is deliberately absent from this vocabulary. Two different distances share every screen — how far you have travelled, and how far code sits from the change — and "depth" fits both, which is why it was retired. Travel is measured in **hops**, distance from the change in **rings**.

## Encoding rule

Exactly one number appears on screen, and it is always a ring. The trail shows its hops as visible links in a chain — countable, so a digit would be redundant. See [03 — Name the two depths](./.scratch/code-review-client/issues/03-name-the-two-depths.md).
