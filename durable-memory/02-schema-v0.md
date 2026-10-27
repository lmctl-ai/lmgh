# Schema v0

`schema/lmgh.host.json` (copied byte-identical to `schema/lmgh.dsl.json`) is
the authored contract: `dsl.schema: 2`, name `lmgh`. With lmscript ≥ 0.2.420
the compiler supplies the std catalog implicitly, so the embedded schema is
host-only; `print` and `assert_close` are host-provided via
`lmcode.RegisterTesting` and declared in the schema functions (the lmhtml
pattern).

## Contexts and types

- Contexts: `gh: Gh` (operation catalog + policy), `report: Report`
  (findings log: `add`, `len`, `write_text`, `write_json`, `fail_if_any`;
  `fail_if_any` raises `APP_FAIL` → exit 4).
- Objects with `len()`/`at(int)` list protocol: `RepoList`, `IssueList`,
  `PrList`, `ReleaseList`, `RunList`, plus `Strings` (labels/topics).
- `RunList.failing()` filters conclusions failure/timed_out/action_required/
  startup_failure into a new list.
- `Triage.ok()` = no failing checks, no changes requested and
  `mergeable == "MERGEABLE"`.

## Why a host `Strings` type

The Go SDK's std `StrList` has no exported constructor, so host code cannot
build one. Hosts expose their own read-only `len()/at()` list instead.

## Why no `Json` return type

The compiler rejects host schemas returning std `Json` ("type not
declared"), even though the SDK registry has it — implicit std types are not
host-declarable. An `api_json` escape hatch was dropped from v0 for this.

## gh `--json` field verification (against vendored v2.103.3 source)

Field lists in `ops.go` were checked against `third_party/cli`:

- `repo view`: `repositoryTopics` exports as a **flat** `[{"name"}]` list;
  `openIssues` does **not** exist (use `issues` → `{totalCount}`); homepage
  is `homepageUrl`; `stargazerCount`/`forkCount` plain ints.
- `issue list`/`issue view`: `comments` exports as a **node list**, not a
  count — so `issue_list` does not request it (`Issue.comments()` is 0 for
  lists; populated by `issue_view`). Search-style `commentsCount` (plain
  int) exists only on `search issues`.
- `pr view`: `reviewThreads` does **not** exist in v2.103.3 (gh2 hit this
  too); triage uses `reviewDecision` + `reviews` + `statusCheckRollup`
  (CheckRun `conclusion` or StatusContext `state`).
- `release list`: no `isLatest` field — dropped from `Release`.
- `search repos`: no `topics` field; result topics are always empty.
- `search prs` = issue search fields + `isDraft` only (no base/head refs).

## Policy

- `state` validated to open/closed/all; `limit` to 1..1000; merge method to
  merge/squash/rebase — before any gh spawn.
- `issue_create` runs `gh issue create`, parses the printed URL, then
  re-fetches the issue; under `dry_run(true)` it records a `dry-run` report
  entry and returns an `Issue` with `state() == "dry-run"` and `number() ==
  0`.
- Human-in-the-loop PRs (v0.2.0): `pr_prepare(owner, repo, title, body, base,
  head, draft)` writes `pr-review-<owner>-<repo>.toml` in the host's cwd and
  returns its absolute path; it refuses to overwrite an existing review file.
  `pr_submit(owner, repo, path)` decodes that file with
  `pelletier/go-toml/v2` (strict: `DisallowUnknownFields`, non-empty title,
  plain-name idents, owner/repo must match the call), then runs
  `gh pr create` and re-fetches the PR. `pr_submit` honors `dry_run(true)`;
  `pr_prepare` always writes (local file, not a remote mutation). TOML is the
  first and only third-party Go module dependency (MIT).
- Env: `GH_PROMPT_DISABLED=1`, `NO_COLOR=1`, `GH_PAGER=cat`, `PAGER=cat`.
  `LMGH_GH` overrides the binary path (testing / non-PATH installs).
