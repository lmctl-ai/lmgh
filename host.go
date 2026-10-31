package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/lmctl-ai/lmcode-go"
)

const version = "0.2.2"

// ghVersionRe parses the first line of `gh --version`.
var ghVersionRe = regexp.MustCompile(`gh version (\d+)\.(\d+)\.(\d+)`)

// Host owns the lmcode registry, the arena of domain handles returned to
// scripts, and the execution policy for the gh subprocess.
type Host struct {
	reg *lmcode.Registry

	ghPath string
	ghSeen bool
	dryRun bool

	repos    []*Repo
	issues   []*Issue
	prs      []*Pr
	triages  []*Triage
	releases []*Release
	runs     []*Run
	strings  []*Strings
	report   *Report
}

// Report is the script-visible findings log (context "report").
type Report struct {
	entries []ReportEntry
}

// ReportEntry is one report line.
type ReportEntry struct {
	Kind    string `json:"kind"`
	Subject string `json:"subject"`
	Message string `json:"message"`
}

func (r *Report) add(kind, subject, message string) {
	r.entries = append(r.entries, ReportEntry{Kind: kind, Subject: subject, Message: message})
}

// NewHost builds the registry and registers every host callback.
func NewHost() *Host {
	h := &Host{report: &Report{}}
	h.reg = lmcode.NewRegistry()
	h.must(h.reg.Context("gh", "Gh"))
	h.must(h.reg.Context("report", "Report"))
	h.registerGh()
	h.registerRepo()
	h.registerRepoList()
	h.registerStrings()
	h.registerIssue()
	h.registerIssueList()
	h.registerPr()
	h.registerPrList()
	h.registerTriage()
	h.registerRelease()
	h.registerReleaseList()
	h.registerRun()
	h.registerRunList()
	h.registerReport()
	h.must(lmcode.RegisterTesting(h.reg, os.Stdout))
	return h
}

func (h *Host) must(err error) {
	if err != nil {
		panic(err)
	}
}

// ensureGh locates the gh binary once and checks its version. LMGH_GH
// overrides PATH lookup (testing and non-PATH installs).
func (h *Host) ensureGh() error {
	if h.ghSeen {
		return nil
	}
	path := os.Getenv("LMGH_GH")
	if path == "" {
		var err error
		path, err = exec.LookPath("gh")
		if err != nil {
			return lmcode.NewHostError("gh executable not found on PATH; install the GitHub CLI (>= 2.45.0, < 3.0.0) or set LMGH_GH")
		}
	} else if _, err := os.Stat(path); err != nil {
		return lmcode.NewHostError("LMGH_GH points to a missing gh executable: " + path)
	}
	out, err := exec.Command(path, "--version").Output()
	if err != nil {
		return lmcode.NewHostError("gh --version failed: " + err.Error())
	}
	m := ghVersionRe.FindStringSubmatch(string(out))
	if m == nil {
		return lmcode.NewHostError("gh --version output is not parseable: " + firstLine(string(out)))
	}
	major, _ := strconv.Atoi(m[1])
	minor, _ := strconv.Atoi(m[2])
	if major != 2 || minor < 45 {
		return lmcode.NewHostError(fmt.Sprintf("unsupported gh version %s.%s.%s: lmgh supports gh >= 2.45.0 < 3.0.0", m[1], m[2], m[3]))
	}
	h.ghPath = path
	h.ghSeen = true
	return nil
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}

// runGh runs one gh argv with prompts, color and pagers disabled.
func (h *Host) runGh(args ...string) (string, error) {
	if err := h.ensureGh(); err != nil {
		return "", err
	}
	cmd := exec.Command(h.ghPath, args...)
	cmd.Env = append(os.Environ(),
		"GH_PROMPT_DISABLED=1",
		"NO_COLOR=1",
		"GH_PAGER=cat",
		"PAGER=cat",
	)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		detail := strings.TrimSpace(stderr.String())
		if detail == "" {
			detail = err.Error()
		}
		lines := strings.Split(detail, "\n")
		if len(lines) > 3 {
			lines = lines[:3]
		}
		return "", lmcode.NewHostError("gh " + strings.Join(args, " ") + " failed: " + strings.Join(lines, " | "))
	}
	return stdout.String(), nil
}

