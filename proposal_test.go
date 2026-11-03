package main

import (
	"github.com/lmctl-ai/lmcode-go"
	"strings"
	"testing"
)

const proposalFixture = `[pr]
owner = "octo"
repo = "demo"
title = "Preserve proposals"
body = "Exact body: quotes, Unicode 水, and ${literal}"
base = "main"
head = "proposal"
draft = true
labels = ["review", "docs"]
reviewers = ["octocat"]
`

func TestProposalDryValidates(t *testing.T) {
	h := NewHost()
	entry := h.reg.FunctionBySignature("fn pr_create_toml(string) -> Json")
	if entry == nil || entry.DryFn == nil {
		t.Fatal("proposal function needs an actual dry validator")
	}
	t.Setenv("LMGH_GH", "must-not-start")
	if _, err := entry.DryFn([]lmcode.Value{lmcode.String(proposalFixture)}); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ source, needle string }{
		{strings.Replace(proposalFixture, "title = \"Preserve proposals\"\n", "", 1), "pr.title: required"},
		{proposalFixture + "surprise = true\n", "pr.surprise: unknown field"},
		{strings.Replace(proposalFixture, "draft = true", "draft = \"yes\"", 1), "pr.draft: expected boolean"},
	} {
		for _, fn := range []lmcode.Function{entry.Fn, entry.DryFn} {
			if _, err := fn([]lmcode.Value{lmcode.String(tc.source)}); err == nil || !strings.Contains(err.Error(), tc.needle) {
				t.Fatalf("want %q, got %v", tc.needle, err)
			}
		}
	}
}
