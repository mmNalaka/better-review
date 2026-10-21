# 03 — Name the two depths

Type: grilling
Status: resolved

## Question

Two different "depths" will be on screen at once:

1. How far you have navigated from where you started (the trail).
2. How far a piece of code sits from the changed lines in the call graph (the blast radius).

Both are currently called depth, and a reader seeing two numbers will have to ask which is which. Decide:

- The canonical term for each, and whether either keeps the word "depth" at all.
- Distinct visual languages — number, dots, colour, indentation — so they are never confused even at a glance.
- Whether both are ever shown numerically on the same surface, or whether one is always ambient.
- What the zero point is called in each case (the PR diff you started from; the changed lines themselves).

Record the terms in `CONTEXT.md` via `/domain-modeling`. Every later UI ticket depends on this vocabulary.

## Answer

**"Depth" is retired.** It fitted both distances equally well, which is exactly why it was ambiguous. Travel is measured in **hops**, distance from the change in **rings** — one linear metaphor, one concentric, so they cannot be misread as the same scale.

Terms recorded in [`CONTEXT.md`](../../../CONTEXT.md).

### The two scales

| | trail | blast radius |
|---|---|---|
| unit | **hop** | **ring** |
| origin | **the changes** | **changed** |
| shape | linear chain | concentric bands |
| rendering | visible links in a breadcrumb | glyph + digit in explorer rows and gutter |

### Encoding rule

**Exactly one number appears on screen, and it is always a ring.** The breadcrumb already shows the hops as countable links, so a hop digit would be redundant; a ring is invisible without a marker and is the thing you will want to filter and compare by, so it earns the digit.

```
authorize › loadPolicy › cacheGet          [← back to the changes]
────────────────────────────────────────────────────────────────
explorer                    cache.ts                    ⬡ 2
  auth.ts        ⬣  changed  ┃ 34  export function cacheGet(k) {
X policy.ts      ⬢ 1         ┃ 35    const hit = store.get(k)
  cache.ts       ⬡ 2         ┃ 36    if (!hit) return miss(k)
  mailer.ts      ·  out of range
  routes.ts      ?  unknown
```

### Ring states

Four, and none of them overlap:

- **changed** — the code the PR modified. Spoken as `changed`, never "ring 0"; it is the origin, not a distance from itself.
- **1, 2, 3…** — bands outward through the call graph.
- **out of range** (`·`) — the graph reached it, no path to the change. Claims only that no call edge exists. Rejected `unrelated` as overclaiming: a types or config file can be central to a change and still carry no call edge.
- **unknown** (`?`) — the language server could not place it at all. Kept deliberately distinct from `out of range`, because [01](./01-lsp-proxy-viability.md) found 7 of 8 callables in a real controller are anonymous route handlers with no call-hierarchy identity. Collapsing the two would render the common case as "nothing calls this", which is a lie.

### Shared origin

The two scales meet at one point: **hop 0 always sits in code whose ring state is `changed`**. The return action is "back to the changes". This is why `the changes` beat `home` and `the diff` — it names the origin once and both vocabularies use it.

### Consequences for other tickets

- [09](./09-unknown-versus-zero.md) inherits `unknown` and `out of range` as given words; it decides how loudly they are shown, not what they are called.
- [06](./06-explorer-row-signal-budget.md) now knows the ring marker is a glyph plus at most one digit, and that four states must fit.
- [10](./10-blast-radius-walk.md) has vocabulary for the walk's edges: it stops at some ring, and everything beyond is `out of range`.
