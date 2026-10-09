package collector

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/Primexz/nodarium/internal/rpc"
	"github.com/Primexz/nodarium/internal/storage"
)

type fakeRPC struct {
	fail                   map[string]bool
	received, sent, uptime int64
	tip                    string
	chain                  string
	peers                  []rpc.Peer
}

func (f *fakeRPC) Call(ctx context.Context, method string, params any, out any) error {
	if f.fail[method] {
		return errors.New("node unavailable")
	}

	var data any

	switch method {
	case "getblockchaininfo":
		data = rpc.Blockchain{
			Chain:                f.chain,
			Blocks:               100,
			Headers:              101,
			BestBlockHash:        f.tip,
			InitialBlockDownload: true,
			Pruned:               true,
			VerificationProgress: .99,
		}

	case "getnetworkinfo":
		data = rpc.Network{Connections: len(f.peers), ConnectionsOut: len(f.peers)}

	case "getpeerinfo":
		data = f.peers

	case "getmempoolinfo":
		data = rpc.Mempool{Size: 42, MinFee: .00001}

	case "getnettotals":
		data = rpc.NetTotals{Received: f.received, Sent: f.sent}

	case "uptime":
		data = f.uptime

	case "getblockheader":
		data = rpc.Block{Hash: f.tip, Height: 100, Time: time.Now().Unix()}
	}

	b, _ := json.Marshal(data)

	return json.Unmarshal(b, out)
}

type memoryStore struct {
	fail   bool
	values map[string]storage.Measurement
}

func (s *memoryStore) Save(_ context.Context, _ string, _ time.Time, v map[string]storage.Measurement) error {
	s.values = v

	if s.fail {
		return errors.New("password must never leak")
	}

	return nil
}

func (s *memoryStore) Prune(context.Context, time.Time) error {
	return nil
}

func TestCollectorRecovery(t *testing.T) {
	f := &fakeRPC{
		fail:     map[string]bool{},
		chain:    "regtest",
		tip:      "a",
		uptime:   100,
		received: 1000,
		sent:     500,
	}

	db := &memoryStore{}
	c := New(f, db, "http://node:8332", 10*time.Second, nil)
	ctx := context.Background()
	c.Collect(ctx)
	s := c.Snapshot()

	if s.Status != "connected" ||
		s.Overview.Data == nil ||
		!s.Overview.Data.Blockchain.Pruned ||
		len(*s.Peers.Data) != 0 ||
		s.Traffic.Data.ReceiveRate != nil {
		t.Fatalf("bad initial snapshot %+v", s)
	}

	c.previous.at = time.Now().Add(-10 * time.Second)
	f.received += 100
	f.sent += 50
	f.uptime += 10
	c.Collect(ctx)

	if c.Snapshot().Traffic.Data.ReceiveRate == nil || db.values["rx_rate"].Total != 100 {
		t.Fatal("rate missing")
	}

	f.uptime = 1
	f.received = 1
	c.Collect(ctx)

	if c.Snapshot().Traffic.Data.ReceiveRate != nil {
		t.Fatal("restart produced invalid rate")
	}

	f.fail["getnettotals"] = true
	c.Collect(ctx)

	if c.Snapshot().Status != "partial" || !c.Snapshot().Traffic.Stale {
		t.Fatal("partial failure hidden")
	}

	delete(f.fail, "getnettotals")
	c.Collect(ctx)

	if c.Snapshot().Traffic.Data.ReceiveRate != nil {
		t.Fatal("gap bridged")
	}

	db.fail = true
	c.Collect(ctx)

	if c.Snapshot().PersistenceError == "" || strings.Contains(c.Snapshot().PersistenceError, "password") {
		t.Fatal("storage error not sanitized")
	}

	if c.Snapshot().Status != "connected" {
		t.Fatal("database broke live monitoring")
	}

	db.fail = false
	f.tip = "b"
	c.Collect(ctx)

	if (*c.Snapshot().Blocks.Data)[0].Hash != "b" || c.Snapshot().PersistenceError != "" {
		t.Fatal("recovery failed")
	}

	for _, m := range []string{
		"getblockchaininfo",
		"getnetworkinfo",
		"getpeerinfo",
		"getnettotals",
		"getmempoolinfo",
		"uptime",
	} {
		f.fail[m] = true
	}

	c.Collect(ctx)
	s = c.Snapshot()

	if s.Status != "disconnected" || s.Overview.Data == nil || !s.Overview.Stale {
		t.Fatal("stale data lost")
	}
}

func TestLongGapAndChainIsolation(t *testing.T) {
	f := &fakeRPC{fail: map[string]bool{}, chain: "regtest", tip: "a", uptime: 100}
	c := New(f, &memoryStore{}, "node", 10*time.Second, nil)
	c.Collect(context.Background())
	old := c.Snapshot().Node
	c.previous.at = time.Now().Add(-time.Hour)
	f.received = 100
	c.Collect(context.Background())

	if c.Snapshot().Traffic.Data.ReceiveRate != nil {
		t.Fatal("long gap bridged")
	}

	f.chain = "signet"
	c.Collect(context.Background())

	if c.Snapshot().Node == old || c.Snapshot().Traffic.Data.ReceiveRate != nil {
		t.Fatal("chains mixed")
	}
}
