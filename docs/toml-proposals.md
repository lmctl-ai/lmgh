# Write a PR proposal before submitting it

`examples/toml-pr.lms` embeds a `[pr]` TOML table. Its opaque Data object sends
`proposal.toString()` to `pr_create_toml(string) -> Json`; strings stay quoted
values, with no generated source or new std functions. Fields are owner, repo,
title, body, base, head, draft, labels and reviewers. Title/owner/repo/base/head
are required; unknown fields and wrong types fail before `gh` can start.

Use a compiler built from mono main a830a1cb or later: npm 0.2.458 predates opaque
Data. Build this host with `go build -o build/lmgh .`, then:

```text
lmscript --check examples/toml-pr.lms /absolute/path/to/build/lmgh
lmscript --dry-run examples/toml-pr.lms /absolute/path/to/build/lmgh
lmscript examples/toml-pr.lms /absolute/path/to/build/lmgh
```

Check validates TOML syntax without a host process. Dry starts the actual host,
strictly validates the table and prints every normalized proposal field; it
neither starts `gh` nor writes review files. Real mode validates the same table
and calls `gh pr create` once, including explicit draft/labels/reviewers, returning
the proposal and URL. A successful preview cannot prove remote permissions or
branch availability. The last command submits; run it only for an approved PR.

For a Jira issue alongside the PR, the jiracli repository's
`examples/pr-and-jira.lms` and `examples/run-proposals.ts` register its existing
preview/submit CLI as lmscript callbacks and retain SHA-bound Jira submission.
No cross-service transaction or automatic retry is promised.

`tests/proposal.mjs` runs the real host against a loopback-audited fake gh on
Linux, macOS and Windows. Its default CI lane compiles the string boundary with
pinned npm 0.2.458, because that compiler lacks Data; set PROPOSAL_DATA_BLOCKS=1
and LMSCRIPT_ROOT to a main-built mono root to run the unmodified Data example.
Both lanes test check/dry zero requests, all three refusals and exact real argv;
the Data lane is a separate qualification, never silently mocked or counted as
executed in the published-compiler lane.
