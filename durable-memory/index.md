# lmgh (`gh2`) — durable memory

Portable knowledge for this repository.

## What gh2 is

A structured CLI over the GitHub `gh` binary: JSON in, JSON out, no server.
It is an lmapi server: `gh2 --schema` prints its `cli.schema.v1` document, and
that document is the contract (see https://github.com/lmctl-ai/lmapi).

The runtime (input forms, validation, policy flags, error envelope,
`--schema`/`--list`/`--explain`/`--help`, process spawning) is
`@lmctl-ai/lmts/server`; this repository defines operations and schemas only.
The operation catalog was migrated from kousen/gh_mcp_server and checked against
github/github-mcp-server (see `THIRD-PARTY-NOTICES.md`).

## Ops

28 operations (26 from the migrated catalog, plus `create_repository` and
`pr_triage`); `gh2 --list` is authoritative.
- Most read operations pass `--json <fields>` and parse the result.
- `get_file_contents` fetches raw content via
  `gh api repos/.../contents/... --jq '.content | @base64d'`.
- Write operations return a `{success, url|output}` envelope.
- `src/api.ts` is the catalog, `src/pr-triage.ts` the PR-triage implementation,
  `src/schemas.ts` the authored schemas for every op.

## Things worth knowing

- **gh JSON field names**: the field lists target the field names of current `gh`
  releases (`defaultBranchRef`, `primaryLanguage`, `repositoryTopics`,
  `stargazerCount`, `forkCount`, `isLatest`). When upgrading `gh`, audit the
  field lists in `api.ts`.
- **`pr_triage` fallback**: `gh pr view --json` with `reviewThreads` fails with
  `Unknown JSON field: "reviewThreads"` on some gh builds; `pr-triage.ts` retries
  with the reduced field set (`GH_FIELDS_NO_REVIEW_THREADS`) and reports the
  degradation in `warnings` instead of failing.
- **`execGh` vs `execGhText`**: `execGh` parses `--json` output; `execGhText`
  returns raw text (used by `pr_triage` to inspect stderr on non-zero exit).
- **No dangerous ops**: `merge_pull_request`, `close_issue` and
  `close_pull_request` run under the normal write policy and are simulated under
  `--dryrun`; none needs `--confirm`. This is intended.

## Non-negotiables

- `GH_PROMPT_DISABLED=1` and `NO_COLOR=1` in every spawned environment.
- Write ops pass `checkPolicy` before any command is built.
- Every op has an authored schema with descriptions and cardinality; a missing
  `access` counts as effectful.
- New op = `op()` in `cli.ts` + method in `api.ts` + schema in `schemas.ts`.
- The published tool name stays `gh2`.

## Tests

`bun test --coverage` (thresholds in `bunfig.toml`). Tests use a fake `gh`
executable placed first on `PATH` that records argv and prints canned JSON; they
never call GitHub, need no token, and never touch the real `HOME`.
