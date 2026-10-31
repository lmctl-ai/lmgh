# Open items

Candidate work after v0, in no fixed order.

## API surface

- `api_json(path)` escape hatch: blocked because the compiler rejects std
  `Json` as a host-declared return type. Options: compiler support, or a
  host `ApiResult` type with `get`/`at` navigation.
- More write ops with dry-run support: `issue_close`, `label_add`,
  `release_create`, and inline/line-level PR review comments (summary-level PR
  reviews — `APPROVE`, `REQUEST_CHANGES`, `COMMENT` — are now covered by the
  human-in-the-loop `pr_review_prepare`/`pr_review_submit` flow). gh2's
  catalog (git history) is the reference list.
- Harden `pr_prepare`/`readReview` (`writeReview` / `readReview` in
  `pr_review.go`) to match `writeReviewVerdict`/`readReviewVerdict`: `readReview`
  still relies solely on `go-toml/v2` struct decoding with
  `DisallowUnknownFields()`, which matches struct fields case-insensitively and
  allows a later case-variant key (e.g. `Title` after `title`) to overwrite an
  earlier value, and `writeReview` still uses `os.Stat` + `os.WriteFile` instead
  of `os.OpenFile(..., O_WRONLY|O_CREATE|O_EXCL, 0o644)`. Both are pre-existing
  from v0.2.0 and intentionally left untouched in the `pr_review_prepare` /
  `pr_review_submit` change to keep PR scope tight.
- `pr_triage` additions when gh exposes them: unresolved review threads
  (needs `reviewThreads`, absent from gh v2.103.3).
- Pagination beyond `--limit` (cursors via `gh api`).

## Platform

- Release v0.2.0 (2026-10-27) adds the human-in-the-loop PR flow
  (`pr_prepare` review TOML + `pr_submit`) on top of v0.1.0's six
  `lmgh-OS-ARCH` assets + SHA256SUMS, so
  `install="github:lmctl-ai/lmgh@latest"` resolves for users without Go or a
  PATH binary; see 03 for the verified flow. From v0.2.1 on, releases publish
  from CI: pushing a `v*` tag runs `./test.sh` and the release job builds and
  attaches the assets (local `scripts/release.sh` is the fallback). Since
  v0.2.2 a `verify` job also downloads each asset on its native GitHub runner
  (x64/arm64 Linux, Intel/ARM macOS, Windows; windows-arm64 gets a
  download-back checksum in the release job) and executes `--version`
  against the tag.
- CI workflow (`.github/workflows/ci.yml`) was rewritten for Go + test.sh.
- `gh issue list` does not populate `Issue.comments()` (gh exports a node
  list, not a count); acceptable until someone needs per-list counts.

## Upstream

- `cli.lock` pins v2.103.3. On upgrade, re-verify every `--json` field list
  in `ops.go` against the new vendored source (see 02-schema-v0.md for the
  fields that already bit once).
