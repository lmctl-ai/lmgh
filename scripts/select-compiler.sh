#!/usr/bin/env bash
# Select a compiler by what it can do, not by its version: it must compile a
# program against a host-only schema (implicit std catalog) with an _lmcode_ block (checked, never executed).
set -euo pipefail
WORK="$(mktemp -d "${TMPDIR:-/tmp}/lmgh-compiler-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
# A native (mingw) python cannot see MSYS /tmp paths: hand it drive-letter paths when cygpath exists.
native() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s\n' "$1"; fi; }
candidate="${LMSCRIPT_BIN:-$(command -v lmscript || true)}"
printf '%s\n' '{"dsl.schema":2,"name":"compiler_probe","types":{},"functions":{},"context":{}}' > "$WORK/probe.schema.json"
# JSON string quoting also supports checkouts whose paths contain spaces/quotes.
python3 - "$(native "$WORK/probe.schema.json")" "$(native "$WORK")" <<'PY'
import json,pathlib,sys
work=pathlib.Path(sys.argv[2])
(work/'probe.lms').write_text('p = _lmcode_ schema='+json.dumps(sys.argv[1])+';\nlet n = str_len("implicit std");\nend _lmcode_\n')
PY
if [ -n "$candidate" ] &&
   "$candidate" --lmcode-signatures "$WORK/probe.schema.json" > /dev/null 2>&1 &&
   "$candidate" --check "$WORK/probe.lms" > /dev/null 2>&1
then
  printf '%s\n' "$candidate"
else
  if [ -n "${LMGH_DEBUG:-}" ]; then
    echo "--- compiler probe diagnostics (candidate=$candidate)" >&2
    [ -n "$candidate" ] && "$candidate" --lmcode-signatures "$WORK/probe.schema.json" 2>&1 | head -3 >&2
    [ -n "$candidate" ] && "$candidate" --check "$WORK/probe.lms" 2>&1 | head -10 >&2
  fi
  echo "error: no working lmscript compiler found; install @lmctl-ai/lmctl@staging so lmscript is on PATH, or set LMSCRIPT_BIN" >&2
  exit 2
fi
