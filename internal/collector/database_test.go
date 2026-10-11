package collector

import (
	"testing"
	"time"
)

func TestDatabaseSizeSurvivesFailureAndOfflineNode(t *testing.T) {
	rpc := &fakeRPC{fail: map[string]bool{}, chain: "regtest", tip: "a", uptime: 100}
	store := &memoryStore{size: 1048576}
	c := New(rpc, store, "node", 10*time.Second, nil)
	c.Collect(t.Context())
	first := c.Snapshot().Database
	if first.Data == nil || first.Data.SizeBytes != store.size || first.UpdatedAt == nil || first.Stale {
		t.Fatalf("database reading missing: %+v", first)
	}
	store.fail = true
	c.Collect(t.Context())
	failed := c.Snapshot().Database
	if failed.Data != first.Data || !failed.Stale || failed.Error == "" || !failed.UpdatedAt.Equal(*first.UpdatedAt) {
		t.Fatalf("last database reading lost: %+v", failed)
	}
	if c.Snapshot().Status != "connected" {
		t.Fatal("database measurement changed Core status")
	}
	store.fail = false
	store.size *= 2
	for _, method := range []string{"getblockchaininfo", "getnetworkinfo", "getpeerinfo", "getnettotals", "getmempoolinfo", "uptime"} {
		rpc.fail[method] = true
	}
	c.Collect(t.Context())
	recovered := c.Snapshot().Database
	if recovered.Data.SizeBytes != store.size || recovered.Stale || recovered.Error != "" || c.Snapshot().Status != "disconnected" {
		t.Fatalf("local measurement depends on Core availability: %+v", recovered)
	}
}
