#!/usr/bin/env bash
# lmgh end-to-end checks: build, schema parity, examples against a fake gh,
# and refusal tests. Mirrors lmhtml's test.sh structure.
set -u
cd "$(dirname "$0")"
mkdir -p build

PASS=0
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }
fail() { echo "FAIL: $1" >&2; exit 1; }

# --- compiler ----------------------------------------------------------
LMSCRIPT="${LMSCRIPT_BIN:-$(command -v lmscript || true)}"
[ -n "$LMSCRIPT" ] || fail "lmscript not found; npm install -g @lmctl-ai/lmctl"
LMSCRIPT="$(scripts/select-compiler.sh)" || fail "compiler capability probe"
ok "compiler emitted v6 with implicit std"

# --- upstream cli/cli pin ----------------------------------------------
scripts/sync-cli.sh --verify 2>/dev/null || scripts/sync-cli.sh || fail "cannot sync third_party/cli"
ok "third_party/cli pinned by cli.lock"

# --- build --------------------------------------------------------------
CGO_ENABLED=0 go build -trimpath -ldflags='-buildid=' -o build/lmgh . || fail "go build"
HOST=build/lmgh
ok "go build (CGO disabled)"
python3 tests/check-host-flags.py schema/lmgh.dsl.json "$HOST" || fail "hard flag cutover"

# fake gh on PATH for every run below
mkdir -p build/fake-bin
cat > build/fake-bin/gh <<EOF
#!/bin/bash
exec python3 "$PWD/tests/fake-gh.py" "\$@"
EOF
chmod +x build/fake-bin/gh
export PATH="$PWD/build/fake-bin:$PWD/build:$PATH"

# --- CLI protocol -------------------------------------------------------
[ "$("$HOST" --version)" = "lmgh 0.2.2" ] || fail "--version"
ok "--version"
cmp -s <("$HOST" --lmcode-schema) schema/lmgh.dsl.json || fail "--lmcode-schema bytes differ from schema/lmgh.dsl.json"
ok "--lmcode-schema equals schema/lmgh.dsl.json"
set +e; out=$("$HOST" 2>&1); code=$?; set -e
[ "$code" = 2 ] && [[ "$out" == *'CLI_USAGE'* ]] || fail "bad args refusal (exit $code)"
set +e
out=$("$HOST" --schema 2>&1); code=$?
set -e
[ "$code" = 2 ] || fail "former --schema flag accepted"
ok "usage errors exit 2 with CLI_USAGE JSON"

# --- schema parity ------------------------------------------------------
"$HOST" --lmcode-signatures > build/host-signatures.txt
"$LMSCRIPT" --lmcode-signatures schema/lmgh.dsl.json > build/compiler-signatures.txt
missing=$(python3 - <<'PY'
host = set(open("build/host-signatures.txt").read().splitlines())
print("\n".join(s for s in open("build/compiler-signatures.txt").read().splitlines() if s not in host))
PY
)
[ -z "$missing" ] || fail "compiler signatures missing from host registry: $missing"
ok "every compiler-visible signature binds in the host registry"
python3 - <<'PY' || fail "host schema drifts from the registry"
import json, subprocess
schema = json.load(open("schema/lmgh.host.json"))
sigs = set(subprocess.run(["build/lmgh", "--lmcode-signatures"], capture_output=True, text=True).stdout.splitlines())
want = [f"context {n}: {t}" for n, t in schema["context"].items()]
for fn, overloads in schema.get("functions", {}).items():
    for o in overloads:
        want.append(f"fn {fn}({', '.join(o['params'])}) -> {o['returns']}")
for t, decl in schema["types"].items():
    for m, overloads in decl.get("methods", {}).items():
        for o in overloads:
            ret = t if o["returns"] == "self" else o["returns"]
            want.append(f"method {t}.{m}({', '.join(o['params'])}) -> {ret}")
missing = [s for s in want if s not in sigs]
if missing:
    print("\n".join(missing)); raise SystemExit(1)
PY
ok "every host schema signature is registered"

# --- examples -----------------------------------------------------------
rm -f pr-review-*.toml  # pr_prepare refuses to clobber; examples must start clean
run_example() { # name [expected-exit]
  local name="$1" want="${2:-0}"
  "$LMSCRIPT" "examples/$name.lms" "build/$name.dslb" >/dev/null || fail "$name compile"
  od -An -t u1 -j 5 -N 1 "build/$name.dslb" | grep -q 6 || fail "$name is not bytecode v6"
  set +e
  "$HOST" --lmcode "build/$name.dslb" > "build/$name.out" 2>&1
  local code=$?
  set -e
  [ "$code" = "$want" ] || fail "$name exit $code (want $want): $(cat build/$name.out)"
  cmp -s "build/$name.out" "tests/expected/$name.out" || fail "$name stdout drift: $(diff tests/expected/$name.out build/$name.out | head -5)"
  ok "$name (exit $want)"
}

