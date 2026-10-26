# Third-party notices

lmgh is MIT-licensed original work of Lattice Systems LLC (see `LICENSE`),
built on the material described below.

## cli/cli (GitHub CLI)

Source: https://github.com/cli/cli (vendored under `third_party/cli`, pinned
by `cli.lock`)

lmgh is a fork of cli/cli: the GitHub CLI is the product lmgh drives over
argv, and the vendored checkout is the upstream reference for its `--json`
field names and release behavior. cli/cli is MIT licensed:

```
MIT License

Copyright (c) 2019 GitHub Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## gh_mcp_server (Ken Kousen)

Source: https://github.com/kousen/gh_mcp_server

The operation catalog (which `gh` commands back each lmgh operation and which
`--json` field lists to request) was migrated from the earlier `gh2`
iteration of this repository, which derived it from the Java
`GithubService` class. The code was rewritten as a Go lmcode host; field
names were adapted to the `gh` JSON fields of cli/cli v2.103.3, verified
against the vendored source. gh_mcp_server is MIT licensed:

```
MIT License

Copyright (c) 2025 Ken Kousen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```

## lmcode-go

Source: https://github.com/lmctl-ai/lmcode-go (Go SDK, pinned in `go.mod`/`go.sum`)

MIT licensed; see the lmcode-go repository.
