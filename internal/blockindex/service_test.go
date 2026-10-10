package blockindex

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Primexz/nodarium/internal/explorer"
	"github.com/Primexz/nodarium/internal/miningpool"
	"github.com/Primexz/nodarium/internal/rpc"
	"github.com/Primexz/nodarium/internal/storage"
	"go.uber.org/zap"
)

type indexRPC struct {
	active         []string
	calls          map[string]int
	pruneHeight    int64
	failStats      bool
	failHeaders    bool
	switchOnCommit bool
}

func hash(height int64) string { return fmt.Sprintf("%064x", height+1) }

func newRPC(height int64) *indexRPC {
	f := &indexRPC{calls: map[string]int{}}
	for h := int64(0); h <= height; h++ {
		f.active = append(f.active, hash(h))
	}
	return f
}

func (f *indexRPC) chain() rpc.Blockchain {
	return rpc.Blockchain{Chain: "main", Blocks: int64(len(f.active) - 1), Headers: int64(len(f.active) - 1), BestBlockHash: f.active[len(f.active)-1], Pruned: f.pruneHeight > 0, PruneHeight: f.pruneHeight}
}

func (f *indexRPC) Call(_ context.Context, method string, params any, out any) error {
	f.calls[method]++
	p := params.([]any)
	var value any
	if method == "getblockhash" {
		value = f.active[p[0].(int64)]
	} else {
		id := p[0].(string)
		height := int64(-1)
		for i, h := range f.active {
			if h == id {
				height = int64(i)
				break
			}
		}
		if method == "getrawtransaction" {
			id = p[2].(string)
			for i, h := range f.active {
				if h == id {
					height = int64(i)
					break
				}
			}
		}
		if height < 0 {
			return errors.New("inactive block")
		}
		previous := ""
		if height > 0 {
			previous = f.active[height-1]
		}
		switch method {
		case "getblockheader":
			if f.failHeaders {
				return errors.New("node unavailable")
			}
			value = map[string]any{"hash": id, "height": height, "time": 1700000000 + height*600, "confirmations": int64(len(f.active)) - height, "previousblockhash": previous, "difficulty": 10, "version": 1, "bits": "1d00ffff"}
		case "getblock":
			if height < f.pruneHeight {
				return errors.New("pruned")
			}
			value = map[string]any{"hash": id, "height": height, "confirmations": int64(len(f.active)) - height, "size": 1000, "weight": 3000, "nTx": 2, "tx": []string{strings.Repeat("c", 64)}}
		case "getrawtransaction":
			value = map[string]any{"txid": p[0], "blockhash": id, "vin": []any{map[string]any{"coinbase": "032f50312f"}}, "vout": []any{map[string]any{"scriptPubKey": map[string]any{"address": "address1"}}}}
		case "getblockstats":
			if f.failStats {
				return errors.New("missing undo data")
			}
			value = map[string]any{"blockhash": id, "total_out": int64(9007199254740993), "txs": 2, "totalfee": 100, "subsidy": 5000, "avgfeerate": 3, "feerate_percentiles": []int{1, 2, 3, 4, 5}, "ins": 1, "outs": 2, "swtxs": 1, "utxo_increase": 1}
		default:
			return errors.New("unexpected RPC")
		}
	}
	raw, _ := json.Marshal(value)
	return json.Unmarshal(raw, out)
}

func testService(t *testing.T, fake *indexRPC, db *storage.Store) *Service {
	t.Helper()
	if db == nil {
		var err error
		db, err = storage.Open(context.Background(), "sqlite", filepath.Join(t.TempDir(), "blocks.db"))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = db.Close() })
	}
	registry, err := miningpool.Parse([]byte(`[{"id":1,"name":"Pool one","link":"https://example.com","tags":["/P1/"],"addresses":[]}]`))
	if err != nil {
		t.Fatal(err)
	}
	registry.Source.SHA256 = "first-revision"
	state, err := db.BlockState(context.Background(), fake.active[0])
	if err != nil {
		t.Fatal(err)
	}
	state.Chain = "main"
	service := &Service{client: fake, db: db, registry: registry, logger: zap.NewNop(), ctx: context.Background(), network: fake.active[0], state: state, wake: make(chan struct{}, 1)}
	chain := fake.chain()
	service.Observe(&chain)
	return service
}

