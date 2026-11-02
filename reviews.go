package main

import (
	"bufio"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/lmctl-ai/lmcode-go"
)

// Review is the confirmation handle returned by pr_review_submit. summary()
// always carries the human-readable intent/echo string; url(), id() and
// state() are filled from the review GitHub actually recorded, and
// confirmed() reports whether that lookup succeeded. A failed lookup never
// turns a posted review into an error.
type Review struct {
	id        int64
	url       string
	state     string
	summary   string
	confirmed bool
}

type ghReviewRef struct {
	ID    int64  `json:"id"`
	URL   string `json:"html_url"`
	State string `json:"state"`
	Login string `json:"login"`
}

// myReviews lists the authenticated user's reviews on a pull request, oldest
// first, using one JSON object per line so --paginate output stays parseable.
func (h *Host) myReviews(owner, repo string, number int64) ([]ghReviewRef, error) {
	login, err := h.runGh("api", "user", "--jq", ".login")
	if err != nil {
		return nil, err
	}
	login = strings.TrimSpace(login)
	if login == "" {
		return nil, lmcode.NewHostError("empty login from gh api user")
	}
	out, err := h.runGh("api", "--paginate",
		"repos/"+owner+"/"+repo+"/pulls/"+strconv.FormatInt(number, 10)+"/reviews",
		"--jq", `.[] | {id, html_url, state, login: .user.login}`)
	if err != nil {
		return nil, err
	}
	var mine []ghReviewRef
	sc := bufio.NewScanner(strings.NewReader(out))
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var r ghReviewRef
		if err := json.Unmarshal([]byte(line), &r); err != nil {
			return nil, lmcode.NewHostError("gh returned invalid review JSON (" + err.Error() + ")")
		}
		if r.Login == login {
			mine = append(mine, r)
		}
	}
	if err := sc.Err(); err != nil {
		return nil, lmcode.NewHostError("cannot read review list: " + err.Error())
	}
	return mine, nil
}

// newestAfter returns the newest review whose id is greater than floor.
func newestAfter(reviews []ghReviewRef, floor int64) (ghReviewRef, bool) {
	var best ghReviewRef
	found := false
	for _, r := range reviews {
		if r.ID > floor && (!found || r.ID > best.ID) {
			best, found = r, true
		}
	}
	return best, found
}

func maxReviewID(reviews []ghReviewRef) int64 {
	var m int64
	for _, r := range reviews {
		if r.ID > m {
			m = r.ID
		}
	}
	return m
}

func (h *Host) registerReview() {
	reg := func(name, returns string, fn func(*Review) lmcode.Value) {
		h.must(h.reg.Method("Review", name, nil, returns, func(self any, _ []lmcode.Value) (lmcode.Value, error) {
			return fn(self.(*Review)), nil
		}))
	}
	reg("id", "int", func(v *Review) lmcode.Value { return lmcode.Integer(v.id) })
	reg("url", "string", func(v *Review) lmcode.Value { return lmcode.String(v.url) })
	reg("state", "string", func(v *Review) lmcode.Value { return lmcode.String(v.state) })
	reg("summary", "string", func(v *Review) lmcode.Value { return lmcode.String(v.summary) })
	reg("confirmed", "bool", func(v *Review) lmcode.Value { return lmcode.Boolean(v.confirmed) })
}
