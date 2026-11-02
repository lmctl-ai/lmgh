package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lmctl-ai/lmcode-go"
)

func callGh(t *testing.T, h *Host, name string, args ...lmcode.Value) (string, error) {
	t.Helper()
	m := h.reg.FindMethod("Gh", name)
	if m == nil {
		t.Fatalf("method %s not registered", name)
	}
	v, err := m.Fn(h, args)
	if err != nil {
		return "", err
	}
	s, _ := v.AsStr()
	return s, nil
}

func argvHost(t *testing.T) (*Host, string) {
	log := filepath.Join(t.TempDir(), "argv")
	t.Setenv("LMGH_ARGV_LOG", log)
	return fakeGH(t, "printf '%s\\n' \"$*\" >> \"$LMGH_ARGV_LOG\"; echo done"), log
}

func TestWritesBuildExactArgv(t *testing.T) {
	h, log := argvHost(t)
	S, I, B := lmcode.String, lmcode.Integer, lmcode.Boolean
	for _, c := range []struct {
		name string
		args []lmcode.Value
	}{
		{"issue_close", []lmcode.Value{S("o"), S("r"), I(3), S("not planned")}},
		{"pr_comment", []lmcode.Value{S("o"), S("r"), I(4), S("hi")}},
		{"label_add", []lmcode.Value{S("o"), S("r"), I(5), S("bug")}},
		{"release_create", []lmcode.Value{S("o"), S("r"), S("v1"), S("T"), S("N"), B(true), B(false)}},
	} {
		if _, err := callGh(t, h, c.name, c.args...); err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
	}
	got, _ := os.ReadFile(log)
	want := "issue close 3 -R o/r --reason not planned\n" +
		"pr comment 4 -R o/r --body hi\n" +
		"api --method POST repos/o/r/issues/5/labels -f labels[]=bug\n" +
		"release create v1 -R o/r --title T --notes N --draft\n"
	if string(got) != want {
		t.Fatalf("argv:\n%s\nwant:\n%s", got, want)
	}
}

func TestWritesDryRunNeverSpawnsGh(t *testing.T) {
	h, log := argvHost(t)
	h.dryRun = true
	out, err := callGh(t, h, "issue_close", lmcode.String("o"), lmcode.String("r"), lmcode.Integer(3), lmcode.String(""))
	if err != nil || !strings.HasPrefix(out, "dry-run: gh issue close 3") {
		t.Fatalf("out %q err %v", out, err)
	}
	if _, err := os.Stat(log); err == nil {
		t.Fatal("gh was spawned under dry-run")
	}
	if len(h.report.entries) != 1 || h.report.entries[0].Kind != "dry-run" {
		t.Fatalf("report %+v", h.report.entries)
	}
}

func TestWritesRefuseBadInput(t *testing.T) {
	h, log := argvHost(t)
	S, I := lmcode.String, lmcode.Integer
	bad := []struct {
		name string
		args []lmcode.Value
	}{
		{"issue_close", []lmcode.Value{S("o"), S("r"), I(0), S("")}},
		{"issue_close", []lmcode.Value{S("o"), S("r"), I(1), S("whatever")}},
		{"issue_close", []lmcode.Value{S("o/x"), S("r"), I(1), S("")}},
		{"pr_comment", []lmcode.Value{S("o"), S("r"), I(1), S("  ")}},
		{"label_add", []lmcode.Value{S("o"), S("r"), I(1), S("")}},
		{"release_create", []lmcode.Value{S("o"), S("r"), S("-x"), S("T"), S("N"), lmcode.Boolean(false), lmcode.Boolean(false)}},
	}
	for _, c := range bad {
		if _, err := callGh(t, h, c.name, c.args...); err == nil {
			t.Fatalf("%s %v: expected refusal", c.name, c.args)
		}
	}
	if _, err := os.Stat(log); err == nil {
		t.Fatal("gh was spawned for refused input")
	}
}
