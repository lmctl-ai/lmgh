package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/lmctl-ai/lmcode-go"
	"github.com/pelletier/go-toml/v2"
)

// prReview is the human-in-the-loop contract between pr_prepare and
// pr_submit: pr_prepare marshals it into a review TOML the operator edits,
// pr_submit unmarshals the edited file and drives `gh pr create` from it.
type prReview struct {
	Owner string `toml:"owner"`
	Repo  string `toml:"repo"`
	Title string `toml:"title"`
	Base  string `toml:"base"`
	Head  string `toml:"head"`
	Draft bool   `toml:"draft"`
	Body  string `toml:"body"`
}

// reviewHeader is prepended to every review file so the operator knows the
// contract without reading docs.
const reviewHeader = `# lmgh PR review file — human in the loop.
# Edit any field below, then submit with: gh.pr_submit(owner, repo, <this file>)
# Nothing is pushed until pr_submit runs; delete this file to abort.
`

// reviewPath names the review file for a repository in the current directory.
func reviewPath(owner, repo string) string {
	return filepath.Join(".", "pr-review-"+owner+"-"+repo+".toml")
}

// checkIdent validates one repository identifier (owner, repo, base, head).
func checkIdent(field, value string) error {
	if value == "" {
		return lmcode.NewHostError(field + " must not be empty")
	}
	if strings.ContainsAny(value, "/\\") || value == "." || value == ".." {
		return lmcode.NewHostError("invalid " + field + " '" + value + "': expected a plain name without '/'")
	}
	return nil
}

// writeReview marshals the review file, refusing to clobber an existing one
// so operator edits are never silently overwritten.
func writeReview(r *prReview) (string, error) {
	data, err := toml.Marshal(r)
	if err != nil {
		return "", lmcode.NewHostError("pr_prepare: cannot encode review file: " + err.Error())
	}
	path := reviewPath(r.Owner, r.Repo)
	if _, err := os.Stat(path); err == nil {
		return "", lmcode.NewHostError("pr_prepare: " + path + " already exists; review and pr_submit it, or delete it to abort")
	}
	if err := os.WriteFile(path, append([]byte(reviewHeader), data...), 0o644); err != nil {
		return "", lmcode.NewHostError("pr_prepare: cannot write " + path + ": " + err.Error())
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		abs = path
	}
	return abs, nil
}

// readReview parses an operator-edited review file with strict decoding so
// typos and stale files are refused instead of misread.
func readReview(path string) (*prReview, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, lmcode.NewHostError("pr_submit: cannot read review file " + path + ": " + err.Error())
	}
	var r prReview
	dec := toml.NewDecoder(strings.NewReader(string(data)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&r); err != nil {
		return nil, lmcode.NewHostError("pr_submit: invalid TOML in " + path + ": " + firstLine(err.Error()))
	}
	if r.Title == "" {
		return nil, lmcode.NewHostError("pr_submit: " + path + " has an empty title; the operator must set one")
	}
	for _, id := range [][2]string{{"owner", r.Owner}, {"repo", r.Repo}, {"base", r.Base}, {"head", r.Head}} {
		if err := checkIdent(id[0], id[1]); err != nil {
			return nil, lmcode.NewHostError("pr_submit: " + path + ": " + err.Error())
		}
	}
	return &r, nil
}

// expectRepo pins a parsed review file to the repository the script asked to
// submit against, catching stale or mismatched review files.
func (r *prReview) expectRepo(owner, repo string) error {
	if r.Owner != owner || r.Repo != repo {
		return lmcode.NewHostError(fmt.Sprintf(
			"pr_submit: review file is for %s/%s but pr_submit was called with %s/%s",
			r.Owner, r.Repo, owner, repo))
	}
	return nil
}

// prReviewVerdict is the human-in-the-loop contract between pr_review_prepare
// and pr_review_submit: pr_review_prepare marshals it into a verdict TOML the
// operator edits, pr_review_submit unmarshals the edited file and drives
// `gh pr review` from it.
type prReviewVerdict struct {
	Owner  string `toml:"owner"`
	Repo   string `toml:"repo"`
	Number int64  `toml:"number"`
	Event  string `toml:"event"`
	Body   string `toml:"body"`
}

// reviewVerdictHeader is prepended to every review verdict file so the
// operator knows the contract without reading docs.
const reviewVerdictHeader = `# lmgh PR review verdict file — human in the loop.
# Edit any field below (event: APPROVE, REQUEST_CHANGES, or COMMENT),
# then submit with: gh.pr_review_submit(owner, repo, number, <this file>)
# Nothing is sent until pr_review_submit runs; delete this file to abort.
`

// reviewVerdictPath names the review verdict file for a pull request in the current directory.
func reviewVerdictPath(owner, repo string, number int64) string {
	return filepath.Join(".", fmt.Sprintf("pr-review-verdict-%s-%s-%d.toml", owner, repo, number))
}

