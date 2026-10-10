# LMScript Recipes for lmgh (`gh2`)

Practical automation recipes in [LMScript](https://github.com/lmctl-ai/lmctl) using the `@lmctl-ai/lmgh` schema module import (defaulting to the `latest` channel defined by `cli.schema.latest.json`).

## Recipe Index

| File | What it does | Access | Arguments |
|---|---|---|---|
| `pr-triage.lms` | Fetches a structured triage digest for a GitHub pull request URL | Read-only | `<pr-url>` |
| `open-prs.lms` | Lists open pull requests with PR number, title, author, and branch | Read-only | `<owner> <repo>` |
| `issue-digest.lms` | Lists open issues with issue number, title, and author | Read-only | `<owner> <repo>` |
| `failing-workflows.lms` | Lists recent failing GitHub Actions workflow runs | Read-only | `<owner> <repo>` |
| `release-notes.lms` | Lists published releases and tags with release names and dates | Read-only | `<owner> <repo>` |
| `create-issue.lms` | Creates a new issue in a GitHub repository with title and body | Changes state | `<owner> <repo> <title> [body]` |
| `repo-overview.lms` | Fetches repository metadata (description, default branch, stars, forks) | Read-only | `<owner> <repo>` |

## Running Recipes

Run any recipe with `lmscript`:

```bash
lmscript examples/open-prs.lms lmctl-ai lmgh
```

To preview without side effects or spawning tool processes:

```bash
lmscript --dry-run examples/create-issue.lms lmctl-ai lmgh "Bug report" "Steps to reproduce..."
```
