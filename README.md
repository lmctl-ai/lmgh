# lmgh — `gh2`, a structured GitHub CLI

`gh2` runs `gh` (argv only, prompts disabled) and returns JSON for repositories, issues, pull requests, releases, workflow runs, search and files, plus `pr_triage`, a one-call summary of a pull request's checks, reviews and threads. Authentication is `gh`'s own (`gh auth login` or `GH_TOKEN`).

`gh2` is an [lmapi](https://github.com/lmctl-ai/lmapi) server: `gh2 --schema` prints its
`cli.schema.v1` document, which is the contract. A client (an LLM tool, a script,
an SDK) validates against it before calling, and `gh2` validates again and
enforces its policy. Built on [@lmctl-ai/lmts](https://github.com/lmctl-ai/lmts).

## Install

`gh2` runs on [Bun](https://bun.sh) and needs the GitHub `gh` CLI on `PATH`.

```sh
git clone https://github.com/lmctl-ai/lmgh.git
cd lmgh
bun install
bun link            # puts `gh2` on PATH
```

## Usage

```sh
gh2 --list                 # operations with access (read/write) and descriptions
gh2 --schema               # the cli.schema.v1 document
gh2 --explain <op>         # one operation's schema (--format text for help text)
gh2 <op> [--param value ...] [--dryrun] [--readonly] [--confirm]
```

```sh
gh2 list_issues --owner octo --repo hello --state open
gh2 pr_triage --url https://github.com/octo/hello/pull/42
gh2 create_issue --owner octo --repo hello --title "Bug" --body "..." --dryrun
```

Input can be flags, a JSON document (`--input-json '{"op":...,"params":{...}}'`
or `--input-file`) or a GraphQL document (`--input-graphql`). Output is JSON on
stdout; errors are `{"success":false,"error":{"code","message","data"}}` with a
non-zero exit code.

## Use from lmscript

> [!NOTE]
> Available in lmscript >= the release that includes schema module import.

lmscript can import this tool's schema directly:

```ts
import "@lmctl-ai/lmgh";

const triage = await gh2.pr_triage({ url: "https://github.com/octo/hello/pull/42" });
```

Or with an alias:

```ts
import "@lmctl-ai/lmgh" as mygh;

const issues = await mygh.list_issues({ owner: "octo", repo: "hello", state: "open" });
```

Or targeting the development channel:

```ts
import "@lmctl-ai/lmgh#dev";
```

### Channel files and release workflow

The repository publishes two schema contracts at the root of its default branch:
- `cli.schema.latest.json` — the contract of the latest stable release (default for `import "@lmctl-ai/lmgh"`).
- `cli.schema.dev.json` — the active development contract (used by `import "@lmctl-ai/lmgh#dev"`).

When releasing a new tool version, copy `cli.schema.dev.json` to `cli.schema.latest.json` in the release commit. Automated tests verify that `cli.schema.dev.json` is byte-for-byte identical to `bun src/cli.ts --schema`, and that all differences between `latest` and `dev` are strictly additive.

### Product compatibility

`gh2` declares and enforces product version requirements for the underlying `gh` binary:
- Product name: `gh`
- Supported versions: `>=2.45.0 <3.0.0`
- Detection: `gh --version` (pattern `gh version (\d+\.\d+\.\d+)`)

If the installed `gh` binary is missing or outside this range, operations are refused with error code `UNSUPPORTED_PRODUCT_VERSION` (exit code 10). Introspection flags (`--schema`, `--list`, `--help`) succeed regardless of the product check. The `gh2` binary must be installed and available on `PATH` at runtime; installing the CLI tool is separate.

## Safety flags

Every write goes through the same policy before any command is built:

- `--dryrun` — report what would run, change nothing (reads still execute).
- `--readonly` — refuse every write operation.
- `--confirm` — required for operations marked dangerous.
- Environment floors `GH2_READONLY=1` / `GH2_DRYRUN=1` turn the same modes on for every call;
  flags cannot loosen them.

Operations whose schema does not declare `access: "read"` are treated as effectful.

## Development

Requires [Bun](https://bun.sh) (version in `.bun-version`).

```sh
bun install --frozen-lockfile
bunx tsc --noEmit
bun test --coverage   # fails below the thresholds in bunfig.toml
```

The tests are hermetic: no network, no credentials, and they never touch your
`HOME` or working directory; a fake `gh` executable on `PATH` stands in for GitHub.

## Provenance

- The command catalog (which `gh` command and `--json` fields back each
  operation) was migrated from [kousen/gh_mcp_server](https://github.com/kousen/gh_mcp_server)
  (MIT, Copyright (c) 2025 Ken Kousen).
- The operation checklist follows [github/github-mcp-server](https://github.com/github/github-mcp-server)
  (MIT, Copyright (c) 2025 GitHub).
- `pr_triage` originated in [lmctl-ai/lmprobe](https://github.com/lmctl-ai/lmprobe) (MIT, Lattice Systems LLC).
- The CLI runtime is [@lmctl-ai/lmts](https://github.com/lmctl-ai/lmts).

## License

MIT, see [LICENSE](LICENSE). Third-party material is listed with its license
notices in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
