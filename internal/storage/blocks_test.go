package storage

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPersistentBlockStorage(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			dsn := filepath.Join(t.TempDir(), "blocks.db")
			if driver == "postgres" {
				dsn = os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN not set")
				}
			}
			ctx := context.Background()
			s, err := Open(ctx, driver, dsn)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			network := fmt.Sprintf("block-test-%d", time.Now().UnixNano())
			state := BlockIndexState{Network: network, Chain: "main", TipHeight: 3, TipHash: "h3", NextHeight: -1, HeadHeight: -1}
			ptr := func(n int64) *int64 { return &n }
			rate := 10.0
			rows := []IndexedBlock{
				{Network: network, Hash: "h0", Height: 0, Time: 3600, MetadataStatus: "complete", StatisticsStatus: "complete", SubsidySats: ptr(1000), TotalFeesSats: ptr(100), AverageFeeRate: &rate, MedianFeeRate: &rate, WeightUnits: ptr(4_000_000), TotalOutputSats: ptr(9007199254740993)},
				{Network: network, Hash: "h1", Height: 1, Time: 3700, MetadataStatus: "complete", StatisticsStatus: "complete", SubsidySats: ptr(1000), TotalFeesSats: ptr(0), AverageFeeRate: &rate, WeightUnits: ptr(2_000_000)},
				{Network: network, Hash: "h2", Height: 2, Time: 7200, MetadataStatus: "pruned", StatisticsStatus: "pruned"},
				{Network: network, Hash: "h3", Height: 3, Time: 10800, MetadataStatus: "partial", StatisticsStatus: "partial"},
			}
			for i := 0; i < 2; i++ {
				if err := s.CommitBlockIndex(ctx, state, rows, nil); err != nil {
					t.Fatal(err)
				}
			}
			coverage, err := s.BlockCoverage(ctx, network)
			if err != nil || coverage.Headers != 4 || coverage.Statistics != 2 || coverage.Pruned != 1 {
				t.Fatalf("coverage %+v %v", coverage, err)
			}
			buckets, err := s.BlockEconomics(ctx, network, 0, 12000, 3600)
			if err != nil {
				t.Fatal(err)
			}
			if len(buckets) != 3 || buckets[0].Blocks != 2 || buckets[0].RewardBlocks != 2 || buckets[0].Fees != 100 || buckets[0].Subsidy != 2000 || buckets[0].Weight != 6_000_000 || buckets[0].MedianBlocks != 1 {
				t.Fatalf("bucket semantics %+v", buckets)
			}
			if buckets[1].RewardBlocks != 0 {
				t.Fatal("missing fees turned into observed zero")
			}
			if err := s.Prune(ctx, time.Now().AddDate(10, 0, 0)); err != nil {
				t.Fatal(err)
			}
			block, exists, err := s.IndexedBlock(ctx, network, "h0")
			if err != nil || !exists || *block.TotalOutputSats != 9007199254740993 {
				t.Fatalf("retention/precision %+v %v", block, err)
			}
			fork := int64(1)
			rows = []IndexedBlock{{Network: network, Hash: "replacement", Height: 2, Time: 7200}}
			state.TipHeight, state.TipHash = 2, "replacement"
			if err := s.CommitBlockIndex(ctx, state, rows, &fork); err != nil {
				t.Fatal(err)
			}
			page, err := s.BlockPage(ctx, network, 100, false, 50)
			if err != nil || len(page) != 3 || page[0].Hash != "replacement" {
				t.Fatalf("canonical query %+v %v", page, err)
			}
			if _, exists, _ := s.IndexedBlock(ctx, network, "h3"); !exists {
				t.Fatal("orphan metadata deleted")
			}
			// A rejected batch must roll back both suffix deletion and checkpoint.
			bad := IndexedBlock{Network: network, Hash: "invalid", Height: 100}
			if err := s.CommitBlockIndex(ctx, state, []IndexedBlock{bad}, &fork); err == nil {
				t.Fatal("accepted invalid batch")
			}
			active, _ := s.CanonicalHash(ctx, network, 2)
			if active != "replacement" {
				t.Fatal("failed transaction removed canonical block")
			}
		})
	}
}

func TestUpgradeVersionOneKeepsMonitoringHistory(t *testing.T) {
	ctx := context.Background()
	s, err := Open(ctx, "sqlite", filepath.Join(t.TempDir(), "old.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := s.Save(ctx, "existing", time.Now(), map[string]Measurement{"peers": {Value: 4, Weight: 10}}); err != nil {
		t.Fatal(err)
	}
	for _, model := range []any{&IndexedBlock{}, &CanonicalBlock{}, &BlockIndexState{}} {
		if err := s.db.Migrator().DropTable(model); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.db.Where("version = ?", 2).Delete(&migration{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if err := s.migrate(ctx); err != nil {
		t.Fatal(err)
	}
	history, err := s.History(ctx, "existing", "peers", "1h", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, point := range history.Points {
		if point.Value != nil && *point.Value == 4 {
			found = true
		}
	}
	if !found {
		t.Fatal("migration lost monitoring history")
	}
}
