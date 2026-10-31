package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/lmctl-ai/lmcode-go"
)

// Domain objects. Every pointer returned to the VM stays in the Host arena so
// a DSL handle stays valid for the process lifetime.

type Repo struct {
	name, fullName, description, url string
	defaultBranch, license, homepage string
	pushedAt                         string
	stars, forks, openIssues         int64
	archived, private                bool
	topics                           []string
}

type Issue struct {
	number, comments  int64
	title, state      string
	author, url       string
	repoFull, created string
	body              string
	labels            []string
}

type Pr struct {
	number                      int64
	title, state                string
	author, url                 string
	base, head                  string
	created, updated, mergeable string
	draft                       bool
	labels                      []string
}

type Triage struct {
	number                                        int64
	title, state, author, url, mergeable, summary string
	reviewDecision                                string
	checksTotal, checksPassed, checksFailing      int64
	approved, changesRequested                    int64
}

type Release struct {
	tag, name, url, published string
	draft, prerelease         bool
}

type Run struct {
	databaseID                             int64
	name, displayTitle, status, conclusion string
	url, branch, event                     string
	created, updated                       string
}

// Strings is a read-only string collection; the std StrList has no exported
// constructor, so the host exposes its own len()/at() list type.
type Strings []string

type RepoList []*Repo
type IssueList []*Issue
type PrList []*Pr
type ReleaseList []*Release
type RunList []*Run

// gh JSON decoders (field names are gh's --json export names).

type ghAuthor struct {
	Login string `json:"login"`
}

type ghLabel struct {
	Name string `json:"name"`
}

type ghRepoView struct {
	Name             string `json:"name"`
	FullName         string `json:"nameWithOwner"`
	Description      string `json:"description"`
	URL              string `json:"url"`
	Homepage         string `json:"homepageUrl"`
	DefaultBranchRef *struct {
		Name string `json:"name"`
	} `json:"defaultBranchRef"`
	StargazerCount int64  `json:"stargazerCount"`
	ForkCount      int64  `json:"forkCount"`
	IsArchived     bool   `json:"isArchived"`
	IsPrivate      bool   `json:"isPrivate"`
	PushedAt       string `json:"pushedAt"`
	LicenseInfo    *struct {
		SPDXID string `json:"spdxId"`
	} `json:"licenseInfo"`
	RepositoryTopics []struct {
		Name string `json:"name"`
	} `json:"repositoryTopics"`
	OpenIssues struct {
		TotalCount int64 `json:"totalCount"`
	} `json:"issues"`
}

type ghIssue struct {
	Number   int64     `json:"number"`
	Title    string    `json:"title"`
	State    string    `json:"state"`
	Author   ghAuthor  `json:"author"`
	URL      string    `json:"url"`
	Labels   []ghLabel `json:"labels"`
	Comments []struct {
		ID string `json:"id"`
	} `json:"comments"`
	CreatedAt string `json:"createdAt"`
	Body      string `json:"body"`
}

type ghPr struct {
	Number      int64     `json:"number"`
	Title       string    `json:"title"`
	State       string    `json:"state"`
	Author      ghAuthor  `json:"author"`
	URL         string    `json:"url"`
	BaseRefName string    `json:"baseRefName"`
	HeadRefName string    `json:"headRefName"`
	IsDraft     bool      `json:"isDraft"`
	Labels      []ghLabel `json:"labels"`
	CreatedAt   string    `json:"createdAt"`
	UpdatedAt   string    `json:"updatedAt"`
	Mergeable   string    `json:"mergeable"`
}

type ghTriageRollup struct {
	Conclusion string `json:"conclusion"`
	State      string `json:"state"`
}

type ghTriage struct {
	Number    int64            `json:"number"`
	Title     string           `json:"title"`
	State     string           `json:"state"`
	Author    ghAuthor         `json:"author"`
	URL       string           `json:"url"`
	Mergeable string           `json:"mergeable"`
	Rollup    []ghTriageRollup `json:"statusCheckRollup"`
	Reviews   []struct {
		State string `json:"state"`
	} `json:"reviews"`
	ReviewDecision string `json:"reviewDecision"`
}

type ghRelease struct {
	TagName      string `json:"tagName"`
	Name         string `json:"name"`
	URL          string `json:"url"`
	PublishedAt  string `json:"publishedAt"`
	IsDraft      bool   `json:"isDraft"`
	IsPrerelease bool   `json:"isPrerelease"`
}