const ghFailedLogStdoutLimit = 1 << 20
const ghFailedLogStderrLimit = 64 << 10

func (h *Host) runGhFailedLog(owner, repo string, runID int64) (string, error) {
	if err := checkIdent("owner", owner); err != nil {
		return "", err
	}
	if err := checkIdent("repo", repo); err != nil {
		return "", err
	}
	if runID < 1 {
		return "", lmcode.NewHostError("run_failed_log: run id must be positive")
	}
	if err := h.ensureGh(); err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, h.ghPath, "run", "view", strconv.FormatInt(runID, 10), "-R", owner+"/"+repo, "--log-failed")
	cmd.Env = append(os.Environ(), "GH_PROMPT_DISABLED=1", "NO_COLOR=1", "GH_PAGER=cat", "PAGER=cat")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &limitedBuffer{Buffer: &stdout, Limit: ghFailedLogStdoutLimit}
	cmd.Stderr = &limitedBuffer{Buffer: &stderr, Limit: ghFailedLogStderrLimit}
	err := cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		return "", lmcode.NewHostError("run_failed_log: gh timed out after 30s")
	}
	if err != nil {
		detail := strings.TrimSpace(stderr.String())
		if detail == "" {
			detail = err.Error()
		}
		if detail == "" {
			detail = "no diagnostic output"
		}
		return "", lmcode.NewHostError("run_failed_log: " + detail)
	}
	if stdout.Len() == 0 {
		return "", lmcode.NewHostError("run_failed_log: gh returned no failed-job logs")
	}
	return stdout.String(), nil
}

type limitedBuffer struct {
	Buffer    *bytes.Buffer
	Limit     int
	Truncated bool
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	remaining := b.Limit - b.Buffer.Len()
	if remaining <= 0 {
		b.Truncated = true
		return len(p), nil
	}
	if len(p) > remaining {
		b.Buffer.Write(p[:remaining])
		b.Truncated = true
		return len(p), nil
	}
	return b.Buffer.Write(p)
}

var _ io.Writer = (*limitedBuffer)(nil)

// runGhJSON runs gh and decodes its --json output into dest.
func runGhJSON[T any](h *Host, args []string, dest *T) error {
	out, err := h.runGh(args...)
	if err != nil {
		return err
	}
	if err := json.Unmarshal([]byte(out), dest); err != nil {
		return lmcode.NewHostError("gh returned invalid JSON (" + err.Error() + ")")
	}
	return nil
}

func checkState(state string) error {
	switch state {
	case "open", "closed", "all":
		return nil
	}
	return lmcode.NewHostError("invalid state '" + state + "': expected open, closed or all")
}

func checkLimit(limit int64) error {
	if limit < 1 || limit > 1000 {
		return lmcode.NewHostError(fmt.Sprintf("invalid limit %d: expected 1..1000", limit))
	}
	return nil
}

func checkHandleKind(kind string) error {
	switch kind {
	case "", "issue", "pr":
		return nil
	}
	return lmcode.NewHostError("invalid kind '" + kind + "': expected issue or pr")
}

func (h *Host) keepStrings(values []string) *Strings {
	s := Strings(values)
	h.strings = append(h.strings, &s)
	return &s
}

// vstr/vint/vbool unwrap VM arguments; the VM guarantees declared schema types.
func vstr(v lmcode.Value) string { s, _ := v.AsStr(); return s }
func vint(v lmcode.Value) int64  { n, _ := v.AsInt(); return n }
func vbool(v lmcode.Value) bool  { b, _ := v.AsBool(); return b }
