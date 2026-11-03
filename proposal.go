package main

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/lmctl-ai/lmcode-go"
	"github.com/pelletier/go-toml/v2"
)

type prProposal struct {
	Owner     string   `json:"owner"`
	Repo      string   `json:"repo"`
	Title     string   `json:"title"`
	Body      string   `json:"body"`
	Base      string   `json:"base"`
	Head      string   `json:"head"`
	Draft     bool     `json:"draft"`
	Labels    []string `json:"labels"`
	Reviewers []string `json:"reviewers"`
}

func parsePRProposal(text string) (prProposal, error) {
	var root map[string]any
	p := prProposal{Labels: []string{}, Reviewers: []string{}}
	fail := func(message string) (prProposal, error) { return p, lmcode.NewHostError(message) }
	if err := toml.Unmarshal([]byte(text), &root); err != nil {
		return fail("pr: invalid TOML: " + err.Error())
	}
	if len(root) != 1 {
		return fail("pr: expected only the [pr] table")
	}
	fields, ok := root["pr"].(map[string]any)
	if !ok {
		return fail("pr: required table")
	}
	allowed := map[string]bool{"owner": true, "repo": true, "title": true, "body": true, "base": true, "head": true, "draft": true, "labels": true, "reviewers": true}
	keys := make([]string, 0, len(fields))
	for key := range fields {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if !allowed[key] {
			return fail("pr." + key + ": unknown field")
		}
	}
	for _, field := range []struct {
		name     string
		target   *string
		required bool
	}{
		{"title", &p.Title, true}, {"owner", &p.Owner, true}, {"repo", &p.Repo, true}, {"base", &p.Base, true}, {"head", &p.Head, true}, {"body", &p.Body, false},
	} {
		value, exists := fields[field.name]
		if !exists {
			if field.required {
				return fail("pr." + field.name + ": required")
			}
			continue
		}
		s, ok := value.(string)
		if !ok {
			return fail("pr." + field.name + ": expected string")
		}
		*field.target = s
		if field.required && strings.TrimSpace(s) == "" {
			return fail("pr." + field.name + ": required")
		}
	}
	if value, exists := fields["draft"]; exists {
		b, ok := value.(bool)
		if !ok {
			return fail("pr.draft: expected boolean")
		}
		p.Draft = b
	}
	for _, field := range []struct {
		name   string
		target *[]string
	}{{"labels", &p.Labels}, {"reviewers", &p.Reviewers}} {
		if value, exists := fields[field.name]; exists {
			items, ok := value.([]any)
			if !ok {
				return fail("pr." + field.name + ": expected string array")
			}
			for _, item := range items {
				s, ok := item.(string)
				if !ok || strings.TrimSpace(s) == "" {
					return fail("pr." + field.name + ": expected nonempty strings")
				}
				*field.target = append(*field.target, s)
			}
		}
	}
	for _, field := range []struct{ name, value string }{{"owner", p.Owner}, {"repo", p.Repo}, {"base", p.Base}, {"head", p.Head}} {
		if err := checkIdent(field.name, field.value); err != nil {
			return fail("pr." + field.name + ": " + err.Error())
		}
	}
	return p, nil
}

func proposalResult(p prProposal, submitted bool, url string) (lmcode.Value, error) {
	bytes, err := json.Marshal(map[string]any{"proposal": p, "submitted": submitted, "url": url})
	if err != nil {
		return lmcode.None(), err
	}
	value, err := lmcode.ParseJSON(string(bytes))
	return lmcode.Object("Json", value), err
}

func (h *Host) registerProposal() {
	preview := lmcode.Function(func(args []lmcode.Value) (lmcode.Value, error) {
		p, err := parsePRProposal(vstr(args[0]))
		if err != nil {
			return lmcode.None(), err
		}
		bytes, err := json.MarshalIndent(p, "", "  ")
		if err != nil {
			return lmcode.None(), err
		}
		fmt.Fprintln(os.Stdout, "PR proposal (validated; nothing sent):\n"+string(bytes))
		return proposalResult(p, false, "")
	})
	real := lmcode.Function(func(args []lmcode.Value) (lmcode.Value, error) {
		if h.dryRun {
			return preview(args)
		}
		p, err := parsePRProposal(vstr(args[0]))
		if err != nil {
			return lmcode.None(), err
		}
		argv := []string{"pr", "create", "-R", p.Owner + "/" + p.Repo, "--title", p.Title, "--body", p.Body, "--base", p.Base, "--head", p.Head}
		if p.Draft {
			argv = append(argv, "--draft")
		}
		for _, label := range p.Labels {
			argv = append(argv, "--label", label)
		}
		for _, reviewer := range p.Reviewers {
			argv = append(argv, "--reviewer", reviewer)
		}
		url, err := h.runGh(argv...)
		if err != nil {
			return lmcode.None(), err
		}
		if _, err := numberFromURL(strings.TrimSpace(url)); err != nil {
			return lmcode.None(), err
		}
		return proposalResult(p, true, strings.TrimSpace(url))
	})
	h.must(h.reg.Function("pr_create_toml", []string{"string"}, "Json", real, lmcode.Dry(preview)))
}
