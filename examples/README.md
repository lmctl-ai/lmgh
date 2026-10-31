# lmgh examples

LMScript recipes compiled against the lmgh schema and run by the `lmgh`
host. Each example defaults to `octo/demo` and can be pointed at any
repository with arguments; runs use the ambient `gh` authentication.

| File | What it does | gh access | Arguments |
|---|---|---|---|
| [repo-overview.lms](repo-overview.lms) | Repository metadata: branch, license, stars, topics, last push | read | `<owner> <repo>` |
| [open-prs.lms](open-prs.lms) | Lists open PRs with author and branch, drafts flagged | read | `<owner> <repo>` |
| [issue-digest.lms](issue-digest.lms) | Groups open issues by first label into a JSON report | read | `<owner> <repo>` |
| [pr-triage.lms](pr-triage.lms) | Checks/reviews/mergeability digest for one PR | read | `<owner> <repo> <number>` |
| [failing-workflows.lms](failing-workflows.lms) | Failing workflow runs; exits 4 (`APP_FAIL`) when any exist | read | `<owner> <repo>` |
| [release-notes.lms](release-notes.lms) | Recent releases with tag, name and date | read | `<owner> <repo>` |
| [search-repos.lms](search-repos.lms) | Repository search with stars and descriptions | read | `<query>` |
| [create-issue.lms](create-issue.lms) | Creates an issue; dry-run unless a 5th argument is given | write | `<owner> <repo> <title> [body] [--dry]` |
| [submit-pr.lms](submit-pr.lms) | Human-in-the-loop PR: writes a review TOML for the operator, submits only on approval | write | `<owner> <repo> <title> [head] [--dry]` |
| [ci-errors.lms](ci-errors.lms) | WHY recent runs failed: first recognized error per failed job, linked JSON findings | read | `<owner> <repo> [run-limit=5]` |
| [org-ci-health.lms](org-ci-health.lms) | Table of latest observed default-branch runs per workflow across repositories | read | `<owner> <repo[,repo...]>` |
| [stale-prs.lms](stale-prs.lms) | PRs inactive for N days, including draft/conflict findings | read | `<owner> <repo> [days=30]` |
| [unreviewed-prs.lms](unreviewed-prs.lms) | Open PRs with no approving reviews or approved decision | read | `<owner> <repo>` |
| [release-readiness.lms](release-readiness.lms) | Latest stable release and latest observed default-branch CI per workflow | read | `<owner> <repo>` |
| [issue-triage-unlabeled.lms](issue-triage-unlabeled.lms) | Open issues needing labels | read | `<owner> <repo>` |
| [repo-audit.lms](repo-audit.lms) | Missing license, description and topics across an owner's repositories | read | `<owner> [repo]` |


## Running

Nothing to install: on first compile, `lmscript` downloads the released lmgh
host for your platform (SHA-256 verified, cached under the lmscript tool
cache) because each recipe names it on the `_lmcode_` line:

```sh
mkdir -p build
lmscript examples/open-prs.lms build/open-prs.dslb lmctl-ai lmgh
lmgh --lmcode build/open-prs.dslb                 # run (gh auth as usual)
```

If `lmgh` is already on `PATH`, the download is skipped and that binary is
used. Runtime requirement: `gh` >= 2.45.0 with its own auth.

`./test.sh` compiles every example, runs it against the canned `gh` double in
[tests/fake-gh.py](../tests/fake-gh.py), and diffs stdout and report files
against [tests/expected/](../tests/expected/).

## Task recipes

The first command-line argument is always the output bytecode path; owner/repo
follow it. The default is `octo/demo`; `repo-audit` defaults to all repositories
returned by `user:octo` (or restrict it with a repository argument).

```sh
mkdir -p build
lmscript examples/ci-errors.lms build/ci-errors.dslb lmctl-ai lmgcp 5
lmgh --lmcode build/ci-errors.dslb
lmscript examples/org-ci-health.lms build/org-ci-health.dslb lmctl-ai lmgh,lmgcp
lmgh --lmcode build/org-ci-health.dslb
lmscript examples/stale-prs.lms build/stale-prs.dslb octo demo 30
lmgh --lmcode build/stale-prs.dslb
```

`ci-errors` requires **lmgh 0.2.3 or later (not released yet)** for `Run.id()` and
`Gh.run_failed_log()`. Until the owner releases it, build main and put `build/`
on PATH when compiling; the embedded schema must match the binary used to run.
The other six new recipes use existing 0.2.2 operations. A compatible lmscript
compiler must support implicit std and bytecode v6 (see `scripts/select-compiler.sh`).

Each recipe writes `build/NAME.txt` or `.json` before `report.fail_if_any()`:
exit 0 means no findings, exit 4 means findings, and exit 3 means an incomplete
scan due to a host/API/log error. `ci-errors` includes historical failed runs
within its requested window; a newer green run does not erase earlier failures.
Log matching is heuristic, so jobs without recognized errors link back to their
full logs. Empty/deleted/inaccessible logs fail honestly; logs over 1 MiB and
commands over 30 seconds are refused. Error lines and reports may contain
repository data, so inspect before sharing.

Search/list scans are bounded (100 PRs/issues/repos/runs; 30 releases); results
are the latest **observed** runs, not a guarantee that all required workflows ran
on the latest commit. `release-readiness` is a review aid, not permission to
release. `stale-prs` uses an inactivity cutoff calculated at compile time; recompile
each tick. Org CI accepts a comma-separated repository list, not an unbounded org scan.

`./test.sh` covers every recipe with 14 offline scenarios, pinned stdout AND
report bytes, including a clean release, missing CI, missing logs, multiple
repositories, stale/conflicting drafts, and metadata gaps. Goldens are never
regenerated by the test run.
