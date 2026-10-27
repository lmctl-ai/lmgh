package main

import (
	"fmt"
	"os"
	"path/filepath"
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
