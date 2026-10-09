package collector

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/Primexz/nodarium/internal/rpc"
)

type statsRPC struct {
	*fakeRPC
	mu          sync.Mutex
	calls       map[string]int
	totals      map[string]*int64
	counts      map[string]*int64
	failStats   bool
	wrongHash   bool
	failBlock   bool
	fees        map[string]*int64
	metadata    *rpc.BlockMetadata
	blockCalls  map[string]int
	percentiles []float64
	subsidies   map[string]*int64
	rates       map[string]*float64
}

func (f *statsRPC) Call(ctx context.Context, method string, params any, out any) error {
	if method == "getblock" {
		args := params.([]any)

		if args[1] != 1 {
			return errors.New("expected metadata verbosity")
		}

		hash := args[0].(string)
		f.mu.Lock()
		f.blockCalls[hash]++
		f.mu.Unlock()

		if f.failBlock {
			return errors.New("block data unavailable")
		}

		size, weight := int64(1750000), int64(3800000)
		meta := rpc.BlockMetadata{Hash: hash, Size: &size, Weight: &weight}

		if f.metadata != nil {
			meta = *f.metadata

			if meta.Hash == "" {
				meta.Hash = hash
			}
		}

		if f.wrongHash {
			meta.Hash = "different-hash"
		}

		encoded, _ := json.Marshal(meta)

		return json.Unmarshal(encoded, out)
	}

	if method != "getblockstats" {
		return f.fakeRPC.Call(ctx, method, params, out)
	}

	args := params.([]any)

	if !reflect.DeepEqual(args[1], []string{"blockhash", "total_out", "txs", "totalfee", "feerate_percentiles", "subsidy", "avgfeerate"}) {
		return errors.New("unexpected statistics request")
	}

	hash := args[0].(string)
	f.mu.Lock()
	f.calls[hash]++
	f.mu.Unlock()

	if f.failStats {
		return errors.New("block data pruned or unavailable")
	}

	returnedHash := hash

	if f.wrongHash {
		returnedHash = "different-hash"
	}

	count, exists := f.counts[hash]

	if !exists {
		value := int64(2500)
		count = &value
	}

	fees, exists := f.fees[hash]

	if !exists {
		value := int64(0)
		fees = &value
	}

	encoded, _ := json.Marshal(rpc.BlockStats{
		BlockHash:          returnedHash,
		TotalOut:           f.totals[hash],
		Transactions:       count,
		TotalFee:           fees,
		FeeRatePercentiles: f.percentiles,
		Subsidy:            f.subsidy(hash),
		AverageFeeRate:     f.rate(hash),
	})

	return json.Unmarshal(encoded, out)
}

func (f *statsRPC) subsidy(hash string) *int64 {
	if value, exists := f.subsidies[hash]; exists {
		return value
	}

	value := int64(312500000)

	return &value
}

func (f *statsRPC) rate(hash string) *float64 {
	if value, exists := f.rates[hash]; exists {
		return value
	}

	value := float64(8)

	return &value
}

func newStatsRPC() *statsRPC {
	return &statsRPC{
		fakeRPC:     &fakeRPC{fail: map[string]bool{}, chain: "regtest", tip: "a", uptime: 100},
		calls:       map[string]int{},
		blockCalls:  map[string]int{},
		totals:      map[string]*int64{},
		percentiles: []float64{1, 3, 8, 25, 40},
	}
}