type ghRun struct {
	DatabaseID   int64  `json:"databaseId"`
	Name         string `json:"name"`
	DisplayTitle string `json:"displayTitle"`
	Status       string `json:"status"`
	Conclusion   string `json:"conclusion"`
	URL          string `json:"url"`
	HeadBranch   string `json:"headBranch"`
	Event        string `json:"event"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
}

type ghSearchRepo struct {
	FullName        string `json:"fullName"`
	Description     string `json:"description"`
	StargazersCount int64  `json:"stargazersCount"`
	ForksCount      int64  `json:"forksCount"`
	URL             string `json:"url"`
	UpdatedAt       string `json:"updatedAt"`
	IsArchived      bool   `json:"isArchived"`
	IsPrivate       bool   `json:"isPrivate"`
}

type ghSearchIssue struct {
	Number     int64  `json:"number"`
	Title      string `json:"title"`
	State      string `json:"state"`
	URL        string `json:"url"`
	Repository struct {
		NameWithOwner string `json:"nameWithOwner"`
	} `json:"repository"`
	Labels        []ghLabel `json:"labels"`
	CreatedAt     string    `json:"createdAt"`
	CommentsCount int64     `json:"commentsCount"`
	Author        ghAuthor  `json:"author"`
}

func labelNames(labels []ghLabel) []string {
	out := make([]string, 0, len(labels))
	for _, l := range labels {
		out = append(out, l.Name)
	}
	return out
}

// listAt bounds-checks a list index and returns a normalized host error.
func listAt(kind string, index, length int64) error {
	if index < 0 || index >= length {
		return lmcode.NewHostError(fmt.Sprintf("%s index %d out of range (length %d)", kind, index, length))
	}
	return nil
}

func (h *Host) registerStrings() {
	h.must(h.reg.Method("Strings", "len", nil, "int", func(self any, _ []lmcode.Value) (lmcode.Value, error) {
		return lmcode.Integer(int64(len(*self.(*Strings)))), nil
	}))
	h.must(h.reg.Method("Strings", "at", []string{"int"}, "string", func(self any, args []lmcode.Value) (lmcode.Value, error) {
		s := *self.(*Strings)
		i := vint(args[0])
		if err := listAt("Strings", i, int64(len(s))); err != nil {
			return lmcode.None(), err
		}
		return lmcode.String(s[i]), nil
	}))
}

func (h *Host) registerRepo() {
	reg := func(name string, params []string, returns string, fn func(*Repo) (lmcode.Value, error)) {
		h.must(h.reg.Method("Repo", name, params, returns, func(self any, _ []lmcode.Value) (lmcode.Value, error) {
			return fn(self.(*Repo))
		}))
	}
	strField := func(f func(*Repo) string) func(*Repo) (lmcode.Value, error) {
		return func(r *Repo) (lmcode.Value, error) { return lmcode.String(f(r)), nil }
	}
	intField := func(f func(*Repo) int64) func(*Repo) (lmcode.Value, error) {
		return func(r *Repo) (lmcode.Value, error) { return lmcode.Integer(f(r)), nil }
	}
	boolField := func(f func(*Repo) bool) func(*Repo) (lmcode.Value, error) {
		return func(r *Repo) (lmcode.Value, error) { return lmcode.Boolean(f(r)), nil }
	}
	reg("name", nil, "string", strField(func(r *Repo) string { return r.name }))
	reg("full_name", nil, "string", strField(func(r *Repo) string { return r.fullName }))
	reg("description", nil, "string", strField(func(r *Repo) string { return r.description }))
	reg("url", nil, "string", strField(func(r *Repo) string { return r.url }))
	reg("default_branch", nil, "string", strField(func(r *Repo) string { return r.defaultBranch }))
	reg("license", nil, "string", strField(func(r *Repo) string { return r.license }))
	reg("homepage", nil, "string", strField(func(r *Repo) string { return r.homepage }))
	reg("pushed_at", nil, "string", strField(func(r *Repo) string { return r.pushedAt }))
	reg("stars", nil, "int", intField(func(r *Repo) int64 { return r.stars }))
	reg("forks", nil, "int", intField(func(r *Repo) int64 { return r.forks }))
	reg("open_issues", nil, "int", intField(func(r *Repo) int64 { return r.openIssues }))
	reg("is_archived", nil, "bool", boolField(func(r *Repo) bool { return r.archived }))
	reg("is_private", nil, "bool", boolField(func(r *Repo) bool { return r.private }))
	reg("topics", nil, "Strings", func(r *Repo) (lmcode.Value, error) {
		return lmcode.Object("Strings", h.keepStrings(r.topics)), nil
	})
}

func (h *Host) registerRepoList() {
	h.must(h.reg.Method("RepoList", "len", nil, "int", func(self any, _ []lmcode.Value) (lmcode.Value, error) {
		return lmcode.Integer(int64(len(*self.(*RepoList)))), nil
	}))
	h.must(h.reg.Method("RepoList", "at", []string{"int"}, "Repo", func(self any, args []lmcode.Value) (lmcode.Value, error) {
		l := *self.(*RepoList)
		i := vint(args[0])
		if err := listAt("RepoList", i, int64(len(l))); err != nil {
			return lmcode.None(), err
		}
		return lmcode.Object("Repo", l[i]), nil
	}))
}

func (h *Host) registerIssue() {
	reg := func(name string, params []string, returns string, fn func(*Issue) (lmcode.Value, error)) {
		h.must(h.reg.Method("Issue", name, params, returns, func(self any, _ []lmcode.Value) (lmcode.Value, error) {
			return fn(self.(*Issue))
		}))
	}
	strField := func(f func(*Issue) string) func(*Issue) (lmcode.Value, error) {
		return func(v *Issue) (lmcode.Value, error) { return lmcode.String(f(v)), nil }
	}
	reg("number", nil, "int", func(v *Issue) (lmcode.Value, error) { return lmcode.Integer(v.number), nil })
	reg("title", nil, "string", strField(func(v *Issue) string { return v.title }))
	reg("state", nil, "string", strField(func(v *Issue) string { return v.state }))
	reg("author", nil, "string", strField(func(v *Issue) string { return v.author }))
	reg("url", nil, "string", strField(func(v *Issue) string { return v.url }))
	reg("repo", nil, "string", strField(func(v *Issue) string { return v.repoFull }))
	reg("created_at", nil, "string", strField(func(v *Issue) string { return v.created }))
	reg("body", nil, "string", strField(func(v *Issue) string { return v.body }))
	reg("comments", nil, "int", func(v *Issue) (lmcode.Value, error) { return lmcode.Integer(v.comments), nil })
	reg("labels", nil, "Strings", func(v *Issue) (lmcode.Value, error) {
		return lmcode.Object("Strings", h.keepStrings(v.labels)), nil
	})
}

func (h *Host) registerIssueList() {
	h.must(h.reg.Method("IssueList", "len", nil, "int", func(self any, _ []lmcode.Value) (lmcode.Value, error) {
		return lmcode.Integer(int64(len(*self.(*IssueList)))), nil
	}))
	h.must(h.reg.Method("IssueList", "at", []string{"int"}, "Issue", func(self any, args []lmcode.Value) (lmcode.Value, error) {
		l := *self.(*IssueList)
		i := vint(args[0])
		if err := listAt("IssueList", i, int64(len(l))); err != nil {
			return lmcode.None(), err
		}
		return lmcode.Object("Issue", l[i]), nil
	}))
}

func (h *Host) registerPr() {
	reg := func(name string, params []string, returns string, fn func(*Pr) (lmcode.Value, error)) {
		h.must(h.reg.Method("Pr", name, params, returns, func(self any, _ []lmcode.Value) (lmcode.Value, error) {
			return fn(self.(*Pr))
		}))
	}
	strField := func(f func(*Pr) string) func(*Pr) (lmcode.Value, error) {
		return func(v *Pr) (lmcode.Value, error) { return lmcode.String(f(v)), nil }
	}
	reg("number", nil, "int", func(v *Pr) (lmcode.Value, error) { return lmcode.Integer(v.number), nil })
	reg("title", nil, "string", strField(func(v *Pr) string { return v.title }))
	reg("state", nil, "string", strField(func(v *Pr) string { return v.state }))
	reg("author", nil, "string", strField(func(v *Pr) string { return v.author }))
	reg("url", nil, "string", strField(func(v *Pr) string { return v.url }))
	reg("base", nil, "string", strField(func(v *Pr) string { return v.base }))
	reg("head", nil, "string", strField(func(v *Pr) string { return v.head }))
	reg("created_at", nil, "string", strField(func(v *Pr) string { return v.created }))
	reg("updated_at", nil, "string", strField(func(v *Pr) string { return v.updated }))
	reg("mergeable", nil, "string", strField(func(v *Pr) string { return v.mergeable }))
	reg("is_draft", nil, "bool", func(v *Pr) (lmcode.Value, error) { return lmcode.Boolean(v.draft), nil })
	reg("labels", nil, "Strings", func(v *Pr) (lmcode.Value, error) {
		return lmcode.Object("Strings", h.keepStrings(v.labels)), nil
	})
}

func (h *Host) registerPrList() {
	h.must(h.reg.Method("PrList", "len", nil, "int", func(self any, _ []lmcode.Value) (lmcode.Value, error) {
		return lmcode.Integer(int64(len(*self.(*PrList)))), nil
	}))
	h.must(h.reg.Method("PrList", "at", []string{"int"}, "Pr", func(self any, args []lmcode.Value) (lmcode.Value, error) {
		l := *self.(*PrList)
		i := vint(args[0])
		if err := listAt("PrList", i, int64(len(l))); err != nil {
			return lmcode.None(), err
		}
		return lmcode.Object("Pr", l[i]), nil
	}))
}

func (h *Host) registerTriage() {
	reg := func(name string, params []string, returns string, fn func(*Triage) (lmcode.Value, error)) {
		h.must(h.reg.Method("Triage", name, params, returns, func(self any, _ []lmcode.Value) (lmcode.Value, error) {
			return fn(self.(*Triage))
		}))
	}
	strField := func(f func(*Triage) string) func(*Triage) (lmcode.Value, error) {
		return func(v *Triage) (lmcode.Value, error) { return lmcode.String(f(v)), nil }
	}
	intField := func(f func(*Triage) int64) func(*Triage) (lmcode.Value, error) {
		return func(v *Triage) (lmcode.Value, error) { return lmcode.Integer(f(v)), nil }
	}
	reg("number", nil, "int", func(v *Triage) (lmcode.Value, error) { return lmcode.Integer(v.number), nil })
	reg("title", nil, "string", strField(func(v *Triage) string { return v.title }))
	reg("state", nil, "string", strField(func(v *Triage) string { return v.state }))
	reg("author", nil, "string", strField(func(v *Triage) string { return v.author }))
	reg("url", nil, "string", strField(func(v *Triage) string { return v.url }))
	reg("mergeable", nil, "string", strField(func(v *Triage) string { return v.mergeable }))
	reg("review_decision", nil, "string", strField(func(v *Triage) string { return v.reviewDecision }))
	reg("summary", nil, "string", strField(func(v *Triage) string { return v.summary }))
	reg("checks_total", nil, "int", intField(func(v *Triage) int64 { return v.checksTotal }))
	reg("checks_passed", nil, "int", intField(func(v *Triage) int64 { return v.checksPassed }))
	reg("checks_failing", nil, "int", intField(func(v *Triage) int64 { return v.checksFailing }))
	reg("approved", nil, "int", intField(func(v *Triage) int64 { return v.approved }))
	reg("changes_requested", nil, "int", intField(func(v *Triage) int64 { return v.changesRequested }))
	reg("ok", nil, "bool", func(v *Triage) (lmcode.Value, error) {
		return lmcode.Boolean(v.checksFailing == 0 && v.changesRequested == 0 && v.mergeable == "MERGEABLE"), nil
	})
}

func (h *Host) registerRelease() {
	reg := func(name string, params []string, returns string, fn func(*Release) (lmcode.Value, error)) {
		h.must(h.reg.Method("Release", name, params, returns, func(self any, _ []lmcode.Value) (lmcode.Value, error) {
			return fn(self.(*Release))
		}))
	}
	strField := func(f func(*Release) string) func(*Release) (lmcode.Value, error) {
		return func(v *Release) (lmcode.Value, error) { return lmcode.String(f(v)), nil }
	}
	reg("tag", nil, "string", strField(func(v *Release) string { return v.tag }))
	reg("name", nil, "string", strField(func(v *Release) string { return v.name }))
	reg("url", nil, "string", strField(func(v *Release) string { return v.url }))
	reg("published_at", nil, "string", strField(func(v *Release) string { return v.published }))
	reg("is_draft", nil, "bool", func(v *Release) (lmcode.Value, error) { return lmcode.Boolean(v.draft), nil })
	reg("is_prerelease", nil, "bool", func(v *Release) (lmcode.Value, error) { return lmcode.Boolean(v.prerelease), nil })
}

func (h *Host) registerReleaseList() {
	h.must(h.reg.Method("ReleaseList", "len", nil, "int", func(self any, _ []lmcode.Value) (lmcode.Value, error) {
		return lmcode.Integer(int64(len(*self.(*ReleaseList)))), nil
	}))
	h.must(h.reg.Method("ReleaseList", "at", []string{"int"}, "Release", func(self any, args []lmcode.Value) (lmcode.Value, error) {
		l := *self.(*ReleaseList)
		i := vint(args[0])
		if err := listAt("ReleaseList", i, int64(len(l))); err != nil {
			return lmcode.None(), err
		}
		return lmcode.Object("Release", l[i]), nil
	}))
}

func (h *Host) registerRun() {
	reg := func(name string, params []string, returns string, fn func(*Run) (lmcode.Value, error)) {
		h.must(h.reg.Method("Run", name, params, returns, func(self any, _ []lmcode.Value) (lmcode.Value, error) {
			return fn(self.(*Run))
		}))
	}
	strField := func(f func(*Run) string) func(*Run) (lmcode.Value, error) {
		return func(v *Run) (lmcode.Value, error) { return lmcode.String(f(v)), nil }
	}
	reg("name", nil, "string", strField(func(v *Run) string { return v.name }))
	reg("id", nil, "int", func(v *Run) (lmcode.Value, error) { return lmcode.Integer(v.databaseID), nil })
	reg("display_title", nil, "string", strField(func(v *Run) string { return v.displayTitle }))
	reg("status", nil, "string", strField(func(v *Run) string { return v.status }))
	reg("conclusion", nil, "string", strField(func(v *Run) string { return v.conclusion }))
	reg("url", nil, "string", strField(func(v *Run) string { return v.url }))
	reg("branch", nil, "string", strField(func(v *Run) string { return v.branch }))
	reg("event", nil, "string", strField(func(v *Run) string { return v.event }))
	reg("created_at", nil, "string", strField(func(v *Run) string { return v.created }))
	reg("updated_at", nil, "string", strField(func(v *Run) string { return v.updated }))
}

func (h *Host) registerRunList() {
	h.must(h.reg.Method("RunList", "len", nil, "int", func(self any, _ []lmcode.Value) (lmcode.Value, error) {
		return lmcode.Integer(int64(len(*self.(*RunList)))), nil
	}))
	h.must(h.reg.Method("RunList", "at", []string{"int"}, "Run", func(self any, args []lmcode.Value) (lmcode.Value, error) {
		l := *self.(*RunList)
		i := vint(args[0])
		if err := listAt("RunList", i, int64(len(l))); err != nil {
			return lmcode.None(), err
		}
		return lmcode.Object("Run", l[i]), nil
	}))
	h.must(h.reg.Method("RunList", "failing", nil, "RunList", func(self any, _ []lmcode.Value) (lmcode.Value, error) {
		l := *self.(*RunList)
		failing := RunList{}
		for _, r := range l {
			if r.conclusion == "failure" || r.conclusion == "timed_out" || r.conclusion == "action_required" || r.conclusion == "startup_failure" {
				failing = append(failing, r)
			}
		}
		h.runs = append(h.runs, failing...)
		return lmcode.Object("RunList", &failing), nil
	}))
}

func (h *Host) registerReport() {
	h.must(h.reg.Method("Report", "add", []string{"string", "string", "string"}, "void", func(self any, args []lmcode.Value) (lmcode.Value, error) {
		self.(*Report).add(vstr(args[0]), vstr(args[1]), vstr(args[2]))
		return lmcode.None(), nil
	}))
	h.must(h.reg.Method("Report", "len", nil, "int", func(self any, _ []lmcode.Value) (lmcode.Value, error) {
		return lmcode.Integer(int64(len(self.(*Report).entries))), nil
	}))
	h.must(h.reg.Method("Report", "write_text", []string{"string"}, "void", func(self any, args []lmcode.Value) (lmcode.Value, error) {
		r := self.(*Report)
		var b strings.Builder
		for _, e := range r.entries {
			b.WriteString(e.Kind + ": " + e.Subject + ": " + strings.ReplaceAll(e.Message, "\n", " ") + "\n")
		}
		if err := os.WriteFile(vstr(args[0]), []byte(b.String()), 0o644); err != nil {
			return lmcode.None(), lmcode.NewHostError("write_text failed: " + err.Error())
		}
		return lmcode.None(), nil
	}))
	h.must(h.reg.Method("Report", "write_json", []string{"string"}, "void", func(self any, args []lmcode.Value) (lmcode.Value, error) {
		r := self.(*Report)
		data, err := json.Marshal(r.entries)
		if err != nil {
			return lmcode.None(), lmcode.NewHostError("write_json failed: " + err.Error())
		}
		if err := os.WriteFile(vstr(args[0]), append(data, '\n'), 0o644); err != nil {
			return lmcode.None(), lmcode.NewHostError("write_json failed: " + err.Error())
		}
		return lmcode.None(), nil
	}))
	h.must(h.reg.Method("Report", "fail_if_any", nil, "void", func(self any, _ []lmcode.Value) (lmcode.Value, error) {
		r := self.(*Report)
		if len(r.entries) > 0 {
			return lmcode.None(), lmcode.NewError(lmcode.APP_FAIL, fmt.Sprintf("report has %d finding(s), expected none", len(r.entries)))
		}
		return lmcode.None(), nil
	}))
}
