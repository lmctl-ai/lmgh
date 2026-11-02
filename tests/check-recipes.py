#!/usr/bin/env python3
"""Compile every recipe and compare pinned stdout/report bytes offline."""
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
CASES = [
    ("ci-errors", "ci-errors", 4, [], "", "json"),
    ("ci-errors-empty", "ci-errors", 0, [], "empty", "json"),
    ("ci-errors-no-logs", "ci-errors", 3, [], "no-logs", None),
    ("org-ci-health", "org-ci-health", 0, [], "", "json"),
    ("org-ci-health-many", "org-ci-health", 4, ["octo", "demo,toolkit"], "", "json"),
    ("org-ci-health-empty", "org-ci-health", 4, [], "empty", "json"),
    ("stale-prs", "stale-prs", 4, [], "", "txt"),
    ("unreviewed-prs", "unreviewed-prs", 4, [], "", "json"),
    ("release-readiness", "release-readiness", 0, [], "", "txt"),
    ("release-readiness-empty", "release-readiness", 4, [], "empty", "txt"),
    ("issue-triage-unlabeled", "issue-triage-unlabeled", 4, [], "", "json"),
    ("issue-triage-empty", "issue-triage-unlabeled", 0, [], "empty", "json"),
    ("repo-audit", "repo-audit", 4, [], "", "txt"),
    ("repo-audit-clean", "repo-audit", 0, ["octo", "demo"], "", "txt"),
]


def execute(case, compiler):
    label, name, code, args, scenario, extension = case
    env = dict(os.environ, FAKE_GH_RECIPES="1", FAKE_GH_SCENARIO=scenario)
    report = ROOT / "build" / (name + "." + (extension or "json"))
    report.unlink(missing_ok=True)
    result = subprocess.run([compiler, str(ROOT / "examples" / (name + ".lms")), *args],
                            env=env, cwd=ROOT, capture_output=True, timeout=120)
    if result.returncode != code or result.stderr:
        raise AssertionError(f"{label}: expected exit {code}, got {result.returncode}: {result.stdout!r} {result.stderr!r}")
    if not extension and report.exists():
        raise AssertionError(f"{label}: incomplete scan unexpectedly wrote a report")
    return result.stdout, report.read_bytes() if extension else None


def main():
    compiler = str(Path(sys.argv[1]).resolve())  # lmgh must already be on PATH
    for case in CASES:
        label = case[0]
        output, report = execute(case, compiler)
        expected = ROOT / "tests/expected" / (label + ".out")
        if output != expected.read_bytes():
            raise AssertionError(f"{label}: stdout differs from {expected}\nactual: {output!r}")
        if report is not None:
            expected = ROOT / "tests/expected" / (label + ".report")
            if report != expected.read_bytes():
                raise AssertionError(f"{label}: report differs from {expected}\nactual: {report!r}")
        print(f"PASS {label} (exit {case[2]})")
    print(f"PASS {len(CASES)} offline recipe scenarios")


if __name__ == "__main__":
    main()
