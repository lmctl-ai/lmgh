package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/lmctl-ai/lmcode-go"
)

// Gh context methods: the curated lmgh operation catalog. Each method maps to
// one or more gh argv calls with --json field lists pinned to current gh
// exports; results are normalized into the domain objects in types.go.

func (h *Host) registerGh() {
	method := func(name string, params []string, returns string, fn func(*Host, []lmcode.Value) (lmcode.Value, error)) {
		h.must(h.reg.Method("Gh", name, params, returns, func(self any, args []lmcode.Value) (lmcode.Value, error) {
			return fn(self.(*Host), args)
		}))
	}

	method("dry_run", []string{"bool"}, "Gh", func(h *Host, args []lmcode.Value) (lmcode.Value, error) {
		h.dryRun = vbool(args[0])
		return lmcode.Object("Gh", h), nil
	})
	method("is_dry_run", nil, "bool", func(h *Host, _ []lmcode.Value) (lmcode.Value, error) {
		return lmcode.Boolean(h.dryRun), nil
	})

	method("repo_view", []string{"string", "string"}, "Repo", func(h *Host, args []lmcode.Value) (lmcode.Value, error) {
		owner, repo := vstr(args[0]), vstr(args[1])
		var v ghRepoView
		err := runGhJSON(h, []string{"repo", "view", owner + "/" + repo, "--json",
			"name,nameWithOwner,description,url,homepageUrl,defaultBranchRef,stargazerCount,forkCount,isArchived,isPrivate,pushedAt,licenseInfo,repositoryTopics,issues"}, &v)
		if err != nil {
			return lmcode.None(), err
		}
		topics := make([]string, 0, len(v.RepositoryTopics))
		for _, t := range v.RepositoryTopics {
			topics = append(topics, t.Name)
		}
		license := ""
		if v.LicenseInfo != nil {
			license = v.LicenseInfo.SPDXID
		}
		branch := ""
		if v.DefaultBranchRef != nil {
			branch = v.DefaultBranchRef.Name
		}
		r := &Repo{
			name: v.Name, fullName: v.FullName, description: v.Description, url: v.URL,
			defaultBranch: branch, license: license, homepage: v.Homepage, pushedAt: v.PushedAt,
			stars: v.StargazerCount, forks: v.ForkCount, openIssues: v.OpenIssues.TotalCount,
			archived: v.IsArchived, private: v.IsPrivate, topics: topics,
		}
		h.repos = append(h.repos, r)
		return lmcode.Object("Repo", r), nil
	})

	method("issue_list", []string{"string", "string", "string", "int"}, "IssueList", func(h *Host, args []lmcode.Value) (lmcode.Value, error) {
		owner, repo, state := vstr(args[0]), vstr(args[1]), vstr(args[2])
		limit := vint(args[3])
		if err := checkState(state); err != nil {
			return lmcode.None(), err
		}
		if err := checkLimit(limit); err != nil {
			return lmcode.None(), err
		}
		var rows []ghIssue
		err := runGhJSON(h, []string{"issue", "list", "-R", owner + "/" + repo, "--state", state,
			"--limit", strconv.FormatInt(limit, 10), "--json", "number,title,state,author,url,labels,createdAt"}, &rows)
		if err != nil {
			return lmcode.None(), err
		}
		out := IssueList{}
		for _, v := range rows {
			out = append(out, &Issue{
				number: v.Number, title: v.Title, state: v.State, author: v.Author.Login,
				url: v.URL, created: v.CreatedAt,
				labels: labelNames(v.Labels),
			})
		}
		h.issues = append(h.issues, out...)
		return lmcode.Object("IssueList", &out), nil
	})

	method("issue_view", []string{"string", "string", "int"}, "Issue", func(h *Host, args []lmcode.Value) (lmcode.Value, error) {
		owner, repo := vstr(args[0]), vstr(args[1])
		number := vint(args[2])
		if number < 1 {
			return lmcode.None(), lmcode.NewHostError(fmt.Sprintf("invalid issue number %d", number))
		}
		v, err := h.issueByNumber(owner, repo, number)
		if err != nil {
			return lmcode.None(), err
		}
		return lmcode.Object("Issue", v), nil
	})

	method("issue_create", []string{"string", "string", "string", "string"}, "Issue", func(h *Host, args []lmcode.Value) (lmcode.Value, error) {
		owner, repo, title, body := vstr(args[0]), vstr(args[1]), vstr(args[2]), vstr(args[3])
		if title == "" {
			return lmcode.None(), lmcode.NewHostError("issue_create: title must not be empty")
		}
		if h.dryRun {
			h.report.add("dry-run", "issue_create", owner+"/"+repo+": "+title)
			v := &Issue{title: title, state: "dry-run", repoFull: owner + "/" + repo, body: body}
			h.issues = append(h.issues, v)
			return lmcode.Object("Issue", v), nil
		}
		url, err := h.runGh("issue", "create", "-R", owner+"/"+repo, "--title", title, "--body", body)
		if err != nil {
			return lmcode.None(), err
		}
		number, err := numberFromURL(strings.TrimSpace(url))
		if err != nil {
			return lmcode.None(), err
		}
		v, err := h.issueByNumber(owner, repo, number)
		if err != nil {
			return lmcode.None(), err
		}
		return lmcode.Object("Issue", v), nil
	})

	method("pr_list", []string{"string", "string", "string", "int"}, "PrList", func(h *Host, args []lmcode.Value) (lmcode.Value, error) {
		owner, repo, state := vstr(args[0]), vstr(args[1]), vstr(args[2])
		limit := vint(args[3])
		if err := checkState(state); err != nil {
			return lmcode.None(), err
		}
		if err := checkLimit(limit); err != nil {
			return lmcode.None(), err
		}
		var rows []ghPr
		err := runGhJSON(h, []string{"pr", "list", "-R", owner + "/" + repo, "--state", state,
			"--limit", strconv.FormatInt(limit, 10), "--json",
			"number,title,state,author,url,baseRefName,headRefName,isDraft,labels,createdAt,updatedAt"}, &rows)
		if err != nil {
			return lmcode.None(), err
		}
		out := PrList{}
		for _, v := range rows {
			out = append(out, &Pr{
				number: v.Number, title: v.Title, state: v.State, author: v.Author.Login,
				url: v.URL, base: v.BaseRefName, head: v.HeadRefName, created: v.CreatedAt,
				updated: v.UpdatedAt, draft: v.IsDraft, labels: labelNames(v.Labels),
			})
		}
		h.prs = append(h.prs, out...)
		return lmcode.Object("PrList", &out), nil
	})

	method("pr_view", []string{"string", "string", "int"}, "Pr", func(h *Host, args []lmcode.Value) (lmcode.Value, error) {
		owner, repo := vstr(args[0]), vstr(args[1])
		number := vint(args[2])
		if number < 1 {
			return lmcode.None(), lmcode.NewHostError(fmt.Sprintf("invalid pull request number %d", number))
		}
		v, err := h.prByNumber(owner, repo, number)
		if err != nil {
			return lmcode.None(), err
		}
		return lmcode.Object("Pr", v), nil
	})

	method("pr_triage", []string{"string", "string", "int"}, "Triage", func(h *Host, args []lmcode.Value) (lmcode.Value, error) {
		owner, repo := vstr(args[0]), vstr(args[1])
		number := vint(args[2])
		if number < 1 {
			return lmcode.None(), lmcode.NewHostError(fmt.Sprintf("invalid pull request number %d", number))
		}
		var v ghTriage
		err := runGhJSON(h, []string{"pr", "view", strconv.FormatInt(number, 10), "-R", owner + "/" + repo, "--json",
			"number,title,state,author,url,mergeable,statusCheckRollup,reviews,reviewDecision"}, &v)
		if err != nil {
			return lmcode.None(), err
		}
		t := &Triage{
			number: v.Number, title: v.Title, state: v.State, author: v.Author.Login,
			url: v.URL, mergeable: v.Mergeable, reviewDecision: v.ReviewDecision,
			checksTotal: int64(len(v.Rollup)),
		}
		for _, c := range v.Rollup {
			conclusion := c.Conclusion
			if conclusion == "" {
				conclusion = c.State
			}
			switch conclusion {
			case "SUCCESS", "NEUTRAL", "SKIPPED":
				t.checksPassed++
			case "FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR":
				t.checksFailing++
			}
		}
		for _, r := range v.Reviews {
			switch r.State {
			case "APPROVED":
				t.approved++
			case "CHANGES_REQUESTED":
				t.changesRequested++
			}
		}
		t.summary = fmt.Sprintf("checks %d/%d passing, %d approved, %d changes requested, review decision %s, mergeable %s",
			t.checksPassed, t.checksTotal, t.approved, t.changesRequested, t.reviewDecision, t.mergeable)
		h.triages = append(h.triages, t)
		return lmcode.Object("Triage", t), nil
	})

	method("pr_prepare", []string{"string", "string", "string", "string", "string", "string", "bool"}, "string", func(h *Host, args []lmcode.Value) (lmcode.Value, error) {
		owner, repo, title, base, head := vstr(args[0]), vstr(args[1]), vstr(args[2]), vstr(args[4]), vstr(args[5])
	body := vstr(args[3])
	draft := vbool(args[6])
	if title == "" {
		return lmcode.None(), lmcode.NewHostError("pr_prepare: title must not be empty")
	}
	for _, id := range [][2]string{{"owner", owner}, {"repo", repo}, {"base", base}, {"head", head}} {
		if err := checkIdent(id[0], id[1]); err != nil {
			return lmcode.None(), lmcode.NewHostError("pr_prepare: " + err.Error())
		}
	}
	path, err := writeReview(&prReview{Owner: owner, Repo: repo, Title: title, Base: base, Head: head, Draft: draft, Body: body})
	if err != nil {
		return lmcode.None(), err
	}
	return lmcode.String(path), nil
})

method("pr_submit", []string{"string", "string", "string"}, "Pr", func(h *Host, args []lmcode.Value) (lmcode.Value, error) {
	owner, repo, path := vstr(args[0]), vstr(args[1]), vstr(args[2])
	r, err := readReview(path)
	if err != nil {
		return lmcode.None(), err
	}
	if err := r.expectRepo(owner, repo); err != nil {
		return lmcode.None(), err
	}
	if h.dryRun {
		h.report.add("dry-run", "pr_submit", owner+"/"+repo+": "+r.Title+" ("+r.Head+" -> "+r.Base+")")
		p := &Pr{title: r.Title, state: "dry-run", url: owner + "/" + repo, base: r.Base, head: r.Head, draft: r.Draft}
		h.prs = append(h.prs, p)
		return lmcode.Object("Pr", p), nil
	}
	argv := []string{"pr", "create", "-R", owner + "/" + repo, "--title", r.Title, "--body", r.Body,
		"--base", r.Base, "--head", r.Head}
	if r.Draft {
		argv = append(argv, "--draft")
	}
	url, err := h.runGh(argv...)
	if err != nil {
		return lmcode.None(), err
	}
	number, err := numberFromURL(strings.TrimSpace(url))
	if err != nil {
		return lmcode.None(), err
	}
	v, err := h.prByNumber(owner, repo, number)
	if err != nil {
		return lmcode.None(), err
	}
	return lmcode.Object("Pr", v), nil
})

	method("pr_review_prepare", []string{"string", "string", "int", "string", "string"}, "string", func(h *Host, args []lmcode.Value) (lmcode.Value, error) {
		owner, repo := vstr(args[0]), vstr(args[1])
		number := vint(args[2])
		event, body := vstr(args[3]), vstr(args[4])
		for _, id := range [][2]string{{"owner", owner}, {"repo", repo}} {
			if err := checkIdent(id[0], id[1]); err != nil {
				return lmcode.None(), lmcode.NewHostError("pr_review_prepare: " + err.Error())
			}
		}
		if number < 1 {
			return lmcode.None(), lmcode.NewHostError(fmt.Sprintf("pr_review_prepare: invalid pull request number %d", number))
		}
		if _, err := reviewEventFlag(event, body); err != nil {
			return lmcode.None(), lmcode.NewHostError("pr_review_prepare: " + err.Error())
		}
		path, err := writeReviewVerdict(&prReviewVerdict{Owner: owner, Repo: repo, Number: number, Event: event, Body: body})
		if err != nil {
			return lmcode.None(), err
		}
		return lmcode.String(path), nil
	})

	method("pr_review_submit", []string{"string", "string", "int", "string"}, "string", func(h *Host, args []lmcode.Value) (lmcode.Value, error) {
		owner, repo := vstr(args[0]), vstr(args[1])
		number := vint(args[2])
		path := vstr(args[3])
		for _, id := range [][2]string{{"owner", owner}, {"repo", repo}} {
			if err := checkIdent(id[0], id[1]); err != nil {
				return lmcode.None(), lmcode.NewHostError("pr_review_submit: " + err.Error())
			}
		}
		if number < 1 {
			return lmcode.None(), lmcode.NewHostError(fmt.Sprintf("pr_review_submit: invalid pull request number %d", number))
		}
		r, err := readReviewVerdict(path)
		if err != nil {
			return lmcode.None(), err
		}
		if err := r.expectPR(owner, repo, number); err != nil {
			return lmcode.None(), err
		}
		flag, err := reviewEventFlag(r.Event, r.Body)
		if err != nil {
			return lmcode.None(), lmcode.NewHostError("pr_review_submit: " + err.Error())
		}
		numStr := strconv.FormatInt(number, 10)
		if h.dryRun {
			h.report.add("dry-run", "pr_review_submit", owner+"/"+repo+" #"+numStr+" ("+r.Event+")")
			return lmcode.String("dry-run: gh pr review " + numStr + " -R " + owner + "/" + repo + " " + flag), nil
		}
		tmp, err := os.CreateTemp("", "lmgh-review-body-*.md")
		if err != nil {
			return lmcode.None(), lmcode.NewHostError("pr_review_submit: cannot create temp body file: " + err.Error())
		}
		tmpPath := tmp.Name()
		defer os.Remove(tmpPath)
		if _, err := tmp.WriteString(r.Body); err != nil {
			_ = tmp.Close()
			return lmcode.None(), lmcode.NewHostError("pr_review_submit: cannot write temp body file: " + err.Error())
		}
		if err := tmp.Close(); err != nil {
			return lmcode.None(), lmcode.NewHostError("pr_review_submit: cannot close temp body file: " + err.Error())
		}
		argv := []string{"pr", "review", numStr, "-R", owner + "/" + repo, flag, "--body-file", tmpPath}
		out, err := h.runGh(argv...)
		if err != nil {
			return lmcode.None(), err
		}
		if s := strings.TrimSpace(out); s != "" {
			return lmcode.String(s), nil
		}
		return lmcode.String(fmt.Sprintf("%s %s/%s#%d", r.Event, owner, repo, number)), nil
	})

method("pr_merge", []string{"string", "string", "int", "string"}, "string", func(h *Host, args []lmcode.Value) (lmcode.Value, error) {
		owner, repo := vstr(args[0]), vstr(args[1])
		number := vint(args[2])
		kind := vstr(args[3])
		if number < 1 {
			return lmcode.None(), lmcode.NewHostError(fmt.Sprintf("invalid pull request number %d", number))
		}
		switch kind {
		case "merge", "squash", "rebase":
		default:
			return lmcode.None(), lmcode.NewHostError("invalid merge method '" + kind + "': expected merge, squash or rebase")
		}
		argv := []string{"pr", "merge", strconv.FormatInt(number, 10), "-R", owner + "/" + repo, "--" + kind}
		if h.dryRun {
			h.report.add("dry-run", "pr_merge", owner+"/"+repo+" #"+strconv.FormatInt(number, 10)+" ("+kind+")")
			return lmcode.String("dry-run: gh " + strings.Join(argv, " ")), nil
		}
		out, err := h.runGh(argv...)
		if err != nil {
			return lmcode.None(), err
		}
		return lmcode.String(strings.TrimSpace(out)), nil
	})

	method("release_list", []string{"string", "string", "int"}, "ReleaseList", func(h *Host, args []lmcode.Value) (lmcode.Value, error) {
		owner, repo := vstr(args[0]), vstr(args[1])
		limit := vint(args[2])
		if err := checkLimit(limit); err != nil {
			return lmcode.None(), err
		}
		var rows []ghRelease
		err := runGhJSON(h, []string{"release", "list", "-R", owner + "/" + repo,
			"--limit", strconv.FormatInt(limit, 10), "--json", "tagName,name,url,publishedAt,isDraft,isPrerelease"}, &rows)
		if err != nil {
			return lmcode.None(), err
		}
		out := ReleaseList{}
		for _, v := range rows {
			out = append(out, &Release{
				tag: v.TagName, name: v.Name, url: v.URL, published: v.PublishedAt,
				draft: v.IsDraft, prerelease: v.IsPrerelease,
			})
		}
		h.releases = append(h.releases, out...)
		return lmcode.Object("ReleaseList", &out), nil
	})

	method("run_list", []string{"string", "string", "int"}, "RunList", func(h *Host, args []lmcode.Value) (lmcode.Value, error) {
		owner, repo := vstr(args[0]), vstr(args[1])
		limit := vint(args[2])
		if err := checkLimit(limit); err != nil {
			return lmcode.None(), err
		}
		var rows []ghRun
		err := runGhJSON(h, []string{"run", "list", "-R", owner + "/" + repo,
			"--limit", strconv.FormatInt(limit, 10), "--json",
			"name,displayTitle,status,conclusion,url,headBranch,event,createdAt,updatedAt"}, &rows)
		if err != nil {
			return lmcode.None(), err
		}
		out := RunList{}
		for _, v := range rows {
			out = append(out, &Run{
				name: v.Name, displayTitle: v.DisplayTitle, status: v.Status, conclusion: v.Conclusion,
				url: v.URL, branch: v.HeadBranch, event: v.Event, created: v.CreatedAt, updated: v.UpdatedAt,
			})
		}
		h.runs = append(h.runs, out...)
		return lmcode.Object("RunList", &out), nil
	})

	method("search_repos", []string{"string", "int"}, "RepoList", func(h *Host, args []lmcode.Value) (lmcode.Value, error) {
		query := vstr(args[0])
		limit := vint(args[1])
		if query == "" {
			return lmcode.None(), lmcode.NewHostError("search_repos: query must not be empty")
		}
		if err := checkLimit(limit); err != nil {
			return lmcode.None(), err
		}
		var rows []ghSearchRepo
		err := runGhJSON(h, []string{"search", "repos", query,
			"--limit", strconv.FormatInt(limit, 10), "--json",
			"fullName,description,stargazersCount,forksCount,url,updatedAt,isArchived,isPrivate"}, &rows)
		if err != nil {
			return lmcode.None(), err
		}
		out := RepoList{}
		for _, v := range rows {
			name := v.FullName
			if i := strings.LastIndexByte(name, '/'); i >= 0 {
				name = name[i+1:]
			}
			out = append(out, &Repo{
				name: name, fullName: v.FullName, description: v.Description, url: v.URL,
				pushedAt: v.UpdatedAt, stars: v.StargazersCount, forks: v.ForksCount,
				archived: v.IsArchived, private: v.IsPrivate,
			})
		}
		h.repos = append(h.repos, out...)
		return lmcode.Object("RepoList", &out), nil
	})

	method("search_issues", []string{"string", "int"}, "IssueList", func(h *Host, args []lmcode.Value) (lmcode.Value, error) {
		query := vstr(args[0])
		limit := vint(args[1])
		if query == "" {
			return lmcode.None(), lmcode.NewHostError("search_issues: query must not be empty")
		}
		if err := checkLimit(limit); err != nil {
			return lmcode.None(), err
		}
		var rows []ghSearchIssue
		err := runGhJSON(h, []string{"search", "issues", query,
			"--limit", strconv.FormatInt(limit, 10), "--json",
			"number,title,state,url,repository,labels,createdAt,commentsCount,author"}, &rows)
		if err != nil {
			return lmcode.None(), err
		}
		out := IssueList{}
		for _, v := range rows {
			out = append(out, &Issue{
				number: v.Number, title: v.Title, state: v.State, author: v.Author.Login,
				url: v.URL, repoFull: v.Repository.NameWithOwner, created: v.CreatedAt,
				comments: v.CommentsCount, labels: labelNames(v.Labels),
			})
		}
		h.issues = append(h.issues, out...)
		return lmcode.Object("IssueList", &out), nil
	})

	method("search_prs", []string{"string", "int"}, "PrList", func(h *Host, args []lmcode.Value) (lmcode.Value, error) {
		query := vstr(args[0])
		limit := vint(args[1])
		if query == "" {
			return lmcode.None(), lmcode.NewHostError("search_prs: query must not be empty")
		}
		if err := checkLimit(limit); err != nil {
			return lmcode.None(), err
		}
		var rows []ghPr
		err := runGhJSON(h, []string{"search", "prs", query,
			"--limit", strconv.FormatInt(limit, 10), "--json",
			"number,title,state,author,url,isDraft,labels,createdAt,updatedAt"}, &rows)
		if err != nil {
			return lmcode.None(), err
		}
		out := PrList{}
		for _, v := range rows {
			out = append(out, &Pr{
				number: v.Number, title: v.Title, state: v.State, author: v.Author.Login,
				url: v.URL, base: v.BaseRefName, head: v.HeadRefName, created: v.CreatedAt,
				updated: v.UpdatedAt, draft: v.IsDraft, labels: labelNames(v.Labels),
			})
		}
		h.prs = append(h.prs, out...)
		return lmcode.Object("PrList", &out), nil
	})

	method("file_text", []string{"string", "string", "string"}, "string", func(h *Host, args []lmcode.Value) (lmcode.Value, error) {
		owner, repo, path := vstr(args[0]), vstr(args[1]), vstr(args[2])
		if path == "" {
			return lmcode.None(), lmcode.NewHostError("file_text: path must not be empty")
		}
		out, err := h.runGh("api", "repos/"+owner+"/"+repo+"/contents/"+path,
			"-H", "Accept: application/vnd.github.raw")
		if err != nil {
			return lmcode.None(), err
		}
		return lmcode.String(out), nil
	})
}

