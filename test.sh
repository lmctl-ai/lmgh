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
[ -n "$LMSCRIPT" ] || fail "lmscript not found; set LMSCRIPT_BIN to a private compiler installation"
LMSCRIPT="$(scripts/select-compiler.sh)" || fail "compiler capability probe"
ok "compiler compiles against a host-only schema"

# --- upstream cli/cli pin ----------------------------------------------
scripts/sync-cli.sh --verify 2>/dev/null || scripts/sync-cli.sh || fail "cannot sync third_party/cli"
ok "third_party/cli pinned by cli.lock"

# --- build --------------------------------------------------------------
CGO_ENABLED=0 go build -trimpath -ldflags='-buildid=' -o build/lmgh . || fail "go build"
HOST=build/lmgh
ok "go build (CGO disabled)"
go test ./... || fail "Go host operation tests"
ok "Go host operation tests"
COMPILER_ROOT="${LMSCRIPT_ROOT:-}"
if [ -z "$COMPILER_ROOT" ]; then
  COMPILER_ROOT="$(node -e 'const f=require("node:fs"),p=require("node:path");console.log(p.dirname(p.dirname(f.realpathSync(process.argv[1]))))' "$LMSCRIPT")"
fi
LMSCRIPT_ROOT="$COMPILER_ROOT" node tests/proposal.mjs "$HOST" || fail "inline TOML proposal preview and loopback submit"
ok "inline TOML proposal preview and loopback submit"
python3 tests/check-sdk-pin.py || fail "reviewed SDK pin"
LMSCRIPT_BIN="$LMSCRIPT" python3 tests/check-protocol.py "$HOST" || fail "invocation protocol"
ok "invocation protocol"
LMSCRIPT_BIN="$LMSCRIPT" python3 tests/check-operation-parity.py "$HOST" || fail "operation parity"
ok "five operation results match pre-adoption host"
cmp -s schema/lmgh.host.json schema/lmgh.dsl.json || fail "host/embedded schema drift"
ok "host and embedded schema bytes agree"
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
[ "$("$HOST" --version)" = "lmgh 0.3.2" ] || fail "--version"
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
  set +e
  "$LMSCRIPT" "examples/$name.lms" > "build/$name.out" 2>&1
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
run_example review-pr
rm -f pr-review-*.toml  # submit-pr / review-pr leave their review files behind
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
compile_chunk() { # name body  (a chunk is a complete script run by lmscript)
  cat > "$WORK/$1.lms" <<EOF2
p = _lmcode_ cli="lmgh";
$2
end _lmcode_
r = run_lmcode(p);
if (!r.ok) {
  print("lmgh " + r.phase + " " + r.code + ": " + r.message);
  exit(r.code == "APP_FAIL" ? 4 : 3);
}
EOF2
}

