package activity

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/Primexz/nodarium/internal/storage"
	"os"
	"testing"
	"time"

	"github.com/Primexz/nodarium/internal/collector"
	"github.com/Primexz/nodarium/internal/rpc"
)

func TestCoreActivityRegtest(t *testing.T) {
	endpoint, zmqEndpoint := os.Getenv("TEST_BITCOIN_RPC_URL"), os.Getenv("TEST_BITCOIN_ZMQ_URL")
	if endpoint == "" || zmqEndpoint == "" {
		t.Skip("disposable Core RPC/ZMQ fixture not configured")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 35*time.Second)
	defer cancel()
	client := rpc.New(endpoint, "monitor", "integration-only", nil)
	var ignored any
	wallet := fmt.Sprintf("activity-%d", time.Now().UnixNano())
	if err := client.Call(ctx, "createwallet", []any{wallet}, &ignored); err != nil {
		t.Fatal(err)
	}
	walletClient := rpc.New(endpoint+"/wallet/"+wallet, "monitor", "integration-only", nil)
	var address string
	if err := walletClient.Call(ctx, "getnewaddress", nil, &address); err != nil {
		t.Fatal(err)
	}
	if err := client.Call(ctx, "generatetoaddress", []any{101, address}, &ignored); err != nil {
		t.Fatal(err)
	}
	var chain rpc.Blockchain
	if err := client.Call(ctx, "getblockchaininfo", nil, &chain); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	snapshots := snapshotFunc(func() collector.Snapshot {
		return collector.Snapshot{Node: "regtest", Status: "connected", Overview: collector.Section[collector.Overview]{UpdatedAt: &now, Data: &collector.Overview{Blockchain: chain}}}
	})
	store := &memoryStore{}
	service := New(ctx, client, snapshots, store, ZMQReceiver{URL: zmqEndpoint}, nil, nil)
	defer service.Close()
	q, unsubscribe := service.Subscribe(true, "")
	defer unsubscribe()
	<-q
	wait := func(description string, condition func() bool) {
		t.Helper()
		for !condition() {
			select {
			case <-ctx.Done():
				state, _ := json.Marshal(service.Snapshot())
				store.mu.Lock()
				events := append([]storage.ActivityEvent{}, store.events...)
				store.mu.Unlock()
				t.Fatal(description, "timed out", string(state), "events", events)
			case <-time.After(10 * time.Millisecond):
			}
		}
	}
	wait("RPC baseline", func() bool { return service.Snapshot().Status == "ready" })
	// Give the SUB handshake time to complete, then send a real wallet transaction.
	time.Sleep(300 * time.Millisecond)
	var destination string
	walletClient.Call(ctx, "getnewaddress", nil, &destination)
	var txid string
	if err := walletClient.Call(ctx, "sendtoaddress", []any{destination, 1}, &txid); err != nil {
		t.Fatal(err)
	}
	wait("native libzmq A notification", func() bool {
		live := service.Snapshot()
		return live.Source == "zmq" && live.Arrivals == 1 && len(live.Transactions) == 1
	})
	if service.Snapshot().Transactions[0].TxID != txid {
		t.Fatal("sequence hash does not match RPC txid")
	}
	var blocks []string
	if err := client.Call(ctx, "generatetoaddress", []any{1, address}, &blocks); err != nil {
		t.Fatal(err)
	}
	wait("verified transaction confirmation", func() bool {
		live := service.Snapshot()
		return live.Block != nil && live.Block.Hash == blocks[0] && len(live.Block.Transactions) == 1 && live.Block.Transactions[0].TxID == txid
	})
	wait("event persistence", func() bool {
		store.mu.Lock()
		defer store.mu.Unlock()
		return len(store.events) == 1 && store.events[0].Kind == "block"
	})
	// A following A message must not reset the scene because mined removals advance
	// Core's mempool sequence without publishing R frames.
	if err := walletClient.Call(ctx, "sendtoaddress", []any{destination, 1}, &txid); err != nil {
		t.Fatal(err)
	}
	wait("post-block sequence", func() bool {
		live := service.Snapshot()
		return live.Source == "zmq" && live.Arrivals == 2 && len(live.Transactions) == 1
	})
	// Core returns null for this fixture-only mutation; the read-only client rejects empty results.
	if err := client.Call(ctx, "invalidateblock", []any{blocks[0]}, &ignored); err != nil && err.Error() != "empty RPC response" {
		t.Fatal(err)
	}
	wait("native D notification/reorg", func() bool {
		store.mu.Lock()
		defer store.mu.Unlock()
		for _, event := range store.events {
			if event.Kind == "reorg" && event.Depth != nil && *event.Depth == 1 {
				return true
			}
		}
		return false
	})
}
