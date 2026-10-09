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

type feeRPC struct {
	*miningRPC
	estimates map[int]rpc.SmartFee
	fail      int
	wait      bool
	mu        sync.Mutex
	calls     [][]any
}

func newFeeRPC() *feeRPC {
	f := &feeRPC{miningRPC: newMiningRPC(), estimates: map[int]rpc.SmartFee{}}

	for target, rate := range map[int]float64{2: .00012, 3: .00008, 6: .00004} {
		f.estimates[target] = rpc.SmartFee{FeeRate: pointer(rate), Blocks: target}
	}

	return f
}

func (f *feeRPC) Call(ctx context.Context, method string, params any, out any) error {
	if method != "estimatesmartfee" {
		return f.miningRPC.Call(ctx, method, params, out)
	}

	args := params.([]any)
	target := args[0].(int)
	f.mu.Lock()
	f.calls = append(f.calls, args)
	f.mu.Unlock()

	if f.wait {
		<-ctx.Done()

		return ctx.Err()
	}

	if err := ctx.Err(); err != nil {
		return err
	}

	if f.fail == target {
		return errors.New("RPC estimatesmartfee failed (code -1)")
	}

	*out.(*rpc.SmartFee) = f.estimates[target]

	return nil
}

func TestFeeCollectionAndIndependentRecovery(t *testing.T) {
	f := newFeeRPC()
	db := &memoryStore{}
	c := New(f, db, "node", 10*time.Second, nil)
	c.Collect(context.Background())
	s := c.Snapshot()

	if s.Fees.Data == nil || s.Fees.Stale || s.Fees.Data.Mode != "conservative" || len(s.Fees.Data.Targets) != 3 {
		t.Fatalf("missing fee estimates: %+v", s.Fees)
	}

	for i, want := range []float64{12, 8, 4} {
		target := s.Fees.Data.Targets[i]

		if target.Target != feeTargets[i] || target.Data == nil || math.Abs(target.Data.Rate-want) > 1e-12 || target.Data.Blocks != target.Target || target.Stale || target.UpdatedAt == nil {
			t.Fatalf("incorrect sat/vB estimate: %+v", target)
		}

		found := false

		for _, call := range f.calls {
			found = found || reflect.DeepEqual(call, []any{target.Target, "CONSERVATIVE"})
		}

		if !found {
			t.Fatalf("missing conservative target %d", target.Target)
		}
	}

	for metric, want := range map[string]float64{"fee_estimate_2": 12, "fee_estimate_3": 8, "fee_estimate_6": 4} {
		if got := db.values[metric]; math.Abs(got.Value-want) > 1e-12 || got.Weight != 10 || got.Total != 0 {
			t.Fatalf("%s: %+v", metric, got)
		}
	}

	f.fail = 3
	f.estimates[6] = rpc.SmartFee{FeeRate: pointer(.00002), Blocks: 6}
	c.Collect(context.Background())
	updated := c.Snapshot().Fees.Data.Targets

	if !updated[1].Stale || updated[1].Data != s.Fees.Data.Targets[1].Data || !updated[1].UpdatedAt.Equal(*s.Fees.Data.Targets[1].UpdatedAt) || updated[1].Error == "" {
		t.Fatal("failed target lost its last known observation")
	}

	if updated[2].Stale || updated[2].Data.Rate != 2 || db.values["fee_estimate_6"].Value != 2 {
		t.Fatal("successful target was discarded with its failed neighbor")
	}

	if _, saved := db.values["fee_estimate_3"]; saved {
		t.Fatal("stale estimate recorded as a fresh sample")
	}

	f.fail = 0
	c.Collect(context.Background())

	if target := c.Snapshot().Fees.Data.Targets[1]; target.Stale || target.Error != "" || target.Data == nil {
		t.Fatal("fee target did not recover")
	}

	c.snapshot.CheckedAt = pointer(time.Now().Add(-time.Hour))

	if !c.Snapshot().Fees.Stale {
		t.Fatal("expired fees not marked stale")
	}

	// A fresh insufficient-data response must clear the old valid estimate.
	f.estimates[3] = rpc.SmartFee{Blocks: 3, Errors: []string{"untrusted node text"}}
	c.Collect(context.Background())
	target := c.Snapshot().Fees.Data.Targets[1]

	if target.Data != nil || target.Stale || target.Error != "Not enough data to estimate this fee rate." {
		t.Fatalf("insufficient data misrepresented: %+v", target)
	}
}

