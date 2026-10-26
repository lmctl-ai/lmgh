#!/usr/bin/env bash
# Fetch or verify the vendored cli/cli checkout used as the upstream
# reference for the lmgh fork (same idiom as lmhtml's sync-lexbor.sh).
set -euo pipefail
cd "$(dirname "$0")/.."

LOCK=cli.lock
DIR=third_party/cli

repo=$(sed -n 's/^repo=//p' "$LOCK")
commit=$(sed -n 's/^commit=//p' "$LOCK")

if [ "${1:-}" = "--verify" ]; then
  if [ ! -d "$DIR/.git" ]; then
    echo "third_party/cli is not checked out; run scripts/sync-cli.sh" >&2
    exit 1
  fi
  actual=$(git -C "$DIR" rev-parse HEAD)
  if [ "$actual" != "$commit" ]; then
    echo "third_party/cli is at $actual, lock pins $commit; run scripts/sync-cli.sh" >&2
    exit 1
  fi
  echo "third_party/cli matches $commit"
  exit 0
fi

mkdir -p third_party
if [ ! -d "$DIR/.git" ]; then
  rm -rf "$DIR"
  git init -q "$DIR"
  git -C "$DIR" remote add origin "$repo"
fi
git -C "$DIR" fetch -q --depth 1 origin "$commit"
git -C "$DIR" checkout -q FETCH_HEAD
echo "third_party/cli now at $commit ($repo)"