// issueByNumber fetches one issue with body.
func (h *Host) issueByNumber(owner, repo string, number int64) (*Issue, error) {
	var v ghIssue
	err := runGhJSON(h, []string{"issue", "view", strconv.FormatInt(number, 10), "-R", owner + "/" + repo, "--json",
		"number,title,state,author,url,labels,comments,createdAt,body"}, &v)
	if err != nil {
		return nil, err
	}
	iss := &Issue{
		number: v.Number, title: v.Title, state: v.State, author: v.Author.Login,
		url: v.URL, repoFull: owner + "/" + repo, created: v.CreatedAt, body: v.Body,
		comments: int64(len(v.Comments)), labels: labelNames(v.Labels),
	}
	h.issues = append(h.issues, iss)
	return iss, nil
}

// prByNumber fetches one pull request with mergeable state.
func (h *Host) prByNumber(owner, repo string, number int64) (*Pr, error) {
	var v ghPr
	err := runGhJSON(h, []string{"pr", "view", strconv.FormatInt(number, 10), "-R", owner + "/" + repo, "--json",
		"number,title,state,author,url,baseRefName,headRefName,isDraft,labels,createdAt,updatedAt,mergeable"}, &v)
	if err != nil {
		return nil, err
	}
	p := &Pr{
		number: v.Number, title: v.Title, state: v.State, author: v.Author.Login,
		url: v.URL, base: v.BaseRefName, head: v.HeadRefName, created: v.CreatedAt,
		updated: v.UpdatedAt, mergeable: v.Mergeable, draft: v.IsDraft, labels: labelNames(v.Labels),
	}
	h.prs = append(h.prs, p)
	return p, nil
}

// numberFromURL extracts the trailing issue/PR number from a URL printed by gh.
func numberFromURL(url string) (int64, error) {
	i := strings.LastIndexByte(url, '/')
	if i < 0 || i == len(url)-1 {
		return 0, lmcode.NewHostError("cannot extract issue number from gh output: " + url)
	}
	n, err := strconv.ParseInt(url[i+1:], 10, 64)
	if err != nil {
		return 0, lmcode.NewHostError("cannot extract issue number from gh output: " + url)
	}
	return n, nil
}
