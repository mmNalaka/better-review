# 10 — How far the blast radius walks, and when it is computed

Type: grilling
Status: resolved
Blocked by: 03

## Question

Graduated from fog now that [01](./01-lsp-proxy-viability.md) has measured the real costs.

The numbers that force this decision: warm repeat queries are cheap (tsgo definition p50 1–2 ms, call hierarchy p50 5–8 ms), but that is a cache hit. Walking to *newly touched* symbols costs tsgo ~21 ms and **gopls ~1.7 s per newly-touched package**. A naive breadth-first walk over a Go PR will visibly hang.

Decide:

- **Depth** — how many levels out does the radius go? Is it fixed, or does it expand on demand?
- **When** — precomputed in the background on PR open, computed lazily per file as you browse, or streamed in and rendered progressively?
- **What the UI does while it is unknown** — a spinner, an absent marker, or a marker that fills in. Interacts with [09](./09-unknown-versus-zero.md).
- **Direction** — callers only (who could this break), or callees too (what does this depend on)? The word "blast radius" implies callers; is that right?
- **Caching and invalidation** — cache keyed on what, invalidated by what. New commits on the PR, edits in the clone.
- **The Go/TS asymmetry** — is one strategy applied to both, or does Go get background precomputation that TypeScript does not need?

## Answer

### The premise was wrong — measured on the real PR

This ticket was written expecting ~1.7 s per newly-touched package and a UI that visibly hangs. That figure came from [01](./01-lsp-proxy-viability.md)'s walk over *new packages in a cold cache*. Measured against the actual PR — `sitoo/auth#146`, 23 changed Go files, depth 3, warm gopls:

| | |
|---|---|
| whole radius, spawn to done | **2.7 s** |
| project ready | 589 ms |
| level 0 (symbols enclosing changed lines) | 1322 ms |
| BFS outward | 698 ms |
| per `incomingCalls` request | **5.6 ms** (124 issued) |
| symbols by ring | 111 → **8** → **5** → **3** |
| files in radius | 21 |
| symbols gopls refused | **44** |

Two things this changes:

1. **Eager computation is affordable.** Three seconds, not thirty.
2. **The radius collapses almost immediately.** 111 changed symbols reach only 8 at ring 1 — most changed symbols are tests, and nothing calls a test.

Raw output: `/tmp/br-blast-real.json`; walker at [`../research-01/measure-pr.mjs`](../research-01/measure-pr.mjs) (a copy of the ticket 01 walker taking `base..head` instead of one commit, and tolerating per-file server failures).

### When — eagerly on PR open, streamed

The walk starts when the PR loads; rings stream into the explorer as they resolve. At 2.7 s the answer lands before you have finished reading the first file, so rings are simply *present* rather than something you request.

**Required:** a cold gopls cache was measured at up to 38 s. The first open of a repo must show a working state, not an empty one — an absent ring marker means "not computed yet", which is [09](./09-unknown-versus-zero.md)'s `unknown`, not "no callers".

### How far — until it runs dry, with a cap

Walk outward while the frontier is non-empty. Termination is natural: this PR would stop at ring 4 by itself. A fixed depth would be arbitrary.

Cap on **symbol count and elapsed time, not depth** (2000 symbols / 15 s as starting values), because depth is not what runs away — fan-out is. When a cap is hit, say so: *"radius capped at ring 3 — 2000 symbols"*. Never present a truncated radius as complete.

### Direction — callers only

No decision needed: [`CONTEXT.md`](../../../CONTEXT.md) already defines the blast radius as answering *"what could this break?"*, which is `incomingCalls`. Callees are a different question and not this feature.

### Caching

Keyed on the PR head sha, since that is what the radius is computed from. A new commit invalidates it wholesale — consistent with how [04](./04-review-mark-model.md) treats marks, and cheap enough at 2.7 s that partial invalidation would be false economy.

### Surfaced — build tags are a real `unknown` population

**44 of 155 symbols were refused by gopls**, all from files behind `//go:build integration_test`. gopls returns a hard error (`no package metadata for file`), not an empty result.

This is a live bug in what is already built: `/api/definition` lets that error escape as a 502. It must be caught and reported as `unknown`. Logged as [13](./13-build-tagged-files-error.md).

## Implementation

Built in `server/rings.ts` (walk), `/api/rings` (SSE), `web/src/useRings.ts` (stream), `web/src/RingMark.tsx` (09's three states) and `Explorer.tsx` (06's *Whole repo* mode with the ring column).

### Measured on `sitoo/auth#146`, in the app

| | |
|---|---|
| whole radius, streamed | **1.47 s** (research measured 2.7 s standalone) |
| symbols visited | 207 |
| terminated | naturally at ring 5 — **no cap hit** |
| events streamed | 7, one per ring plus a closing batch |

| ring state | files |
|---|---|
| changed | 32 (29 placed, 3 `unknown`) |
| ring 1–4 | 16 |
| out of range | 130 |
| not applicable | 66 |
| unknown | 3 |

**The three unknowns are exactly the files [09](./09-unknown-versus-zero.md) predicted** — `app/constants.go`, `provider/iam/types.go`, `service/session.go` — each reporting *"no callable encloses the changed lines"*. The declarations-only and deletions-only cases, found independently by the walk rather than by hand.

Ring 2 is empty: the walk found nothing there. Rings are not contiguous, and the UI does not pretend otherwise.

### Decisions honoured

- Eager on PR open, streamed per ring — the explorer fills in as rings land.
- Walk until the frontier is dry; caps on symbols (2000) and time (15 s), **not depth**; a cap renders as a visible badge, never a silent truncation.
- Callers only.
- `working` pulses while the walk runs, so an unplaced file never reads as "no callers" (09).

### Not done

- **No caching.** Every PR open re-walks. At 1.5 s that is tolerable; the head-sha key from this ticket is unimplemented.
- **No inferred edges.** [09](./09-unknown-versus-zero.md)'s anonymous-callable attribution and TypeScript references fallback are still unbuilt, so the radius is measured-only — thinner than 09 specifies, and nothing renders `1~` yet.
- The walk holds the request open; there is no cancellation if the PR is closed mid-walk.
