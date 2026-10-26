# Open items

Candidate work after v0, in no fixed order.

## API surface

- `api_json(path)` escape hatch: blocked because the compiler rejects std
  `Json` as a host-declared return type. Options: compiler support, or a
  host `ApiResult` type with `get`/`at` navigation.
- More write ops with dry-run support: `issue_close`, `pr_comment`,
  `label_add`, `release_create`. gh2's catalog (git history) is the
  reference list.
- `pr_triage` additions when gh exposes them: unresolved review threads
  (needs `reviewThreads`, absent from gh v2.103.3).
- Pagination beyond `--limit` (cursors via `gh api`).

## Platform

- Release binaries + `install="github:lmctl-ai/lmgh@latest"` story: examples
  use the idiom already; it resolves locally via PATH until the first
  release exists. Packaging can follow lmhtml's npm-layout pattern.
- CI workflow (`.github/workflows/ci.yml`) still shows the old gh2 Bun
  pipeline — rewrite for `go build` + `./test.sh`.
- `gh issue list` does not populate `Issue.comments()` (gh exports a node
  list, not a count); acceptable until someone needs per-list counts.

## Upstream

- `cli.lock` pins v2.103.3. On upgrade, re-verify every `--json` field list
  in `ops.go` against the new vendored source (see 02-schema-v0.md for the
  fields that already bit once).
