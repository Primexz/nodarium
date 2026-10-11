package storage

import (
	"context"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSQLiteSizeIncludesJournalFiles(t *testing.T) {
	for _, uri := range []bool{false, true} {
		t.Run(map[bool]string{false: "path", true: "file URI"}[uri], func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "database with spaces.db")
			dsn := path
			if uri {
				dsn = (&url.URL{Scheme: "file", Path: path, RawQuery: "cache=private"}).String()
			}
			s, err := Open(t.Context(), "sqlite", dsn)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { s.Close() })
			if err := s.db.Exec("CREATE TABLE size_payload (data BLOB)").Error; err != nil {
				t.Fatal(err)
			}
			if err := s.db.Exec("INSERT INTO size_payload VALUES (zeroblob(131072))").Error; err != nil {
				t.Fatal(err)
			}
			check := func() {
				t.Helper()
				var expected int64
				for _, suffix := range []string{"", "-wal", "-shm"} {
					info, err := os.Stat(path + suffix)
					if err != nil {
						t.Fatal(err)
					}
					expected += info.Size()
				}
				actual, err := s.Size(t.Context())
				if err != nil || actual.SizeBytes != expected || actual.Driver != "sqlite" || actual.InMemory {
					t.Fatalf("unexpected size: %+v, expected %d, error %v", actual, expected, err)
				}
			}
			check()
			if err := s.db.Exec("PRAGMA wal_checkpoint(TRUNCATE)").Error; err != nil {
				t.Fatal(err)
			}
			check()
		})
	}
}

func TestSQLiteMemorySizeAndFailure(t *testing.T) {
	s, err := Open(t.Context(), "sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	size, err := s.Size(t.Context())
	if err != nil || !size.InMemory || size.SizeBytes <= 0 {
		t.Fatalf("in-memory size unavailable: %+v, %v", size, err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := s.Size(ctx); err == nil || err.Error() != "database size unavailable" {
		t.Fatalf("canceled reading was not unavailable: %v", err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Size(t.Context()); err == nil || strings.Contains(err.Error(), "memory") {
		t.Fatalf("closed database error was not sanitized: %v", err)
	}
}

func TestPostgresDatabaseSize(t *testing.T) {
	dsn := os.Getenv("TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN not set")
	}
	s, err := Open(t.Context(), "postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	size, err := s.Size(t.Context())
	if err != nil || size.Driver != "postgres" || size.InMemory || size.SizeBytes <= 0 {
		t.Fatalf("PostgreSQL size unavailable: %+v, %v", size, err)
	}
}
