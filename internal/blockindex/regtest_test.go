package blockindex

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Primexz/nodarium/internal/miningpool"
	"github.com/Primexz/nodarium/internal/rpc"
	"github.com/Primexz/nodarium/internal/storage"
)

func TestCoreRegtestIndex(t *testing.T) {
	endpoint := os.Getenv("TEST_BITCOIN_RPC_URL")
	if endpoint == "" {
		t.Skip("TEST_BITCOIN_RPC_URL not set")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	client := rpc.New(endpoint, "monitor", "integration-only", nil)
	var chain rpc.Blockchain
	if err := client.Call(ctx, "getblockchaininfo", nil, &chain); err != nil {
		t.Fatal(err)
	}
	// The disposable fixture starts at genesis; override only its IBD flag so
	// this test can exercise real header/metadata RPCs without mining a wallet.
	chain.InitialBlockDownload = false
	db, err := storage.Open(ctx, "sqlite", filepath.Join(t.TempDir(), "core.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	registry, err := miningpool.Load()
	if err != nil {
		t.Fatal(err)
	}
	index := New(ctx, client, db, registry, nil)
	defer index.Close()
	index.Observe(&chain)
	for {
		status, err := index.Status(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if status.Headers >= 1 {
			break
		}
		if err := pause(ctx, 25*time.Millisecond); err != nil {
			t.Fatal("Core index did not initialize", err)
		}
	}
	block, pool, err := index.Block(ctx, chain.BestBlockHash)
	if err != nil {
		t.Fatal(err)
	}
	var metadata rpc.BlockMetadata
	if err := client.Call(ctx, "getblock", []any{chain.BestBlockHash, 1}, &metadata); err != nil {
		t.Fatal(err)
	}
	if block.SizeBytes == nil || *block.SizeBytes != *metadata.Size || block.WeightUnits == nil || *block.WeightUnits != *metadata.Weight {
		t.Fatalf("stored measurements differ from Core: %+v", block)
	}
	if pool.Status != "unsupported" {
		t.Fatal("regtest was attributed to a mainnet mining pool")
	}
}
