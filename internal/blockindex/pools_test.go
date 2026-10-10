package blockindex

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/Primexz/nodarium/internal/explorer"
	"github.com/Primexz/nodarium/internal/miningpool"
	"github.com/Primexz/nodarium/internal/storage"
)

func TestPoolTrendsCoverageAndDetails(t *testing.T) {
	fake := newRPC(5)
	s := testService(t, fake, nil)
	now := time.Unix(1_800_001_234, 0)
	start := now.Add(-24 * time.Hour).Unix()
	poolJSON, _ := json.Marshal(miningpool.Pool{ID: 1, Name: "Pool one", Link: "https://example.com"})
	rows := []storage.IndexedBlock{
		{Height: 0, Time: start - 1, PoolStatus: "identified", PoolJSON: string(poolJSON)},
		{Height: 1, Time: start, PoolStatus: "identified", PoolJSON: string(poolJSON), TransactionCount: new(int64(1)), WeightUnits: new(int64(2_000_000)), TotalFeesSats: new(int64(0))},
		{Height: 2, Time: start + 600, PoolStatus: "identified", PoolJSON: string(poolJSON), WeightUnits: new(int64(4_000_000))},
		{Height: 3, Time: start + 1200, PoolStatus: "unknown", TransactionCount: new(int64(2))},
		{Height: 4, Time: start + 1800, PoolStatus: "unavailable"},
		{Height: 5, Time: now.Unix() + 1, PoolStatus: "identified", PoolJSON: string(poolJSON)},
	}
	for i := range rows {
		rows[i].Network, rows[i].Hash = s.network, fake.active[i]
	}
	state := s.state
	state.TipHash, state.TipHeight = fake.active[5], 5
	if err := s.db.CommitBlockIndex(t.Context(), state, rows, nil); err != nil {
		t.Fatal(err)
	}
	before := len(fake.calls)
	trend, err := s.PoolTrends(t.Context(), "24h", now)
	if err != nil {
		t.Fatal(err)
	}
	if trend.Blocks != 4 || trend.Attributed != 2 || trend.Classified != 3 || !trend.Partial || trend.Start != start*1000 {
		t.Fatalf("wrong coverage or exact boundary: %+v", trend)
	}
	pool := trend.Pools[0]
	if pool.Pool == nil || pool.Pool.ID != 1 || pool.Blocks != 2 || *pool.Share != 50 || pool.TransactionBlocks != 1 || *pool.EmptyPercent != 100 || *pool.Capacity != 75 || pool.FeeBlocks != 1 || *pool.FeesBTC != 0 {
		t.Fatalf("missing metrics counted as zero or wrong denominators: %+v", pool)
	}
	var counted int64
	for _, point := range trend.Points {
		var sum int64
		for _, count := range point.Counts {
			sum += count
		}
		if sum != point.Blocks {
			t.Fatalf("bucket denominator mismatch: %+v", point)
		}
		counted += point.Blocks
	}
	if counted != 4 || len(trend.Points) > 366 {
		t.Fatal("unbounded points or lost blocks")
	}
	detail, err := s.PoolDetail(t.Context(), 1, "24h", now)
	if err != nil || detail.Pool.ID != 1 || len(detail.Recent) != 4 || detail.Recent[0].Height != 5 || detail.Recent[3].Height != 0 {
		t.Fatalf("all-history recent blocks or detail: %+v %v", detail, err)
	}
	if len(fake.calls) != before {
		t.Fatal("pool views called Core")
	}
	for _, period := range []string{"7d", "30d", "1y", "all"} {
		history, err := s.PoolTrends(t.Context(), period, now)
		if err != nil || len(history.Points) > 366 {
			t.Fatalf("range %s: %v", period, err)
		}
	}
	for _, id := range []int{0, -1, 9999} {
		_, err := s.PoolDetail(t.Context(), id, "24h", now)
		expected := explorer.ErrInvalid
		if id > 0 {
			expected = explorer.ErrNotFound
		}
		if !errors.Is(err, expected) {
			t.Fatalf("pool %d: %v", id, err)
		}
	}
	if _, err := s.PoolTrends(t.Context(), "bogus", now); !errors.Is(err, explorer.ErrInvalid) {
		t.Fatal("invalid range accepted")
	}
	// A replacement must disappear from both trend totals and recent pool blocks.
	fork := int64(1)
	replacement := storage.IndexedBlock{Network: s.network, Hash: hash(100), Height: 2, Time: start + 600, PoolStatus: "unknown"}
	state.TipHeight, state.TipHash = 2, replacement.Hash
	if err := s.db.CommitBlockIndex(t.Context(), state, []storage.IndexedBlock{replacement}, &fork); err != nil {
		t.Fatal(err)
	}
	chain := fake.chain()
	chain.Blocks, chain.Headers, chain.BestBlockHash = 2, 2, replacement.Hash
	s.Observe(&chain)
	detail, err = s.PoolDetail(t.Context(), 1, "24h", now)
	if err != nil || detail.History.Blocks != 2 || detail.History.Attributed != 1 || len(detail.Recent) != 2 {
		t.Fatalf("reorg retained orphan statistics: %+v %v", detail, err)
	}
}

func TestPoolTrendsAvailability(t *testing.T) {
	fake := newRPC(3)
	s := testService(t, fake, nil)
	history, err := s.PoolTrends(t.Context(), "all", time.Now())
	if err != nil || !history.Partial || history.Blocks != 0 {
		t.Fatalf("empty index: %+v %v", history, err)
	}
	chain := fake.chain()
	chain.Chain = "regtest"
	s.Observe(&chain)
	s.mu.Lock()
	s.network = fake.active[0]
	s.mu.Unlock()
	history, err = s.PoolTrends(t.Context(), "24h", time.Now())
	if err != nil || history.Status != "unsupported" || len(history.Points) != 0 {
		t.Fatalf("unsupported: %+v %v", history, err)
	}
	chain.Chain = "main"
	s.Observe(&chain)
	s.mu.Lock()
	s.network = fake.active[0]
	s.observed = time.Time{}
	s.mu.Unlock()
	history, err = s.PoolTrends(t.Context(), "24h", time.Now())
	if err != nil || !history.Stale {
		t.Fatalf("offline: %+v %v", history, err)
	}
}
