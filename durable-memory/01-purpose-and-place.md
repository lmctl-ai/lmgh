# Purpose and place

lmgh exists so agent-written LMScript can operate GitHub through the same
`gh` binary operators already authenticate, with a compiled schema contract
instead of ad-hoc argv strings.

## Place in the stack

- LMScript source → `lmscript` (≥ 0.2.420) compiles against
  `schema/lmgh.dsl.json` → DSL bytecode v5 (`.dslb`).
- `lmgh` host (Go, `github.com/lmctl-ai/lmcode-go` SDK, CGO disabled)
  embeds the exact schema bytes, loads the bytecode, and runs it.
- Every operation shells out to `gh` (argv only; `GH_PROMPT_DISABLED=1`,
  `NO_COLOR=1`, pagers cat-ed). Auth is entirely `gh`'s own.
- Upstream `cli/cli` v2.103.3 (`63837fb7`) is vendored in `third_party/cli`
  (git-ignored) as the reference for `--json` field names; `cli.lock` pins
  it and `scripts/sync-cli.sh --verify` guards drift.

## Scope boundaries

- v0 covers read ops for repos, issues, PRs, releases, workflow runs and
  search, plus write ops (`issue_create`, `pr_merge`) behind a dry-run flag,
  and human-in-the-loop TOML flows for PR creation (`pr_prepare`/`pr_submit`)
  and PR review submission (`pr_review_prepare`/`pr_review_submit`). No GraphQL
  passthrough, no label mutations or inline diff-comment threads.
- The host never prompts; anything `gh` would ask about is an error.
- `gh` version must parse as >= 2.45.0 < 3.0.0 or every op refuses.

## History

2026-10-10: repo created as `gh2`, a Bun/TypeScript lmapi server (schema
`cli.schema.v1`, `@lmctl-ai/lmts` runtime). 2026-10-26: pivoted to the Go
lmcode host per operator task p1.txt. The `gh2` code remains in git history;
its operation catalog and product-compatibility policy were carried over.
