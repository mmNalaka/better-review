# 06 — Explorer row: how much signal can one row carry?

Type: prototype
Status: resolved
Blocked by: 03, 04

## Question

One explorer row may need to carry five signals at once: filename, whether the PR touched it, the change kind (added / modified / deleted), review-mark state, and blast-radius level. Plus the whole tree must stay browsable for files the PR never touched.

Build a cheap static prototype — real filenames from a real repo (`~/code/iam-mono` or `~/code/auth`), no behaviour — with two or three competing treatments, and react to them. Decide:

- Which signals earn a permanent slot on the row, and which become a filter, a mode, or a hover.
- How PR-touched files stay obviously distinct while the rest of the tree remains navigable — highlight in place, sort to the top, a separate section, or a toggle between "PR files" and "whole repo".
- Whether the blast radius belongs on the tree at all, or only in the code view.
- What the tree does at `iam-mono` scale.

Use `/prototype`. Link the artifact from this ticket.

## Prototype

Three variants, switchable with `←` `→` or `?variant=A|B|C`.

- **Artifact:** https://claude.ai/code/artifact/34ef55c8-325c-4f6b-8f5b-64fa18f14bdf
- **Source:** [`../prototype-06-explorer.html`](../prototype-06-explorer.html) — throwaway, per `/prototype`

Data is real: the 32 changed files of `sitoo/auth#146` with their true additions/deletions, set against the real 231-file `sitoo/auth` tree. Ring and review values are fixtures — no call graph was computed.

| variant | organising principle | what it is testing |
|---|---|---|
| **A** | path — full tree, PR files highlighted in place | can a row carry all five signals permanently and stay readable? |
| **B** | progress — changed files grouped by review state, rings behind a toggle | is the ring worth a permanent column at all? |
| **C** | distance — files grouped into ring bands as sections | does making the blast radius the structure beat making it a column? |

### Finding from building it

**On changed files the ring never varies — it is always `changed`.** The gradient exists only among files the PR did *not* touch. So a permanent ring column on a changed-files list is a constant, carrying no information; rings only earn their place on a surface that shows untouched code. This was not obvious before the data was real, and it is the strongest argument against variant A's always-on column.

A second thing the real data exposed: **10 of the 32 changed files are markdown docs** (one is 3,319 lines). They are `out of range` by definition — no call edges — so in variant C they sort into the same band as untouched config, which reads as wrong even though it is literally correct.

## Answer

**Two modes, and each signal appears only where it carries information.**

Variant B wins as the default surface, variant A's tree becomes a second mode, and variant C's bands survive as an ordering option inside that mode rather than a surface of their own.

### Changed files — the default mode

Grouped by review state, not by path, because during a review the question is always "what is left". Rows carry: review glyph, path, flag, hunk progress, churn.

```
MODE: [ Changed files ]  Whole repo

this review · 5 of 32          ███░░░░░░░

⚠ needs another look 2
⚠ repository/mysql/user.go     4/9  +486 −18
⚠ service/session.go                −14

· not reviewed 25
  middleware/forwarded_authorization.go  ⚑ 1/2
    ✓ @@ 1,14   ForwardedAuthorizationToCtx
      @@ 15,29  ForwardedAuthorizationFromCtx
                ⚑ no test for the empty-header path
  service/scim.go              3/12 +626 −233

✓ reviewed 5
```

**No ring column here.** Every file in this list is ring state `changed` by definition, so the column would be a constant — five signals collapse to four the moment you notice that.

### Whole repo — the second mode

The full tree, PR-touched files highlighted in place, **and here the ring column earns its slot** because this is the only surface where rings vary. Sortable by path or by ring; sorting by ring is variant C, demoted from a surface to an ordering.

```
MODE: Changed files  [ Whole repo ]
sort: [ by path ]  by ring

  generated/service/
    api_scim_service.go        ● 1
    container.go               ● 1
  cmd/http/
    main.go                    ○ 3
  generated/handler/
    handlers.go                ? unknown
```

### The signal budget, settled

| signal | changed-files mode | whole-repo mode |
|---|---|---|
| filename | yes | yes |
| review state | yes (row group + glyph) | glyph only |
| hunk progress | yes | no |
| flag | yes | no |
| churn | yes | no |
| change kind (A/M/D) | derived from group + churn | yes, glyph |
| **ring** | **no — constant here** | **yes** |

Nothing was cut for taste; each signal was placed where it varies.

### What the real data settled that prose could not

1. **The ring is constant on changed code.** Every PR-touched file is `changed`; the gradient lives entirely among untouched files. This single observation is what split the surface into two modes.
2. **10 of the 32 changed files are markdown**, one of them 3,319 lines. They have no call edges, so they are `out of range` — which is literally correct and reads as wrong when they sort beside untouched CI config. Non-code changed files probably need a ring state that means *not applicable* rather than *out of range*; noted on [11](./11-language-support-tiers.md).

### Prototype disposition

The repo is not yet under git, so the throwaway cannot go on a branch as `/prototype` prescribes. It stays at [`../prototype-06-explorer.html`](../prototype-06-explorer.html) and at the artifact URL above, both linked from this ticket. When [08](./08-stack-and-scaffold.md) runs `git init`, move it to a `prototype/06-explorer` branch and drop it from main.