func TestBlockAmountsRetryCacheAndChainIsolation(t *testing.T) {
	f := newStatsRPC()
	amount := int64(9007199254740993) // Beyond JavaScript's exact Number range.
	f.totals["a"] = &amount
	f.failStats = true
	c := New(f, &memoryStore{}, "node", 10*time.Second, nil)
	ctx := context.Background()
	c.Collect(ctx)
	before := c.Snapshot()

	if before.Status != "connected" ||
		before.Blocks.Stale ||
		len(*before.Blocks.Data) != 1 ||
		(*before.Blocks.Data)[0].TotalTransactionAmountSats != nil {
		t.Fatal("optional statistics failure hid headers or marked healthy node stale")
	}

	f.failStats = false
	c.Collect(ctx)
	current := c.Snapshot()

	if got := (*current.Blocks.Data)[0].TotalTransactionAmountSats; got == nil || *got != "9007199254740993" {
		t.Fatalf("lost exact satoshi amount: %v", got)
	}

	if current.Blocks.Data == nil ||
		(*current.Blocks.Data)[0].TransactionCount == nil ||
		*(*current.Blocks.Data)[0].TransactionCount != 2500 {
		t.Fatal("transaction count missing")
	}

	if (*before.Blocks.Data)[0].TransactionCount != nil {
		t.Fatal("mutated previous transaction count")
	}

	if (*before.Blocks.Data)[0].TotalTransactionAmountSats != nil {
		t.Fatal("mutated a previously published snapshot")
	}

	if f.calls["a"] != 2 {
		t.Fatal("missing amount not retried with unchanged tip")
	}

	c.Collect(ctx)

	if f.calls["a"] != 2 {
		t.Fatal("successful amount was not cached")
	}

	f.tip = "b" // A different hash at the same height represents a reorg.
	zero := int64(0)
	f.totals["b"] = &zero
	c.Collect(ctx)

	if got := (*c.Snapshot().Blocks.Data)[0].TotalTransactionAmountSats; got == nil || *got != "0" {
		t.Fatal("reorg reused old amount or lost real zero")
	}

	f.chain = "signet"
	c.Collect(ctx)

	if f.calls["b"] != 2 {
		t.Fatal("statistics cache leaked across chains")
	}
}

func TestBlockAmountValidationAndOverlappingHeaders(t *testing.T) {
	f := newStatsRPC()
	value := int64(123456789)
	negative := int64(-1)
	f.totals = map[string]*int64{"a": &value, "b": &value, "invalid": &negative}
	c := New(f, &memoryStore{}, "node", 10*time.Second, nil)
	first := c.blockStatistics(context.Background(), []Block{{Block: rpc.Block{Hash: "a"}}}, nil)
	second := c.blockStatistics(
		context.Background(),
		[]Block{
			{Block: rpc.Block{Hash: "b"}},
			{Block: rpc.Block{Hash: "a"}},
			{Block: rpc.Block{Hash: "missing"}},
			{Block: rpc.Block{Hash: "invalid"}},
		},
		&first,
	)

	if f.calls["a"] != 1 || f.calls["b"] != 1 {
		t.Fatal("overlapping hashes unnecessarily fetched")
	}

	if second[0].TotalTransactionAmountSats == nil ||
		second[1].TotalTransactionAmountSats == nil ||
		second[2].TotalTransactionAmountSats != nil ||
		second[3].TotalTransactionAmountSats != nil {
		t.Fatal("missing or invalid amount became a value")
	}

	f.wrongHash = true

	if got := c.blockStatistics(context.Background(), first, nil); got[0].TotalTransactionAmountSats != nil {
		t.Fatal("mismatched statistics accepted")
	}
}

func TestTransactionCountValidationAndPartialRetry(t *testing.T) {
	for _, value := range []int64{-1, 0, 1, 3200} {
		f := newStatsRPC()
		f.counts = map[string]*int64{"a": &value}
		c := New(f, &memoryStore{}, "node", 10*time.Second, nil)
		result := c.blockStatistics(context.Background(), []Block{{Block: rpc.Block{Hash: "a"}}}, nil)

		if value <= 0 && result[0].TransactionCount != nil {
			t.Fatal("invalid transaction count accepted")
		}

		if value > 0 && (result[0].TransactionCount == nil || *result[0].TransactionCount != value) {
			t.Fatal("transaction count lost when amount unavailable")
		}
	}

	f := newStatsRPC()
	amount := int64(100000000)
	f.totals["a"] = &amount
	f.counts = map[string]*int64{"a": nil}
	c := New(f, &memoryStore{}, "node", 10*time.Second, nil)
	first := c.blockStatistics(context.Background(), []Block{{Block: rpc.Block{Hash: "a"}}}, nil)

	if first[0].TransactionCount != nil || first[0].TotalTransactionAmountSats == nil {
		t.Fatal("missing count hid available amount")
	}

	f.failStats = true
	second := c.blockStatistics(context.Background(), first, &first)

	if second[0].TotalTransactionAmountSats == nil || second[0].TransactionCount != nil {
		t.Fatal("retry failure lost previously available statistics")
	}

	f.failStats = false
	count := int64(1)
	f.counts["a"] = &count
	third := c.blockStatistics(context.Background(), second, &second)

	if third[0].TransactionCount == nil || *third[0].TransactionCount != 1 || f.calls["a"] != 3 {
		t.Fatal("missing count not retried")
	}

	c.blockStatistics(context.Background(), third, &third)

	if f.calls["a"] != 3 {
		t.Fatal("complete statistics not cached")
	}

	f.wrongHash = true
	result := c.blockStatistics(context.Background(), third, nil)

	if result[0].TransactionCount != nil {
		t.Fatal("count from wrong hash accepted")
	}
}

