package main

import (
	"strconv"
	"strings"

	"github.com/lmctl-ai/lmcode-go"
)

// Additional write operations. Like pr_merge they honor gh.dry_run(bool):
// under dry-run the intent is recorded in the report and gh is never spawned.
// All validation happens before either path.

func (h *Host) registerWrites() {
	method := func(name string, params []string, fn func(*Host, []lmcode.Value) (lmcode.Value, error)) {
		h.must(h.reg.Method("Gh", name, params, "string", func(self any, args []lmcode.Value) (lmcode.Value, error) {
			return fn(self.(*Host), args)
		}))
	}

	// issue_close(owner, repo, number, reason): reason is "", "completed" or "not planned".
	method("issue_close", []string{"string", "string", "int", "string"}, func(h *Host, args []lmcode.Value) (lmcode.Value, error) {
		owner, repo, number, reason := vstr(args[0]), vstr(args[1]), vint(args[2]), vstr(args[3])
		if err := checkRepoNumber("issue_close", owner, repo, number); err != nil {
			return lmcode.None(), err
		}
		argv := []string{"issue", "close", strconv.FormatInt(number, 10), "-R", owner + "/" + repo}
		switch reason {
		case "":
		case "completed", "not planned":
			argv = append(argv, "--reason", reason)
		default:
			return lmcode.None(), lmcode.NewHostError("issue_close: invalid reason '" + reason + "': expected completed, not planned or empty")
		}
		return h.write("issue_close", owner+"/"+repo+" #"+strconv.FormatInt(number, 10), argv)
	})

	// pr_comment(owner, repo, number, body): plain top-level PR comment.
	method("pr_comment", []string{"string", "string", "int", "string"}, func(h *Host, args []lmcode.Value) (lmcode.Value, error) {
		owner, repo, number, body := vstr(args[0]), vstr(args[1]), vint(args[2]), vstr(args[3])
		if err := checkRepoNumber("pr_comment", owner, repo, number); err != nil {
			return lmcode.None(), err
		}
		if strings.TrimSpace(body) == "" {
			return lmcode.None(), lmcode.NewHostError("pr_comment: body must not be empty")
		}
		argv := []string{"pr", "comment", strconv.FormatInt(number, 10), "-R", owner + "/" + repo, "--body", body}
		return h.write("pr_comment", owner+"/"+repo+" #"+strconv.FormatInt(number, 10), argv)
	})

	// label_add(owner, repo, number, label): works for issues and pull requests
	// (GitHub treats PRs as issues for labels), so it goes through the REST API.
	method("label_add", []string{"string", "string", "int", "string"}, func(h *Host, args []lmcode.Value) (lmcode.Value, error) {
		owner, repo, number, label := vstr(args[0]), vstr(args[1]), vint(args[2]), vstr(args[3])
		if err := checkRepoNumber("label_add", owner, repo, number); err != nil {
			return lmcode.None(), err
		}
		if strings.TrimSpace(label) == "" {
			return lmcode.None(), lmcode.NewHostError("label_add: label must not be empty")
		}
		n := strconv.FormatInt(number, 10)
		argv := []string{"api", "--method", "POST", "repos/" + owner + "/" + repo + "/issues/" + n + "/labels", "-f", "labels[]=" + label}
		return h.write("label_add", owner+"/"+repo+" #"+n+" +"+label, argv)
	})

	// release_create(owner, repo, tag, title, notes, draft, prerelease)
	h.must(h.reg.Method("Gh", "release_create", []string{"string", "string", "string", "string", "string", "bool", "bool"}, "string",
		func(self any, args []lmcode.Value) (lmcode.Value, error) {
			h := self.(*Host)
			owner, repo, tag, title, notes := vstr(args[0]), vstr(args[1]), vstr(args[2]), vstr(args[3]), vstr(args[4])
			draft, pre := vbool(args[5]), vbool(args[6])
			for _, id := range [][2]string{{"owner", owner}, {"repo", repo}, {"tag", tag}} {
				if err := checkIdent(id[0], id[1]); err != nil {
					return lmcode.None(), lmcode.NewHostError("release_create: " + err.Error())
				}
			}
			if strings.HasPrefix(tag, "-") {
				return lmcode.None(), lmcode.NewHostError("release_create: invalid tag '" + tag + "'")
			}
			argv := []string{"release", "create", tag, "-R", owner + "/" + repo, "--title", title, "--notes", notes}
			if draft {
				argv = append(argv, "--draft")
			}
			if pre {
				argv = append(argv, "--prerelease")
			}
			return h.write("release_create", owner+"/"+repo+" "+tag, argv)
		}))
}

// checkRepoNumber validates the common owner/repo/number triple.
func checkRepoNumber(op, owner, repo string, number int64) error {
	for _, id := range [][2]string{{"owner", owner}, {"repo", repo}} {
		if err := checkIdent(id[0], id[1]); err != nil {
			return lmcode.NewHostError(op + ": " + err.Error())
		}
	}
	if number < 1 {
		return lmcode.NewHostError(op + ": invalid number " + strconv.FormatInt(number, 10))
	}
	return nil
}

// write runs (or, under dry-run, records) one mutating gh invocation and
// returns gh's trimmed output.
func (h *Host) write(op, subject string, argv []string) (lmcode.Value, error) {
	if h.dryRun {
		h.report.add("dry-run", op, subject)
		return lmcode.String("dry-run: gh " + strings.Join(argv, " ")), nil
	}
	out, err := h.runGh(argv...)
	if err != nil {
		return lmcode.None(), err
	}
	return lmcode.String(strings.TrimSpace(out)), nil
}