func indexAll(t *testing.T, s *Service, fake *indexRPC) {
	t.Helper()
	for i := 0; i < 100; i++ {
		chain := fake.chain()
		s.Observe(&chain)
		if err := s.step(context.Background(), chain); err != nil {
			t.Fatal(err)
		}
		coverage, err := s.db.BlockCoverage(context.Background(), s.network)
		if err != nil {
			t.Fatal(err)
		}
		if coverage.Headers == int64(len(fake.active)) {
			return
		}
	}
	t.Fatal("index failed to finish")
}

func TestBackfillResumeAndLivePriority(t *testing.T) {
	fake := newRPC(39)
	s := testService(t, fake, nil)
	if err := s.step(context.Background(), fake.chain()); err != nil {
		t.Fatal(err)
	}
	coverage, _ := s.db.BlockCoverage(context.Background(), s.network)
	if coverage.Headers != 16 || *coverage.OldestHeight != 24 {
		t.Fatalf("first batch: %+v", coverage)
	}
	s = testService(t, fake, s.db)
	before := fake.calls["getblock"]
	fake.active = append(fake.active, hash(40))
	chain := fake.chain()
	s.Observe(&chain)
	if err := s.step(context.Background(), chain); err != nil {
		t.Fatal(err)
	}
	if fake.calls["getblock"]-before != 1 {
		t.Fatal("live block did not take priority over backfill")
	}
	indexAll(t, s, fake)
	latest, err := s.Latest(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(latest) != 10 || latest[0].Height != 40 || *latest[0].TotalTransactionAmountSats != "9007199254740993" {
		t.Fatalf("latest: %+v", latest)
	}
	before = fake.calls["getblock"]
	if err := s.step(context.Background(), fake.chain()); err != nil {
		t.Fatal(err)
	}
	if fake.calls["getblock"] != before {
		t.Fatal("completed blocks were fetched twice")
	}
	pools := s.Snapshot(&chain, false, 144)
	if pools.Status != "ready" || pools.Scanned != 41 || len(pools.Shares) != 1 || pools.Shares[0].Pool.ID != 1 {
		t.Fatalf("pool index: %+v", pools)
	}
}

func TestHistoryDuringFirstBatch(t *testing.T) {
	fake := newRPC(19)
	s := testService(t, fake, nil)
	s.batchDelay = 10 * time.Millisecond
	finished := make(chan error, 1)
	go func() { finished <- s.step(context.Background(), fake.chain()) }()

	// A connected node can serve the first history request before any batch
	// has committed. Empty progress must remain a valid response, not a 503.
	for i := 0; i < 10; i++ {
		page, err := s.History(context.Background(), "", nil, 50)
		if err != nil {
			t.Fatalf("history unavailable during initial indexing: %v", err)
		}
		if len(page.Blocks) == 0 && !page.Pending {
			t.Fatal("empty initial history did not indicate pending backfill")
		}
		time.Sleep(5 * time.Millisecond)
	}
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
	page, err := s.History(context.Background(), "", nil, 50)
	if err != nil || len(page.Blocks) != 16 {
		t.Fatalf("history after first commit: blocks=%d, err=%v", len(page.Blocks), err)
	}
}

func TestReorgInvalidatesHistoryAndEconomics(t *testing.T) {
	fake := newRPC(35)
	s := testService(t, fake, nil)
	indexAll(t, s, fake)
	page, err := s.History(context.Background(), "", nil, 10)
	if err != nil {
		t.Fatal(err)
	}
	old := fake.active[35]
	for i := 10; i < len(fake.active); i++ {
		fake.active[i] = hash(int64(i + 1000))
	}
	indexAll(t, s, fake)
	if _, err := s.History(context.Background(), page.Older, nil, 10); !errors.Is(err, ErrCursor) {
		t.Fatalf("old cursor: %v", err)
	}
	if _, _, err := s.Block(context.Background(), old); !errors.Is(err, explorer.ErrInactive) {
		t.Fatalf("orphan: %v", err)
	}
	coverage, _ := s.db.BlockCoverage(context.Background(), s.network)
	if coverage.Headers != 36 {
		t.Fatalf("reorg double counted: %+v", coverage)
	}
	economics, err := s.Economics(context.Background(), "all", time.Unix(1700100000, 0))
	if err != nil {
		t.Fatal(err)
	}
	var count int64
	for _, p := range economics.Points {
		count += p.Blocks
	}
	if count != 36 {
		t.Fatalf("economics counted orphaned rows: %d", count)
	}
}

func TestPrunedHeadersAndDefinitionUpdates(t *testing.T) {
	fake := newRPC(20)
	fake.pruneHeight = 10
	s := testService(t, fake, nil)
	indexAll(t, s, fake)
	coverage, _ := s.db.BlockCoverage(context.Background(), s.network)
	if coverage.Headers != 21 || coverage.Pruned != 10 || coverage.Statistics != 11 {
		t.Fatalf("pruned coverage: %+v", coverage)
	}
	if fake.calls["getblock"] != 11 {
		t.Fatal("tried to read pruned block bodies")
	}
	block, _, err := s.Block(context.Background(), fake.active[0])
	if err != nil || block.TotalFeesSats != nil {
		t.Fatalf("missing statistics fabricated: %+v %v", block, err)
	}
	registry, _ := miningpool.Parse([]byte(`[{"id":2,"name":"Updated pool","link":"https://example.com","tags":["/P1/"],"addresses":[]}]`))
	registry.Source.SHA256 = "second-revision"
	s.registry = registry
	before := fake.calls["getblock"]
	if err := s.reattribute(context.Background()); err != nil {
		t.Fatal(err)
	}
	_, pool, err := s.Block(context.Background(), fake.active[20])
	if err != nil || pool.Pool == nil || pool.Pool.ID != 2 {
		t.Fatalf("reattribution: %+v %v", pool, err)
	}
	if fake.calls["getblock"] != before {
		t.Fatal("definitions update fetched block bodies")
	}
}

func TestTransientStatisticsAndGenesis(t *testing.T) {
	fake := newRPC(5)
	fake.failStats = true
	s := testService(t, fake, nil)
	indexAll(t, s, fake)
	for _, id := range fake.active {
		row, _, _ := s.db.IndexedBlock(context.Background(), s.network, id)
		row.RetryAt = time.Now().Add(-time.Hour)
		if err := s.db.CommitBlockIndex(context.Background(), s.state, []storage.IndexedBlock{row}, nil); err != nil {
			t.Fatal(err)
		}
	}
	fake.failStats = false
	for i := 0; i < 5; i++ {
		s.retryAt = time.Time{}
		if err := s.retry(context.Background(), fake.chain()); err != nil {
			t.Fatal(err)
		}
	}
	coverage, _ := s.db.BlockCoverage(context.Background(), s.network)
	if coverage.Statistics != 5 {
		t.Fatalf("retry coverage: %+v", coverage)
	}
	s.retryAt = time.Time{}
	before := fake.calls["getblockstats"]
	if err := s.retry(context.Background(), fake.chain()); err != nil {
		t.Fatal(err)
	}
	if fake.calls["getblockstats"] != before {
		t.Fatal("genesis unsupported statistics retried endlessly")
	}
}

func TestCursorBoundsAndTipAnchor(t *testing.T) {
	fake := newRPC(60)
	s := testService(t, fake, nil)
	indexAll(t, s, fake)
	page, err := s.History(context.Background(), "", nil, 10)
	if err != nil {
		t.Fatal(err)
	}
	fake.active = append(fake.active, hash(61))
	indexAll(t, s, fake)
	older, err := s.History(context.Background(), page.Older, nil, 10)
	if err != nil {
		t.Fatal(err)
	}
	if older.Blocks[0].Height != 50 || older.AnchorHeight != 60 {
		t.Fatalf("unstable cursor: %+v", older)
	}
	newer, err := s.History(context.Background(), older.Newer, nil, 10)
	if err != nil || newer.Blocks[0].Height != 60 {
		t.Fatalf("newer cursor: %+v %v", newer, err)
	}
	for _, bad := range []string{"bad", strings.Repeat("x", 513), encodeCursor(cursor{Network: s.network, Tip: hash(0), TipHeight: 0, Height: 3})} {
		if _, err := s.History(context.Background(), bad, nil, 10); !errors.Is(err, explorer.ErrInvalid) {
			t.Fatalf("accepted malformed cursor: %v", err)
		}
	}
	if _, err := s.History(context.Background(), "", nil, 101); !errors.Is(err, explorer.ErrInvalid) {
		t.Fatal("unbounded page accepted")
	}
	if _, err := s.Economics(context.Background(), "invalid", time.Now()); !errors.Is(err, explorer.ErrInvalid) {
		t.Fatal("invalid economics range accepted")
	}
}

func TestOfflineReadsAndBoundedChartResponse(t *testing.T) {
	fake := newRPC(2)
	s := testService(t, fake, nil)
	indexAll(t, s, fake)
	s.observed = time.Now().Add(-time.Hour)
	page, err := s.History(context.Background(), "", nil, 50)
	if err != nil || !page.Stale || len(page.Blocks) != 3 {
		t.Fatalf("offline history %+v %v", page, err)
	}
	history, err := s.Economics(context.Background(), "all", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if !history.Stale || len(history.Points) > 1000 {
		t.Fatalf("unbounded/offline chart: %+v", history)
	}
	chain := fake.chain()
	dist := s.Snapshot(&chain, true, 144)
	if len(dist.Shares) != 1 || !dist.Stale || dist.Status != "unavailable" {
		t.Fatalf("offline pools %+v", dist)
	}
}

func TestIndexerShutdownAndSyncGate(t *testing.T) {
	fake := newRPC(2)
	db, err := storage.Open(context.Background(), "sqlite", filepath.Join(t.TempDir(), "shutdown.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	registry, _ := miningpool.Load()
	s := New(context.Background(), fake, db, registry, zap.NewNop())
	chain := fake.chain()
	chain.InitialBlockDownload = true
	s.Observe(&chain)
	status, err := s.Status(context.Background())
	if err != nil || status.Status != "syncing" {
		t.Fatalf("sync gate %+v %v", status, err)
	}
	done := make(chan struct{})
	go func() { s.Close(); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("indexer shutdown blocked")
	}
}

func TestOfflineStartupRestoresStoredNetwork(t *testing.T) {
	fake := newRPC(3)
	s := testService(t, fake, nil)
	indexAll(t, s, fake)
	index := New(context.Background(), fake, s.db, s.registry, zap.NewNop())
	defer index.Close()
	page, err := index.History(context.Background(), "", nil, 50)
	if err != nil || !page.Stale || len(page.Blocks) != 4 {
		t.Fatalf("offline restart %+v %v", page, err)
	}
	status, err := index.Status(context.Background())
	if err != nil || status.Status != "offline" {
		t.Fatalf("offline status %+v %v", status, err)
	}
	if fake.calls["getblock"] != 4 {
		t.Fatal("offline startup reread blocks")
	}
	// Network changes clear old data immediately, including during IBD.
	chain := fake.chain()
	chain.Chain = "test"
	chain.InitialBlockDownload = true
	s.Observe(&chain)
	latest, err := s.Latest(context.Background())
	if err != nil || len(latest) != 0 {
		t.Fatalf("network mixed old blocks %+v %v", latest, err)
	}
}

func TestCompletePoolWindowsUseOnlyTheirCanonicalRange(t *testing.T) {
	fake := newRPC(1050)
	s := testService(t, fake, nil)
	indexAll(t, s, fake)
	chain := fake.chain()
	for _, window := range []int{144, 1008} {
		dist := s.Snapshot(&chain, false, window)
		if dist.Status != "ready" || dist.Scanned != window || dist.Target != window || len(dist.Shares) != 1 || dist.Shares[0].Blocks != window {
			t.Fatalf("window %d: %+v", window, dist)
		}
	}
}
