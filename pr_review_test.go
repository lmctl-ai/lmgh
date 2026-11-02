package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCheckExactKeysRefusesCaseVariants(t *testing.T) {
	allowed := []string{"owner", "title"}
	for name, doc := range map[string]string{
		"duplicate case": "owner = 'o'\ntitle = 'a'\nTitle = 'b'\n",
		"only wrong":     "owner = 'o'\nTITLE = 'a'\n",
		"extra":          "owner = 'o'\nextra = 1\n",
		"table":          "owner = 'o'\n[extra]\nx = 1\n",
	} {
		err := checkExactKeys("op", "f.toml", []byte(doc), allowed, nil)
		if err == nil || !strings.Contains(err.Error(), "unknown or non-canonical key") {
			t.Fatalf("%s: want refusal, got %v", name, err)
		}
	}
	if err := checkExactKeys("op", "f.toml", []byte("owner = 'o'\ntitle = 'a'\n"), allowed, allowed); err != nil {
		t.Fatalf("canonical file refused: %v", err)
	}
	if err := checkExactKeys("op", "f.toml", []byte("owner = 'o'\n"), allowed, allowed); err == nil || !strings.Contains(err.Error(), "missing required key 'title'") {
		t.Fatalf("missing key not reported: %v", err)
	}
	if err := checkExactKeys("op", "f.toml", []byte("owner = "), allowed, nil); err == nil || !strings.Contains(err.Error(), "invalid TOML") {
		t.Fatalf("syntax error not reported: %v", err)
	}
}

func TestReadReviewIgnoresNoLaterSpellings(t *testing.T) {
	path := filepath.Join(t.TempDir(), "r.toml")
	doc := "owner = 'octo'\nrepo = 'demo'\ntitle = 'Original'\nTitle = 'Overridden'\nbase = 'main'\nhead = 'feat'\n"
	if err := os.WriteFile(path, []byte(doc), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readReview(path); err == nil || !strings.Contains(err.Error(), "'Title'") {
		t.Fatalf("want Title refused, got %v", err)
	}
}

func TestCreateExclusiveNeverClobbers(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "r.toml")
	if _, err := createExclusive("op", path, "sub", []byte("first")); err != nil {
		t.Fatal(err)
	}
	if _, err := createExclusive("op", path, "sub", []byte("second")); err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("want already-exists, got %v", err)
	}
	if b, _ := os.ReadFile(path); string(b) != "first" {
		t.Fatalf("file clobbered: %q", b)
	}
}

func TestNewestAfterPicksNewestNewReview(t *testing.T) {
	rs := []ghReviewRef{{ID: 100}, {ID: 205}, {ID: 201}}
	if got, ok := newestAfter(rs, 100); !ok || got.ID != 205 {
		t.Fatalf("got %+v %v", got, ok)
	}
	if _, ok := newestAfter(rs, 205); ok {
		t.Fatal("nothing newer than 205 expected")
	}
	if maxReviewID(rs) != 205 || maxReviewID(nil) != 0 {
		t.Fatal("maxReviewID")
	}
}