run_example repo-overview
run_example open-prs
run_example issue-digest
run_example pr-triage
run_example failing-workflows 4
run_example release-notes
run_example search-repos
run_example create-issue
run_example submit-pr
rm -f pr-review-*.toml  # submit-pr leaves its review file behind
cmp -s build/repo-overview.txt tests/expected/repo-overview.txt || fail "repo-overview.txt drift"
cmp -s build/open-prs.txt tests/expected/open-prs.txt || fail "open-prs.txt drift"
cmp -s build/pr-triage.txt tests/expected/pr-triage.txt || fail "pr-triage.txt drift"
cmp -s build/release-notes.txt tests/expected/release-notes.txt || fail "release-notes.txt drift"
cmp -s build/create-issue.txt tests/expected/create-issue.txt || fail "create-issue.txt drift"
cmp -s build/issue-digest.json tests/expected/issue-digest.json || fail "issue-digest.json drift"
cmp -s build/search-repos.json tests/expected/search-repos.json || fail "search-repos.json drift"
ok "example report files match"

# --- behavioral chunks ---------------------------------------------------
WORK=build/test-chunks
rm -rf "$WORK"; mkdir -p "$WORK"
compile_chunk() { # name body
  cat > "$WORK/$1.lms" <<EOF2
p = _lmcode_ cli="lmgh" install="github:lmctl-ai/lmgh@latest";
$2
end _lmcode_
savedsl(p, "$WORK/$1.dslb");
EOF2
  "$LMSCRIPT" "$WORK/$1.lms" >/dev/null || fail "$1 compile"
}

expect_run() { # name want-exit needle
  set +e
  out=$("$HOST" --lmcode "$WORK/$1.dslb" 2>&1); code=$?
  set -e
  [ "$code" = "$2" ] || fail "$1 exit $code (want $2): $out"
  [[ "$out" == *"$3"* ]] || fail "$1 output lacks '$3': $out"
  ok "$1"
}

expect_refusal() { # name body needle
  compile_chunk "$1" "$2"
  expect_run "$1" 3 "$3"
}

expect_refusal bad-state 'gh.issue_list("octo", "demo", "widely-open", 10);' 'invalid state'
expect_refusal bad-limit 'gh.issue_list("octo", "demo", "open", 10000);' 'invalid limit'
expect_refusal bad-merge-kind 'gh.pr_merge("octo", "demo", 21, "nuke");' 'invalid merge method'
expect_refusal list-oob 'let l = gh.issue_list("octo", "demo", "open", 10); l.at(99);' 'out of range'
expect_refusal bad-repo 'gh.issue_list("octo", "missing", "open", 10);' 'failed'

# gh binary missing: LMGH_GH points nowhere (robust even when gh is installed)
compile_chunk needs-gh 'gh.issue_list("octo", "demo", "open", 10);'
set +e
out=$(LMGH_GH="$WORK/no-such-gh" "$HOST" --lmcode "$WORK/needs-gh.dslb" 2>&1); code=$?
set -e
[ "$code" = 3 ] && [[ "$out" == *'missing gh executable'* ]] || fail "missing gh refusal (exit $code): $out"
ok "missing gh binary refused"

# write ops
compile_chunk issue-create-live 'let i = gh.issue_create("octo", "demo", "Live title", "body"); print("#" + str(i.number()) + " " + i.state());'
expect_run issue-create-live 0 '#42 OPEN'

compile_chunk issue-create-dry 'gh.dry_run(true); let i = gh.issue_create("octo", "demo", "Dry title", ""); print(i.state()); report.write_text("build/test-chunks/dry-report.txt");'
expect_run issue-create-dry 0 'dry-run'
grep -q 'dry-run: issue_create: octo/demo: Dry title' "$WORK/dry-report.txt" || fail "dry-run report entry"
ok "dry-run write recorded in report"

compile_chunk merge-dry 'gh.dry_run(true); print(gh.pr_merge("octo", "demo", 21, "squash"));'
expect_run merge-dry 0 'dry-run: gh pr merge 21 -R octo/demo --squash'

# human-in-the-loop PR flow: pr_prepare writes the review TOML, the operator
# edits it, pr_submit pushes only that reviewed file's contents.
compile_chunk pr-prepare 'print(gh.pr_prepare("octo", "demo", "Add feature", "Line one\nLine two", "main", "feature-x", true));'
expect_run pr-prepare 0 'pr-review-octo-demo.toml'
grep -q "^owner = 'octo'$" pr-review-octo-demo.toml || fail "review file owner"
grep -q "^title = 'Add feature'$" pr-review-octo-demo.toml || fail "review file title"
grep -q '^draft = true$' pr-review-octo-demo.toml || fail "review file draft"
grep -q 'Line one\\nLine two' pr-review-octo-demo.toml || fail "review file body"
ok "pr_prepare writes operator-reviewable TOML"

