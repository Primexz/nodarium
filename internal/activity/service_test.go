package activity

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Primexz/nodarium/internal/collector"
	"github.com/Primexz/nodarium/internal/rpc"
	"github.com/Primexz/nodarium/internal/storage"
	"go.uber.org/zap"
)

type callerFunc func(context.Context, string, any, any) error

func (f callerFunc) Call(ctx context.Context, method string, params, out any) error {
	return f(ctx, method, params, out)
}
func assign(out, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, out)
}

type memoryStore struct {
	mu     sync.Mutex
	events []storage.ActivityEvent
	failed bool
}

func (m *memoryStore) SaveActivity(_ context.Context, event storage.ActivityEvent) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.failed {
		return errors.New("offline")
	}
	m.events = append(m.events, event)
	return nil
}
func (m *memoryStore) PruneActivity(context.Context) error { return nil }
func (m *memoryStore) Activity(context.Context, string, string, int64, string) (storage.ActivityPage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return storage.ActivityPage{Events: append([]storage.ActivityEvent{}, m.events...)}, nil
}
func testService(t *testing.T, client rpc.Caller) *Service {
	t.Helper()
	return &Service{ctx: t.Context(), rpc: client, store: &memoryStore{}, logger: zap.NewNop(), node: "test-node", session: "generation", subscribers: map[*subscription]bool{}, members: map[string]bool{}, sample: map[string]Transaction{}, removed: map[string]removedTransaction{}, metadataTried: map[string]bool{}, live: Live{Source: "rpc", Transactions: []Transaction{}}}
}
func TestPollingBaselineAndRecovery(t *testing.T) {
	ids := []string{"existing"}
	seq := uint64(10)
	failed := false
	s := testService(t, callerFunc(func(_ context.Context, method string, params, out any) error {
		if method != "getrawmempool" {
			t.Fatalf("unexpected %s", method)
		}
		if failed {
			return errors.New("offline")
		}
		return assign(out, map[string]any{"txids": ids, "mempool_sequence": seq})
	}))
	s.poll()
	if s.Snapshot().Arrivals != 0 || len(s.sample) != 1 {
		t.Fatal("bootstrap was counted as arrival")
	}
	ids = []string{"existing", "new"}
	seq++
	s.poll()
	if s.Snapshot().Arrivals != 1 || len(s.members) != 2 {
		t.Fatal("RPC arrival was missed")
	}
	s.zmqReady = true
	seq += 2
	ids = []string{"after-gap"}
	s.poll()
	if s.Snapshot().Arrivals != 0 || s.zmqReady || s.Snapshot().Generation != 1 {
		t.Fatal("gap did not reset baseline")
	}
	failed = true
	s.poll()
	if s.baseline || s.Snapshot().Status != "unavailable" {
		t.Fatal("RPC failure retained a misleading live scene")
	}
	failed = false
	seq = 1
	s.poll()
	if s.Snapshot().Arrivals != 0 || s.Snapshot().Status != "ready" {
		t.Fatal("restart produced false arrivals")
	}
}
func TestCapacityAndBoundedSample(t *testing.T) {
	s := testService(t, nil)
	for i := range 800 {
		s.add(fmt.Sprint(i), true)
	}
	if len(s.sample) != MaxTransactions || len(s.members) != 800 {
		t.Fatal("sample is not bounded")
	}
	for i := range MaxMembers {
		s.members[fmt.Sprint(i)] = true
	}
	s.add("overflow", true)
	if s.Snapshot().Status != "capacity" || len(s.members) != 0 {
		t.Fatal("membership cap not enforced")
	}
}
func TestBlocksVerifiedAndNoFalseReorgOnRPCFailure(t *testing.T) {
	head := rpc.Block{Hash: "new", Height: 2, Previous: "old", Confirmations: 1, Time: 123}
	hashError := false
	s := testService(t, callerFunc(func(_ context.Context, method string, params, out any) error {
		switch method {
		case "getblockheader":
			return assign(out, head)
		case "getblockhash":
			if hashError {
				return errors.New("timeout")
			}
			return assign(out, "old")
		case "getbestblockhash":
			return assign(out, head.Hash)
		case "getblock":
			return assign(out, map[string]any{"tx": []string{"included", "previously-removed"}, "confirmations": 1})
		default:
			return errors.New("unexpected RPC")
		}
	}))
	s.tip = &rpc.Block{Hash: "old", Height: 1}
	s.add("included", false)
	s.add("evicted", false)
	s.add("previously-removed", false)
	s.remove("previously-removed")
	// A transaction can return after a non-block removal. Its current sample
	// must replace retained metadata and disappear from the waiting region.
	s.add("previously-removed", false)
	_, unsubscribe := s.Subscribe(true, "")
	defer unsubscribe()
	hashError = true
	s.chain(rpc.Blockchain{BestBlockHash: "new"})
	if len(s.pending) != 0 || s.tip.Hash != "old" {
		t.Fatal("RPC failure fabricated reorg")
	}
	hashError = false
	s.chain(rpc.Blockchain{BestBlockHash: "new"})
	live := s.Snapshot()
	if len(s.pending) != 1 || s.pending[0].Kind != "block" || live.Block == nil || len(live.Block.Transactions) != 2 || len(s.members) != 1 || !s.members["evicted"] {
		t.Fatalf("incorrect confirmation %+v", live)
	}
	if len(s.sample) != 1 {
		t.Fatal("confirmed transaction remained in waiting sample")
	}
	if s.sequence != 2 {
		t.Fatal("mined membership did not advance the sequence")
	}
	s.chain(rpc.Blockchain{BestBlockHash: "new"})
	if len(s.pending) != 1 {
		t.Fatal("duplicate tip emitted")
	}
}
func TestActualReorgDepth(t *testing.T) {
	headers := map[string]rpc.Block{
		"old":    {Hash: "old", Height: 2, Previous: "common"},
		"new":    {Hash: "new", Height: 2, Previous: "common", Confirmations: 1},
		"common": {Hash: "common", Height: 1, Confirmations: 2},
	}
	s := testService(t, callerFunc(func(_ context.Context, method string, params, out any) error {
		switch method {
		case "getblockheader":
			return assign(out, headers[params.([]any)[0].(string)])
		case "getblockhash", "getbestblockhash":
			return assign(out, "new")
		default:
			return errors.New("unexpected RPC")
		}
	}))
	s.tip = new(headers["old"])
	s.chain(rpc.Blockchain{BestBlockHash: "new"})
	if len(s.pending) != 2 || s.pending[0].Kind != "reorg" || s.pending[0].Depth == nil || *s.pending[0].Depth != 1 || s.pending[1].Hash != "new" {
		t.Fatalf("wrong reorg: %+v", s.pending)
	}
}
func TestReplayResetSlowSubscribersAndPersistence(t *testing.T) {
	s := testService(t, nil)
	s.publish("event", map[string]string{"id": "first"})
	first := s.replay[0].ID
	s.publish("event", map[string]string{"id": "second"})
	q, closeSub := s.Subscribe(false, first)
	if msg := <-q; msg.Kind != "event" || !strings.Contains(string(msg.Data), "second") {
		t.Fatal("missing replay")
	}
	closeSub()
	q, closeSub = s.Subscribe(false, "expired")
	if (<-q).Kind != "reset" || (<-q).Kind != "snapshot" {
		t.Fatal("expired cursor did not reset")
	}
	closeSub()
	q, _ = s.Subscribe(true, "")
	for range 1200 {
		s.publish("event", map[string]string{"id": "fill"})
	}
	if len(s.subscribers) != 0 || len(s.replay) > 1000 {
		t.Fatal("slow consumer was not bounded")
	}
	for range q {
	}
	s.emit(storage.ActivityEvent{Kind: "connection", Status: "disconnected"})
	m := s.store.(*memoryStore)
	m.failed = true
	s.persist(t.Context())
	if !s.Snapshot().PersistenceError || len(s.pending) != 1 {
		t.Fatal("lost pending event on storage failure")
	}
	m.failed = false
	s.persist(t.Context())
	if s.Snapshot().PersistenceError || len(s.pending) != 0 || len(m.events) != 1 {
		t.Fatal("persistence recovery failed")
	}
}

