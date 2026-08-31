# 12 — The server, not the client, should resolve the clone path

Type: task
Status: resolved

## Question

[08](./08-stack-and-scaffold.md) shipped `/api/blob?clone=<absolute path>&rev=&path=`. The client passes an absolute filesystem path back to the server, which is wrong in two ways:

- **Portability** — [07](./07-navigation-trail-ux.md) made trails URL-encoded and shareable, but a URL carrying `/Users/<someone>/code/auth` is meaningless on another machine.
- **Exposure** — the endpoint will read from any git repository named, not just the one under review. It is localhost-only and single-user, so this is untidiness rather than a live vulnerability, but it is an open door with no reason to be open.

Fix: address blobs by `owner/repo` and let the server resolve the clone itself (it already does this in `findClone`, then hands the answer to the client and takes it back). Validate that the resolved path is one of the known clones before reading.

Small and mechanical — but do it before anything else is built on the current shape.

## Answer

Done, alongside the LSP wiring.

- `/api/blob` and `/api/definition` now take `owner` + `repo`; the server resolves the clone itself via `findClone`. `clonePath` is gone from the review payload — the client never sees a filesystem path, so trail URLs are portable.
- Repo-relative paths are validated: no leading `/`, no `..` segment.
- Definitions resolving outside the repo are dropped from results, and reported as `external: true` rather than as "not found".
