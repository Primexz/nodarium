package storage

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestActivityBackends(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			dsn := filepath.Join(t.TempDir(), "events.db")
			if driver == "postgres" {
				dsn = os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN not set")
				}
			}
			s, err := Open(t.Context(), driver, dsn)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			node := t.Name() + time.Now().Format("150405.000000000")
			at := time.Now().UnixMilli()
			prefix := fmt.Sprintf("%x", sha256.Sum256([]byte(node)))[:16]
			capPrefix := fmt.Sprintf("%x", sha256.Sum256([]byte(node+"cap")))[:16]
			for i := range 101 {
				event := ActivityEvent{ID: fmt.Sprintf("%s%016x", prefix, i), Node: node, At: at, Kind: "block", Height: new(int64(i))}
				for range 2 {
					if err := s.SaveActivity(t.Context(), event); err != nil {
						t.Fatal(err)
					}
				}
			}
			// Node isolation and category filters remain independent of cursors.
			s.SaveActivity(t.Context(), ActivityEvent{ID: node + "other", Node: "other-node", At: at, Kind: "reorg"})
			page, err := s.Activity(t.Context(), node, "", 0, "")
			if err != nil || len(page.Events) != 50 {
				t.Fatalf("first page %+v %v", page, err)
			}
			last := page.Events[49]
			second, err := s.Activity(t.Context(), node, "block", last.At, last.ID)
			if err != nil || len(second.Events) != 50 || second.Events[0].ID >= last.ID {
				t.Fatal("cursor ties not stable")
			}
			last = second.Events[49]
			third, err := s.Activity(t.Context(), node, "", last.At, last.ID)
			if err != nil || len(third.Events) != 1 {
				t.Fatal("deduplication or cursor boundary failed")
			}
			filtered, _ := s.Activity(t.Context(), node, "connection", 0, "")
			if len(filtered.Events) != 0 {
				t.Fatal("category leaked")
			}
			old := ActivityEvent{ID: node + "expired", Node: node, At: time.Now().AddDate(0, 0, -31).UnixMilli(), Kind: "block"}
			s.SaveActivity(t.Context(), old)
			if err := s.PruneActivity(t.Context()); err != nil {
				t.Fatal(err)
			}
			var count int64
			s.db.Model(&ActivityEvent{}).Where("id = ?", old.ID).Count(&count)
			if count != 0 {
				t.Fatal("expired event retained")
			}
			// Exercise the hard row cap with batched writes, including equal timestamps.
			rows := make([]ActivityEvent, 100005)
			for i := range rows {
				rows[i] = ActivityEvent{ID: fmt.Sprintf("%s%016x", capPrefix, i), Node: node + "cap", At: at, Kind: "block"}
			}
			if err := s.db.CreateInBatches(rows, 500).Error; err != nil {
				t.Fatal(err)
			}
			if err := s.PruneActivity(t.Context()); err != nil {
				t.Fatal(err)
			}
			s.db.Model(&ActivityEvent{}).Where("node = ?", node+"cap").Count(&count)
			if count != 100000 {
				t.Fatalf("row cap = %d", count)
			}
		})
	}
}
