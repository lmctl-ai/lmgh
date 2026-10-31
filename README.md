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

## Use it — no installation

Users do **not** install lmgh and do **not** need Go. A `_lmcode_` block that
names lmgh makes `lmscript` download the released host binary for your
platform (SHA-256 verified, cached), compile against its embedded schema, and
run it:

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
lmscript open-prs.lms <owner> <repo>   # compiles AND fetches the lmgh host on first use
lmgh --lmcode build/open-prs.dslb         # or run it straight from the lmscript tool cache
```

The only runtime requirement is the `gh` binary itself (version >= 2.45.0,
< 3.0.0) with `gh`'s own authentication (`gh auth login` or `GH_TOKEN`). Set
`LMGH_GH` to point at a `gh` that is not on `PATH`.

The schema ([`schema/lmgh.dsl.json`](schema/lmgh.dsl.json)) is the contract:
`lmgh --lmcode-schema` prints the exact embedded bytes and
`lmgh --lmcode-signatures` the host registry. Contexts: `gh: Gh` (the operation
catalog) and `report: Report` (findings log with `write_text`, `write_json`
and `fail_if_any`, which fails with exit 4 / `APP_FAIL` when non-empty).

## Operation catalog (v0)

Reads: `repo_view`, `issue_list`, `issue_view`, `pr_list`, `pr_view`,
`pr_triage`, `release_list`, `run_list`, `search_repos`, `search_issues`,
`search_prs`, `file_text`.
Writes: `issue_create`, `pr_merge` — both honor `gh.dry_run(bool)`, which
records intent in the report instead of calling `gh`.

Human-in-the-loop PRs: `pr_prepare(owner, repo, title, body, base, head, draft)`
writes `pr-review-<owner>-<repo>.toml` — a plain TOML file (via
[pelletier/go-toml](https://github.com/pelletier/go-toml)) for the operator to
review and edit; it refuses to overwrite an existing file. Once approved,
`pr_submit(owner, repo, path)` decodes that exact file (unknown fields, an
empty title, or a repository mismatch are refused) and runs `gh pr create`
from it. Nothing reaches GitHub between prepare and submit; `pr_submit` also
honors `gh.dry_run(bool)`. See [`examples/submit-pr.lms`](examples/submit-pr.lms).

## Develop

```sh
go build -o build/lmgh .   # from a source checkout; needs Go 1.26
scripts/sync-cli.sh        # fetch the pinned cli/cli checkout (third_party/)
./test.sh                  # 44 checks: build, parity, examples vs a fake gh, refusals
```

Releases: pushing a `v*` tag publishes automatically — CI runs `./test.sh`
and, once tests pass, cross-builds the six `lmgh-{linux,macos,windows}-{x64,arm64}`
assets plus `SHA256SUMS` and creates the GitHub release (the asset names are
the lmscript `install=` convention). `scripts/release.sh <version>` remains as
the local fallback. [durable-memory/](durable-memory/) records the design and
decisions.
