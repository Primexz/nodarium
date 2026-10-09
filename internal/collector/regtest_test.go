package collector

import (
	"context"
	"github.com/Primexz/nodarium/internal/rpc"
	"os"
	"strconv"
	"testing"
	"time"
)

func TestRegtest(t *testing.T) {
	endpoint := os.Getenv("TEST_BITCOIN_RPC_URL")

	if endpoint == "" {
		t.Skip("TEST_BITCOIN_RPC_URL not set")
	}

	c := New(rpc.New(endpoint, "monitor", "integration-only", nil), &memoryStore{}, endpoint, 10*time.Second, nil)
	c.Collect(context.Background())
	s := c.Snapshot()

	if s.Status != "connected" {
		t.Fatalf("regtest collection: %+v", s)
	}

	if s.Overview.Data.Blockchain.Chain != "regtest" {
		t.Fatal("wrong network")
	}

	if s.Blocks.Data == nil || len(*s.Blocks.Data) == 0 {
		t.Fatal("missing real block header")
	}

	first := (*s.Blocks.Data)[0]
	var stats rpc.BlockStats

	client := rpc.New(endpoint, "monitor", "integration-only", nil)

	if err := client.Call(
		context.Background(),
		"getblockstats",
		[]any{first.Hash, []string{"blockhash", "total_out", "txs", "totalfee", "subsidy", "avgfeerate"}},
		&stats,
	); err != nil {
		t.Fatal("real block statistics unavailable:", err)
	}

	if stats.TotalOut == nil ||
		first.TotalTransactionAmountSats == nil ||
		*first.TotalTransactionAmountSats != strconv.FormatInt(*stats.TotalOut, 10) {
		t.Fatal("collector amount differs from Bitcoin Core's satoshi total")
	}

	if stats.Transactions == nil ||
		first.TransactionCount == nil ||
		*first.TransactionCount != *stats.Transactions ||
		*first.TransactionCount < 1 {
		t.Fatal("collector transaction count differs from Bitcoin Core")
	}

	if stats.Subsidy == nil || first.SubsidySats == nil ||
		*first.SubsidySats != strconv.FormatInt(*stats.Subsidy, 10) {
		t.Fatal("block subsidy differs from Core")
	}

	if stats.AverageFeeRate == nil || first.AverageFeeRate == nil ||
		*first.AverageFeeRate != *stats.AverageFeeRate {
		t.Fatal("average fee rate differs from Core")
	}

	if stats.TotalFee == nil ||
		first.TotalFeesSats == nil ||
		*first.TotalFeesSats != strconv.FormatInt(*stats.TotalFee, 10) {
		t.Fatal("total fees differ from Core")
	}

	var metadata rpc.BlockMetadata

	if err := client.Call(context.Background(), "getblock", []any{first.Hash, 1}, &metadata); err != nil {
		t.Fatal(err)
	}

	if first.SizeBytes == nil ||
		metadata.Size == nil ||
		*first.SizeBytes != *metadata.Size ||
		first.WeightUnits == nil ||
		metadata.Weight == nil ||
		*first.WeightUnits != *metadata.Weight ||
		first.CapacityPercent == nil ||
		*first.CapacityPercent != float64(*metadata.Weight)/4000000*100 {
		t.Fatal("full block measurements differ from Core")
	}

	if s.Overview.Data.Network.Version < 280000 {
		t.Fatal("expected Core 28+")
	}

	for _, target := range feeTargets {
		var estimate rpc.SmartFee

		if err := client.Call(context.Background(), "estimatesmartfee", []any{target, "CONSERVATIVE"}, &estimate); err != nil {
			t.Fatal("real fee estimation RPC failed:", err)
		}

		if estimate.FeeRate != nil || len(estimate.Errors) == 0 {
			t.Fatalf("regtest without confirmed transactions should have no fee estimate: %+v", estimate)
		}
	}

	chain := s.Overview.Data.Blockchain

	if chain.InitialBlockDownload || chain.Blocks < chain.Headers {
		if s.Fees.Data != nil || s.Fees.Error != "Fee estimates are unavailable while the node is syncing." {
			t.Fatal("syncing regtest exposed current fee estimates")
		}

		return
	}

	if s.Fees.Data == nil || len(s.Fees.Data.Targets) != 3 {
		t.Fatalf("missing real fee estimator responses: %+v", s.Fees)
	}

	for _, target := range s.Fees.Data.Targets {
		if target.Data != nil || target.Stale || target.Error != "Not enough data to estimate this fee rate." {
			t.Fatalf("regtest without estimator observations should be unavailable, not zero: %+v", target)
		}
	}
}
