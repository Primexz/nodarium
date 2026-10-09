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
		[]any{first.Hash, []string{"blockhash", "total_out", "txs", "totalfee"}},
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
}
