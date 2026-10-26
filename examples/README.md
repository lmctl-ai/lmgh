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

## Running

```sh
lmscript examples/open-prs.lms lmctl-ai lmgh   # compile to build/open-prs.dslb
lmgh --dsl build/open-prs.dslb                 # run
```

`./test.sh` compiles every example, runs it against the canned `gh` double in
[tests/fake-gh.py](../tests/fake-gh.py), and diffs stdout and report files
against [tests/expected/](../tests/expected/).
