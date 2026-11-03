package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fakeGH(t *testing.T, body string) *Host {
	t.Helper()
	path, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("LMGH_GH", path)
	t.Setenv("LMGH_FIXTURE_MODE", body)
	return NewHost()
}

// Re-exec the already-built native test binary instead of a POSIX shell script.
func TestMain(m *testing.M) {
	if mode := os.Getenv("LMGH_FIXTURE_MODE"); mode != "" {
		if len(os.Args) == 2 && os.Args[1] == "--version" {
			os.Stdout.WriteString("gh version 2.103.3\n")
			os.Exit(0)
		}
		switch mode {
		case "argv", "append":
			flags := os.O_CREATE | os.O_WRONLY | os.O_TRUNC
			if mode == "append" {
				flags = os.O_CREATE | os.O_WRONLY | os.O_APPEND
			}
			f, err := os.OpenFile(os.Getenv("LMGH_ARGV_LOG"), flags, 0600)
			if err != nil {
				panic(err)
			}
			f.WriteString(strings.Join(os.Args[1:], " ") + "\n")
			f.Close()
			if mode == "argv" {
				os.Stdout.WriteString("failed\nlog\n")
			} else {
				os.Stdout.WriteString("done\n")
			}
		case "large":
			os.Stdout.Write(make([]byte, 2097152))
		case "empty":
		case "error":
			os.Stderr.Write(make([]byte, 100000))
			os.Exit(1)
		case "ignored":
			os.Stdout.WriteString("ignored")
		default:
			panic("unknown fixture mode")
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func TestRunFailedLogUsesExactArgvAndReturnsOutput(t *testing.T) {
	log := filepath.Join(t.TempDir(), "argv")
	t.Setenv("LMGH_ARGV_LOG", log)
	h := fakeGH(t, "argv")
	out, err := h.runGhFailedLog("octo", "demo", 1001)
	if err != nil {
		t.Fatal(err)
	}
	if out != "failed\nlog\n" {
		t.Fatalf("output %q", out)
	}
	argv, err := os.ReadFile(log)
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(argv)) != "run view 1001 -R octo/demo --log-failed" {
		t.Fatalf("argv %q", argv)
	}
}

func TestRunFailedLogValidatesInputs(t *testing.T) {
	h := fakeGH(t, "ignored")
	for _, tc := range []struct {
		owner, repo string
		id          int64
	}{{"octo/demo", "demo", 1}, {"octo", "demo/x", 1}, {"octo", "demo", 0}} {
		if _, err := h.runGhFailedLog(tc.owner, tc.repo, tc.id); err == nil {
			t.Fatalf("expected validation error for %+v", tc)
		}
	}
}

func TestRunFailedLogPreservesLargeStdout(t *testing.T) {
	h := fakeGH(t, "large")
	out, err := h.runGhFailedLog("octo", "demo", 1)
	if err != nil || len(out) != 2097152 {
		t.Fatalf("want full output, got %d bytes, %v", len(out), err)
	}
}

func TestRunFailedLogRejectsEmptySuccess(t *testing.T) {
	h := fakeGH(t, "empty")
	if _, err := h.runGhFailedLog("octo", "demo", 1); err == nil || !strings.Contains(err.Error(), "no failed-job logs") {
		t.Fatalf("want honest empty-log error, got %v", err)
	}
}

func TestRunFailedLogPreservesFailureDiagnostic(t *testing.T) {
	h := fakeGH(t, "error")
	_, err := h.runGhFailedLog("octo", "demo", 1)
	if err == nil || len(err.Error()) < 100000 {
		t.Fatalf("complete stderr error, got %v", err)
	}
}
