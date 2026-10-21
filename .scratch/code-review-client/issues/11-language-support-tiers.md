# 11 — Which languages the MVP supports, and at what fidelity

Type: grilling
Status: resolved

## Question

Charting assumed TypeScript, Go, then Python and PHP. [01](./01-lsp-proxy-viability.md) found the tiers are not uniform:

| language | definition | blast radius |
|---|---|---|
| Go (gopls) | yes | yes — 14/14, zero misses |
| TypeScript (`tsc --lsp`, TS7) | yes | yes, minus three known shapes |
| Python (pyright / basedpyright / ty) | yes | yes |
| **PHP** | yes | **no server implements call hierarchy at all** |

PHP would need call hierarchy synthesized from `references` + `documentSymbol`, or shipped definition-only.

Decide:

- Which languages the MVP actually ships with. TypeScript and Go alone cover most of `~/code`; Python is one repo, PHP is one repo.
- Whether a language can ship **definition-only**, with the blast radius simply absent — and whether that is honest enough or confusing.
- What the app does with a file in a language it has no server for. Plain highlighted text with no navigation, or hidden from the explorer?
- Whether language support is a build-time list or something that detects available servers on the machine at runtime.

## Note from [06](./06-explorer-row-signal-budget.md)

Real data raised a fourth case this ticket must answer. `sitoo/auth#146` changes **10 markdown files**, one of them 3,319 lines. Markdown has no language server and no call edges, so under the [03](./03-name-the-two-depths.md) vocabulary it is `out of range` — literally true, and it reads as wrong when those files sort beside untouched CI config.

So: does a file in a language the app has no server for get `out of range`, `unknown`, or a fourth state meaning **not applicable** — no call graph exists for this kind of file at all? Whichever it is, changed docs must not look like unaffected code.

## Answer

### What the sample said

Across ~209 changed files in the user's recent PRs: **83 Go, 70 TypeScript, 27 markdown, 13 Terraform**, then shell/yaml/sql/json. **Zero Python and zero PHP** — the two languages this ticket was written to worry about. Neither server is installed on the machine either.

So the question was mis-framed. PHP's missing call hierarchy is not a problem to solve; it is a language that does not appear in the work. Terraform, which nobody had mentioned, is the third-largest code language present.

### Two tiers, by installation rather than by decree

**Supported and verified:** TypeScript (`tsc --lsp`, TS 7) and Go (`gopls`) — 153 of 209 sampled files, both tested end to end.

**Registered, detected at runtime:** Python (`pyright-langserver`) and Terraform (`terraform-ls`). One row each in the server table. If the binary is on `PATH` or named by an env var, the language works; if not, its files read as [09](./09-unknown-versus-zero.md)'s `not applicable` with the install command named:

```
No terraform language server found — install terraform-ls, or set BR_TERRAFORM_LS.
```

This costs a table row rather than a code path, and nothing pretends to support a language it cannot.

**Not registered:** everything else. Markdown, YAML, shell, SQL and JSON are highlighted but never navigable — `No language server covers <path>`.

**PHP is out** for this effort. No server implements call hierarchy, it appears in none of the sampled PRs, and adding it would mean designing a definition-only fidelity tier for a language nobody here is reviewing. Recorded on the map as out of scope.

### The docs question this ticket inherited from 06

Answered by [09](./09-unknown-versus-zero.md): a changed markdown file is `not applicable`, visibly distinct from `out of range`. A changed doc no longer sorts beside unaffected code.

### Verified

| file | result |
|---|---|
| `infra/alarms.tf` | `unsupported`, reason names the install command |
| `docs/…scim-iam-api.md` | `unsupported`, "no language server covers" |
| `middleware/forwarded_authorization.go` | resolves, unchanged |
