package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fakeGH(t *testing.T, body string) *Host {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "gh")
	script := "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'gh version 2.103.3'; exit 0; fi\n" + body + "\n"
	if err := os.WriteFile(path, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("LMGH_GH", path)
	return NewHost()
}

func TestRunFailedLogUsesExactArgvAndReturnsOutput(t *testing.T) {
	h := fakeGH(t, "printf 'failed\\nlog\\n'")
	out, err := h.runGhFailedLog("octo", "demo", 1001)
	if err != nil {
		t.Fatal(err)
	}
	if out != "failed\nlog\n" {
		t.Fatalf("output %q", out)
	}
}

func TestRunFailedLogValidatesInputs(t *testing.T) {
	h := fakeGH(t, "printf ignored")
	for _, tc := range []struct {
		owner, repo string
		id          int64
	}{{"octo/demo", "demo", 1}, {"octo", "demo/x", 1}, {"octo", "demo", 0}} {
		if _, err := h.runGhFailedLog(tc.owner, tc.repo, tc.id); err == nil {
			t.Fatalf("expected validation error for %+v", tc)
		}
	}
}

func TestRunFailedLogCapsStdout(t *testing.T) {
	h := fakeGH(t, "head -c 2097152 /dev/zero")
	out, err := h.runGhFailedLog("octo", "demo", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != ghFailedLogStdoutLimit {
		t.Fatalf("got %d bytes, want %d", len(out), ghFailedLogStdoutLimit)
	}
	if strings.Trim(out, "\x00") != "" {
		t.Fatal("output was not zero-filled")
	}
}

func TestRunFailedLogRejectsEmptySuccess(t *testing.T) {
	h := fakeGH(t, "exit 0")
	if _, err := h.runGhFailedLog("octo", "demo", 1); err == nil || !strings.Contains(err.Error(), "no failed-job logs") {
		t.Fatalf("want honest empty-log error, got %v", err)
	}
}
