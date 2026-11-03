package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestRetiredBuilderFlagsRefusedBeforeInput(t *testing.T) {
	dir := t.TempDir()
	first, second := filepath.Join(dir, "first.bin"), filepath.Join(dir, "second.bin")
	manifest := filepath.Join(dir, "invocation.json")
	for _, flag := range []string{"--first", "--last"} {
		for _, args := range [][]string{{flag, first}, {flag, first, "--lmcode", second}, {"--lmcode", first, flag, second}} {
			parts := []map[string]any{{"index": 0, "file": first}}
			mode := "single"
			if len(args) > 2 {
				mode = "builder"
				parts = append(parts, map[string]any{"index": 1, "file": second})
			}
			raw, err := json.Marshal(map[string]any{"version": 1, "mode": mode, "dry": false, "parts": parts})
			if err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(manifest, raw, 0600); err != nil {
				t.Fatal(err)
			}
			t.Setenv("LMCODE_INVOCATION_FILE", manifest)
			if got := run(args); got != 2 {
				t.Errorf("retired invocation %v returned %d, want CLI exit 2 before opening input", args, got)
			}
		}
	}
}
