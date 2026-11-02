#!/usr/bin/env python3
"""Fake `gh` for lmgh tests.

Prints canned JSON for the lmgh operation catalog and records nothing; every
response is deterministic so example outputs can be diffed byte-for-byte.
Never contacts GitHub and needs no token.
"""
import json
import os
import sys

OWNER_REPO = None  # resolved per call from argv


def out(text):
    sys.stdout.write(text)


def fail(message):
    sys.stderr.write(message + "\n")
    sys.exit(1)


def log_argv(args):
    # tests set FAKE_GH_LOG to inspect the exact argv a write op received
    path = os.environ.get("FAKE_GH_LOG")
    if path:
        with open(path, "a") as f:
            f.write(json.dumps(args) + "\n")


def main():
    args = sys.argv[1:]
    if not args:
        fail("usage: gh <command>")
    if args[0] == "--version":
        out("gh version 2.103.3 (2026-10-26)\nhttps://github.com/cli/cli/releases/tag/v2.103.3\n")
        return

    cmd = args[0]
    recipes = os.environ.get("FAKE_GH_RECIPES") == "1"
    scenario = os.environ.get("FAKE_GH_SCENARIO", "")
    if scenario == "empty" and args[1:2] == ["list"]:
        out("[]\n")
        return
    if recipes and args[:2] == ["repo", "view"] and args[2] == "octo/toolkit":
        out(json.dumps({"name": "toolkit", "nameWithOwner": "octo/toolkit", "url": "https://github.com/octo/toolkit", "description": "", "defaultBranchRef": {"name": "main"}, "licenseInfo": None, "repositoryTopics": []}) + "\n")
        return
    if recipes and args[:2] == ["run", "list"] and "octo/toolkit" in args:
        out(json.dumps([{"databaseId": 2001, "name": "build", "displayTitle": "broken main", "status": "completed", "conclusion": "failure", "headBranch": "main", "url": "https://github.com/octo/toolkit/actions/runs/2001"}]) + "\n")
        return
    if recipes and args[:2] == ["search", "repos"] and args[2] == "repo:octo/demo":
        out(json.dumps([{"fullName": "octo/demo", "url": "https://github.com/octo/demo"}]) + "\n")
        return
    if recipes and args[:2] == ["issue", "list"]:
        out(json.dumps([{"number": 14, "title": "Needs an owner", "state": "OPEN", "author": {"login": "bob"}, "labels": [], "url": "https://github.com/octo/demo/issues/14"}]) + "\n")
        return
    if recipes and args[:2] == ["search", "prs"]:
        out(json.dumps([{"number": 22, "title": "WIP: dark mode", "state": "open", "isDraft": True, "author": {"login": "dave"}, "url": "https://github.com/octo/demo/pull/22", "updatedAt": "2020-01-01T00:00:00Z"}]) + "\n")
        return
    if recipes and args[:3] == ["pr", "view", "22"]:
        out(json.dumps({"number": 22, "title": "WIP: dark mode", "state": "OPEN", "author": {"login": "dave"}, "url": "https://github.com/octo/demo/pull/22", "isDraft": True, "updatedAt": "2020-01-01T00:00:00Z", "mergeable": "CONFLICTING", "reviews": [], "reviewDecision": "REVIEW_REQUIRED", "statusCheckRollup": []}) + "\n")
        return

    # every canned response below is for octo/demo; anything else is a miss
    if ("-R" in args and args[args.index("-R") + 1] != "octo/demo") or \
       (len(args) > 2 and args[0] == "repo" and "/" in args[2] and args[2] != "octo/demo"):
        fail("GraphQL: Could not resolve to a Repository with the name 'octo/missing'.")

    if cmd == "repo" and args[1:2] == ["view"]:
        out(json.dumps({
            "name": "demo",
            "nameWithOwner": "octo/demo",
            "description": "Demo repository for lmgh tests",
            "url": "https://github.com/octo/demo",
            "homepageUrl": "https://octo.dev/demo",
            "defaultBranchRef": {"name": "main"},
            "stargazerCount": 42,
            "forkCount": 7,
            "isArchived": False,
            "isPrivate": False,
            "pushedAt": "2026-10-20T12:00:00Z",
            "licenseInfo": {"spdxId": "MIT"},
            "repositoryTopics": [{"name": "testing"}, {"name": "demo"}],
            "issues": {"totalCount": 5},
        }) + "\n")
        return

    if cmd == "issue" and args[1:2] == ["list"]:
        out(json.dumps([
            {
                "number": 12, "title": "Login button unresponsive", "state": "OPEN",
                "author": {"login": "alice"}, "url": "https://github.com/octo/demo/issues/12",
                "labels": [{"name": "bug"}, {"name": "ui"}],
                "createdAt": "2026-10-01T09:00:00Z",
            },
            {
                "number": 13, "title": "Add dark mode", "state": "OPEN",
                "author": {"login": "bob"}, "url": "https://github.com/octo/demo/issues/13",
                "labels": [{"name": "enhancement"}],
                "createdAt": "2026-10-05T14:30:00Z",
            },
        ]) + "\n")
        return

    if cmd == "issue" and args[1:2] == ["view"]:
        number = int(args[2])
        out(json.dumps({
            "number": number, "title": "Live title", "state": "OPEN",
            "author": {"login": "alice"}, "url": "https://github.com/octo/demo/issues/%d" % number,
            "labels": [],
            "comments": [],
            "createdAt": "2026-10-26T09:00:00Z",
            "body": "body",
        }) + "\n")
        return

    if cmd == "issue" and args[1:2] == ["create"]:
        log_argv(args)
        out("https://github.com/octo/demo/issues/42\n")
        return

    if cmd == "pr" and args[1:2] == ["create"]:
        log_argv(args)
        out("https://github.com/octo/demo/pull/43\n")
        return

    if cmd == "pr" and args[1:2] == ["list"]:
        out(json.dumps([
            {
                "number": 21, "title": "Fix login flow", "state": "OPEN",
                "author": {"login": "carol"}, "url": "https://github.com/octo/demo/pull/21",
                "baseRefName": "main", "headRefName": "fix-login", "isDraft": False,
                "labels": [{"name": "bug"}],
                "createdAt": "2026-10-10T08:00:00Z", "updatedAt": "2026-10-11T10:00:00Z",
            },
            {
                "number": 22, "title": "WIP: dark mode", "state": "OPEN",
                "author": {"login": "dave"}, "url": "https://github.com/octo/demo/pull/22",
                "baseRefName": "main", "headRefName": "dark-mode", "isDraft": True,
                "labels": [],
                "createdAt": "2026-10-12T11:00:00Z", "updatedAt": "2026-10-12T11:00:00Z",
            },
        ]) + "\n")
        return

    if cmd == "pr" and args[1:2] == ["view"]:
        fields = args[args.index("--json") + 1] if "--json" in args else ""
        if "statusCheckRollup" in fields:
            out(json.dumps({
                "number": 21, "title": "Fix login flow", "state": "OPEN",
                "author": {"login": "carol"}, "url": "https://github.com/octo/demo/pull/21",
                "mergeable": "MERGEABLE",
                "statusCheckRollup": [
                    {"__typename": "CheckRun", "name": "build", "conclusion": "SUCCESS"},
                    {"__typename": "CheckRun", "name": "test", "conclusion": "SUCCESS"},
                    {"__typename": "CheckRun", "name": "lint", "conclusion": "FAILURE"},
                ],
                "reviews": [{"state": "APPROVED"}, {"state": "COMMENTED"}],
                "reviewDecision": "APPROVED",
            }) + "\n")
        else:
            number = int(args[2])
            out(json.dumps({
                "number": number, "title": "Fix login flow", "state": "OPEN",
                "author": {"login": "carol"}, "url": "https://github.com/octo/demo/pull/%d" % number,
                "baseRefName": "main", "headRefName": "fix-login", "isDraft": False,
                "labels": [{"name": "bug"}],
                "createdAt": "2026-10-10T08:00:00Z", "updatedAt": "2026-10-11T10:00:00Z",
                "mergeable": "MERGEABLE",
            }) + "\n")
        return

    if cmd == "pr" and args[1:2] == ["merge"]:
        out("https://github.com/octo/demo/pull/21\n")
        return

    if cmd == "pr" and args[1:2] == ["review"]:
        int(args[2])
        if "-R" not in args or args.index("-R") + 1 >= len(args) or "/" not in args[args.index("-R") + 1]:
            fail("gh pr review requires -R owner/repo")
        flags = [f for f in ("--approve", "--request-changes", "--comment") if f in args]
        if len(flags) != 1:
            fail("need exactly one of --approve, --request-changes, or --comment")
        if "--body-file" not in args or args.index("--body-file") + 1 >= len(args):
            fail("gh pr review requires --body-file")
        bf = args[args.index("--body-file") + 1]
        with open(bf, "r", encoding="utf-8") as f:
            body = f.read()
        if flags[0] in ("--request-changes", "--comment") and not body:
            fail("body cannot be blank for %s review" % flags[0].lstrip("-"))
        log_argv(args)
        log_argv(["--body-file-content", body])
        state = os.environ.get("FAKE_GH_STATE")
        if state:
            with open(state, "a") as f:
                f.write(flags[0] + "\n")
        return

    if args[:2] == ["api", "user"]:
        out("tester\n")
        return

    if cmd == "api" and "--paginate" in args and args[-2:-1] == ["--jq"] and args[args.index("--paginate") + 1].endswith("/reviews"):
        if os.environ.get("FAKE_GH_SCENARIO") == "no-review-lookup":
            fail("fake gh: review listing unavailable")
        number = args[args.index("--paginate") + 1].split("/")[-2]
        base = "https://github.com/octo/demo/pull/" + number + "#pullrequestreview-"
        rows = [
            {"id": 100, "html_url": base + "100", "state": "APPROVED", "login": "tester"},
            {"id": 150, "html_url": base + "150", "state": "COMMENTED", "login": "someone-else"},
        ]
        state = os.environ.get("FAKE_GH_STATE")
        if state and os.path.exists(state):
            names = {"--approve": "APPROVED", "--request-changes": "CHANGES_REQUESTED", "--comment": "COMMENTED"}
            for i, flag in enumerate(open(state).read().split()):
                rid = 200 + i
                rows.append({"id": rid, "html_url": base + str(rid), "state": names[flag], "login": "tester"})
        out("".join(json.dumps(r) + "\n" for r in rows))
        return

    if cmd == "release" and args[1:2] == ["list"]:
        out(json.dumps([
            {
                "tagName": "v1.2.0", "name": "Version 1.2.0",
                "url": "https://github.com/octo/demo/releases/tag/v1.2.0",
                "publishedAt": "2026-10-15T10:00:00Z",
                "isDraft": False, "isPrerelease": False,
            },
            {
                "tagName": "v1.1.0", "name": "Version 1.1.0",
                "url": "https://github.com/octo/demo/releases/tag/v1.1.0",
                "publishedAt": "2026-09-01T10:00:00Z",
                "isDraft": False, "isPrerelease": False,
            },
        ]) + "\n")
        return

    if cmd == "run" and args[1:2] == ["list"]:
        out(json.dumps([
            {
                "databaseId": 1001, "name": "ci", "displayTitle": "ci: fix login",
                "status": "completed", "conclusion": "failure",
                "url": "https://github.com/octo/demo/actions/runs/1001",
                "headBranch": "fix-login", "event": "push",
                "createdAt": "2026-10-20T09:00:00Z", "updatedAt": "2026-10-20T09:10:00Z",
            },
            {
                "databaseId": 1000, "name": "ci", "displayTitle": "ci: main",
                "status": "completed", "conclusion": "success",
                "url": "https://github.com/octo/demo/actions/runs/1000",
                "headBranch": "main", "event": "push",
                "createdAt": "2026-10-19T09:00:00Z", "updatedAt": "2026-10-19T09:08:00Z",
            },
        ]) + "\n")
        return

    if cmd == "run" and args[1:2] == ["view"] and "--log-failed" in args:
        if scenario == "no-logs":
            out("\n")
            return
        if args[2] != "1001":
            fail("fake gh: failed log is only canned for run 1001")
        out("linux\tTest\t2026-10-31T11:59:59Z\tshell: bash -e -o pipefail\nlinux\tTest\t2026-10-31T12:00:00Z\t##[error]expected 2 got 1\n"
            "linux\tTest\t2026-10-31T12:00:01Z\t##[error]expected 2 got 1\n"
            "windows\tBuild\t2026-10-31T12:00:02Z\terror: missing header\n"
            "windows\tBuild\t2026-10-31T12:00:03Z\terror: missing header\n")
        return

    if cmd == "search" and args[1:2] == ["repos"]:
        out(json.dumps([
            {
                "fullName": "octo/demo", "description": "Demo repository",
                "stargazersCount": 42, "forksCount": 7,
                "url": "https://github.com/octo/demo",
                "updatedAt": "2026-10-20T12:00:00Z",
                "isArchived": False, "isPrivate": False,
            },
            {
                "fullName": "octo/toolkit", "description": "Toolkit",
                "stargazersCount": 1330, "forksCount": 120,
                "url": "https://github.com/octo/toolkit",
                "updatedAt": "2026-10-18T12:00:00Z",
                "isArchived": False, "isPrivate": False,
            },
        ]) + "\n")
        return

    if cmd == "search" and args[1:2] == ["issues"]:
        out(json.dumps([
            {
                "number": 77, "title": "Crash on startup", "state": "open",
                "url": "https://github.com/octo/toolkit/issues/77",
                "repository": {"nameWithOwner": "octo/toolkit"},
                "labels": [{"name": "bug"}],
                "createdAt": "2026-10-15T08:00:00Z", "commentsCount": 4,
                "author": {"login": "erin"},
            },
        ]) + "\n")
        return

    if cmd == "search" and args[1:2] == ["prs"]:
        out(json.dumps([
            {
                "number": 5, "title": "Improve flags", "state": "open",
                "url": "https://github.com/octo/toolkit/pull/5",
                "author": {"login": "frank"},
                "isDraft": False,
                "labels": [], "createdAt": "2026-10-16T08:00:00Z", "updatedAt": "2026-10-16T09:00:00Z",
            },
        ]) + "\n")
        return

    if args[:2] in (["issue", "close"], ["pr", "comment"], ["release", "create"]) or args[:3] == ["api", "--method", "POST"]:
        log_argv(args)
        out("ok " + " ".join(args[:2]) + "\n")
        return

    if cmd == "api":
        path = args[1]
        if path.startswith("repos/octo/demo/contents/"):
            out("# demo\nfake repository file\n")
            return
        fail("fake gh: unsupported api path " + path)

    fail("fake gh: unsupported argv " + " ".join(args))


if __name__ == "__main__":
    main()