func TestFeeHistoryRejectsInvalidAndClampedTargets(t *testing.T) {
	for _, sample := range []rpc.SmartFee{
		{Blocks: 2},
		{FeeRate: pointer(0.0), Blocks: 2},
		{FeeRate: pointer(-1.0), Blocks: 2},
		{FeeRate: pointer(math.NaN()), Blocks: 2},
		{FeeRate: pointer(math.Inf(1)), Blocks: 2},
		{FeeRate: pointer(math.MaxFloat64), Blocks: 2},
		{FeeRate: pointer(.00001), Blocks: 0},
		{FeeRate: pointer(.00001), Blocks: 1009},
		{FeeRate: pointer(.00001), Blocks: 2, Errors: []string{"node error"}},
	} {
		f := newFeeRPC()
		f.estimates[2] = sample
		c := New(f, &memoryStore{}, "node", 10*time.Second, nil)
		section, values := c.collectFees(context.Background(), f.blockchain, nil, Section[Fees]{}, time.Now())

		if section.Data.Targets[0].Data != nil || section.Data.Targets[0].Error == "" {
			t.Fatalf("invalid estimate exposed: %+v", sample)
		}

		if _, saved := values["fee_estimate_2"]; saved {
			t.Fatal("invalid estimate persisted")
		}
	}

	f := newFeeRPC()
	f.estimates[6] = rpc.SmartFee{FeeRate: pointer(.00003), Blocks: 3}
	c := New(f, &memoryStore{}, "node", 10*time.Second, nil)
	section, values := c.collectFees(context.Background(), f.blockchain, nil, Section[Fees]{}, time.Now())

	if target := section.Data.Targets[2]; target.Data == nil || target.Data.Blocks != 3 || target.Data.Rate != 3 || target.Target != 6 {
		t.Fatal("returned target was not preserved")
	}

	if _, saved := values["fee_estimate_6"]; saved {
		t.Fatal("clamped estimate mislabeled in history")
	}
}

func TestFeesUnavailableDuringSyncAndChainFailure(t *testing.T) {
	f := newFeeRPC()
	c := New(f, &memoryStore{}, "node", 10*time.Second, nil)

	for _, chain := range []rpc.Blockchain{
		{InitialBlockDownload: true},
		{Blocks: 1, Headers: 2},
	} {
		section, values := c.collectFees(context.Background(), chain, nil, Section[Fees]{}, time.Now())

		if section.Data != nil || section.Error == "" || len(values) != 0 || len(f.calls) != 0 {
			t.Fatal("syncing produced fee estimates or history")
		}
	}

	section, values := c.collectFees(context.Background(), f.blockchain, errors.New("chain unavailable"), Section[Fees]{}, time.Now())

	if section.Data != nil || !section.Stale || len(values) != 0 || len(f.calls) != 0 {
		t.Fatal("missing blockchain reading produced fees")
	}
}

func TestFeeTimeoutPreservesCoreAndMiningReadings(t *testing.T) {
	f := newFeeRPC()
	f.blockchain.BestBlockHash = "a"
	f.fakeRPC.tip = "a"
	f.wait = true
	c := New(f, &memoryStore{}, "node", 100*time.Millisecond, nil)
	c.Collect(context.Background())
	s := c.Snapshot()

	if s.Status != "connected" || s.Overview.Stale || s.Blocks.Stale || s.Mining.Data == nil || s.Mining.Stale {
		t.Fatalf("optional fee timeout disrupted monitoring: %+v", s)
	}

	for _, target := range s.Fees.Data.Targets {
		if target.Data != nil || !target.Stale || target.Error == "" {
			t.Fatal("fee timeout was hidden")
		}
	}
}