type snapshotFunc func() collector.Snapshot

func (f snapshotFunc) Snapshot() collector.Snapshot { return f() }
func TestLifecycleNoViewerNoMempoolWork(t *testing.T) {
	var mu sync.Mutex
	calls := map[string]int{}
	client := callerFunc(func(_ context.Context, method string, params, out any) error {
		mu.Lock()
		calls[method]++
		mu.Unlock()
		switch method {
		case "getblockchaininfo":
			return assign(out, rpc.Blockchain{BestBlockHash: "head"})
		case "getblockheader":
			return assign(out, rpc.Block{Hash: "head", Confirmations: 1})
		case "getrawmempool":
			return assign(out, map[string]any{"txids": []string{}, "mempool_sequence": 1})
		}
		return nil
	})
	now := time.Now()
	snaps := snapshotFunc(func() collector.Snapshot {
		return collector.Snapshot{Node: "test", Status: "connected", Overview: collector.Section[collector.Overview]{UpdatedAt: &now, Data: &collector.Overview{Blockchain: rpc.Blockchain{BestBlockHash: "head"}}}}
	})
	s := New(t.Context(), client, snaps, &memoryStore{}, nil, zap.NewNop(), nil)
	q, unsubscribe := s.Subscribe(false, "")
	<-q
	time.Sleep(250 * time.Millisecond)
	mu.Lock()
	before := calls["getrawmempool"]
	mu.Unlock()
	if before != 0 {
		t.Fatal("timeline caused mempool work")
	}
	unsubscribe()
	q, unsubscribe = s.Subscribe(true, "")
	<-q
	deadline := time.Now().Add(time.Second)
	for s.Snapshot().Status != "ready" && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if s.Snapshot().Status != "ready" {
		t.Fatal("live viewer did not bootstrap")
	}
	unsubscribe()
	s.Close()
	if len(s.subscribers) != 0 {
		t.Fatal("shutdown leaked subscribers")
	}
}