func TestFullBlockDetailsCacheAndIndependentRecovery(t *testing.T) {
	f := newStatsRPC()
	amount, fees := int64(100000000), int64(12567890)
	f.totals["a"] = &amount
	f.fees = map[string]*int64{"a": &fees}
	f.failBlock = true
	c := New(f, &memoryStore{}, "node", 10*time.Second, nil)
	blocks := []Block{{Block: rpc.Block{Hash: "a"}}}
	first := c.blockStatistics(context.Background(), blocks, nil)

	if first[0].TotalFeesSats == nil ||
		*first[0].TotalFeesSats != "12567890" ||
		first[0].SizeBytes != nil ||
		first[0].CapacityPercent != nil {
		t.Fatal("failed metadata hid fees or fabricated capacity")
	}

	f.failBlock = false
	second := c.blockStatistics(context.Background(), blocks, &first)

	if second[0].SizeBytes == nil ||
		*second[0].SizeBytes != 1750000 ||
		second[0].WeightUnits == nil ||
		*second[0].WeightUnits != 3800000 ||
		second[0].CapacityPercent == nil ||
		*second[0].CapacityPercent != 95 {
		t.Fatal("full-block measurements incorrect")
	}

	if f.calls["a"] != 1 || f.blockCalls["a"] != 2 || first[0].SizeBytes != nil {
		t.Fatal("unnecessary stats retry or old snapshot mutated")
	}

	c.blockStatistics(context.Background(), blocks, &second)

	if f.blockCalls["a"] != 2 || f.calls["a"] != 1 {
		t.Fatal("complete details not cached")
	}

	f.failStats = true
	count := int64(1)
	f.metadata = &rpc.BlockMetadata{Transactions: &count}
	third := c.blockStatistics(context.Background(), blocks, nil)

	if third[0].TransactionCount == nil || *third[0].TransactionCount != 1 || third[0].TotalFeesSats != nil {
		t.Fatal("metadata count fallback failed")
	}
}

func TestBlockDetailValidation(t *testing.T) {
	for _, value := range []int64{-1, 0, 4000001} {
		f := newStatsRPC()
		negativeFee := int64(-1)
		f.fees = map[string]*int64{"a": &negativeFee}
		f.metadata = &rpc.BlockMetadata{Size: &value, Weight: &value}
		c := New(f, &memoryStore{}, "node", 10*time.Second, nil)
		block := c.blockStatistics(context.Background(), []Block{{Block: rpc.Block{Hash: "a"}}}, nil)[0]

		if block.TotalFeesSats != nil ||
			block.SizeBytes != nil ||
			block.WeightUnits != nil ||
			block.CapacityPercent != nil {
			t.Fatal("invalid measurements accepted")
		}
	}

	f := newStatsRPC()
	size, weight := int64(1000000), int64(4000000)
	f.metadata = &rpc.BlockMetadata{Size: &size, Weight: &weight}
	c := New(f, &memoryStore{}, "node", 10*time.Second, nil)
	block := c.blockStatistics(context.Background(), []Block{{Block: rpc.Block{Hash: "a"}}}, nil)[0]

	if block.CapacityPercent == nil ||
		*block.CapacityPercent != 100 ||
		block.TotalFeesSats == nil ||
		*block.TotalFeesSats != "0" {
		t.Fatal("full capacity or zero fees lost")
	}

	f.wrongHash = true
	block = c.blockStatistics(context.Background(), []Block{{Block: rpc.Block{Hash: "a"}}}, nil)[0]

	if block.TotalFeesSats != nil || block.SizeBytes != nil || block.WeightUnits != nil {
		t.Fatal("details from a different block accepted")
	}
}

