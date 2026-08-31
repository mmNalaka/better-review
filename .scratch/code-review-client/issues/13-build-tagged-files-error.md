# 13 — Build-tagged files make the language server throw, not return empty

Type: task
Status: resolved

## Question

Measured while resolving [10](./10-blast-radius-walk.md): **44 of 155 symbols** in `sitoo/auth#146` sit in files behind `//go:build integration_test`. gopls has no package metadata for them and answers with a hard JSON-RPC error:

```
no package metadata for file file:///.../integrationtest/scim_iam_test.go
```

Not an empty result — an error. Consequences in what is already built:

- `/api/definition` lets it escape as a **502**, so clicking any symbol in a build-tagged file looks like the app is broken.
- The blast-radius walk would abort on the first such file unless each call is individually guarded.

Fix:

- Catch language-server errors per request and return the [09](./09-unknown-versus-zero.md) `unknown` state rather than failing. "We could not place this" is exactly what `unknown` means.
- Consider passing build flags to gopls (`build.buildFlags: ["-tags=integration_test"]`) so these files resolve properly. That is a real decision, not just error handling: which tags, and who chooses them.

Whichever way it goes, a whole category of a repo's test files currently reads as a server error.

## Answer

Both halves done, and the second half was not what it looked like.

### Error handling

Language-server refusals are caught per request and returned as [09](./09-unknown-versus-zero.md)'s `unknown`, carrying the server's own words so the cause stays inspectable. The 502 is gone.

### Build tags — only what the PR needs

`server/buildtags.ts` reads the `//go:build` header of each changed `.go` file and passes the union to gopls. On `sitoo/auth#146` that resolves to exactly `-tags=integration_test`; `tools` is not enabled because no changed file needs it. Platform constraints (`linux`, `amd64`, `cgo`, …) are excluded — those describe where code runs, and forcing them is not ours to do.

Tags cannot change after `initialize`, so the server pool is keyed on them: a different tag set is a different server, never a silently reused one started without them.

### Two bugs found only by measuring

**1. gopls ignores nested settings.** `initializationOptions` must use the flat dotted key. The nested form is accepted and silently does nothing, so the flag looks applied and is not:

| settings shape | `textDocument/definition` in a tagged file |
|---|---|
| no tags | REFUSED |
| `{ build: { buildFlags: [...] } }` | **REFUSED** |
| `{ "build.buildFlags": [...] }` | **OK** |
| `GOFLAGS` env | OK |

Also: replying `{}` to `workspace/configuration` discards the options gopls was just given. The handler now returns the real settings.

**2. `documentSymbol` cannot signal readiness.** It is syntactic and succeeds even when a file is in no package at all — so a probe built on it reports ready while every semantic request still fails. My first probe used it and proved nothing. Readiness now retries **the real request** for up to 45 s on first open of a file; after that, a refusal is taken as real.

### Verified

| case | result |
|---|---|
| Go, build-tagged | `mysql.SetupSQL()` → `repository/mysql/integration_test_helper.go:22` |
| Go, untagged | `forwarded_authorization.go:9` |
| Go, dependency symbol | `external: true` |
| markdown | `unsupported` — 09's `not applicable` |
| TypeScript | `rolesv2.ts` → `forwarding.ts:25` |

The tagged-file fix also recovers `repository/mysql/integration_test_helper.go`, one of the seven unplaced files in [09](./09-unknown-versus-zero.md)'s breakdown — so that population is smaller than measured there.
