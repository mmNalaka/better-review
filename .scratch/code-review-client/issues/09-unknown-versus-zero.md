# 09 — Representing "unknown" versus "zero" in the blast radius

Type: grilling
Status: resolved
Blocked by: 03

## Question

[01](./01-lsp-proxy-viability.md) found the blast radius has two distinct kinds of gap, and conflating them would make the feature lie:

1. **Genuinely no callers** — the graph was walked and nothing calls this.
2. **Cannot be answered** — `prepareCallHierarchy` returns nothing at all for anonymous callables. In your own `role-assignments.controller.ts`, **7 of 8 callables are anonymous route handlers**, so this is the common case in real application code, not an edge case.
3. **Known-incomplete** — TypeScript misses `xs.map(fn)`, `const f = fn`, and `{ t: fn }` by design. A references + documentSymbol fallback recovers all three, but only if we build it.

Decide:

- How the UI distinguishes these. Is "unknown" a distinct visual state from "level 0 has no callers", or does unknown code simply carry no marker at all?
- Do we build the references + documentSymbol fallback for the three TypeScript shapes, or ship without it and label the radius as approximate?
- Anonymous route handlers: do we attribute them to an enclosing named symbol (the route registration, the module) so they get *a* position in the graph, or accept that they have none?
- Is there a visible honesty signal — "this radius is incomplete for this file" — or does that undermine trust more than it earns?

## Answer

### Measured first — how big the problem actually is

On `sitoo/auth#146`, **half the changed files carry no ring**, for five different reasons:

| | files | |
|---|---|---|
| Go, placed at ring 0 | 16 | |
| Go, not placed | 7 | 2 build-tagged · 2 declarations-only (`app/constants.go`, `provider/iam/types.go`) · 1 deletions-only (`service/session.go`, −14) · 2 test helpers |
| No language server at all | 9 | 8 markdown, plus `.tf` and `.yaml` |

Deletions-only was not in this ticket's original list: the changed lines do not exist on the new side, so there is no symbol to enclose. It is a distinct cause, not a variant of the others.

### Three rendered states, five causes

Collapsing all five to one glyph would lie; giving each its own would put five glyphs on a row that already carries review state and change kind. The split is by **what the reader can conclude**, not by cause:

- **working** — transient, still computing. Never looks like a permanent gap. With [10](./10-blast-radius-walk.md)'s eager streaming, the first seconds of every review are spent here, so this state is on screen constantly and must read as motion.
- **not applicable** (`–`) — no language server covers this file type. Not a failure to measure: there is no call graph for markdown to be placed in. 28% of this PR. Answers the question [11](./11-language-support-tiers.md) raised.
- **unknown** (`?`) — code we should have been able to place and could not: server refusal, no enclosing callable, deletions only.

The specific cause shows on hover ("build tag", "no callable at the changed lines"), not as a glyph. `out of range` stays what [03](./03-name-the-two-depths.md) defined: the graph reached it and found no path.

Rejected the four-state split that separated server refusals: a refusal is fixable by configuration, but the reader cannot act on that distinction mid-review, and it belongs in [13](./13-build-tagged-files-error.md) rather than on the row.

### Both recoveries, with inferred edges marked

**TypeScript fallback — build it.** [01](./01-lsp-proxy-viability.md) verified that references + documentSymbol recovers all three shapes `incomingCalls` misses by design (`xs.map(fn)`, `const f = fn`, `{ t: fn }`) *exactly*. Nothing approximate about it; declining would leave a TypeScript radius reading thinner than the truth.

**Anonymous attribution — build it, and mark it.** Attribute an anonymous callable to its enclosing named symbol so inline route handlers get a position rather than nothing. This matters: [01](./01-lsp-proxy-viability.md) found 7 of 8 callables in `role-assignments.controller.ts` are anonymous route handlers.

But it is genuinely approximate — the callback inherits its enclosing function's callers, which is right for a route handler and wrong for a callback passed elsewhere. So inferred edges render with a tilde:

```
provider/iam/http.go    ⬢ 1
router.go               ⬢ 1~   inferred
  └ handler attributed to registerRoutes
```

The tilde is the point: coverage without pretending it was measured. An inferred edge must never be silently mixed with a measured one.

### Vocabulary

`not applicable`, `working` and `inferred` added to [`CONTEXT.md`](../../../CONTEXT.md); `unknown` narrowed to "should have been placeable and was not".
