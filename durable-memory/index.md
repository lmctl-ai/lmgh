# lmgh — durable memory

Portable knowledge for this repository. Read this index first, then only the
chapters relevant to the task.

## What lmgh is

A Go [lmcode](../go.mod) host that turns the GitHub CLI (`gh`) into a
scriptable, schema-checked API for LMScript: `.lms` source compiles against
`schema/lmgh.dsl.json` into DSL bytecode; the `lmgh` binary executes it by
driving `gh` over argv (prompts disabled) and returns typed domain objects.
The repository is the lmctl-ai fork of `cli/cli` — upstream is vendored in
`third_party/cli` and pinned by `cli.lock`. This session (2026-10-26)
replaced the earlier Bun/TypeScript `gh2` lmapi-server iteration (history
preserved in git; catalog knowledge migrated into the Go host).

## 60-second takeover

```sh
scripts/sync-cli.sh   # fetch the pinned cli/cli checkout
go build -o build/lmgh .
./test.sh             # 44 checks: build, parity, examples vs fake gh, refusals
```

## Document map

| File | Contents |
|---|---|
| [01-purpose-and-place.md](01-purpose-and-place.md) | purpose, stack position, scope boundaries |
| [02-schema-v0.md](02-schema-v0.md) | the v0 API catalog, gh `--json` field verification, design decisions |
| [03-build-run-test.md](03-build-run-test.md) | build/test flow, CLI protocol, exit codes |
| [04-open-items.md](04-open-items.md) | known gaps and candidate v1 work |