// reviewEventFlag validates a review event and body against gh pr review's
// rules and returns the corresponding CLI flag.
func reviewEventFlag(event, body string) (string, error) {
	var flag string
	switch event {
	case "APPROVE":
		flag = "--approve"
	case "REQUEST_CHANGES":
		flag = "--request-changes"
	case "COMMENT":
		flag = "--comment"
	default:
		return "", lmcode.NewHostError("invalid event '" + event + "': expected APPROVE, REQUEST_CHANGES or COMMENT")
	}
	if event != "APPROVE" && strings.TrimSpace(body) == "" {
		return "", lmcode.NewHostError("empty body for " + event + "; a non-empty body is required")
	}
	return flag, nil
}

// writeReviewVerdict marshals the review verdict file, refusing to clobber an
// existing one (or follow a symlink) via O_CREATE|O_EXCL so operator edits are
// never silently overwritten.
func writeReviewVerdict(r *prReviewVerdict) (string, error) {
	data, err := toml.Marshal(r)
	if err != nil {
		return "", lmcode.NewHostError("pr_review_prepare: cannot encode review file: " + err.Error())
	}
	path := reviewVerdictPath(r.Owner, r.Repo, r.Number)
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		if errors.Is(err, os.ErrExist) {
			return "", lmcode.NewHostError("pr_review_prepare: " + path + " already exists; review and pr_review_submit it, or delete it to abort")
		}
		return "", lmcode.NewHostError("pr_review_prepare: cannot write " + path + ": " + err.Error())
	}
	_, writeErr := f.Write(append([]byte(reviewVerdictHeader), data...))
	closeErr := f.Close()
	if writeErr != nil {
		_ = os.Remove(path)
		return "", lmcode.NewHostError("pr_review_prepare: cannot write " + path + ": " + writeErr.Error())
	}
	if closeErr != nil {
		_ = os.Remove(path)
		return "", lmcode.NewHostError("pr_review_prepare: cannot write " + path + ": " + closeErr.Error())
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		abs = path
	}
	return abs, nil
}

var reviewVerdictKeys = []string{"owner", "repo", "number", "event", "body"}

// readReviewVerdict parses an operator-edited review verdict file with strict
// decoding so typos, case-variant duplicate keys, invalid events and stale
// files are refused instead of misread.
func readReviewVerdict(path string) (*prReviewVerdict, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, lmcode.NewHostError("pr_review_submit: cannot read review file " + path + ": " + err.Error())
	}
	var raw map[string]any
	if err := toml.Unmarshal(data, &raw); err != nil {
		return nil, lmcode.NewHostError("pr_review_submit: invalid TOML in " + path + ": " + firstLine(err.Error()))
	}
	allowed := make(map[string]bool, len(reviewVerdictKeys))
	for _, k := range reviewVerdictKeys {
		allowed[k] = true
	}
	rawKeys := make([]string, 0, len(raw))
	for k := range raw {
		rawKeys = append(rawKeys, k)
	}
	sort.Strings(rawKeys)
	for _, k := range rawKeys {
		if !allowed[k] {
			return nil, lmcode.NewHostError("pr_review_submit: invalid TOML in " + path + ": unknown or non-canonical key '" + k + "'")
		}
	}
	for _, k := range reviewVerdictKeys {
		if _, ok := raw[k]; !ok {
			return nil, lmcode.NewHostError("pr_review_submit: invalid TOML in " + path + ": missing required key '" + k + "'")
		}
	}
	var r prReviewVerdict
	dec := toml.NewDecoder(strings.NewReader(string(data)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&r); err != nil {
		return nil, lmcode.NewHostError("pr_review_submit: invalid TOML in " + path + ": " + firstLine(err.Error()))
	}
	for _, id := range [][2]string{{"owner", r.Owner}, {"repo", r.Repo}} {
		if err := checkIdent(id[0], id[1]); err != nil {
			return nil, lmcode.NewHostError("pr_review_submit: " + path + ": " + err.Error())
		}
	}
	if r.Number < 1 {
		return nil, lmcode.NewHostError(fmt.Sprintf("pr_review_submit: %s: invalid pull request number %d", path, r.Number))
	}
	if _, err := reviewEventFlag(r.Event, r.Body); err != nil {
		return nil, lmcode.NewHostError("pr_review_submit: " + path + ": " + err.Error())
	}
	return &r, nil
}

// expectPR pins a parsed review verdict file to the pull request the script
// asked to submit against, catching stale or mismatched review files.
func (r *prReviewVerdict) expectPR(owner, repo string, number int64) error {
	if r.Owner != owner || r.Repo != repo || r.Number != number {
		return lmcode.NewHostError(fmt.Sprintf(
			"pr_review_submit: review file is for %s/%s#%d but pr_review_submit was called with %s/%s#%d",
			r.Owner, r.Repo, r.Number, owner, repo, number))
	}
	return nil
}
