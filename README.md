# lmgh — GitHub (`gh`) as an lmcode tool

lmgh is a native host for [lmcode](https://github.com/lmctl-ai/lmcode-go)
bytecode that turns the GitHub CLI (`gh`) into a scriptable, type-checked API:
LMScript source is compiled against the lmgh schema into DSL bytecode, and the
`lmgh` host executes it through `gh` (argv only, prompts disabled), producing
typed `Repo`, `Issue`, `Pr`, `Triage`, `Release` and `Run` objects plus a
`Report` for findings.

This repository is the lmctl-ai fork of [`cli/cli`](https://github.com/cli/cli):
upstream is vendored under `third_party/cli` and pinned by
[`cli.lock`](cli.lock); the lmgh-authored host, schema and examples are MIT
licensed like upstream (see [LICENSE](LICENSE) and
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)).

## Install

```sh
go install github.com/lmctl-ai/lmgh@latest   # or: go build -o build/lmgh .
```

`lmgh` needs the `gh` binary on `PATH` (version >= 2.45.0, < 3.0.0). Auth is
`gh`'s own (`gh auth login` or `GH_TOKEN`); set `LMGH_GH` to use a `gh` that is
not on `PATH`.

## Use from lmscript

```lms
out = ARGV.len() > 0 ? ARGV[0] : "build/open-prs.dslb";
p = _lmcode_ cli="lmgh" install="github:lmctl-ai/lmgh@latest";
let prs = gh.pr_list("lmctl-ai", "lmgh", "open", 30);
for (i in range(0, prs.len())) {
  let pr = prs.at(i);
  print("#" + str(pr.number()) + ": " + pr.title() + " (by @" + pr.author() + ")");
}
end _lmcode_
savedsl(p, out);
```

```sh
lmscript examples/open-prs.lms <owner> <repo>   # compile to .dslb
lmgh --dsl build/open-prs.dslb                  # run (set GH_TOKEN as usual)
```

The schema ([`schema/lmgh.dsl.json`](schema/lmgh.dsl.json)) is the contract:
`lmgh --dsl-schema` prints the exact embedded bytes and
`lmgh --dsl-signatures` the host registry. Contexts: `gh: Gh` (the operation
catalog) and `report: Report` (findings log with `write_text`, `write_json`
and `fail_if_any`, which fails with exit 4 / `APP_FAIL` when non-empty).

## Operation catalog (v0)

Reads: `repo_view`, `issue_list`, `issue_view`, `pr_list`, `pr_view`,
`pr_triage`, `release_list`, `run_list`, `search_repos`, `search_issues`,
`search_prs`, `file_text`.
Writes: `issue_create`, `pr_merge` — both honor `gh.dry_run(bool)`, which
records intent in the report instead of calling `gh`.

## Develop

```sh
scripts/sync-cli.sh        # fetch the pinned cli/cli checkout (third_party/)
./test.sh                  # 30 checks: build, parity, examples vs a fake gh, refusals
```

[durable-memory/](durable-memory/) records the design and decisions.