func TestBlockMedianFeeRateIsOptionalAndCached(t *testing.T) {
	for _, percentiles := range [][]float64{nil, {1, 2}, {1, 2, -1, 4, 5}, {1, 2, 8, 20, 40}, {0, 0, 0, 0, 0}} {
		f := newStatsRPC()
		f.percentiles = percentiles
		c := New(f, &memoryStore{}, "node", 10*time.Second, nil)
		c.Collect(context.Background())
		got := (*c.Snapshot().Blocks.Data)[0].MedianFeeRate
		valid := len(percentiles) == 5 && percentiles[2] >= 0

		if valid && (got == nil || *got != percentiles[2]) {
			t.Fatal("valid median missing", got)
		}

		if !valid && got != nil {
			t.Fatal("unavailable median fabricated", got)
		}

		c.Collect(context.Background())
		cached := (*c.Snapshot().Blocks.Data)[0].MedianFeeRate

		if valid && (cached == nil || *cached != *got) {
			t.Fatal("cached median lost")
		}
	}
}

func TestBlockEconomicsRetryAndCache(t *testing.T) {
	f := newStatsRPC()
	amount := int64(100000000)
	f.totals["a"] = &amount
	f.rates = map[string]*float64{"a": nil}
	c := New(f, &memoryStore{}, "node", 10*time.Second, nil)
	blocks := []Block{{Block: rpc.Block{Hash: "a"}}}
	first := c.blockStatistics(context.Background(), blocks, nil)

	if first[0].SubsidySats == nil || *first[0].SubsidySats != "312500000" || first[0].AverageFeeRate != nil {
		t.Fatal("partial economics statistics lost or fabricated")
	}

	f.failStats = true
	second := c.blockStatistics(context.Background(), blocks, &first)

	if second[0].SubsidySats == nil || *second[0].SubsidySats != "312500000" || second[0].AverageFeeRate != nil {
		t.Fatal("retry failure erased the available subsidy")
	}

	f.failStats = false
	zeroRate := float64(0)
	f.rates["a"] = &zeroRate
	third := c.blockStatistics(context.Background(), blocks, &second)

	if third[0].AverageFeeRate == nil || *third[0].AverageFeeRate != 0 || f.calls["a"] != 3 || f.blockCalls["a"] != 1 {
		t.Fatal("missing rate not retried independently of cached metadata")
	}

	if first[0].AverageFeeRate != nil || second[0].AverageFeeRate != nil {
		t.Fatal("enrichment mutated an already published snapshot")
	}

	c.blockStatistics(context.Background(), blocks, &third)

	if f.calls["a"] != 3 {
		t.Fatal("complete zero-valued rate not cached")
	}

	// Replacement at the same height must never inherit another hash's subsidy.
	zeroSubsidy := int64(0)
	f.totals["b"] = &amount
	f.subsidies = map[string]*int64{"b": &zeroSubsidy}
	replacement := c.blockStatistics(context.Background(), []Block{{Block: rpc.Block{Hash: "b"}}}, &third)

	if replacement[0].SubsidySats == nil || *replacement[0].SubsidySats != "0" {
		t.Fatal("real zero subsidy lost or reorg reused old economics")
	}
}

func TestBlockEconomicsValidation(t *testing.T) {
	for _, subsidy := range []int64{-1, 0, 312500000, 5000000000, 5000000001} {
		f := newStatsRPC()
		negativeRate := float64(-1)
		f.subsidies = map[string]*int64{"a": &subsidy}
		f.rates = map[string]*float64{"a": &negativeRate}
		c := New(f, &memoryStore{}, "node", 10*time.Second, nil)
		got := c.blockStatistics(context.Background(), []Block{{Block: rpc.Block{Hash: "a"}}}, nil)[0]
		valid := subsidy >= 0 && subsidy <= 5000000000

		if valid != (got.SubsidySats != nil) || got.AverageFeeRate != nil {
			t.Fatal("invalid economics accepted or valid subsidy dropped", subsidy)
		}
	}

	f := newStatsRPC()
	f.wrongHash = true
	c := New(f, &memoryStore{}, "node", 10*time.Second, nil)
	got := c.blockStatistics(context.Background(), []Block{{Block: rpc.Block{Hash: "a"}}}, nil)[0]

	if got.SubsidySats != nil || got.AverageFeeRate != nil {
		t.Fatal("economics from a different block hash accepted")
	}
}
