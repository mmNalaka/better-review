# 14 — Diff view, split against the whole file

Type: task
Status: resolved

## Question

Graduated from the map's fog ("diff rendering model"), and raised directly: the app shows whole files only, so a review of a *change* never shows the change.

Decided: **changed hunks in one pane, the whole file in the other, scroll-linked.** Clicking a hunk moves the file pane to it. A toggle collapses to either pane alone.

Rejected side-by-side base-versus-head: it is the conventional reading of "split view" and better for rewrites, but it leaves no room for the whole-file pane, which is what makes a hunk legible when it needs the function around it.

Known cost, accepted: there is no base-versus-head comparison anywhere in the app. A rewrite like `service/scim.go` (+626/-233) must be read as a unified hunk list.

## Answer

Built and verified against `sitoo/auth#146`.

### Server

`GET /api/diff?owner&repo&pr&rev&path` returns parsed hunks:

```
Hunk  { header, oldStart, newStart, lines[] }
DiffLine { kind: context|added|removed, text, oldLine, newLine }
```

Computed locally with `git diff <mergeBase> <head> -- <path>`, not from the GitHub API — ticket 02 measured `patch: null` on a 97 KB file well below the documented limits, so the API silently drops large ones. Verified on `service/scim.go`: 8 hunks, 993 lines, old/new numbering correct.

### Client

Three modes, toggled per file: **Diff + file** (default), **Diff only**, **Whole file**. The toggle only appears for files the PR changed — an unchanged file has no diff to show.

- Clicking a hunk header moves the file pane to that hunk's first head-side line. Verified: `@@ -129,6 +138,31 @@` focuses line 138.
- Added lines are marked in the whole-file gutter. Verified: 626 marked on `service/scim.go`, exactly its `+626`.
- Deleted lines appear in the hunk pane only — they do not exist in the file pane, which is the head side.

### Bug found in review

"Diff only" initially still rendered the file pane: the grid narrowed to two columns and the code pane simply filled the second, so the mode looked like a width change rather than a mode. The pane is now unmounted.

### Not done

- **No scroll-linking**, only click-to-jump. Scrolling the diff does not move the file.
- **No base-versus-head view** anywhere — the accepted cost of this layout. A rewrite must be read as a unified hunk list.
- Below 1100px the file pane is dropped from split mode rather than the layout reflowing.
