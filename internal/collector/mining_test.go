package collector

import (
	"context"
	"errors"
	"math"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/Primexz/nodarium/internal/rpc"
)

type miningRPC struct {
	*fakeRPC
	blockchain     rpc.Blockchain
	estimates      map[int]float64
	failWindow     int
	waitForTimeout bool
	mu             sync.Mutex
	calls          [][]any
}

func (f *miningRPC) Call(ctx context.Context, method string, params any, out any) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	if method == "getblockchaininfo" {
		*out.(*rpc.Blockchain) = f.blockchain

		return nil
	}

	if method != "getnetworkhashps" {
		return f.fakeRPC.Call(ctx, method, params, out)
	}

	args := params.([]any)
	window := args[0].(int)
	f.mu.Lock()
	f.calls = append(f.calls, args)
	f.mu.Unlock()

	if f.waitForTimeout {
		<-ctx.Done()

		return ctx.Err()
	}

	if window == f.failWindow {
		return errors.New("RPC getnetworkhashps failed (code -1)")
	}

	*out.(*float64) = f.estimates[window]

	return nil
}

func newMiningRPC() *miningRPC {
	return &miningRPC{
		fakeRPC:    &fakeRPC{fail: map[string]bool{}},
		blockchain: rpc.Blockchain{Chain: "main", Blocks: 900123, Headers: 900123, Difficulty: 123.4e12},
		estimates:  map[int]float64{144: 910e18, 1008: 895e18},
	}
}

func TestMiningCollectionAndRecovery(t *testing.T) {
	f := newMiningRPC()
	db := &memoryStore{}
	c := New(f, db, "node", 10*time.Second, nil)
	c.Collect(context.Background())
	s := c.Snapshot()

	if s.Mining.Data == nil ||
		s.Mining.Stale ||
		s.Mining.Data.Hashrate144 != 910e18 ||
		s.Mining.Data.Hashrate1008 != 895e18 ||
		s.Mining.Data.Height != 900123 {
		t.Fatalf("missing network estimates: %+v", s.Mining)
	}

	for metric, want := range map[string]float64{"hashrate_144": 910e18, "hashrate_1008": 895e18, "difficulty": 123.4e12} {
		if got := db.values[metric]; got.Value != want || got.Weight != 10 || got.Total != 0 {
			t.Fatalf("%s: %+v", metric, got)
		}
	}

	for _, want := range [][]any{{144, int64(900123)}, {1008, int64(900123)}} {
		found := false

		for _, call := range f.calls {
			if reflect.DeepEqual(call, want) {
				found = true
			}
		}

		if !found {
			t.Fatalf("missing height-pinned window: %v", want)
		}
	}

	f.failWindow = 144
	f.estimates[1008] = 900e18
	c.Collect(context.Background())

	if failed := c.Snapshot().Mining; !failed.Stale || failed.Data != s.Mining.Data || failed.Error == "" {
		t.Fatalf("last complete estimate lost: %+v", failed)
	}

	if _, ok := db.values["hashrate_144"]; ok {
		t.Fatal("failed estimate persisted")
	}

	if db.values["hashrate_1008"].Value != 900e18 {
		t.Fatal("successful window discarded")
	}

	f.failWindow = 0
	c.Collect(context.Background())

	if recovered := c.Snapshot().Mining; recovered.Stale || recovered.Error != "" || recovered.Data.Hashrate1008 != 900e18 {
		t.Fatal("mining did not recover")
	}

	c.snapshot.CheckedAt = pointer(time.Now().Add(-time.Hour))

	if !c.Snapshot().Mining.Stale {
		t.Fatal("expired estimate not marked stale")
	}
}

func TestMiningUnavailableDoesNotCreateHistory(t *testing.T) {
	for _, syncing := range []rpc.Blockchain{
		{Blocks: 100, Headers: 100, InitialBlockDownload: true},
		{Blocks: 100, Headers: 101},
	} {
		f := newMiningRPC()
		c := New(f, &memoryStore{}, "node", 10*time.Second, nil)
		section, values := c.collectMining(context.Background(), syncing, nil, Section[Mining]{}, time.Now())

		if section.Data != nil || section.Error == "" || len(values) != 0 || len(f.calls) != 0 {
			t.Fatal("syncing polluted network history")
		}
	}

	for _, invalid := range []float64{0, -1, math.NaN(), math.Inf(1)} {
		f := newMiningRPC()
		f.estimates[144] = invalid
		c := New(f, &memoryStore{}, "node", 10*time.Second, nil)
		section, values := c.collectMining(context.Background(), f.blockchain, nil, Section[Mining]{}, time.Now())

		if section.Data != nil || section.Error == "" {
			t.Fatal("invalid estimate exposed")
		}

		if _, ok := values["hashrate_144"]; ok {
			t.Fatal("invalid estimate saved")
		}
	}

	f := newMiningRPC()
	c := New(f, &memoryStore{}, "node", 10*time.Second, nil)
	section, values := c.collectMining(
		context.Background(),
		f.blockchain,
		errors.New("node unavailable"),
		Section[Mining]{},
		time.Now(),
	)

	if section.Data != nil || !section.Stale || len(values) != 0 || len(f.calls) != 0 {
		t.Fatal("missing chain produced estimates")
	}
}

func pointer[T any](value T) *T {
	return &value
}

func TestMiningTimeoutPreservesCoreReadings(t *testing.T) {
	f := newMiningRPC()
	f.blockchain.BestBlockHash = "a"
	f.fakeRPC.tip = "a"
	f.waitForTimeout = true
	c := New(f, &memoryStore{}, "node", 25*time.Millisecond, nil)
	c.Collect(context.Background())
	s := c.Snapshot()

	if s.Status != "connected" ||
		s.Overview.Stale ||
		s.Blocks.Stale ||
		s.Blocks.Data == nil ||
		len(*s.Blocks.Data) == 0 {
		t.Fatalf("optional mining timeout disrupted core readings: %+v", s)
	}

	if s.Mining.Data != nil || !s.Mining.Stale || s.Mining.Error == "" {
		t.Fatal("mining timeout was hidden")
	}
}