compile_chunk pr-prepare-twice 'gh.pr_prepare("octo", "demo", "T", "b", "main", "h", false); gh.pr_prepare("octo", "demo", "T", "b", "main", "h", false);'
expect_run pr-prepare-twice 3 'already exists'
rm -f pr-review-octo-demo.toml

expect_refusal pr-prepare-bad-ident 'gh.pr_prepare("octo/demo", "demo", "T", "b", "main", "h", false);' 'invalid owner'

compile_chunk pr-submit-live 'let path = gh.pr_prepare("octo", "demo", "Reviewed title", "Body text", "main", "feature-x", false); let pr = gh.pr_submit("octo", "demo", path); print("#" + str(pr.number()) + " " + pr.state() + " " + pr.url());'
expect_run pr-submit-live 0 '#43 OPEN https://github.com/octo/demo/pull/43'
rm -f pr-review-octo-demo.toml

# operator edits the TOML between prepare and submit; the edit must reach gh
compile_chunk pr-edit-prepare 'gh.pr_prepare("octo", "demo", "Original title", "b", "main", "feature-x", false);'
expect_run pr-edit-prepare 0 '"ok": true'
sed -i 's/Original title/Operator edited title/' pr-review-octo-demo.toml
compile_chunk pr-edit-submit 'let pr = gh.pr_submit("octo", "demo", "pr-review-octo-demo.toml"); print("#" + str(pr.number()));'
set +e
out=$(FAKE_GH_LOG="$WORK/gh-write.log" "$HOST" --lmcode "$WORK/pr-edit-submit.dslb" 2>&1); code=$?
set -e
[ "$code" = 0 ] && [[ "$out" == *"#43"* ]] || fail "edited submit (exit $code): $out"
grep -q 'Operator edited title' "$WORK/gh-write.log" || fail "edited title never reached gh: $(cat "$WORK/gh-write.log")"
ok "operator edit flows through to gh pr create"

expect_refusal pr-submit-mismatch 'gh.pr_submit("octo", "other", "pr-review-octo-demo.toml");' 'review file is for'
rm -f pr-review-octo-demo.toml

printf 'title = "unclosed\n' > pr-review-octo-demo.toml
expect_refusal pr-submit-bad-toml 'gh.pr_submit("octo", "demo", "pr-review-octo-demo.toml");' 'invalid TOML'
printf 'owner = "octo"\nrepo = "demo"\ntitle = ""\nbase = "main"\nhead = "h"\n' > pr-review-octo-demo.toml
expect_refusal pr-submit-empty-title 'gh.pr_submit("octo", "demo", "pr-review-octo-demo.toml");' 'empty title'
expect_refusal pr-submit-missing 'gh.pr_submit("octo", "demo", "no-such-review.toml");' 'cannot read review file'
rm -f pr-review-octo-demo.toml

compile_chunk pr-submit-dry 'gh.dry_run(true); let path = gh.pr_prepare("octo", "demo", "Gate check", "b", "main", "feature-x", false); let pr = gh.pr_submit("octo", "demo", path); print(pr.state()); report.write_text("build/test-chunks/pr-dry-report.txt");'
expect_run pr-submit-dry 0 'dry-run'
grep -q 'dry-run: pr_submit: octo/demo: Gate check (feature-x -> main)' "$WORK/pr-dry-report.txt" || fail "dry-run pr_submit report entry"
rm -f pr-review-octo-demo.toml
ok "pr_submit honors dry_run"

compile_chunk app-fail 'report.add("test", "subject", "intentional"); report.fail_if_any();'
expect_run app-fail 4 'APP_FAIL'

# load failures
printf 'not bytecode' > "$WORK/junk.dslb"
set +e
out=$("$HOST" --lmcode "$WORK/junk.dslb" 2>&1); code=$?
set -e
[ "$code" = 3 ] && [[ "$out" == *'LOAD_BAD_BYTECODE'* ]] || fail "junk bytecode (exit $code): $out"
ok "bad bytecode refused at load"

set +e
out=$("$HOST" --lmcode "$WORK/absent.dslb" 2>&1); code=$?
set -e
[ "$code" = 4 ] && [[ "$out" == *'APP_FAIL'* ]] || fail "missing bytecode file (exit $code): $out"
ok "missing bytecode file exits 4"

echo "PASS: $PASS checks"
