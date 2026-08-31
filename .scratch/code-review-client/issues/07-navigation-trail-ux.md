# 07 — Navigation trail mechanics

Type: grilling
Status: resolved
Blocked by: 03

## Question

Clicking a function reference pushes a frame onto the trail. Decide the mechanics:

- **Shape** — linear (jumping back and clicking anew truncates the tail) or a tree you can re-explore?
- **Getting back** — pop one frame, jump to any frame directly, and return to the PR diff in a single action. Which of these exist, and what are they bound to?
- **Explorer interaction** — you are three hops deep and click an unrelated file in the explorer. Does that push a frame, reset the trail, or open outside it?
- **Leaving the PR** — navigating into a file the PR never touched is normal and expected. Does the trail mark that you have left changed code, and how do you get back?
- **Persistence and multiplicity** — one trail per PR or several named ones? Does a trail survive a reload?
- **The zero point** — a review starts from a list of changed files, not one place. What is frame zero when you have opened four files independently?

## Answer

### Shape — linear, truncating on divergence

Jumping back to an earlier hop and clicking a different reference **discards the old tail**. The chain is always exactly the path from hop zero to where you are, with nothing stale in it — which is what makes [03](./03-name-the-two-depths.md)'s countable, digit-free breadcrumb honest. The code you abandoned is still there and still reachable; only the record of that walk is lost.

Rejected the tree: it stops being a chain, so 03's breadcrumb and its no-digit encoding rule would both reopen.

### Explorer versus trail — two jobs, cleanly split

**The explorer chooses where to start. The trail records where you went from there.** Clicking any file in either explorer mode ends the current trail and begins a new one at hop zero.

Rejected pushing explorer clicks onto the trail: `cacheGet` does not call `scim.go`, so putting them adjacent in the chain asserts something untrue — the exact false story a chain of call references exists to prevent.

**This revises [03](./03-name-the-two-depths.md).** That ticket held that hop zero always sits in code whose ring state is `changed`. True when you start from *Changed files*; false from *Whole repo*, where you can legitimately open an untouched caller to approach the change from outside. The rule is now: **hop zero is wherever the trail began**, and it happens to be `changed` when you started from *Changed files*. [`CONTEXT.md`](../../../CONTEXT.md) has been amended.

### Leaving changed code — the chain carries ring markers

Each hop shows the ring of the code it sits in, reusing the marker vocabulary that already exists:

```
⬣ authorize  ›  ⬢ loadPolicy  ›  ⬡ cacheGet
  changed         ring 1           ring 2
```

Crossing out of the change is simply visible — solid to faint as you travel outward — with no new concept, no new word, no extra chrome. It also puts both scales in one line legibly, which is what 03 was protecting in the first place. Travelling *back* into changed code needs no special rule, because the dot just goes solid again; an explicit boundary marker would have needed one.

### Getting back

Falls out of the shape:

- **Click any link** in the chain to jump to that hop (which truncates if you then diverge).
- **One action returns to the changes**, however deep you are — this is why a pure push/pop stack was rejected.

### Lifetime — the trail lives in the URL

Hops encode into search params, so reload restores the walk and a path can be copied to someone else or bookmarked before you go and write the finding up in GitHub. Fits [08](./08-stack-and-scaffold.md)'s decision to carry state in search params rather than adopt a router.

```
/?pr=sitoo/auth%23146&trail=middleware/forwarded_authorization.go:16,router/alb.go:88
```

**Required behaviour:** a hop references a symbol position, which can go stale after a force-push. Restoring a stale trail must degrade to "that symbol has moved" on the affected hop — never a blank pane, and never a silent jump to the wrong line.

Rejected persisting the trail into the PR's marks file: [04](./04-review-mark-model.md) scoped that file to progress you chose to record, and a trail is a side effect of browsing — mixing them would mean every idle click writes to disk.

### Surfaced by this ticket

URL-portable trails exposed a problem in what [08](./08-stack-and-scaffold.md) built: `/api/blob` takes an absolute `clone=` path from the client. A shared URL would carry another machine's path, and any caller can name any git repo on the box. See [12](./12-server-owns-the-clone-path.md).
