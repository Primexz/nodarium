package storage

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPoolQueries(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			dsn := filepath.Join(t.TempDir(), "pools.db")
			if driver == "postgres" {
				dsn = os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN not set")
				}
			}
			db, err := Open(t.Context(), driver, dsn)
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			network := fmt.Sprintf("pools-%d", time.Now().UnixNano())
			state := BlockIndexState{Network: network, TipHeight: 3, TipHash: "3"}
			blocks := []IndexedBlock{
				{Network: network, Hash: "0", Height: 0, Time: 3600, PoolStatus: "identified", PoolJSON: `{"id":12,"name":"Old name"}`, TransactionCount: new(int64(1)), TotalFeesSats: new(int64(0)), WeightUnits: new(int64(2000000))},
				{Network: network, Hash: "1", Height: 1, Time: 3700, PoolStatus: "identified", PoolJSON: `{"id":12,"name":"New name"}`},
				{Network: network, Hash: "2", Height: 2, Time: 3800, PoolStatus: "unknown"},
				{Network: network, Hash: "3", Height: 3, Time: 3900, PoolStatus: "unavailable"},
			}
			if err := db.CommitBlockIndex(t.Context(), state, blocks, nil); err != nil {
				t.Fatal(err)
			}
			buckets, err := db.PoolBuckets(t.Context(), network, 3600, 3800, 3600)
			if err != nil || len(buckets) != 3 {
				t.Fatalf("grouping: %+v %v", buckets, err)
			}
			var total, tx, empty, fees int64
			for _, b := range buckets {
				total += b.Blocks
				tx += b.TransactionBlocks
				empty += b.EmptyBlocks
				fees += b.FeeBlocks
			}
			if total != 3 || tx != 1 || empty != 1 || fees != 1 {
				t.Fatalf("coverage: %d %d %d %d", total, tx, empty, fees)
			}
			page, err := db.PoolBlocks(t.Context(), network, 12, 3, 1)
			if err != nil || len(page) != 1 || page[0].Hash != "1" {
				t.Fatalf("stable ID: %+v %v", page, err)
			}
			page, err = db.PoolBlocks(t.Context(), network, 12, 0, 20)
			if err != nil || len(page) != 1 || page[0].Hash != "0" {
				t.Fatalf("keyset: %+v %v", page, err)
			}
			fork := int64(0)
			state.TipHeight, state.TipHash = 1, "replacement"
			if err := db.CommitBlockIndex(t.Context(), state, []IndexedBlock{{Network: network, Hash: "replacement", Height: 1, Time: 3700, PoolStatus: "unknown"}}, &fork); err != nil {
				t.Fatal(err)
			}
			page, err = db.PoolBlocks(t.Context(), network, 12, 3, 20)
			if err != nil || len(page) != 1 || page[0].Hash != "0" {
				t.Fatalf("canonical membership: %+v %v", page, err)
			}
			page, err = db.PoolBlocks(t.Context(), "other-network", 12, 3, 20)
			if err != nil || len(page) != 0 {
				t.Fatal("network leak")
			}
		})
	}
}