expect_run() { # name want-exit needle
  set +e
  out=$("$LMSCRIPT" "$WORK/$1.lms" 2>&1); code=$?
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
out=$(LMGH_GH="$WORK/no-such-gh" "$LMSCRIPT" "$WORK/needs-gh.lms" 2>&1); code=$?
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

# issue_close / pr_comment / label_add / release_create
compile_chunk writes-live 'print(gh.issue_close("octo", "demo", 3, "not planned")); print(gh.pr_comment("octo", "demo", 21, "Looks good")); print(gh.label_add("octo", "demo", 21, "bug")); print(gh.release_create("octo", "demo", "v9.9.9", "Nine", "notes", false, true));'
set +e
out=$(FAKE_GH_LOG="$WORK/writes.log" "$LMSCRIPT" "$WORK/writes-live.lms" 2>&1); code=$?
set -e
[ "$code" = 0 ] || fail "writes-live (exit $code): $out"
for needle in '"issue", "close", "3", "-R", "octo/demo", "--reason", "not planned"' \
  '"pr", "comment", "21", "-R", "octo/demo", "--body", "Looks good"' \
  '"api", "--method", "POST", "repos/octo/demo/issues/21/labels", "-f", "labels[]=bug"' \
  '"release", "create", "v9.9.9", "-R", "octo/demo", "--title", "Nine", "--notes", "notes", "--prerelease"'; do
  grep -qF "$needle" "$WORK/writes.log" || fail "write argv missing $needle: $(cat "$WORK/writes.log")"
done
ok "issue_close, pr_comment, label_add and release_create reach gh with exact argv"

compile_chunk writes-dry 'gh.dry_run(true); print(gh.issue_close("octo", "demo", 3, "")); print(gh.pr_comment("octo", "demo", 21, "hi")); print(gh.label_add("octo", "demo", 21, "bug")); print(gh.release_create("octo", "demo", "v1", "T", "N", false, false)); report.write_text("build/test-chunks/writes-dry-report.txt");'
set +e
out=$(FAKE_GH_LOG="$WORK/writes-dry.log" "$LMSCRIPT" "$WORK/writes-dry.lms" 2>&1); code=$?
set -e
[ "$code" = 0 ] && [[ "$out" == *'dry-run: gh issue close 3 -R octo/demo'* ]] || fail "writes-dry (exit $code): $out"
[ ! -e "$WORK/writes-dry.log" ] || fail "dry-run writes reached gh"
[ "$(grep -c '^dry-run: ' "$WORK/writes-dry-report.txt")" = 4 ] || fail "dry-run write report entries"
ok "new write ops honor dry_run"

expect_refusal bad-close-reason 'gh.issue_close("octo", "demo", 3, "whatever");' 'invalid reason'
expect_refusal bad-comment-empty 'gh.pr_comment("octo", "demo", 3, "");' 'body must not be empty'

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
expect_run pr-edit-prepare 0 ''
sed -i 's/Original title/Operator edited title/' pr-review-octo-demo.toml
compile_chunk pr-edit-submit 'let pr = gh.pr_submit("octo", "demo", "pr-review-octo-demo.toml"); print("#" + str(pr.number()));'
set +e
out=$(FAKE_GH_LOG="$WORK/gh-write.log" "$LMSCRIPT" "$WORK/pr-edit-submit.lms" 2>&1); code=$?
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

# human-in-the-loop PR review verdict flow: pr_review_prepare writes the
# verdict TOML, the operator edits it, pr_review_submit drives gh pr review.
compile_chunk pr-review-prepare 'print(gh.pr_review_prepare("octo", "demo", 21, "APPROVE", "Ship it\nChecked diff"));'
expect_run pr-review-prepare 0 'pr-review-verdict-octo-demo-21.toml'
grep -q "^owner = 'octo'$" pr-review-verdict-octo-demo-21.toml || fail "verdict file owner"
grep -q "^repo = 'demo'$" pr-review-verdict-octo-demo-21.toml || fail "verdict file repo"
grep -q '^number = 21$' pr-review-verdict-octo-demo-21.toml || fail "verdict file number"
grep -q "^event = 'APPROVE'$" pr-review-verdict-octo-demo-21.toml || fail "verdict file event"
grep -q 'Ship it\\nChecked diff' pr-review-verdict-octo-demo-21.toml || fail "verdict file body"
ok "pr_review_prepare writes operator-reviewable verdict TOML"

compile_chunk pr-review-prepare-twice 'gh.pr_review_prepare("octo", "demo", 21, "APPROVE", "ok");'
expect_run pr-review-prepare-twice 3 'already exists'
rm -f pr-review-verdict-octo-demo-21.toml

# a dangling symlink at the verdict path must be refused via O_EXCL without creating its target
rm -f "$WORK/dangling-target" pr-review-verdict-octo-demo-21.toml
ln -s "$WORK/dangling-target" pr-review-verdict-octo-demo-21.toml
expect_run pr-review-prepare-twice 3 'already exists'
[ ! -e "$WORK/dangling-target" ] || fail "dangling symlink target was created"
rm -f pr-review-verdict-octo-demo-21.toml
ok "pr_review_prepare refuses dangling symlink without following it"

expect_refusal pr-review-prepare-bad-ident 'gh.pr_review_prepare("octo/demo", "demo", 21, "APPROVE", "ok");' 'invalid owner'
expect_refusal pr-review-prepare-bad-number 'gh.pr_review_prepare("octo", "demo", 0, "APPROVE", "ok");' 'invalid pull request number'
expect_refusal pr-review-prepare-bad-event 'gh.pr_review_prepare("octo", "demo", 21, "LGTM", "ok");' 'invalid event'
expect_refusal pr-review-prepare-empty-body-rc 'gh.pr_review_prepare("octo", "demo", 21, "REQUEST_CHANGES", "");' 'empty body'
expect_refusal pr-review-prepare-empty-body-comment 'gh.pr_review_prepare("octo", "demo", 21, "COMMENT", "   ");' 'empty body'

# issue #4: submit returns a Review whose url/id/state come from the review GitHub recorded
compile_chunk pr-review-submit-live 'let path = gh.pr_review_prepare("octo", "demo", 21, "APPROVE", ""); let res = gh.pr_review_submit("octo", "demo", 21, path); print(res.summary() + " " + str(res.id()) + " " + res.state() + " " + res.url() + " " + str(res.confirmed()));'
rm -f "$WORK/review-state"
set +e
out=$(FAKE_GH_STATE="$WORK/review-state" "$LMSCRIPT" "$WORK/pr-review-submit-live.lms" 2>&1); code=$?
set -e
[ "$code" = 0 ] && [[ "$out" == *'APPROVE octo/demo#21 200 APPROVED https://github.com/octo/demo/pull/21#pullrequestreview-200 true'* ]] || fail "pr-review-submit-live (exit $code): $out"
ok "pr_review_submit returns the posted review's id, state and url"
rm -f pr-review-verdict-octo-demo-21.toml

# a second review by the same user must pick the new one (id 201), not the first
rm -f "$WORK/review-state"; printf -- '--approve\n' > "$WORK/review-state"
compile_chunk pr-review-submit-second 'let path = gh.pr_review_prepare("octo", "demo", 21, "COMMENT", "again"); let res = gh.pr_review_submit("octo", "demo", 21, path); print(str(res.id()) + " " + res.state());'
set +e
out=$(FAKE_GH_STATE="$WORK/review-state" "$LMSCRIPT" "$WORK/pr-review-submit-second.lms" 2>&1); code=$?
set -e
[ "$code" = 0 ] && [[ "$out" == *'201 COMMENTED'* ]] || fail "second review confirmation (exit $code): $out"
ok "pr_review_submit confirms the newest review, not an earlier one"
rm -f pr-review-verdict-octo-demo-21.toml

# a failing confirmation lookup must not turn a posted review into an error
rm -f "$WORK/review-state"
set +e
out=$(FAKE_GH_SCENARIO=no-review-lookup FAKE_GH_STATE="$WORK/review-state" FAKE_GH_LOG="$WORK/lookup-fail.log" "$LMSCRIPT" "$WORK/pr-review-submit-live.lms" 2>&1); code=$?
set -e
[ "$code" = 0 ] && [[ "$out" == *'APPROVE octo/demo#21 0   false'* ]] || fail "lookup failure should still succeed (exit $code): $out"
grep -q '"--approve"' "$WORK/lookup-fail.log" || fail "review was not posted when lookup failed"
ok "pr_review_submit reports success with confirmed() == false when the lookup fails"
rm -f pr-review-verdict-octo-demo-21.toml

# the operator edits verdict and body between prepare and submit; the edit flows through --body-file
compile_chunk pr-review-edit-prepare 'gh.pr_review_prepare("octo", "demo", 21, "APPROVE", "Initial note");'
expect_run pr-review-edit-prepare 0 ''
sed -i 's/APPROVE/REQUEST_CHANGES/; s/Initial note/Needs a regression test/' pr-review-verdict-octo-demo-21.toml
compile_chunk pr-review-edit-submit 'print(gh.pr_review_submit("octo", "demo", 21, "pr-review-verdict-octo-demo-21.toml").summary());'
rm -f "$WORK/gh-review-write.log" "$WORK/review-state"
set +e
out=$(FAKE_GH_STATE="$WORK/review-state" FAKE_GH_LOG="$WORK/gh-review-write.log" "$LMSCRIPT" "$WORK/pr-review-edit-submit.lms" 2>&1); code=$?
set -e
[ "$code" = 0 ] && [[ "$out" == *"REQUEST_CHANGES octo/demo#21"* ]] || fail "edited review submit (exit $code): $out"
python3 - "$WORK/gh-review-write.log" <<'PY' || fail "unexpected gh pr review argv: $(cat "$WORK/gh-review-write.log")"
import json, os, sys
lines = [json.loads(line) for line in open(sys.argv[1], encoding="utf-8").read().splitlines()]
assert len(lines) == 2, f"expected 2 log lines, got {len(lines)}"
argv, body_entry = lines[0], lines[1]
assert len(argv) == 8, f"expected 8 argv items, got {argv}"
assert argv[:7] == ["pr", "review", "21", "-R", "octo/demo", "--request-changes", "--body-file"], f"bad argv prefix: {argv[:7]}"
assert os.path.basename(argv[7]).startswith("lmgh-review-body-") and argv[7].endswith(".md"), f"bad temp path: {argv[7]}"
assert not os.path.exists(argv[7]), f"temp body file was not cleaned up: {argv[7]}"
assert body_entry == ["--body-file-content", "Needs a regression test"], f"bad body entry: {body_entry}"
PY
ok "operator verdict edit flows through exact gh pr review argv and --body-file"

expect_refusal pr-review-submit-mismatch-repo 'gh.pr_review_submit("octo", "other", 21, "pr-review-verdict-octo-demo-21.toml");' 'review file is for'
expect_refusal pr-review-submit-mismatch-num 'gh.pr_review_submit("octo", "demo", 22, "pr-review-verdict-octo-demo-21.toml");' 'review file is for'
rm -f pr-review-verdict-octo-demo-21.toml

# two-step examples/review-pr.lms flow: dry-run prepare -> operator edit -> --live submit
rm -f "$WORK/gh-review-live-nodraft.log"
set +e
out=$(FAKE_GH_LOG="$WORK/gh-review-live-nodraft.log" "$LMSCRIPT" examples/review-pr.lms octo demo 21 APPROVE --live 2>&1); code=$?
set -e
[ "$code" = 3 ] && [[ "$out" == *'cannot read review file'* ]] || fail "review-pr --live without draft should fail (exit $code): $out"
[ ! -s "$WORK/gh-review-live-nodraft.log" ] || fail "review-pr --live without draft invoked gh"
ok "examples/review-pr.lms --live refuses when no draft exists"

set +e
out=$("$LMSCRIPT" examples/review-pr.lms octo demo 21 APPROVE --dry 2>&1); code=$?
set -e
[ "$code" = 0 ] && [ -f pr-review-verdict-octo-demo-21.toml ] || fail "review-pr step 1 dry prepare (exit $code): $out"
sed -i 's/APPROVE/COMMENT/; s/Looks good to me./Two-step reviewed comment/' pr-review-verdict-octo-demo-21.toml
rm -f "$WORK/gh-review-twostep.log" "$WORK/review-state"
set +e
out=$(FAKE_GH_STATE="$WORK/review-state" FAKE_GH_LOG="$WORK/gh-review-twostep.log" "$LMSCRIPT" examples/review-pr.lms octo demo 21 APPROVE --live 2>&1); code=$?
set -e
[ "$code" = 0 ] && [[ "$out" == *"submitted review: COMMENT octo/demo#21"* ]] && [[ "$out" == *"review 200 (COMMENTED): https://github.com/octo/demo/pull/21#pullrequestreview-200"* ]] || fail "review-pr step 2 live submit (exit $code): $out"
python3 - "$WORK/gh-review-twostep.log" <<'PY' || fail "two-step gh argv mismatch: $(cat "$WORK/gh-review-twostep.log")"
import json, sys
lines = [json.loads(line) for line in open(sys.argv[1], encoding="utf-8").read().splitlines()]
assert len(lines) == 2 and lines[0][:7] == ["pr", "review", "21", "-R", "octo/demo", "--comment", "--body-file"]
assert lines[1] == ["--body-file-content", "Two-step reviewed comment"]
PY
rm -f pr-review-verdict-octo-demo-21.toml
ok "examples/review-pr.lms two-step prepare -> edit -> --live submit"

verdict() { printf "$1" > pr-review-verdict-octo-demo-21.toml; }
verdict 'owner = "octo"\nrepo = "demo"\nnumber = 21\nevent = "SHIP_IT"\nbody = "x"\n'
expect_refusal pr-review-submit-bad-event 'gh.pr_review_submit("octo", "demo", 21, "pr-review-verdict-octo-demo-21.toml");' 'invalid event'
verdict 'owner = "octo"\nrepo = "demo"\nnumber = 21\nevent = "approve"\nbody = "x"\n'
expect_refusal pr-review-submit-lowercase-event 'gh.pr_review_submit("octo", "demo", 21, "pr-review-verdict-octo-demo-21.toml");' 'invalid event'
verdict 'owner = "octo"\nrepo = "demo"\nnumber = 0\nevent = "APPROVE"\nbody = "x"\n'
expect_refusal pr-review-submit-zero-number 'gh.pr_review_submit("octo", "demo", 21, "pr-review-verdict-octo-demo-21.toml");' 'invalid pull request number'
verdict 'owner = "octo"\nrepo = "demo"\nnumber = 21\nevent = "COMMENT"\nbody = ""\n'
expect_refusal pr-review-submit-empty-body 'gh.pr_review_submit("octo", "demo", 21, "pr-review-verdict-octo-demo-21.toml");' 'empty body'
verdict 'owner = "octo"\nrepo = "demo"\nnumber = 21\nevent = "APPROVE"\nbody = "ok"\nextra = 1\n'
expect_refusal pr-review-submit-unknown-field 'gh.pr_review_submit("octo", "demo", 21, "pr-review-verdict-octo-demo-21.toml");' 'invalid TOML'

# case-variant duplicate key, wrong-case key or missing key must be refused without calling gh
expect_key_refusal() { # label file-content needle
  verdict "$2"
  compile_chunk "$1" 'gh.pr_review_submit("octo", "demo", 21, "pr-review-verdict-octo-demo-21.toml");'
  rm -f "$WORK/gh-keys.log"
  set +e
  out=$(FAKE_GH_LOG="$WORK/gh-keys.log" "$LMSCRIPT" "$WORK/$1.lms" 2>&1); code=$?
  set -e
  [ "$code" = 3 ] && [[ "$out" == *"$3"* ]] || fail "$1 not refused (exit $code): $out"
  [ ! -s "$WORK/gh-keys.log" ] || fail "$1 invoked gh: $(cat "$WORK/gh-keys.log")"
  ok "$1 refused without calling gh"
}
expect_key_refusal verdict-case-duplicate 'owner = "octo"\nrepo = "demo"\nnumber = 21\nevent = "REQUEST_CHANGES"\nEvent = "APPROVE"\nbody = "Needs work"\n' "unknown or non-canonical key 'Event'"
expect_key_refusal verdict-wrong-case 'owner = "octo"\nrepo = "demo"\nnumber = 21\nEvent = "APPROVE"\nbody = "ok"\n' "unknown or non-canonical key 'Event'"
expect_key_refusal verdict-missing-body 'owner = "octo"\nrepo = "demo"\nnumber = 21\nevent = "APPROVE"\n' "missing required key 'body'"

# issue #2: pr_submit's review file gets the same exact-case key check
rm -f pr-review-verdict-octo-demo-21.toml
printf "owner = 'octo'\nrepo = 'demo'\ntitle = 'Original title'\nTitle = 'Overridden title'\nbase = 'main'\nhead = 'feat'\ndraft = false\nbody = 'x'\n" > pr-review-octo-demo.toml
compile_chunk submit-case-duplicate 'gh.dry_run(true); print(gh.pr_submit("octo", "demo", "pr-review-octo-demo.toml").title());'
expect_run submit-case-duplicate 3 "unknown or non-canonical key 'Title'"
printf "owner = 'octo'\nrepo = 'demo'\nTITLE = 'Shouted'\nbase = 'main'\nhead = 'feat'\n" > pr-review-octo-demo.toml
compile_chunk submit-case-only 'gh.dry_run(true); gh.pr_submit("octo", "demo", "pr-review-octo-demo.toml");'
expect_run submit-case-only 3 "unknown or non-canonical key 'TITLE'"
rm -f pr-review-octo-demo.toml
ok "pr_submit refuses case-variant keys instead of letting a later one win"

expect_refusal pr-review-submit-missing 'gh.pr_review_submit("octo", "demo", 21, "no-such-verdict.toml");' 'cannot read review file'
rm -f pr-review-verdict-octo-demo-21.toml

compile_chunk pr-review-submit-dry 'gh.dry_run(true); let path = gh.pr_review_prepare("octo", "demo", 21, "COMMENT", "Nit on line 10"); let res = gh.pr_review_submit("octo", "demo", 21, path); print(res.summary() + " " + res.state() + " " + str(res.confirmed())); report.write_text("build/test-chunks/pr-review-dry-report.txt");'
expect_run pr-review-submit-dry 0 'dry-run: gh pr review 21 -R octo/demo --comment dry-run false'
grep -q 'dry-run: pr_review_submit: octo/demo #21 (COMMENT)' "$WORK/pr-review-dry-report.txt" || fail "dry-run pr_review_submit report entry"
rm -f pr-review-verdict-octo-demo-21.toml
ok "pr_review_submit honors dry_run"

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

python3 tests/check-recipes.py "$LMSCRIPT" || fail "offline recipe scenarios"
ok "all task recipes match pinned stdout and reports"

echo "PASS: $PASS checks"
